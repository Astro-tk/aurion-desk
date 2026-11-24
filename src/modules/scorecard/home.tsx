import Link from 'next/link';
import { Card } from '@/components/ui';
import { userDb } from '@/lib/db/server';
import { todaySast, weekStart } from '@/lib/format';
import { weeklyCell, weeklyTargetsInForce } from './compute';
import { loadEntries, loadStageChanges, loadTargets } from './queries';
import { StatusChip, formatMetric, formatTarget } from './view';

export default async function ScorecardHomeCard() {
  const db = await userDb();
  const week = weekStart(todaySast());
  const targets = weeklyTargetsInForce(await loadTargets(db), week);
  const stages = targets.map((t) => t.source_filter.to_stage).filter((s): s is string => Boolean(s));
  const [entries, changes] = await Promise.all([loadEntries(db, week, week), stages.length ? loadStageChanges(db, week, week, stages) : Promise.resolve([])]);
  return (
    <Card title="This week against target" action={<Link href="/scorecard" className="text-xs underline">Scorecard</Link>}>
      {targets.length === 0 ? (
        <p className="text-sm text-ink-3">No weekly targets set.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {targets.map((t) => {
              const cell = weeklyCell(t, week, changes, entries);
              return (
                <tr key={t.id} className="border-b border-line last:border-0">
                  <td className="py-1 pr-2">{t.label}</td>
                  <td className="num py-1 pr-2 text-right">
                    {formatMetric(t, cell.value)} <span className="text-ink-3">/ {formatTarget(t)}</span>
                  </td>
                  <td className="py-1 text-right">
                    <StatusChip cell={cell} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
