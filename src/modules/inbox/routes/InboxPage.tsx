import Link from 'next/link';
import { EmptyState, Notice, PageHeader } from '@/components/ui';
import { requireMember } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { formatDateTime } from '@/lib/format';
import { itemTitle, listInbox, type InboxItem } from '../queries';

const TABS: Array<{ key: InboxItem['status']; label: string }> = [
  { key: 'new', label: 'New' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'dismissed', label: 'Dismissed' },
];

export function ScoreChip({ score }: { score: number | null }) {
  if (score === null) return null;
  return <span className={`${score >= 4 ? 'chip-accent' : 'chip'} num`}>Score {score}/5</span>;
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireMember();
  const sp = await searchParams;
  const status = TABS.some((t) => t.key === sp.status) ? (sp.status as InboxItem['status']) : 'new';
  const items = await listInbox(await userDb(), status);

  return (
    <>
      <PageHeader title="Inbox" subtitle="Website forms and chatbot leads. Accept into the Pipeline, or dismiss with a reason." />
      {sp.notice === 'dismissed' ? (
        <div className="mb-3">
          <Notice>Dismissed.</Notice>
        </div>
      ) : null}
      <nav className="mb-3 flex gap-2" aria-label="Inbox status">
        {TABS.map((t) => (
          <Link key={t.key} href={`/inbox?status=${t.key}`} className={t.key === status ? 'chip-accent' : 'chip'}>
            {t.label}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        status === 'new' ? (
          <EmptyState sentence="Nothing new. Forms and chatbot leads land here by themselves." actionLabel="Open the Pipeline" actionHref="/pipeline" />
        ) : (
          <EmptyState sentence="Nothing here yet." actionLabel="Back to new items" actionHref="/inbox" />
        )
      ) : (
        <ul className="card divide-y divide-line">
          {items.map((i) => (
            <li key={i.id}>
              <Link href={`/inbox/${i.id}`} className="flex flex-col gap-1 p-3 hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium">{itemTitle(i)}</div>
                  <div className="truncate text-sm text-ink-2">{i.need ?? i.message ?? 'No message'}</div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1 text-xs">
                  <span className="chip">{i.source === 'chatbot' ? 'Chatbot' : `Form${i.form_id ? `: ${i.form_id}` : ''}`}</span>
                  <ScoreChip score={i.score} />
                  {i.suppressed ? <span className="chip-danger">Said no before</span> : null}
                  {i.consent_ticked ? <span className="chip">Consent ticked</span> : null}
                  <span className="num text-ink-3">{formatDateTime(i.received_at)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
