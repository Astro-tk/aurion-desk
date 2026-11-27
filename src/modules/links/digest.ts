import { addDays, sastDayStartUtc } from '@/lib/format';
import type { DigestProvider } from '../types';
import { SOURCE_LABELS, type LinkStats } from './queries';

/** Today's bio-page numbers (the digest goes out at 18:00, so "today so far"). */
const provider: DigestProvider = async ({ date, db, appUrl }) => {
  const { data } = await db.rpc('link_stats', { p_from: sastDayStartUtc(date), p_to: sastDayStartUtc(addDays(date, 1)) });
  const s = (data ?? { views: 0, clicks: 0, by_link: [], by_source: [] }) as LinkStats;
  if (!s.views && !s.clicks) return [{ key: 'bio_links', title: 'Bio links today', lines: [] }];
  const lines = [{ text: `${s.views} view${s.views === 1 ? '' : 's'}, ${s.clicks} click${s.clicks === 1 ? '' : 's'}`, href: `${appUrl}/links?days=7` }];
  const top = s.by_source.slice(0, 3).map((x) => `${SOURCE_LABELS[x.source] ?? x.source} ${x.views}`);
  if (top.length) lines.push({ text: `From: ${top.join(', ')}`, href: `${appUrl}/links?days=7` });
  const links = s.by_link.slice(0, 3).map((l) => `${l.label ?? l.link} ${l.clicks}`);
  if (links.length) lines.push({ text: `Clicked: ${links.join(', ')}`, href: `${appUrl}/links?days=7` });
  return [{ key: 'bio_links', title: 'Bio links today', lines }];
};

export default provider;
