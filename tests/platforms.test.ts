import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { looksLikeSecret, monthlyTotals, nextRenewal, renewalsWithin, type Platform } from '@/modules/platforms/logic';
import { createTestDb, ownerClaims, seedMembers, tryAsRole } from './helpers/db';

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
  await seedMembers(db);
});

const p = (over: Partial<Platform>): Platform => ({
  id: Math.random().toString(36),
  name: 'Tool',
  purpose: null,
  url: null,
  monthly_cost_cents: null,
  billing_cycle: 'monthly',
  renewal_date: null,
  auto_advance: true,
  login_location: null,
  owner_email: null,
  status: 'active',
  is_reminder: false,
  notes: null,
  ...over,
});

describe('platforms register', () => {
  it('is seeded with every tool the blueprint names, plus Resend and the monthly backup reminder', async () => {
    const r = await db.query<{ name: string }>(`select name from desk.platforms order by name`);
    expect(r.rows.map((x) => x.name)).toEqual(
      expect.arrayContaining([
        'Cal.com', 'Brevo', 'Paystack or Yoco', 'Zoho Invoice', 'UptimeRobot', 'Telegram', 'Google Cloud', 'Anthropic',
        'Vercel', 'Supabase', 'GitHub', 'Meta WhatsApp', 'Formspree', 'Canva', 'Domain registrar', 'Resend', 'Monthly backup export',
      ]),
    );
  });

  it('totals active monthly costs in cents and counts tools without a cost', () => {
    const t = monthlyTotals([
      p({ monthly_cost_cents: 45000 }),
      p({ monthly_cost_cents: 129999 }),
      p({ monthly_cost_cents: null }),
      p({ monthly_cost_cents: null, billing_cycle: 'free' }),
      p({ monthly_cost_cents: 50000, status: 'planned' }),
      p({ monthly_cost_cents: 99999, status: 'cancelled' }),
    ]);
    expect(t).toEqual({ activeCents: 174999, plannedCents: 50000, missingCost: 1 });
  });

  it('lists renewals in the next 14 days', () => {
    const list = renewalsWithin([p({ name: 'a', renewal_date: '2026-12-10' }), p({ name: 'b', renewal_date: '2026-12-20' }), p({ name: 'c', renewal_date: '2026-11-30' })], '2026-12-01', 14);
    expect(list.map((x) => x.name)).toEqual(['a']);
  });

  it('rolls monthly and annual renewals forward once they pass, keeping month ends sane', () => {
    expect(nextRenewal(p({ renewal_date: '2026-12-01', is_reminder: true, billing_cycle: 'free' }), '2026-12-02')).toBe('2027-01-01');
    expect(nextRenewal(p({ renewal_date: '2026-01-31' }), '2026-02-01')).toBe('2026-02-28');
    expect(nextRenewal(p({ renewal_date: '2026-03-15', billing_cycle: 'annual' }), '2026-12-01')).toBe('2027-03-15');
    expect(nextRenewal(p({ renewal_date: '2026-03-15', billing_cycle: 'usage' }), '2026-12-01')).toBeNull();
    expect(nextRenewal(p({ renewal_date: '2026-12-15' }), '2026-12-01')).toBeNull();
  });

  it('refuses anything that looks like a password or key, in the app and in the database', async () => {
    for (const bad of ['password: hunter2', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', 'token=abc', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345']) {
      expect(looksLikeSecret(bad), bad).toBe(true);
      const r = await tryAsRole(db, ownerClaims('aal2'), `update desk.platforms set login_location = $1 where name = 'GitHub'`, [bad]);
      expect(r.error, bad).toMatch(/platforms_login_location_not_secret/);
    }
    expect(looksLikeSecret('Bitwarden: Aurion > Vercel')).toBe(false);
    const ok = await tryAsRole(db, ownerClaims('aal2'), `update desk.platforms set login_location = 'Bitwarden: Aurion > GitHub' where name = 'GitHub'`);
    expect(ok.error).toBeNull();
  });
});
