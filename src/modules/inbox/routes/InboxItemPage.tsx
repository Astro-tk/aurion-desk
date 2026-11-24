import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ActionForm, Field } from '@/components/forms';
import { Card, Notice, PageHeader } from '@/components/ui';
import { memberCan, requireMember } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { formatDateTime } from '@/lib/format';
import { getLists } from '@/lib/lists';
import { acceptInboxAction, dismissInboxAction } from '../actions';
import { getInboxItem, itemTitle } from '../queries';
import { ScoreChip } from './InboxPage';

export default async function InboxItemPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMember();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await userDb();
  const [item, lists, canDecide] = await Promise.all([getInboxItem(db, id), getLists(db), memberCan('inbox.decide')]);
  if (!item) notFound();
  const defaultSource = item.source === 'chatbot' ? 'website_chatbot' : 'website_form';

  const rows: Array<[string, string | null]> = [
    ['Name', item.name],
    ['Company', item.company],
    ['Email', item.email],
    ['Phone', item.phone_e164],
    ['Need', item.need],
    ['Offer', item.offer],
    ['Score reason', item.score_reason],
    ['Form', item.form_id],
    ['Page', item.page_url],
    ['Transcript', item.transcript_id],
  ];

  return (
    <>
      <PageHeader
        title={itemTitle(item)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{item.source === 'chatbot' ? 'Website chatbot' : 'Website form'}</span>
            <ScoreChip score={item.score} />
            <span className="num">{formatDateTime(item.received_at)}</span>
          </span>
        }
        actions={
          <Link href="/inbox" className="btn">
            Back to Inbox
          </Link>
        }
      />
      {item.suppressed ? (
        <div className="mb-3">
          <Notice kind="error">This person said no before, or asked to be deleted. Check their consent before any reply.</Notice>
        </div>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Card title="What arrived">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
              {rows
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-3">{k}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ))}
            </dl>
            {item.message ? <p className="mt-3 text-sm whitespace-pre-wrap text-ink-2">{item.message}</p> : null}
            <p className="mt-3 text-xs text-ink-3">
              Consent: {item.consent_ticked ? `ticked ("${item.consent_wording}"), recorded as yes` : 'not ticked, so nothing was recorded'}.
            </p>
          </Card>
        </div>
        <div className="space-y-3">
          {item.status === 'new' && canDecide ? (
            <>
              <Card title="Accept into the Pipeline">
                <ActionForm action={acceptInboxAction} submitLabel="Accept" pendingLabel="Accepting and drafting">
                  <input type="hidden" name="id" value={item.id} />
                  <Field label="Channel" htmlFor="channel_key">
                    <select className="input" id="channel_key" name="channel_key" defaultValue="">
                      <option value="">None</option>
                      {lists.channels.filter((c) => c.active).map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.number ? `${c.number}. ` : ''}
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Source" htmlFor="source_key">
                    <select className="input" id="source_key" name="source_key" defaultValue={defaultSource}>
                      {lists.sources.filter((s) => s.active).map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <p className="text-xs text-ink-3">Desk then writes a two-line summary and a suggested next action, both marked AI draft. You can edit both.</p>
                </ActionForm>
              </Card>
              <Card title="Dismiss">
                <ActionForm action={dismissInboxAction} submitLabel="Dismiss" submitClass="btn">
                  <input type="hidden" name="id" value={item.id} />
                  <Field label="Reason" htmlFor="reason">
                    <input className="input" id="reason" name="reason" placeholder="Spam, job seeker, wrong fit" required />
                  </Field>
                </ActionForm>
              </Card>
            </>
          ) : (
            <Card title="Decision">
              {item.status === 'accepted' && item.lead_id ? (
                <p className="text-sm">
                  Accepted {formatDateTime(item.decided_at)}.{' '}
                  <Link href={`/pipeline/${item.lead_id}`} className="underline">
                    Open the lead
                  </Link>
                </p>
              ) : item.status === 'dismissed' ? (
                <p className="text-sm">
                  Dismissed {formatDateTime(item.decided_at)}: {item.dismiss_reason}
                </p>
              ) : (
                <p className="text-sm text-ink-3">Waiting for a decision.</p>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
