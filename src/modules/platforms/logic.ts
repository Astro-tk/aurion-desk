import { z } from 'zod';
import { addDays, type IsoDate } from '@/lib/format';

export const BILLING_CYCLES = { monthly: 'Monthly', annual: 'Annual', usage: 'Pay as you use', free: 'Free', once: 'Once-off' } as const;
export const PLATFORM_STATUSES = { active: 'Active', planned: 'Planned', deciding: 'Deciding', paused: 'Paused', cancelled: 'Cancelled' } as const;

export interface Platform {
  id: string;
  name: string;
  purpose: string | null;
  url: string | null;
  monthly_cost_cents: number | null;
  billing_cycle: keyof typeof BILLING_CYCLES;
  renewal_date: IsoDate | null;
  auto_advance: boolean;
  login_location: string | null;
  owner_email: string | null;
  status: keyof typeof PLATFORM_STATUSES;
  is_reminder: boolean;
  notes: string | null;
}

/**
 * The login hint says WHERE the login lives, never what it is. Same rule as the database check
 * (platforms_login_location_not_secret), so you get a friendly message before the database refuses.
 */
export function looksLikeSecret(s: string): boolean {
  return (
    /(password|passwd|pwd|secret|token|api[ _-]?key)\s*[:=]/i.test(s) ||
    /[A-Za-z0-9_-]{24,}/.test(s) ||
    /(sk|pk|rk)[-_](live|test|ant)/i.test(s)
  );
}

export const loginLocationSchema = z
  .string()
  .max(200)
  .refine((s) => !looksLikeSecret(s), 'That looks like a password or key. Write only where it is kept, for example "Bitwarden: Aurion > Vercel".');

/** Total monthly cost of active tools. Tools with no cost set are counted separately, not as zero. */
export function monthlyTotals(platforms: Platform[]) {
  const counted = platforms.filter((p) => p.status === 'active' && !p.is_reminder);
  const withCost = counted.filter((p) => p.monthly_cost_cents !== null);
  const planned = platforms.filter((p) => (p.status === 'planned' || p.status === 'deciding') && p.monthly_cost_cents !== null);
  return {
    activeCents: withCost.reduce((n, p) => n + Number(p.monthly_cost_cents), 0),
    plannedCents: planned.reduce((n, p) => n + Number(p.monthly_cost_cents), 0),
    missingCost: counted.filter((p) => p.monthly_cost_cents === null && p.billing_cycle !== 'free').length,
  };
}

export function renewalsWithin(platforms: Platform[], today: IsoDate, days: number): Platform[] {
  const limit = addDays(today, days);
  return platforms
    .filter((p) => p.renewal_date && p.status !== 'cancelled' && p.renewal_date >= today && p.renewal_date <= limit)
    .sort((a, b) => (a.renewal_date! < b.renewal_date! ? -1 : 1));
}

function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Once a renewal date has passed, roll it forward a cycle (monthly reminders included). */
export function nextRenewal(p: Pick<Platform, 'renewal_date' | 'billing_cycle' | 'auto_advance' | 'is_reminder'>, today: IsoDate): IsoDate | null {
  if (!p.renewal_date || !p.auto_advance || p.renewal_date >= today) return null;
  const step = p.billing_cycle === 'annual' ? 12 : p.billing_cycle === 'monthly' || p.is_reminder ? 1 : 0;
  if (step === 0) return null;
  let next = p.renewal_date;
  for (let i = 0; i < 240 && next < today; i++) next = addMonths(next, step);
  return next;
}
