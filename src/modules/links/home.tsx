import Link from 'next/link';
import { Card, Stat } from '@/components/ui';
import { userDb } from '@/lib/db/server';
import { formatCount } from '@/lib/format';
import { ctr, linkStats, SOURCE_LABELS } from './queries';

export default async function LinksHomeCard() {
  const s = await linkStats(await userDb(), 7);
  const topSource = s.by_source[0];
  const topLink = s.by_link[0];
  return (
    <Card title="Bio links, last 7 days" action={<Link href="/links" className="text-xs underline">Bio links</Link>}>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Views" value={formatCount(s.views)} />
        <Stat label="Clicks" value={formatCount(s.clicks)} />
        <Stat label="Rate" value={ctr(s.clicks, s.views)} />
      </div>
      {topSource || topLink ? (
        <p className="mt-2 text-xs text-ink-3">
          {topSource ? `Most visits from ${SOURCE_LABELS[topSource.source] ?? topSource.source}. ` : ''}
          {topLink ? `Top link: ${topLink.label ?? topLink.link}.` : ''}
        </p>
      ) : null}
    </Card>
  );
}
