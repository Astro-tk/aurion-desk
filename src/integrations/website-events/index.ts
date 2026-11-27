import { z } from 'zod';
import { hmacHex } from '@/lib/crypto';

/**
 * First-party, cookieless events from aurioncreative.com: the bio links page (aurioncreative.com/links).
 * This is the first piece of the Phase 2 analytics module, built on the same event store.
 *
 * Privacy rules (POPIA):
 *  - no cookies, no local storage, nothing personal in the body;
 *  - the page sends nothing when the browser asks not to be tracked (DNT or GPC);
 *  - Desk never stores the IP address or user agent. It stores only a visitor code made from
 *    them with a keyed hash that also includes the date, so it changes every day and cannot
 *    be reversed or followed across days. That is enough to count unique visitors per day.
 */
export const EVENT_MAX_BYTES = 2 * 1024;

const slug = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.trim().toLowerCase())
    .refine((s) => /^[a-z0-9][a-z0-9_-]*$/.test(s), 'Use letters, numbers, - and _ only.');

export const websiteEventSchema = z
  .object({
    t: z.enum(['view', 'click']),
    page: slug(30).default('bio'),
    link: slug(40).optional(),
    label: z.string().max(80).optional(),
    via: z.string().max(30).optional(),
    ref: z.string().max(200).optional(),
  })
  .strip()
  .refine((e) => e.t !== 'click' || Boolean(e.link), { message: 'A click needs a link.', path: ['link'] });

export type WebsiteEvent = z.infer<typeof websiteEventSchema>;

const VIA_ALIASES: Record<string, string> = {
  ig: 'instagram', insta: 'instagram', instagram: 'instagram',
  li: 'linkedin', linkedin: 'linkedin',
  fb: 'facebook', facebook: 'facebook',
  yt: 'youtube', youtube: 'youtube',
  tt: 'tiktok', tiktok: 'tiktok',
  x: 'x', twitter: 'x',
  wa: 'whatsapp', whatsapp: 'whatsapp',
  email: 'email', mail: 'email', signature: 'email',
  qr: 'qr', print: 'qr',
};

const REFERRER_SOURCES: Array<[RegExp, string]> = [
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'],
  [/(^|\.)(facebook\.com|fb\.me|messenger\.com)$/, 'facebook'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(t\.co|x\.com|twitter\.com)$/, 'x'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'whatsapp'],
  [/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com)$/, 'search'],
];

/** Host only, never the full referrer URL (it can carry personal data in its query). */
export function referrerHost(ref: string | undefined): string | null {
  if (!ref) return null;
  try {
    const host = new URL(ref).hostname.toLowerCase().replace(/^www\./, '');
    return host.length > 0 && host.length <= 100 ? host : null;
  } catch {
    return null;
  }
}

/** Which social bio (or other place) the visit came from: ?via= first, then the referrer. */
export function sourceOf(via: string | undefined, refHost: string | null): string {
  const v = (via ?? '').trim().toLowerCase();
  if (v) return VIA_ALIASES[v] ?? (/^[a-z0-9-]{1,20}$/.test(v) ? v : 'other');
  if (!refHost) return 'direct';
  if (refHost === 'aurioncreative.com') return 'website';
  for (const [rx, name] of REFERRER_SOURCES) if (rx.test(refHost)) return name;
  return 'other';
}

const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp\/|telegrambot|discordbot|headless|lighthouse|curl|wget|python-requests|httpclient/i;

export function isBot(userAgent: string | null): boolean {
  return !userAgent || BOT_UA.test(userAgent);
}

export function deviceOf(userAgent: string | null): 'mobile' | 'tablet' | 'desktop' {
  const ua = userAgent ?? '';
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** Daily-rotating visitor code: same person, same day = same code; a new code tomorrow. */
export function dailyVisitorCode(pepper: string, sastDate: string, ip: string, userAgent: string): string {
  return hmacHex(pepper, `visitor|${sastDate}|${ip}|${userAgent}`).slice(0, 16);
}

export interface StoredWebsiteEvent {
  type: 'link_page_view' | 'link_click';
  subject_type: 'link_page' | 'link';
  subject_id: string;
  anon_id: string;
  payload: { page: string; via: string; ref_host: string | null; device: string; label?: string };
}

export function toStoredEvent(e: WebsiteEvent, ctx: { anonId: string; userAgent: string | null }): StoredWebsiteEvent {
  const refHost = referrerHost(e.ref);
  const base = { page: e.page, via: sourceOf(e.via, refHost), ref_host: refHost, device: deviceOf(ctx.userAgent) };
  if (e.t === 'view') {
    return { type: 'link_page_view', subject_type: 'link_page', subject_id: e.page, anon_id: ctx.anonId, payload: base };
  }
  return {
    type: 'link_click',
    subject_type: 'link',
    subject_id: e.link!,
    anon_id: ctx.anonId,
    payload: { ...base, label: (e.label ?? e.link!).replace(/[\u0000-\u001f]/g, '').slice(0, 80) },
  };
}
