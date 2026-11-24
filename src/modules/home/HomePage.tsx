import { Suspense } from 'react';
import { PageHeader } from '@/components/ui';
import { requireMember } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { formatDateWithWeekday, todaySast } from '@/lib/format';
import { MODULES } from '@/modules/registry';

/**
 * Today view. It owns no data: each live module contributes cards through its registry entry
 * (manifest.home), so Phase 2 and 3 modules appear here without this file changing.
 */
export default async function HomePage() {
  const member = await requireMember();
  const providers = MODULES.filter((m) => m.status === 'live' && m.home && (!m.capability || can(member.role, m.capability)));
  const cards = await Promise.all(providers.map(async (m) => ({ key: m.key, Card: (await m.home!()).default })));
  return (
    <>
      <PageHeader title="Today" subtitle={formatDateWithWeekday(todaySast())} />
      <div className="grid gap-3 md:grid-cols-2">
        {cards.map(({ key, Card }) => (
          <Suspense key={key} fallback={<div className="card h-24 animate-pulse" />}>
            <Card />
          </Suspense>
        ))}
      </div>
    </>
  );
}
