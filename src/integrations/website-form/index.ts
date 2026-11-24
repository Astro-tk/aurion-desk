import { z } from 'zod';
import { sha256Hex } from '@/lib/crypto';
import { toE164 } from '@/lib/phone';
import type { IngestCheck, IngestSource, IngestedLead } from '../types';

/**
 * Website forms (homepage and contact). Public, so it is protected in layers:
 *   origin allowlist + CORS (browsers), payload size limit, honeypot, per-IP rate limit
 *   (in the handler), and strict Zod validation. Formspree stays the primary destination on
 *   the site, so a refusal here never loses a lead.
 */
export const DEFAULT_CONSENT_WORDING = 'Aurion may contact me about this enquiry.';
export const FORM_MAX_BYTES = 16 * 1024;

const truthy = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === 'true' || v === 'on' || v === 'yes' || v === '1');

const text = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v ?? '').replace(/\u0000/g, '').trim() || null);

export const formPayloadSchema = z
  .object({
    name: text(120),
    email: z
      .string()
      .max(200)
      .optional()
      .transform((v) => (v ?? '').trim().toLowerCase() || null)
      .refine((v) => v === null || z.email().safeParse(v).success, 'That email address does not look right.'),
    phone: text(40),
    company: text(200),
    message: text(5000),
    form_id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/i)
      .optional()
      .transform((v) => v?.toLowerCase() ?? 'website'),
    page_url: z.url().max(500).optional(),
    consent: truthy,
    consent_wording: text(300),
    // Honeypot: real visitors never see or fill this (Formspree uses the same name).
    _gotcha: z.string().max(500).optional(),
  })
  .strip();

export function originAllowed(origin: string | null, allowed: readonly string[]): boolean {
  return Boolean(origin && allowed.includes(origin.replace(/\/$/, '').toLowerCase()));
}

export function corsHeaders(origin: string | null, allowed: readonly string[]): Record<string, string> {
  if (!originAllowed(origin, allowed)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin!,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function bodyToObject(raw: string, contentType: string): unknown {
  if (contentType.includes('application/json')) return JSON.parse(raw);
  if (contentType.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  throw new Error('unsupported content type');
}

export function createFormSource(opts: { allowedOrigins: readonly string[]; now?: () => Date }): IngestSource {
  const allowed = opts.allowedOrigins.map((o) => o.toLowerCase());
  const now = opts.now ?? (() => new Date());
  return {
    key: 'form',
    maxBytes: FORM_MAX_BYTES,
    authenticate(request: Request): IngestCheck {
      if (!originAllowed(request.headers.get('origin'), allowed)) return { ok: false, status: 403, error: 'origin not allowed' };
      return { ok: true };
    },
    parse(raw, contentType) {
      let body: unknown;
      try {
        body = bodyToObject(raw, contentType);
      } catch {
        return { ok: false, error: 'Send JSON or a form post.' };
      }
      const parsed = formPayloadSchema.safeParse(body);
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid form.' };
      const f = parsed.data;
      if (f._gotcha && f._gotcha.trim() !== '') return { ok: true, lead: null };
      const phone = f.phone ? toE164(f.phone) : null;
      if (f.phone && !phone) return { ok: false, error: 'That phone number does not look right.' };
      if (!f.email && !phone) return { ok: false, error: 'Add an email address or a phone number.' };
      // Same person, same form, same minute: treat as one submission (double clicks, retries).
      const minute = now().toISOString().slice(0, 16);
      const dedupeKey = `form:${sha256Hex(`${f.email ?? ''}|${phone ?? ''}|${f.form_id}|${minute}`).slice(0, 40)}`;
      const lead: IngestedLead = {
        source: 'form',
        dedupeKey,
        name: f.name,
        company: f.company,
        email: f.email,
        phone,
        message: f.message,
        formId: f.form_id,
        pageUrl: f.page_url ?? null,
        need: null,
        offer: null,
        score: null,
        scoreReason: null,
        transcriptId: null,
        consentTicked: f.consent,
        consentWording: f.consent ? (f.consent_wording ?? DEFAULT_CONSENT_WORDING) : null,
        payload: { form_id: f.form_id, page_url: f.page_url ?? null, consent: f.consent, has_message: Boolean(f.message) },
      };
      return { ok: true, lead };
    },
  };
}
