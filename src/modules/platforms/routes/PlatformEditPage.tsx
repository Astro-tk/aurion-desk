import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ActionForm, Field } from '@/components/forms';
import { PageHeader } from '@/components/ui';
import { requireMember } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { savePlatformAction } from '../actions';
import { BILLING_CYCLES, PLATFORM_STATUSES, type Platform } from '../logic';

export default async function PlatformEditPage({ params }: { params: Promise<{ id?: string }> }) {
  await requireMember();
  const { id } = await params;
  let p: Platform | null = null;
  if (id) {
    if (!z.uuid().safeParse(id).success) notFound();
    const { data } = await (await userDb()).from('platforms').select('*').eq('id', id).maybeSingle();
    if (!data) notFound();
    p = data as Platform;
  }
  const cost = p?.monthly_cost_cents === null || p?.monthly_cost_cents === undefined ? '' : (Number(p.monthly_cost_cents) / 100).toFixed(2);
  return (
    <>
      <PageHeader title={p ? p.name : 'Add platform'} actions={<Link href="/platforms" className="btn">Back</Link>} />
      <div className="card max-w-2xl p-3">
        <ActionForm action={savePlatformAction} submitLabel="Save">
          {p ? <input type="hidden" name="id" value={p.id} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="name">
              <input className="input" id="name" name="name" defaultValue={p?.name ?? ''} required />
            </Field>
            <Field label="Status" htmlFor="status">
              <select className="input" id="status" name="status" defaultValue={p?.status ?? 'active'}>
                {Object.entries(PLATFORM_STATUSES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Monthly cost (R)" htmlFor="monthly_cost" hint="For annual plans, divide by 12.">
              <input className="input num" id="monthly_cost" name="monthly_cost" inputMode="decimal" defaultValue={cost} placeholder="0.00" />
            </Field>
            <Field label="Billing" htmlFor="billing_cycle">
              <select className="input" id="billing_cycle" name="billing_cycle" defaultValue={p?.billing_cycle ?? 'monthly'}>
                {Object.entries(BILLING_CYCLES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Renewal date" htmlFor="renewal_date">
              <input className="input" id="renewal_date" name="renewal_date" type="date" defaultValue={p?.renewal_date ?? ''} />
            </Field>
            <Field label="Owner email" htmlFor="owner_email">
              <input className="input" id="owner_email" name="owner_email" type="email" defaultValue={p?.owner_email ?? ''} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="auto_advance" defaultChecked={p?.auto_advance ?? true} /> Move the renewal date on by a cycle once it passes
          </label>
          <Field label="Purpose" htmlFor="purpose">
            <input className="input" id="purpose" name="purpose" defaultValue={p?.purpose ?? ''} />
          </Field>
          <Field label="Web address" htmlFor="url">
            <input className="input" id="url" name="url" type="url" defaultValue={p?.url ?? ''} placeholder="https://" />
          </Field>
          <Field label="Login kept in" htmlFor="login_location" hint='Where the login lives, for example "Bitwarden: Aurion > Vercel". Never the password or a key.'>
            <input className="input" id="login_location" name="login_location" defaultValue={p?.login_location ?? ''} autoComplete="off" />
          </Field>
          <Field label="Notes" htmlFor="notes">
            <textarea className="input" id="notes" name="notes" rows={3} defaultValue={p?.notes ?? ''} />
          </Field>
        </ActionForm>
      </div>
    </>
  );
}
