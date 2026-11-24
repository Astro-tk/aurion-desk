import type { DigestProvider } from '../types';

interface Row {
  id: string;
  source: 'form' | 'chatbot';
  name: string | null;
  company: string | null;
  email: string | null;
  need: string | null;
  message: string | null;
  score: number | null;
}

/** New inbox items still waiting for a decision. */
const provider: DigestProvider = async ({ db, appUrl }) => {
  const { data } = await db
    .from('inbox_items')
    .select('id, source, name, company, email, need, message, score')
    .eq('status', 'new')
    .order('received_at', { ascending: false })
    .limit(25);
  const rows = (data ?? []) as Row[];
  return [
    {
      key: 'inbox',
      title: 'New inbox items',
      lines: rows.map((r) => ({
        text: `${[r.name, r.company].filter(Boolean).join(', ') || r.email || 'Unnamed'} (${r.source === 'chatbot' ? 'chatbot' : 'form'}${r.score !== null ? `, score ${r.score}` : ''})${r.need || r.message ? `: ${(r.need ?? r.message ?? '').slice(0, 90)}` : ''}`,
        href: `${appUrl}/inbox/${r.id}`,
      })),
    },
  ];
};

export default provider;
