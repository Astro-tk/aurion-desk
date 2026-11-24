import Link from 'next/link';
import { AutoSubmitSelect } from '@/components/forms';
import type { Lists } from '@/lib/lists';
import { boardStageAction } from './actions';
import { ConsentChip, NextDate, leadTitle } from './components';
import type { LeadOverview } from './queries';

/** Board by stage. One tap on the stage select moves a card; no dragging needed on a phone. */
export function Board({ leads, lists, canWrite }: { leads: LeadOverview[]; lists: Lists; canWrite: boolean }) {
  const options = lists.stages.map((s) => ({ value: s.key, label: s.label }));
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="flex gap-3">
        {lists.stages.map((stage) => {
          const cards = leads.filter((l) => l.stage_key === stage.key);
          return (
            <section key={stage.key} className="w-72 shrink-0" aria-label={stage.label}>
              <h2 className="mb-2 flex items-center justify-between text-xs font-semibold tracking-wide text-ink-2 uppercase">
                {stage.label}
                <span className="num text-ink-3">{cards.length}</span>
              </h2>
              <ul className="space-y-2">
                {cards.map((l) => (
                  <li key={l.id} className={`card p-2 ${l.is_overdue ? 'border-danger' : ''}`}>
                    <Link href={`/pipeline/${l.id}`} className="block text-sm font-medium hover:underline">
                      {leadTitle(l)}
                    </Link>
                    {l.full_name && l.organisation_name ? <div className="text-xs text-ink-3">{l.organisation_name}</div> : null}
                    {l.next_action ? <div className="mt-1 text-xs text-ink-2">{l.next_action}</div> : null}
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                      <NextDate lead={l} />
                      <ConsentChip status={l.consent_status} />
                    </div>
                    {canWrite ? (
                      <form action={boardStageAction} className="mt-2">
                        <input type="hidden" name="lead_id" value={l.id} />
                        <AutoSubmitSelect name="stage_key" defaultValue={l.stage_key} options={options} label={`Stage for ${leadTitle(l)}`} />
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
