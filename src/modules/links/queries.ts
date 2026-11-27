import 'server-only';
import type { DeskClient } from '@/lib/db/server';
import { addDays, sastDayStartUtc, todaySast } from '@/lib/format';

export const BIO_URL = 'https://aurioncreative.com/links';

/** One link per place you post it, so Desk can tell which bio the visit came from. */
export const SHARE_LINKS: Array<{ source: string; label: string; url: string }> = [
  { source: 'instagram', label: 'Instagram bio', url: `${BIO_URL}?via=ig` },
  { source: 'linkedin', label: 'LinkedIn (profile and company page)', url: `${BIO_URL}?via=li` },
  { source: 'facebook', label: 'Facebook', url: `${BIO_URL}?via=fb` },
  { source: 'youtube', label: 'YouTube channel', url: `${BIO_URL}?via=yt` },
  { source: 'tiktok', label: 'TikTok', url: `${BIO_URL}?via=tt` },
  { source: 'whatsapp', label: 'WhatsApp Business profile', url: `${BIO_URL}?via=wa` },
  { source: 'email', label: 'Email signature', url: `${BIO_URL}?via=email` },
  { source: 'qr', label: 'QR code on the one-pager', url: `${BIO_URL}?via=qr` },
];

export const SOURCE_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  whatsapp: 'WhatsApp',
  email: 'Email signature',
  qr: 'QR code',
  search: 'Search engines',
  website: 'aurioncreative.com',
  direct: 'Direct or app (no referrer)',
  other: 'Other',
};

export interface LinkStats {
  views: number;
  clicks: number;
  visitors: number;
  clickers: number;
  by_link: Array<{ link: string; label: string | null; clicks: number }>;
  by_source: Array<{ source: string; views: number; clicks: number }>;
  by_device: Record<string, number>;
  by_day: Array<{ day: string; views: number; clicks: number }>;
}

const EMPTY: LinkStats = { views: 0, clicks: 0, visitors: 0, clickers: 0, by_link: [], by_source: [], by_device: {}, by_day: [] };

/** Stats for the last `days` days, including today (SAST). */
export async function linkStats(db: DeskClient, days: number, endDate: string = todaySast()): Promise<LinkStats & { from: string; to: string }> {
  const from = addDays(endDate, -(days - 1));
  const { data, error } = await db.rpc('link_stats', { p_from: sastDayStartUtc(from), p_to: sastDayStartUtc(addDays(endDate, 1)) });
  if (error) throw new Error(`Could not load link stats: ${error.message}`);
  return { ...EMPTY, ...((data ?? {}) as Partial<LinkStats>), from, to: endDate };
}

export function ctr(clicks: number, views: number): string {
  if (views === 0) return 'None yet';
  return `${Math.round((clicks / views) * 100)}%`;
}

/** Fill missing days with zeros so the chart shows quiet days too. */
export function fillDays(byDay: LinkStats['by_day'], from: string, to: string): LinkStats['by_day'] {
  const map = new Map(byDay.map((d) => [String(d.day).slice(0, 10), d]));
  const out: LinkStats['by_day'] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(map.get(d) ?? { day: d, views: 0, clicks: 0 });
  return out;
}
