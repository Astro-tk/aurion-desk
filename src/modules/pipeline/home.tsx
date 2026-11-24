import Link from 'next/link';
import { Card, EmptyState } from '@/components/ui';
import { userDb } from '@/lib/db/server';
import { formatDate } from '@/lib/format';
import { leadTitle } from './components';
import { foundingOfficePlacesLeft, overdueFollowUps } from './queries';

/** Home cards from the Pipeline: overdue follow-ups and the Founding Office counter. */
export default async function PipelineHomeCards() {
  const db = await userDb();
  const [overdue, founding] = await Promise.all([overdueFollowUps(db, 8), foundingOfficePlacesLeft(db)]);
  return (
    <>
      <Card
        title={`Overdue follow-ups${overdue.total ? ` (${overdue.total})` : ''}`}
        action={overdue.total > 8 ? <Link href="/pipeline?overdue=1" className="text-xs underline">All</Link> : null}
      >
        {overdue.rows.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing overdue.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {overdue.rows.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-2 py-1.5">
                <div className="min-w-0">
                  <Link href={`/pipeline/${l.id}`} className="font-medium hover:underline">
                    {leadTitle({ ...l, email: null, forgotten_at: null })}
                  </Link>
                  {l.next_action ? <div className="truncate text-xs text-ink-2">{l.next_action}</div> : null}
                </div>
                <span className="num shrink-0 text-xs font-semibold text-danger">{formatDate(l.next_date)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Founding Office">
        <div className="flex items-baseline gap-2">
          <span className="num text-3xl font-semibold text-accent">{founding.left}</span>
          <span className="text-sm text-ink-2">of {founding.places} places left</span>
        </div>
        <p className="mt-1 text-xs text-ink-3">Closes {formatDate(founding.closes)}. A place is taken when a lead marked Founding Office reaches Signed.</p>
      </Card>
    </>
  );
}

export function PipelineEmpty() {
  return <EmptyState sentence="No leads yet." actionLabel="Add a lead" actionHref="/pipeline/new" />;
}
