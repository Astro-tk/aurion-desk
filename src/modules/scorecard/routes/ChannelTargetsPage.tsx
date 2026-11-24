import Link from 'next/link';
import { ActionForm } from '@/components/forms';
import { EmptyState, PageHeader, ProgressBar } from '@/components/ui';
import { memberCan, requireMember } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { formatDate } from '@/lib/format';
import { channelLabel, getLists } from '@/lib/lists';
import { saveEntriesAction } from '../actions';
import { channelCell, targetValue, type Target } from '../compute';
import { loadEntries, loadLeadFacts, loadTargets } from '../queries';
import { StatusChip, formatMetric, formatTarget } from '../view';

/** Channel targets for a period (December by default), from blueprint section 3. */
export default async function ChannelTargetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireMember();
  const sp = await searchParams;
  const db = await userDb();
  const [all, lists, canWrite] = await Promise.all([loadTargets(db), getLists(db), memberCan('scorecard.write')]);
  const channelTargets = all.filter((t) => t.kind === 'channel');
  const periods = [...new Set(channelTargets.map((t) => t.period_start))].sort();
  const period = sp.period && periods.includes(sp.period) ? sp.period : (periods.at(-1) ?? null);
  if (!period) {
    return (
      <>
        <PageHeader title="Channel targets" />
        <EmptyState sentence="No channel targets yet." actionLabel="Set targets" actionHref="/settings?tab=targets" />
      </>
    );
  }
  const targets = channelTargets.filter((t) => t.period_start === period);
  const end = targets.find((t) => t.period_end)?.period_end ?? period;
  const [leads, entries] = await Promise.all([loadLeadFacts(db, period, end), loadEntries(db, period, period)]);
  const byChannel = new Map<string, Target[]>();
  for (const t of targets) byChannel.set(t.channel_key ?? '', [...(byChannel.get(t.channel_key ?? '') ?? []), t]);

  return (
    <>
      <PageHeader
        title="Channel targets"
        subtitle={`${formatDate(period)} to ${formatDate(end)}. "Logged" counts leads by channel and first contact date; the rest you enter.`}
        actions={
          <Link href="/scorecard" className="btn">
            Weekly scorecard
          </Link>
        }
      />
      {periods.length > 1 ? (
        <nav className="mb-3 flex gap-2">
          {periods.map((p) => (
            <Link key={p} href={`/scorecard/december?period=${p}`} className={p === period ? 'chip-accent' : 'chip'}>
              {formatDate(p)}
            </Link>
          ))}
        </nav>
      ) : null}
      <ActionForm action={saveEntriesAction} submitLabel="Save counts">
        <input type="hidden" name="period_start" value={period} />
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th>What</th>
                <th>Target</th>
                <th>Logged</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {[...byChannel.entries()].map(([channel, ts]) =>
                ts.map((t, i) => {
                  const cell = channelCell(t, leads, entries);
                  const target = targetValue(t);
                  return (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap">{i === 0 ? channelLabel(lists.channels, channel) : ''}</td>
                      <td className="min-w-40">
                        {t.label}
                        {t.due_date ? <div className="text-xs text-ink-3">By {formatDate(t.due_date)}</div> : null}
                      </td>
                      <td className="num">{formatTarget(t)}</td>
                      <td className="num min-w-28">
                        {cell.auto || !canWrite ? (
                          <>
                            {formatMetric(t, cell.value)}
                            {cell.auto ? <div className="text-xs text-ink-3">from leads</div> : null}
                          </>
                        ) : t.unit === 'milestone' ? (
                          <select className="input w-28" name={`v_${t.id}`} defaultValue={cell.value === null ? '' : String(cell.value >= 1 ? 1 : 0)} aria-label={t.label}>
                            <option value="">Not set</option>
                            <option value="0">Not yet</option>
                            <option value="1">Done</option>
                          </select>
                        ) : (
                          <input className="input w-24" name={`v_${t.id}`} inputMode="numeric" defaultValue={cell.value ?? ''} aria-label={`${t.label} so far`} />
                        )}
                        {target && cell.value !== null ? (
                          <div className="mt-1">
                            <ProgressBar value={cell.value} max={target} />
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <StatusChip cell={cell} />
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </ActionForm>
    </>
  );
}
