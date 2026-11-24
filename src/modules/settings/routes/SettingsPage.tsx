import Link from 'next/link';
import { ActionForm, Field } from '@/components/forms';
import { Card, Notice, PageHeader } from '@/components/ui';
import { memberCan, requireMember } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { formatDate, formatDateTime, formatRand, todaySast } from '@/lib/format';
import { EDITABLE_LISTS, channelLabel, getLists, type EditableList, type ListItem } from '@/lib/lists';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password';
import {
  addListItemAction,
  addTargetAction,
  changePasswordAction,
  forgetContactAction,
  removeFactorAction,
  updateListItemAction,
  updateProfileAction,
  updateTargetAction,
} from '../actions';
import { BackupFactor } from '../BackupFactor';

const TABS = {
  lists: 'Lists',
  targets: 'Targets',
  account: 'Profile and two-factor',
  data: 'Data export',
  danger: 'Danger zone',
  audit: 'Audit log',
} as const;
type Tab = keyof typeof TABS;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const member = await requireMember();
  const sp = await searchParams;
  const tab: Tab = sp.tab && sp.tab in TABS ? (sp.tab as Tab) : 'lists';
  const [canWrite, canExport, canForget, canAudit] = await Promise.all([
    memberCan('settings.write'),
    memberCan('data.export'),
    memberCan('contacts.forget'),
    memberCan('audit.read'),
  ]);
  return (
    <>
      <PageHeader title="Settings" />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Settings sections">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link key={t} href={`/settings?tab=${t}`} className={t === tab ? 'chip-accent' : 'chip'}>
            {TABS[t]}
          </Link>
        ))}
      </nav>
      {tab === 'lists' ? <ListsTab canWrite={canWrite} /> : null}
      {tab === 'targets' ? <TargetsTab canWrite={canWrite} /> : null}
      {tab === 'account' ? <AccountTab displayName={member.displayName} email={member.email} /> : null}
      {tab === 'data' ? <DataTab canExport={canExport} /> : null}
      {tab === 'danger' ? <DangerTab canForget={canForget} q={sp.q} /> : null}
      {tab === 'audit' ? (canAudit ? <AuditTab /> : <Notice>You cannot see the audit log.</Notice>) : null}
    </>
  );
}

// ---------------------------------------------------------------- lists

async function ListsTab({ canWrite }: { canWrite: boolean }) {
  const lists = await getLists(await userDb());
  const byTable: Record<EditableList, ListItem[]> = {
    org_types: lists.orgTypes,
    lead_sources: lists.sources,
    channels: lists.channels,
    contact_methods: lists.contactMethods,
    activity_purposes: lists.activityPurposes,
  };
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <p className="text-sm text-ink-2 lg:col-span-2">
        Values are never deleted, only switched off, so old leads keep their meaning. Stages are fixed by the blueprint: {lists.stages.map((s) => s.label).join(', ')}.
      </p>
      {(Object.keys(EDITABLE_LISTS) as EditableList[]).map((table) => (
        <Card key={table} title={EDITABLE_LISTS[table]}>
          <ul className="divide-y divide-line">
            {byTable[table].map((item) => (
              <li key={item.key} className="py-1.5">
                {canWrite ? (
                  <ActionForm action={updateListItemAction} submitLabel="Save" className="flex flex-wrap items-center gap-2" submitClass="btn btn-sm">
                    <input type="hidden" name="list" value={table} />
                    <input type="hidden" name="key" value={item.key} />
                    <input className="input min-h-8 w-44 py-1" name="label" defaultValue={item.label} aria-label={`Label for ${item.key}`} />
                    <input className="input min-h-8 w-16 py-1" name="sort_order" type="number" min={0} defaultValue={item.sort_order} aria-label="Order" />
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" name="active" defaultChecked={item.active} /> In use
                    </label>
                  </ActionForm>
                ) : (
                  <span className={item.active ? '' : 'text-ink-3 line-through'}>{item.label}</span>
                )}
              </li>
            ))}
          </ul>
          {canWrite ? (
            <ActionForm action={addListItemAction} submitLabel="Add" resetOnSuccess className="mt-2 flex items-end gap-2" submitClass="btn btn-sm">
              <input type="hidden" name="list" value={table} />
              <input className="input min-h-8 py-1" name="label" placeholder={`New ${EDITABLE_LISTS[table].toLowerCase().replace(/s$/, '')}`} aria-label="New value" />
            </ActionForm>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- targets

async function TargetsTab({ canWrite }: { canWrite: boolean }) {
  const db = await userDb();
  const [{ data }, lists] = await Promise.all([db.from('targets').select('*').order('kind').order('period_start').order('sort_order'), getLists(db)]);
  const targets = (data ?? []) as Array<{
    id: string;
    kind: string;
    label: string;
    channel_key: string | null;
    period_start: string;
    unit: string;
    target_value: number | null;
    target_cents: number | null;
    cap_value: number | null;
    count_source: string;
    active: boolean;
  }>;
  const show = (t: (typeof targets)[number]) => (t.unit === 'cents' ? (t.target_cents === null ? '' : (Number(t.target_cents) / 100).toFixed(2)) : (t.target_value ?? ''));
  return (
    <div className="space-y-3">
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Metric</th>
              <th>From</th>
              <th>Target</th>
              <th>Cap</th>
              <th>Counted from</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap">{t.kind === 'weekly' ? 'Weekly' : channelLabel(lists.channels, t.channel_key)}</td>
                <td colSpan={canWrite ? 4 : 1}>
                  {canWrite ? (
                    <ActionForm action={updateTargetAction} submitLabel="Save" className="flex flex-wrap items-center gap-2" submitClass="btn btn-sm">
                      <input type="hidden" name="id" value={t.id} />
                      <input className="input min-h-8 w-56 py-1" name="label" defaultValue={t.label} aria-label="Label" />
                      <span className="num text-xs text-ink-3">{formatDate(t.period_start)}</span>
                      <input className="input min-h-8 w-24 py-1" name="target" defaultValue={show(t)} aria-label="Target" placeholder={t.unit === 'cents' ? 'R' : ''} />
                      {t.unit !== 'cents' ? <input className="input min-h-8 w-20 py-1" name="cap" defaultValue={t.cap_value ?? ''} aria-label="Cap" placeholder="cap" /> : null}
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" name="active" defaultChecked={t.active} /> In use
                      </label>
                    </ActionForm>
                  ) : (
                    <>
                      {t.label}: {t.unit === 'cents' ? formatRand(t.target_cents) : t.target_value}
                    </>
                  )}
                </td>
                <td className="text-xs text-ink-3">{t.count_source === 'stage_history' ? 'Stage changes' : t.count_source === 'leads' ? 'Leads' : 'You, on Sunday'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canWrite ? (
        <Card title="Add a target">
          <ActionForm action={addTargetAction} submitLabel="Add target" resetOnSuccess submitClass="btn">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Kind" htmlFor="t_kind">
                <select className="input" id="t_kind" name="kind" defaultValue="channel">
                  <option value="channel">Channel target for a period</option>
                  <option value="weekly">Weekly scorecard number</option>
                </select>
              </Field>
              <Field label="Channel" htmlFor="t_channel">
                <select className="input" id="t_channel" name="channel_key" defaultValue="">
                  <option value="">Not for weekly</option>
                  {lists.channels.map((c) => (
                    <option key={c.key} value={c.key}>
                      {channelLabel(lists.channels, c.key)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="What" htmlFor="t_label">
                <input className="input" id="t_label" name="label" placeholder="Permission emails" />
              </Field>
              <Field label="From" htmlFor="t_from">
                <input className="input" id="t_from" name="period_start" type="date" defaultValue={todaySast()} />
              </Field>
              <Field label="To (channel targets)" htmlFor="t_to">
                <input className="input" id="t_to" name="period_end" type="date" />
              </Field>
              <Field label="Target" htmlFor="t_target">
                <input className="input" id="t_target" name="target" inputMode="decimal" />
              </Field>
              <Field label="Unit" htmlFor="t_unit">
                <select className="input" id="t_unit" name="unit" defaultValue="count">
                  <option value="count">Count</option>
                  <option value="hours">Hours</option>
                  <option value="milestone">Done or not</option>
                </select>
              </Field>
              <Field label="Count it from" htmlFor="t_source">
                <select className="input" id="t_source" name="count_source" defaultValue="manual">
                  <option value="manual">I enter it</option>
                  <option value="leads">Leads in this channel</option>
                </select>
              </Field>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- account

async function AccountTab({ displayName, email }: { displayName: string; email: string }) {
  const db = await userDb();
  const { data } = await db.auth.mfa.listFactors();
  const factors = (data?.totp ?? []).filter((f) => f.status === 'verified');
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Profile">
        <ActionForm action={updateProfileAction} submitLabel="Save" submitClass="btn">
          <Field label="Name shown in Desk" htmlFor="display_name">
            <input className="input" id="display_name" name="display_name" defaultValue={displayName} />
          </Field>
          <p className="text-xs text-ink-3">Signed in as {email}. Sign-in emails are set in OWNER_EMAILS (Vercel).</p>
        </ActionForm>
      </Card>
      <Card title="Change password">
        <ActionForm action={changePasswordAction} submitLabel="Change password" resetOnSuccess submitClass="btn">
          <Field label="New password" htmlFor="pw" hint={`At least ${MIN_PASSWORD_LENGTH} characters. A short sentence works well.`}>
            <input className="input" id="pw" name="password" type="password" autoComplete="new-password" />
          </Field>
          <Field label="Type it again" htmlFor="pw2">
            <input className="input" id="pw2" name="password_again" type="password" autoComplete="new-password" />
          </Field>
        </ActionForm>
      </Card>
      <Card title="Two-factor authenticators" className="lg:col-span-2">
        <ul className="mb-3 divide-y divide-line text-sm">
          {factors.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                {f.friendly_name ?? 'Authenticator'} <span className="num text-xs text-ink-3">added {formatDateTime(f.created_at)}</span>
              </span>
              {factors.length > 1 ? (
                <ActionForm action={removeFactorAction} submitLabel="Remove" submitClass="btn btn-sm" className="" confirm="Remove this authenticator?">
                  <input type="hidden" name="factorId" value={f.id} />
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
        <BackupFactor />
        <div className="mt-3 space-y-1 text-xs text-ink-3">
          <p>If you lose your phone: sign in with a backup authenticator. With no backup, run the reset in README step 3 (it needs the service key, from your password manager), then enrol again.</p>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- data

function DataTab({ canExport }: { canExport: boolean }) {
  return (
    <Card title="Export everything">
      <p className="mb-3 text-sm text-ink-2">
        Downloads every Desk table as CSV in one ZIP. It contains personal information: keep it in your password manager&apos;s secure files or an encrypted drive, and never email it.
        The Platforms register reminds you monthly.
      </p>
      {canExport ? (
        <a href="/settings/export" className="btn-primary">
          Download the ZIP
        </a>
      ) : (
        <Notice>You cannot export data.</Notice>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- danger zone

async function DangerTab({ canForget, q }: { canForget: boolean; q?: string }) {
  if (!canForget) return <Notice>Only the owner can delete personal data.</Notice>;
  const term = (q ?? '').replace(/[^\p{L}\p{N}@.\-' ]/gu, ' ').trim().slice(0, 80);
  let matches: Array<{ id: string; full_name: string | null; email: string | null; phone_e164: string | null }> = [];
  if (term.length >= 2) {
    const { data } = await (await userDb())
      .from('contacts')
      .select('id, full_name, email, phone_e164')
      .is('forgotten_at', null)
      .or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone_e164.ilike.%${term}%`)
      .limit(20);
    matches = (data ?? []) as typeof matches;
  }
  return (
    <Card title="Delete a person's personal data (POPIA)">
      <div className="mb-3 space-y-1 text-sm text-ink-2">
        <p>This removes their name, email, phone, LinkedIn, notes and what they sent through forms or the chatbot. It cannot be undone.</p>
        <p>What stays: an anonymous record that a deletion happened (audit log), their consent history without any personal details, and a scrambled fingerprint of their email and phone so that, if they contact you again, Desk can warn you they asked to be deleted.</p>
      </div>
      <form method="get" className="mb-3 flex gap-2">
        <input type="hidden" name="tab" value="danger" />
        <input className="input" name="q" defaultValue={term} placeholder="Find by name, email or phone" aria-label="Find a contact" />
        <button className="btn">Find</button>
      </form>
      {term.length >= 2 && matches.length === 0 ? <p className="text-sm text-ink-3">No one matches.</p> : null}
      <ul className="divide-y divide-line">
        {matches.map((c) => (
          <li key={c.id} className="py-2">
            <div className="text-sm font-medium">{c.full_name ?? c.email ?? c.phone_e164}</div>
            <div className="text-xs text-ink-3">{[c.email, c.phone_e164].filter(Boolean).join(', ')}</div>
            <ActionForm action={forgetContactAction} submitLabel="Delete their personal data" submitClass="btn-danger btn-sm" className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="contact_id" value={c.id} />
              <Field label="Type DELETE to confirm" htmlFor={`confirm_${c.id}`}>
                <input className="input w-40" id={`confirm_${c.id}`} name="confirm" autoComplete="off" />
              </Field>
            </ActionForm>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- audit

async function AuditTab() {
  const { data } = await (await userDb()).from('audit_log').select('id, at, actor_kind, action, table_name, record_id, changed_columns').order('id', { ascending: false }).limit(150);
  const rows = (data ?? []) as Array<{ id: number; at: string; actor_kind: string; action: string; table_name: string | null; record_id: string | null; changed_columns: string[] | null }>;
  return (
    <div className="card max-h-[70dvh] overflow-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>Where</th>
            <th className="hidden md:table-cell">Columns changed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="num whitespace-nowrap">{formatDateTime(r.at)}</td>
              <td>{r.actor_kind}</td>
              <td>{r.action.replace(/_/g, ' ')}</td>
              <td className="text-xs">
                {r.table_name}
                {r.record_id ? <span className="text-ink-3"> {r.record_id.slice(0, 8)}</span> : null}
              </td>
              <td className="hidden text-xs text-ink-3 md:table-cell">{r.changed_columns?.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
