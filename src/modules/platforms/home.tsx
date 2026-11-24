import Link from 'next/link';
import { Card } from '@/components/ui';
import { formatDate, todaySast } from '@/lib/format';
import { renewalsWithin } from './logic';
import { loadPlatforms } from './routes/PlatformsPage';

export default async function PlatformsHomeCard() {
  const due = renewalsWithin(await loadPlatforms(), todaySast(), 14);
  if (due.length === 0) return null;
  return (
    <Card title="Renewals in the next 14 days" action={<Link href="/platforms" className="text-xs underline">Platforms</Link>}>
      <ul className="divide-y divide-line text-sm">
        {due.map((p) => (
          <li key={p.id} className="flex justify-between gap-2 py-1.5">
            <span>{p.name}</span>
            <span className="num text-warn">{formatDate(p.renewal_date)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
