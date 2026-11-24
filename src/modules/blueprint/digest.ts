import { formatDate } from '@/lib/format';
import type { DigestProvider } from '../types';

/** Today's unticked blueprint and ad hoc tasks, plus anything overdue. */
const provider: DigestProvider = async ({ date, db, appUrl }) => {
  const { data } = await db
    .from('tasks')
    .select('id, title, due_date')
    .is('removed_at', null)
    .is('done_at', null)
    .lte('due_date', date)
    .order('due_date')
    .order('position', { nullsFirst: false })
    .limit(40);
  const rows = (data ?? []) as Array<{ id: string; title: string; due_date: string }>;
  return [
    {
      key: 'tasks',
      title: "Today's unticked blueprint tasks",
      lines: rows.map((t) => ({ text: `${t.title}${t.due_date < date ? ` (due ${formatDate(t.due_date)})` : ''}`, href: `${appUrl}/blueprint?view=today` })),
    },
  ];
};

export default provider;
