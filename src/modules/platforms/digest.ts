import { formatDate, formatRand } from '@/lib/format';
import type { DigestProvider } from '../types';
import { renewalsWithin, type Platform } from './logic';

const provider: DigestProvider = async ({ date, db, appUrl }) => {
  const { data } = await db.from('platforms').select('*').not('renewal_date', 'is', null);
  const due = renewalsWithin((data ?? []) as Platform[], date, 14);
  return [
    {
      key: 'renewals',
      title: 'Renewals due soon',
      lines: due.map((p) => ({
        text: `${p.name}: ${formatDate(p.renewal_date)}${p.monthly_cost_cents !== null && !p.is_reminder ? ` (${formatRand(Number(p.monthly_cost_cents))} a month)` : ''}`,
        href: `${appUrl}/platforms`,
      })),
    },
  ];
};

export default provider;
