import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ActionForm, Field } from '@/components/forms';
import { Card, DateText, Notice, PageHeader } from '@/components/ui';
import { memberCan, requireMember } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { formatDateTime, todaySast } from '@/lib/format';
import { channelLabel, labelOf } from '@/lib/lists';
import { getLists } from '@/lib/lists';
import {
  archiveLeadAction,
  changeStageAction,
  logActivityAction,
  recordConsentAction,
  updateContactAction,
  updateLeadAction,
  updateOrganisationAction,
} from '../actions';
import { AiDraftChip, ConsentChip, NextDate, leadTitle } from '../components';
import { getLead, getLeadDetail } from '../queries';

const EVENT_LABELS: Record<string, string> = {
  lead_created: 'Lead created',
  stage_changed: 'Stage changed',
  stage_note: 'Stage note',
  consent_recorded: 'Consent recorded',
  activity_logged: 'Activity logged',
  form_submitted: 'Website form received',
  chatbot_lead_received: 'Chatbot lead received',
  inbox_accepted: 'Accepted from the Inbox',
  inbox_dismissed: 'Dismissed in the Inbox',
  ai_draft_created: 'AI draft written',
  alert_sent: 'Alert sent',
  lead_archived: 'Archived',
  lead_restored: 'Restored',
  contact_forgotten: 'Personal data deleted',
};

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireMember();
  const { id } = await params;
  const sp = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await userDb();
  const lead = await getLead(db, id);
  if (!lead) notFound();
  const [lists, detail, canWrite] = await Promise.all([getLists(db), getLeadDetail(db, lead), memberCan('pipeline.write')]);
  const blocked = lead.do_not_contact;
  const stageOptions = lists.stages.map((s) => ({ value: s.key, label: s.label }));
  const stageLabel = (k: string | null) => (k ? labelOf(lists.stages, k) : 'Start');

  return (
    <>
      <PageHeader
        title={leadTitle(lead)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{labelOf(lists.stages, lead.stage_key)}</span>
            <ConsentChip status={lead.consent_status} />
            {lead.score !== null ? <span className="chip num">Score {lead.score}</span> : null}
            {lead.archived_at ? <span className="chip">Archived</span> : null}
            <span className="text-ink-3">Added by {lead.created_from}</span>
          </span>
        }
        actions={
          <Link href="/pipeline" className="btn">
            Back to Pipeline
          </Link>
        }
      />

      {sp.notice === 'accepted' ? <div className="mb-3"><Notice kind="ok">Accepted from the Inbox. The summary and next action below are AI drafts: check and edit them.</Notice></div> : null}
      {sp.notice === 'accepted_no_ai' ? <div className="mb-3"><Notice>Accepted from the Inbox. The AI draft could not be written this time, so add a next action yourself.</Notice></div> : null}
      {sp.notice === 'existing' ? <div className="mb-3"><Notice>This person is already in Desk, so nothing new was created. Here is their lead.</Notice></div> : null}
      {blocked ? (
        <div className="mb-3">
          <Notice kind="error">This person said no. Desk blocks drafting or logging any outbound message to them. Never contact them again.</Notice>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Card title="Next step">
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <NextDate lead={lead} />
              <span className="text-ink-2">{lead.next_action ?? 'No next action set.'}</span>
              {lead.next_action_is_ai_draft ? <AiDraftChip /> : null}
            </div>
            {canWrite ? (
              <ActionForm action={changeStageAction} submitLabel="Change stage" className="flex flex-wrap items-end gap-2" submitClass="btn">
                <input type="hidden" name="lead_id" value={lead.id} />
                <Field label="Stage" htmlFor="stage_key">
                  <select className="input" id="stage_key" name="stage_key" defaultValue={lead.stage_key}>
                    {stageOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Note (optional)" htmlFor="stage_note">
                  <input className="input" id="stage_note" name="note" />
                </Field>
              </ActionForm>
            ) : null}
          </Card>

          <Card title="Lead details">
            {lead.summary ? (
              <div className="mb-3 text-sm">
                <div className="mb-1 flex items-center gap-2 text-xs text-ink-3">
                  Summary {lead.summary_is_ai_draft ? <AiDraftChip /> : null}
                </div>
                <p className="text-ink-2">{lead.summary}</p>
              </div>
            ) : null}
            {canWrite ? (
              <ActionForm action={updateLeadAction} submitLabel="Save details" submitClass="btn">
                <input type="hidden" name="lead_id" value={lead.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Next action" htmlFor="next_action" hint={lead.next_action_is_ai_draft ? 'AI draft: edit it to make it yours.' : undefined}>
                    <input className="input" id="next_action" name="next_action" defaultValue={lead.next_action ?? ''} />
                  </Field>
                  <Field label="Next date" htmlFor="next_date">
                    <input className="input" id="next_date" name="next_date" type="date" defaultValue={lead.next_date ?? ''} />
                  </Field>
                  <Field label="Channel" htmlFor="channel_key">
                    <select className="input" id="channel_key" name="channel_key" defaultValue={lead.channel_key ?? ''}>
                      <option value="">None</option>
                      {lists.channels.map((c) => (
                        <option key={c.key} value={c.key}>
                          {channelLabel(lists.channels, c.key)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Source" htmlFor="source_key">
                    <select className="input" id="source_key" name="source_key" defaultValue={lead.source_key ?? ''}>
                      <option value="">None</option>
                      {lists.sources.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="First contact date" htmlFor="first_contact_date">
                    <input className="input" id="first_contact_date" name="first_contact_date" type="date" defaultValue={lead.first_contact_date ?? ''} />
                  </Field>
                  <Field label="Score (0 to 5)" htmlFor="score">
                    <input className="input" id="score" name="score" type="number" min={0} max={5} defaultValue={lead.score ?? ''} />
                  </Field>
                </div>
                <Field label="Summary" htmlFor="summary" hint={lead.summary_is_ai_draft ? 'AI draft: edit it to make it yours.' : undefined}>
                  <textarea className="input" id="summary" name="summary" rows={2} defaultValue={lead.summary ?? ''} />
                </Field>
                <Field label="Notes" htmlFor="notes">
                  <textarea className="input" id="notes" name="notes" rows={4} defaultValue={lead.notes ?? ''} />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="founding_office" defaultChecked={lead.founding_office} /> Founding Office client (counts against the 3 places once Signed)
                </label>
              </ActionForm>
            ) : (
              <p className="text-sm whitespace-pre-wrap text-ink-2">{lead.notes}</p>
            )}
          </Card>

          <Card title="Activities">
            {canWrite ? (
              <details className="mb-3" open={detail.activities.length === 0}>
                <summary className="cursor-pointer text-sm font-medium">Log an activity</summary>
                <div className="mt-2">
                  <ActionForm action={logActivityAction} submitLabel="Log it" resetOnSuccess submitClass="btn">
                    <input type="hidden" name="lead_id" value={lead.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Direction" htmlFor="direction">
                        <select className="input" id="direction" name="direction" defaultValue={blocked ? 'inbound' : 'outbound'}>
                          <option value="outbound" disabled={blocked}>
                            Outbound (I contacted them){blocked ? ': blocked' : ''}
                          </option>
                          <option value="inbound">Inbound (they contacted me)</option>
                        </select>
                      </Field>
                      <Field label="Via" htmlFor="method_key">
                        <select className="input" id="method_key" name="method_key" defaultValue="email">
                          {lists.contactMethods.filter((m) => m.active).map((m) => (
                            <option key={m.key} value={m.key}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Purpose" htmlFor="purpose_key">
                        <select className="input" id="purpose_key" name="purpose_key" defaultValue="follow_up">
                          {lists.activityPurposes.filter((m) => m.active).map((m) => (
                            <option key={m.key} value={m.key}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Date" htmlFor="occurred_on">
                        <input className="input" id="occurred_on" name="occurred_on" type="date" defaultValue={todaySast()} />
                      </Field>
                      <Field label="Outcome" htmlFor="outcome">
                        <input className="input" id="outcome" name="outcome" placeholder="Said yes to the Checker" />
                      </Field>
                      <Field label="Follow up on" htmlFor="follow_up_date">
                        <input className="input" id="follow_up_date" name="follow_up_date" type="date" />
                      </Field>
                    </div>
                    <Field label="Notes" htmlFor="activity_notes">
                      <textarea className="input" id="activity_notes" name="notes" rows={2} />
                    </Field>
                  </ActionForm>
                </div>
              </details>
            ) : null}
            {detail.activities.length === 0 ? (
              <p className="text-sm text-ink-3">Nothing logged yet.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {detail.activities.map((a) => (
                  <li key={a.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-ink-3">{formatDateTime(a.occurred_at)}</span>
                      <span className="chip">{a.direction === 'outbound' ? 'Out' : 'In'}</span>
                      <span>{labelOf(lists.activityPurposes, a.purpose_key)}</span>
                      <span className="text-ink-3">via {labelOf(lists.contactMethods, a.method_key)}</span>
                    </div>
                    {a.outcome ? <div className="text-ink-2">{a.outcome}</div> : null}
                    {a.notes ? <div className="whitespace-pre-wrap text-ink-3">{a.notes}</div> : null}
                    {a.follow_up_date ? <div className="text-xs text-ink-3">Follow up: <DateText value={a.follow_up_date} /></div> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-3">
          <Card title="Contact">
            {lead.forgotten_at ? (
              <p className="text-sm text-ink-3">Personal data was deleted on {formatDateTime(lead.forgotten_at)}.</p>
            ) : lead.contact_id && canWrite ? (
              <ActionForm action={updateContactAction} submitLabel="Save contact" submitClass="btn btn-sm">
                <input type="hidden" name="contact_id" value={lead.contact_id} />
                <input type="hidden" name="lead_id" value={lead.id} />
                <Field label="Name" htmlFor="full_name">
                  <input className="input" id="full_name" name="full_name" defaultValue={lead.full_name ?? ''} />
                </Field>
                <Field label="Role" htmlFor="role_title">
                  <input className="input" id="role_title" name="role_title" defaultValue={lead.role_title ?? ''} />
                </Field>
                <Field label="Email" htmlFor="c_email">
                  <input className="input" id="c_email" name="email" type="email" defaultValue={lead.email ?? ''} />
                </Field>
                <Field label="Phone" htmlFor="c_phone">
                  <input className="input" id="c_phone" name="phone" type="tel" defaultValue={lead.phone_e164 ?? ''} />
                </Field>
                <Field label="LinkedIn" htmlFor="linkedin_url">
                  <input className="input" id="linkedin_url" name="linkedin_url" type="url" defaultValue={lead.linkedin_url ?? ''} />
                </Field>
              </ActionForm>
            ) : lead.contact_id ? (
              <dl className="space-y-1 text-sm">
                <dd>{lead.full_name}</dd>
                <dd className="text-ink-2">{lead.role_title}</dd>
                <dd>{lead.email}</dd>
                <dd className="num">{lead.phone_e164}</dd>
              </dl>
            ) : (
              <p className="text-sm text-ink-3">No person on this lead yet.</p>
            )}
            {lead.linkedin_url && !lead.forgotten_at ? (
              <a href={lead.linkedin_url} rel="noopener noreferrer" target="_blank" className="mt-2 block text-xs underline">
                Open LinkedIn profile
              </a>
            ) : null}
          </Card>

          {detail.organisation ? (
            <Card title="Organisation">
              {canWrite ? (
                <ActionForm action={updateOrganisationAction} submitLabel="Save organisation" submitClass="btn btn-sm">
                  <input type="hidden" name="organisation_id" value={detail.organisation.id} />
                  <input type="hidden" name="lead_id" value={lead.id} />
                  <Field label="Firm" htmlFor="org_name">
                    <input className="input" id="org_name" name="name" defaultValue={detail.organisation.name} />
                  </Field>
                  <Field label="Type" htmlFor="type_key">
                    <select className="input" id="type_key" name="type_key" defaultValue={detail.organisation.type_key ?? ''}>
                      <option value="">None</option>
                      {lists.orgTypes.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Town" htmlFor="town">
                    <input className="input" id="town" name="town" defaultValue={detail.organisation.town ?? ''} />
                  </Field>
                  <Field label="Website" htmlFor="website">
                    <input className="input" id="website" name="website" type="url" defaultValue={detail.organisation.website ?? ''} />
                  </Field>
                </ActionForm>
              ) : (
                <p className="text-sm">{detail.organisation.name}</p>
              )}
            </Card>
          ) : null}

          <Card title="Consent history">
            <p className="mb-2 text-xs text-ink-3">Permanent record. The latest entry is what counts.</p>
            {detail.consent.length === 0 ? (
              <p className="text-sm text-ink-3">Never asked.</p>
            ) : (
              <ul className="mb-3 space-y-2 text-sm">
                {detail.consent.map((c, i) => (
                  <li key={c.id} className={i === 0 ? '' : 'opacity-70'}>
                    <div className="flex items-center gap-2">
                      <ConsentChip status={c.status} />
                      <span className="num text-xs text-ink-3">{formatDateTime(c.recorded_at)}</span>
                      {i === 0 ? <span className="text-xs text-ink-3">Current</span> : null}
                    </div>
                    <div className="text-xs text-ink-2">
                      Via {labelOf(lists.contactMethods, c.method_key)}. Evidence: {c.evidence_type}
                      {c.evidence_ref ? ` (${c.evidence_ref.slice(0, 12)})` : ''}
                    </div>
                    <div className="text-xs text-ink-3">Wording: {c.wording_shown}</div>
                  </li>
                ))}
              </ul>
            )}
            {canWrite && lead.contact_id && !lead.forgotten_at ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium">Record consent</summary>
                <div className="mt-2">
                  <ActionForm action={recordConsentAction} submitLabel="Record" submitClass="btn btn-sm" resetOnSuccess>
                    <input type="hidden" name="lead_id" value={lead.id} />
                    <input type="hidden" name="contact_id" value={lead.contact_id} />
                    <Field label="Status" htmlFor="consent_status">
                      <select className="input" id="consent_status" name="status" defaultValue="asked">
                        <option value="asked">Asked</option>
                        <option value="yes">Yes</option>
                        <option value="no">No (never contact again)</option>
                      </select>
                    </Field>
                    <Field label="Via" htmlFor="consent_method">
                      <select className="input" id="consent_method" name="method_key" defaultValue="linkedin">
                        {lists.contactMethods.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Wording shown or used" htmlFor="wording_shown" hint="Paste the permission ask (for example script L1).">
                      <textarea className="input" id="wording_shown" name="wording_shown" rows={2} required />
                    </Field>
                  </ActionForm>
                </div>
              </details>
            ) : null}
          </Card>

          <Card title="Stage history">
            <ul className="space-y-1 text-sm">
              {detail.stageHistory.map((s) => (
                <li key={s.id} className="flex flex-wrap gap-x-2">
                  <span className="num text-xs text-ink-3">{formatDateTime(s.changed_at)}</span>
                  <span>
                    {stageLabel(s.from_stage)} to {stageLabel(s.to_stage)}
                  </span>
                  {s.source !== 'manual' ? <span className="text-xs text-ink-3">({s.source})</span> : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Timeline">
            <ul className="space-y-1 text-sm">
              {detail.events.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-x-2">
                  <span className="num text-xs text-ink-3">{formatDateTime(e.occurred_at)}</span>
                  <span>{EVENT_LABELS[e.type] ?? e.type.replace(/_/g, ' ')}</span>
                  <span className="text-xs text-ink-3">{e.source}</span>
                </li>
              ))}
            </ul>
          </Card>

          {canWrite ? (
            <ActionForm action={archiveLeadAction} submitLabel={lead.archived_at ? 'Restore lead' : 'Archive lead'} submitClass="btn btn-sm" className="">
              <input type="hidden" name="lead_id" value={lead.id} />
              {lead.archived_at ? <input type="hidden" name="restore" value="1" /> : null}
            </ActionForm>
          ) : null}
          <p className="text-xs text-ink-3">
            Deleting a person&apos;s personal data is in Settings, Danger zone.
          </p>
        </div>
      </div>
    </>
  );
}
