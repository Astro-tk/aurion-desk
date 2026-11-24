import { z } from 'zod';
import { hmacHex, safeEqual } from '@/lib/crypto';
import { toE164 } from '@/lib/phone';
import type { IngestCheck, IngestSource, IngestedLead } from '../types';

/**
 * Server-to-server ingest from aurion-assistant.
 *
 * Signing (the chatbot does exactly this; see its desk-ingest branch):
 *   timestamp = current Unix time in seconds, as a string
 *   signature = hex( HMAC-SHA256( INGEST_SIGNING_SECRET, `${timestamp}.${rawBody}` ) )
 *   headers:   X-Aurion-Timestamp: <timestamp>
 *              X-Aurion-Signature: sha256=<signature>
 * Desk refuses a bad signature (401), a timestamp more than 5 minutes away (401), and the
 * same signature seen twice (409, checked in the handler against desk.ingest_nonces).
 */
export const CHATBOT_MAX_BYTES = 64 * 1024;
export const MAX_SKEW_SECONDS = 300;
export const CHATBOT_CONSENT_WORDING = 'Consent given in the Aurion Assistant chat to be contacted about this enquiry.';

const str = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ?? '').trim() || null);

export const chatbotPayloadSchema = z
  .object({
    name: str(120),
    company: str(200),
    email: z
      .string()
      .max(200)
      .optional()
      .nullable()
      .transform((v) => (v ?? '').trim().toLowerCase() || null)
      .refine((v) => v === null || z.email().safeParse(v).success, 'bad email'),
    phone: str(40),
    need: str(1000),
    offer: str(100),
    score: z.number().int().min(1).max(5),
    reason: str(1000),
    consent: z.boolean(),
    consent_wording: str(300),
    transcript_id: z.string().min(1).max(120),
    channel: z.enum(['web', 'whatsapp']).optional(),
  })
  .strip();

export function signChatbotBody(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${hmacHex(secret, `${timestamp}.${rawBody}`)}`;
}

export function createChatbotSource(opts: { secret: string; now?: () => number }): IngestSource {
  const nowSeconds = () => Math.floor((opts.now ? opts.now() : Date.now()) / 1000);
  return {
    key: 'chatbot',
    maxBytes: CHATBOT_MAX_BYTES,
    authenticate(request: Request, raw: string): IngestCheck {
      const ts = request.headers.get('x-aurion-timestamp') ?? '';
      const sig = request.headers.get('x-aurion-signature') ?? '';
      if (!/^\d{9,11}$/.test(ts) || !sig.startsWith('sha256=')) return { ok: false, status: 401, error: 'missing signature' };
      if (Math.abs(nowSeconds() - Number(ts)) > MAX_SKEW_SECONDS) return { ok: false, status: 401, error: 'stale timestamp' };
      if (!safeEqual(signChatbotBody(opts.secret, ts, raw), sig)) return { ok: false, status: 401, error: 'bad signature' };
      return { ok: true };
    },
    parse(raw, contentType) {
      if (!contentType.includes('application/json')) return { ok: false, error: 'Send JSON.' };
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return { ok: false, error: 'Body is not valid JSON.' };
      }
      const parsed = chatbotPayloadSchema.safeParse(body);
      if (!parsed.success) return { ok: false, error: `${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}` };
      const c = parsed.data;
      const phone = c.phone ? toE164(c.phone) : null;
      if (!c.email && !phone) return { ok: false, error: 'A chatbot lead needs an email or a phone number.' };
      const lead: IngestedLead = {
        source: 'chatbot',
        dedupeKey: `chatbot:${c.transcript_id}`,
        name: c.name,
        company: c.company,
        email: c.email,
        phone,
        message: null,
        formId: null,
        pageUrl: null,
        need: c.need,
        offer: c.offer,
        score: c.score,
        scoreReason: c.reason,
        transcriptId: c.transcript_id,
        consentTicked: c.consent,
        consentWording: c.consent ? (c.consent_wording ?? CHATBOT_CONSENT_WORDING) : null,
        payload: { channel: c.channel ?? null, offer: c.offer, score: c.score, consent: c.consent, transcript_id: c.transcript_id },
      };
      return { ok: true, lead };
    },
  };
}
