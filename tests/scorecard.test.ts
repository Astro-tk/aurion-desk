import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { channelCell, lastWeeks, sastDate, weeklyCell, weeklyTargetsInForce, type Target } from '@/modules/scorecard/compute';
import { asRole, createTestDb, ownerClaims, seedMembers, tryAsRole } from './helpers/db';

let db: PGlite;
let targets: Target[];
// PGlite returns dates as Date objects; Supabase returns 'YYYY-MM-DD' strings.
const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

beforeAll(async () => {
  db = await createTestDb();
  await seedMembers(db);
  const r = await db.query<Target>(`select * from desk.targets`);
  targets = r.rows.map((t) => ({
    ...t,
    period_start: iso(t.period_start)!,
    period_end: iso(t.period_end),
    due_date: iso(t.due_date),
    target_value: t.target_value === null ? null : Number(t.target_value),
    target_cents: t.target_cents === null ? null : Number(t.target_cents),
    cap_value: t.cap_value === null ? null : Number(t.cap_value),
  }));
});

const byKey = (kind: Target['kind'], key: string, channel?: string) =>
  targets.find((t) => t.kind === kind && t.metric_key === key && (!channel || t.channel_key === channel))!;

describe('targets seeded from the blueprint', () => {
  it('weekly scorecard (section 11)', () => {
    const w = weeklyTargetsInForce(targets, '2026-11-30');
    expect(w.map((t) => [t.metric_key, t.unit === 'cents' ? t.target_cents : t.target_value, t.cap_value])).toEqual([
      ['live_conversations', 2, null],
      ['audits_booked', 1, null],
      ['proposals_sent', 0.5, null],
      ['linkedin_invitations', 30, null],
      ['checker_reports', 5, null],
      ['hours_worked', 8, 10],
      ['recurring_revenue', 3540000, null],
    ]);
  });

  it('December channel targets (section 3)', () => {
    expect(byKey('channel', 'blank_invitations', 'linkedin').target_value).toBe(105);
    expect(byKey('channel', 'permission_emails', 'firm_email').target_value).toBe(60);
    expect(byKey('channel', 'checker_live').due_date).toBe('2026-12-08');
    expect(targets.filter((t) => t.kind === 'channel').length).toBe(19);
  });
});

describe('weekly numbers', () => {
  const week = '2026-12-07';
  const changes = [
    { to_stage: 'audit_booked', changed_at: '2026-12-08T17:00:00Z', source: 'manual' },
    { to_stage: 'audit_booked', changed_at: '2026-12-13T21:30:00Z', source: 'manual' }, // Sunday 23:30 SAST: still this week
    { to_stage: 'audit_booked', changed_at: '2026-12-13T22:30:00Z', source: 'manual' }, // Monday 00:30 SAST: next week
    { to_stage: 'audit_booked', changed_at: '2026-12-09T08:00:00Z', source: 'import' }, // imports never count
    { to_stage: 'proposal_sent', changed_at: '2026-12-10T08:00:00Z', source: 'manual' },
  ];

  it('pre-fills audits booked and proposals from stage changes, in SAST, ignoring imports', () => {
    expect(weeklyCell(byKey('weekly', 'audits_booked'), week, changes, [])).toEqual({ value: 2, auto: true, status: 'met' });
    expect(weeklyCell(byKey('weekly', 'proposals_sent'), week, changes, [])).toEqual({ value: 1, auto: true, status: 'met' });
    expect(sastDate('2026-12-13T22:30:00Z')).toBe('2026-12-14');
  });

  it('manual numbers come from Sunday entries; hours over 10 is flagged', () => {
    const hours = byKey('weekly', 'hours_worked');
    expect(weeklyCell(hours, week, [], [])).toMatchObject({ value: null, status: 'none' });
    expect(weeklyCell(hours, week, [], [{ target_id: hours.id, period_start: week, value: 9, value_cents: null }]).status).toBe('met');
    expect(weeklyCell(hours, week, [], [{ target_id: hours.id, period_start: week, value: 11, value_cents: null }]).status).toBe('over_cap');
  });

  it('trend windows are consecutive Mondays', () => {
    expect(lastWeeks('2026-12-28', 3)).toEqual(['2026-12-14', '2026-12-21', '2026-12-28']);
  });
});

describe('channel targets: "logged" from leads', () => {
  const leads = [
    { channel_key: 'linkedin', source_key: 'linkedin_search_a', first_contact_date: '2026-12-01' },
    { channel_key: 'linkedin', source_key: 'linkedin_search_b', first_contact_date: '2026-12-31' },
    { channel_key: 'linkedin', source_key: 'linkedin_search_b', first_contact_date: '2027-01-12' },
    { channel_key: 'beelevel_audience', source_key: 'linkedin_search_e', first_contact_date: '2026-12-05' },
    { channel_key: 'beelevel_audience', source_key: 'google_search', first_contact_date: '2026-12-09' },
  ];
  it('counts leads by channel and first contact date in the period', () => {
    expect(channelCell(byKey('channel', 'blank_invitations', 'linkedin'), leads, []).value).toBe(2);
  });
  it('applies a source filter where the blueprint splits a channel', () => {
    expect(channelCell(byKey('channel', 'blank_invitations', 'beelevel_audience'), leads, []).value).toBe(1);
  });
  it('non-lead channels use the manual count', () => {
    const reels = byKey('channel', 'reels_made');
    expect(channelCell(reels, leads, [{ target_id: reels.id, period_start: '2026-12-01', value: 4, value_cents: null }])).toMatchObject({ value: 4, auto: false, status: 'under' });
  });
});

describe('entries and events in the database', () => {
  it('a member can save an entry once per target and week, and a viewer cannot', async () => {
    const t = byKey('weekly', 'live_conversations');
    await asRole(db, ownerClaims('aal2'), `insert into desk.scorecard_entries (target_id, period_start, value) values ($1, '2026-12-07', 2)`, [t.id]);
    const dup = await tryAsRole(db, ownerClaims('aal2'), `insert into desk.scorecard_entries (target_id, period_start, value) values ($1, '2026-12-07', 3)`, [t.id]);
    expect(dup.error).toMatch(/duplicate key/);
    const viewer = await tryAsRole(db, { sub: '33333333-3333-4333-8333-333333333333', role: 'authenticated', aal: 'aal2' }, `insert into desk.scorecard_entries (target_id, period_start, value) values ($1, '2026-12-14', 1)`, [t.id]);
    expect(viewer.error).toMatch(/row-level security/);
  });

  it('an event written by a member without an explicit actor is stamped with that member', async () => {
    const [row] = await asRole<{ actor_id: string }>(db, ownerClaims('aal2'), `insert into desk.events (source, type) values ('manual', 'scorecard_entered') returning actor_id`);
    expect(row!.actor_id).toBe('11111111-1111-4111-8111-111111111111');
    const forged = await tryAsRole(db, ownerClaims('aal2'), `insert into desk.events (source, type, actor_id) values ('manual', 'x', '33333333-3333-4333-8333-333333333333')`);
    expect(forged.error).toMatch(/row-level security/);
  });
});
