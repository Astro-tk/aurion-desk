import Link from 'next/link';
import { Card, EmptyState, PageHeader, ProgressBar, Stat } from '@/components/ui';
import { requireMember } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { formatCount, formatDate } from '@/lib/format';
import { DayChart } from '../DayChart';
import { BIO_URL, SHARE_LINKS, SOURCE_LABELS, ctr, fillDays, linkStats } from '../queries';

const PERIODS = [7, 30, 90] as const;

export default async function LinksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireMember();
  const sp = await searchParams;
  const days = PERIODS.find((p) => String(p) === sp.days) ?? 30;
  const stats = await linkStats(await userDb(), days);
  const chart = fillDays(stats.by_day, stats.from, stats.to);
  const topClicks = Math.max(1, ...stats.by_link.map((l) => l.clicks));

  return (
    <>
      <PageHeader
        title="Bio links"
        subtitle={
          <>
            Views and clicks on{' '}
            <a href={BIO_URL} target="_blank" rel="noopener noreferrer" className="underline">
              aurioncreative.com/links
            </a>
            , {formatDate(stats.from)} to {formatDate(stats.to)}. Cookieless: no personal data is stored.
          </>
        }
      />
      <nav className="mb-3 flex gap-2" aria-label="Period">
        {PERIODS.map((p) => (
          <Link key={p} href={`/links?days=${p}`} className={p === days ? 'chip-accent' : 'chip'}>
            Last {p} days
          </Link>
        ))}
      </nav>

      <section className="card mb-3 grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
        <Stat label="Page views" value={formatCount(stats.views)} />
        <Stat label="Visitors" value={formatCount(stats.visitors)} sub="Counted once per day" />
        <Stat label="Link clicks" value={formatCount(stats.clicks)} />
        <Stat label="Click rate" value={ctr(stats.clicks, stats.views)} sub="Clicks per view" />
      </section>

      {stats.views === 0 && stats.clicks === 0 ? (
        <div className="mb-3">
          <EmptyState sentence="No visits yet. Put the links below in your bios and they will show here within seconds." />
        </div>
      ) : (
        <Card title="Day by day" className="mb-3">
          <DayChart days={chart} />
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Clicks by link">
          {stats.by_link.length === 0 ? (
            <p className="text-sm text-ink-3">No clicks in this period.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {stats.by_link.map((l) => (
                <li key={l.link}>
                  <div className="flex justify-between gap-2">
                    <span>{l.label ?? l.link}</span>
                    <span className="num text-ink-2">{formatCount(l.clicks)}</span>
                  </div>
                  <ProgressBar value={l.clicks} max={topClicks} label={`${l.label ?? l.link}: ${l.clicks} clicks`} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Where visitors came from">
          {stats.by_source.length === 0 ? (
            <p className="text-sm text-ink-3">No visits in this period.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th className="text-right">Views</th>
                  <th className="text-right">Clicks</th>
                  <th className="text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {stats.by_source.map((s) => (
                  <tr key={s.source}>
                    <td>{SOURCE_LABELS[s.source] ?? s.source}</td>
                    <td className="num text-right">{formatCount(s.views)}</td>
                    <td className="num text-right">{formatCount(s.clicks)}</td>
                    <td className="num text-right">{ctr(s.clicks, s.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {Object.keys(stats.by_device).length ? (
            <p className="mt-2 text-xs text-ink-3">
              Devices:{' '}
              {Object.entries(stats.by_device)
                .map(([d, n]) => `${d} ${n}`)
                .join(', ')}
              .
            </p>
          ) : null}
        </Card>

        <Card title="Your bio links, one per platform" className="lg:col-span-2">
          <p className="mb-2 text-sm text-ink-2">
            Use the matching link on each platform so Desk can tell which bio sent the visitor. All of them open the same page.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Put it on</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {SHARE_LINKS.map((s) => (
                <tr key={s.source}>
                  <td className="whitespace-nowrap">{s.label}</td>
                  <td>
                    <code className="font-mono text-xs break-all select-all">{s.url}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-3">
            Enquiries sent through &quot;Book a Workflow Audit&quot; arrive in the Inbox as usual, with the source shown in the page address.
          </p>
        </Card>
      </div>
    </>
  );
}
