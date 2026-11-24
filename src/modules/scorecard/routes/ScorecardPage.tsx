import Link from 'next/link';
import { ActionForm } from '@/components/forms';
import { EmptyState, PageHeader, Sparkline } from '@/components/ui';
import { memberCan, requireMember } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { addDays, formatDate, isIsoDate, todaySast, weekStart } from '@/lib/format';
import { saveEntriesAction } from '../actions';
import { lastWeeks, targetValue, weeklyCell, weeklyTargetsInForce } from '../compute';
import { loadEntries, loadStageChanges, loadTargets } from '../queries';
import { StatusChip, formatMetric, formatTarget } from '../view';

const TREND_WEEKS = 8;

export default async function ScorecardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireMember();
  const sp = await searchParams;
  const thisWeek = weekStart(todaySast());
  const week = sp.week && isIsoDate(sp.week) ? weekStart(sp.week) : thisWeek;
  const weeks = lastWeeks(week, TREND_WEEKS);
  const db = await userDb();
  const targets = await loadTargets(db);
  const inForce = weeklyTargetsInForce(targets, week);
  const stages = inForce.map((t) => t.source_filter.to_stage).filter((s): s is string => Boolean(s));
  const [entries, changes, canWrite] = await Promise.all([
    loadEntries(db, weeks[0]!, week),
    stages.length ? loadStageChanges(db, weeks[0]!, week, stages) : Promise.resolve([]),
    memberCan('scorecard.write'),
  ]);

  return (
    <>
      <PageHeader
        title="Scorecard"
        subtitle={`Week of ${formatDate(week)} to ${formatDate(addDays(week, 6))}. Fill it in on Sunday.`}
        actions={
          <Link href="/scorecard/december" className="btn">
            December channel targets
          </Link>
        }
      />
      <nav className="mb-3 flex flex-wrap items-center gap-2 text-sm" aria-label="Week">
        <Link className="chip" href={`/scorecard?week=${addDays(week, -7)}`}>
          Previous week
        </Link>
        {week !== thisWeek ? (
          <Link className="chip" href="/scorecard">
            This week
          </Link>
        ) : null}
        {week < thisWeek ? (
          <Link className="chip" href={`/scorecard?week=${addDays(week, 7)}`}>
            Next week
          </Link>
        ) : null}
      </nav>
      {inForce.length === 0 ? (
        <EmptyState sentence="No weekly targets are set for this week." actionLabel="Set targets" actionHref="/settings?tab=targets" />
      ) : (
        <ActionForm action={saveEntriesAction} submitLabel="Save this week" className="space-y-3">
          <input type="hidden" name="period_start" value={week} />
          <div className="card overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Target</th>
                  <th>This week</th>
                  <th>Status</th>
                  <th className="hidden sm:table-cell">Last {TREND_WEEKS} weeks</th>
                </tr>
              </thead>
              <tbody>
                {inForce.map((t) => {
                  const cell = weeklyCell(t, week, changes, entries);
                  const trend = weeks.map((w) => weeklyCell(t, w, changes, entries).value);
                  return (
                    <tr key={t.id}>
                      <td className="min-w-40">
                        {t.label}
                        {cell.auto ? <div className="text-xs text-ink-3">Counted from stage changes</div> : null}
                      </td>
                      <td className="num">{formatTarget(t)}</td>
                      <td className="num">
                        {cell.auto || !canWrite ? (
                          formatMetric(t, cell.value)
                        ) : (
                          <input
                            className="input w-28"
                            name={`v_${t.id}`}
                            inputMode="decimal"
                            defaultValue={cell.value === null ? '' : t.unit === 'cents' ? (cell.value / 100).toFixed(2) : String(cell.value)}
                            placeholder={t.unit === 'cents' ? 'R' : t.unit === 'hours' ? 'hours' : 'number'}
                            aria-label={`${t.label} this week`}
                          />
                        )}
                      </td>
                      <td>
                        <StatusChip cell={cell} />
                      </td>
                      <td className="hidden sm:table-cell">
                        <Sparkline values={trend} target={targetValue(t)} label={`${t.label}: last ${TREND_WEEKS} weeks`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ActionForm>
      )}
    </>
  );
}
