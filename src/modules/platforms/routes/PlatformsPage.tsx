import Link from 'next/link';
import { EmptyState, Money, Notice, PageHeader, Stat } from '@/components/ui';
import { memberCan, requireMember } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { formatDate, todaySast } from '@/lib/format';
import { BILLING_CYCLES, PLATFORM_STATUSES, monthlyTotals, renewalsWithin, type Platform } from '../logic';

export async function loadPlatforms(): Promise<Platform[]> {
  const { data } = await (await userDb()).from('platforms').select('*').order('is_reminder').order('name');
  return ((data ?? []) as Platform[]).map((p) => ({ ...p, monthly_cost_cents: p.monthly_cost_cents === null ? null : Number(p.monthly_cost_cents) }));
}

export default async function PlatformsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireMember();
  const sp = await searchParams;
  const [platforms, canWrite] = await Promise.all([loadPlatforms(), memberCan('platforms.write')]);
  const totals = monthlyTotals(platforms);
  const soon = new Set(renewalsWithin(platforms, todaySast(), 14).map((p) => p.id));

  return (
    <>
      <PageHeader
        title="Platforms"
        subtitle="Every tool Aurion runs on. Never store a password or key here: only where it is kept."
        actions={
          canWrite ? (
            <Link href="/platforms/new" className="btn-primary">
              Add platform
            </Link>
          ) : null
        }
      />
      {sp.notice === 'saved' ? (
        <div className="mb-3">
          <Notice kind="ok">Saved.</Notice>
        </div>
      ) : null}
      <section className="card mb-3 grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
        <Stat label="Monthly cost of active tools" value={<Money cents={totals.activeCents} />} />
        <Stat label="Planned or deciding" value={<Money cents={totals.plannedCents} />} />
        <Stat label="Active tools without a cost" value={totals.missingCost} sub={totals.missingCost ? 'Fill these in for a true total' : undefined} />
      </section>
      {platforms.length === 0 ? (
        <EmptyState sentence="No platforms recorded." actionLabel="Add one" actionHref="/platforms/new" />
      ) : (
        <div className="card max-h-[70dvh] overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Platform</th>
                <th>Status</th>
                <th className="text-right">Per month</th>
                <th>Renews</th>
                <th className="hidden md:table-cell">Login kept in</th>
                <th className="hidden lg:table-cell">Billing</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((p) => (
                <tr key={p.id}>
                  <td className="min-w-44">
                    {canWrite ? (
                      <Link href={`/platforms/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{p.name}</span>
                    )}
                    {p.is_reminder ? <span className="chip ml-1">Reminder</span> : null}
                    <div className="text-xs text-ink-3">{p.purpose}</div>
                  </td>
                  <td>{PLATFORM_STATUSES[p.status]}</td>
                  <td className="text-right">{p.billing_cycle === 'free' ? <span className="text-ink-3">Free</span> : <Money cents={p.monthly_cost_cents} />}</td>
                  <td>
                    {p.renewal_date ? (
                      <span className={`num ${soon.has(p.id) ? 'font-semibold text-warn' : ''}`}>{formatDate(p.renewal_date)}</span>
                    ) : (
                      <span className="text-ink-3">None</span>
                    )}
                  </td>
                  <td className="hidden text-ink-2 md:table-cell">{p.login_location ?? <span className="text-ink-3">Not set</span>}</td>
                  <td className="hidden lg:table-cell">{BILLING_CYCLES[p.billing_cycle]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
