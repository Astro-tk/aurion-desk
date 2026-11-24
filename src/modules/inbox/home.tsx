import Link from 'next/link';
import { Card } from '@/components/ui';
import { userDb } from '@/lib/db/server';
import { formatDateTime } from '@/lib/format';
import { itemTitle, listInbox } from './queries';

export default async function InboxHomeCard() {
  const items = await listInbox(await userDb(), 'new', 6);
  return (
    <Card title={`New in the Inbox${items.length ? ` (${items.length}${items.length === 6 ? '+' : ''})` : ''}`} action={<Link href="/inbox" className="text-xs underline">Inbox</Link>}>
      {items.length === 0 ? (
        <p className="text-sm text-ink-3">Nothing new.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-2 py-1.5">
              <Link href={`/inbox/${i.id}`} className="min-w-0 font-medium hover:underline">
                {itemTitle(i)}
                {i.score !== null ? <span className={`ml-2 ${i.score >= 4 ? 'chip-accent' : 'chip'} num`}>{i.score}/5</span> : null}
              </Link>
              <span className="num shrink-0 text-xs text-ink-3">{formatDateTime(i.received_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
