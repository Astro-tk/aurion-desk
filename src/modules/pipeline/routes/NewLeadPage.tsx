import { ActionForm, Field } from '@/components/forms';
import { PageHeader } from '@/components/ui';
import { requireMember } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { addDays, todaySast } from '@/lib/format';
import { getLists } from '@/lib/lists';
import { quickAddLeadAction } from '../actions';

/** Quick add: built to take under 15 seconds on a phone. Everything except one identifier is optional. */
export default async function NewLeadPage() {
  await requireMember();
  const lists = await getLists(await userDb());
  return (
    <>
      <PageHeader title="Add lead" subtitle="Name or firm, a way to reach them, and what happens next." />
      <div className="card max-w-xl p-3">
        <ActionForm action={quickAddLeadAction} submitLabel="Add lead" pendingLabel="Adding" resetOnSuccess>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="name">
              <input className="input" id="name" name="name" autoComplete="off" autoFocus />
            </Field>
            <Field label="Firm" htmlFor="firm">
              <input className="input" id="firm" name="firm" autoComplete="off" />
            </Field>
            <Field label="Email" htmlFor="email">
              <input className="input" id="email" name="email" type="email" inputMode="email" autoComplete="off" />
            </Field>
            <Field label="Phone" htmlFor="phone">
              <input className="input" id="phone" name="phone" type="tel" inputMode="tel" autoComplete="off" />
            </Field>
            <Field label="Channel" htmlFor="channel_key">
              <select className="input" id="channel_key" name="channel_key" defaultValue="">
                <option value="">Choose</option>
                {lists.channels.filter((c) => c.active).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.number ? `${c.number}. ` : ''}
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source" htmlFor="source_key">
              <select className="input" id="source_key" name="source_key" defaultValue="">
                <option value="">Choose</option>
                {lists.sources.filter((s) => s.active).map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Next action" htmlFor="next_action">
              <input className="input" id="next_action" name="next_action" placeholder="Send L1 when they accept" />
            </Field>
            <Field label="Next date" htmlFor="next_date">
              <input className="input" id="next_date" name="next_date" type="date" defaultValue={addDays(todaySast(), 2)} />
            </Field>
          </div>
        </ActionForm>
      </div>
    </>
  );
}
