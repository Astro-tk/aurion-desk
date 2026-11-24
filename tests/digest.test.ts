import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { Notifier } from '@/integrations/types';
import { requireCronSecret } from '@/lib/cron';
import type { JobStore } from '@/lib/jobs';
import type { NotificationStore } from '@/lib/notify';
import { composeDigest } from '@/modules/digest/compose';
import { runDigest } from '@/modules/digest/run';
import type { DigestProvider } from '@/modules/types';
import { asRole, createTestDb, SERVICE } from './helpers/db';

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
});

// The same SQL the live stores call, through the service role.
const notifications = (): NotificationStore => ({
  claim: async (key, channel, subject, jobRunId) =>
    (await asRole<{ ok: boolean }>(db, SERVICE, `select desk.claim_notification($1, $2, $3, $4) ok`, [key, channel, subject, jobRunId ?? null]))[0]!.ok,
  markSent: async (key) => void (await asRole(db, SERVICE, `update desk.notifications set status = 'sent', sent_at = now() where dedupe_key = $1`, [key])),
  markFailed: async (key, e) => void (await asRole(db, SERVICE, `update desk.notifications set status = 'failed', error = $2 where dedupe_key = $1`, [key, e])),
  markSkipped: async () => undefined,
});
const jobs = (): JobStore => ({
  start: async (job, runKey) => (await asRole<{ id: string }>(db, SERVICE, `insert into desk.job_runs (job, run_key) values ($1, $2) returning id`, [job, runKey]))[0]!.id,
  finish: async (id, status, details = {}, error) =>
    void (await asRole(db, SERVICE, `update desk.job_runs set status = $2, details = $3, error = $4, finished_at = now() where id = $1`, [id, status, JSON.stringify(details), error ?? null])),
});

function mailbox(fail = false) {
  const sent: Array<{ subject: string; text: string }> = [];
  const n: Notifier = {
    key: 'email',
    isConfigured: () => true,
    send: async (m) => {
      if (fail) throw new Error('Resend 500');
      sent.push({ subject: m.subject, text: m.text });
      return { providerId: `msg-${sent.length}` };
    },
  };
  return { n, sent };
}

const providers: Array<{ module: string; provider: DigestProvider }> = [
  { module: 'inbox', provider: async () => [{ key: 'inbox', title: 'New inbox items', lines: [{ text: 'Fictional Person (form)', href: 'https://desk/inbox/1' }] }] },
  { module: 'blueprint', provider: async () => [{ key: 'tasks', title: "Today's unticked blueprint tasks", lines: [{ text: 'Publish the site' }] }] },
  { module: 'platforms', provider: async () => [{ key: 'renewals', title: 'Renewals due soon', lines: [] }] },
];

const deps = (date: string, notifier: Notifier, extra: Array<{ module: string; provider: DigestProvider }> = []) => ({
  date,
  now: new Date(),
  db: {} as never,
  appUrl: 'https://desk.example',
  providers: [...providers, ...extra],
  notifier,
  notifications: notifications(),
  jobs: jobs(),
});

describe('daily digest', () => {
  it('is safe to run twice: one email, and the second run is recorded as skipped', async () => {
    const box = mailbox();
    const first = await runDigest(deps('2026-12-01', box.n));
    const second = await runDigest(deps('2026-12-01', box.n));
    expect(first.delivery).toBe('sent');
    expect(second.delivery).toBe('already_sent');
    expect(box.sent).toHaveLength(1);
    const runs = await db.query<{ status: string }>(`select status from desk.job_runs where job = 'digest' and run_key = '2026-12-01' order by started_at`);
    expect(runs.rows.map((r) => r.status)).toEqual(['succeeded', 'skipped']);
  });

  it('sends a new digest the next day', async () => {
    const box = mailbox();
    expect((await runDigest(deps('2026-12-02', box.n))).delivery).toBe('sent');
  });

  it('a failed send is recorded as a failed job and goes out on the next run', async () => {
    await expect(runDigest(deps('2026-12-03', mailbox(true).n))).rejects.toThrow(/could not be sent/);
    const failed = await db.query<{ status: string }>(`select status from desk.job_runs where run_key = '2026-12-03'`);
    expect(failed.rows[0]!.status).toBe('failed');
    const box = mailbox();
    expect((await runDigest(deps('2026-12-03', box.n))).delivery).toBe('sent');
    expect(box.sent).toHaveLength(1);
  });

  it('one broken section does not stop the email', async () => {
    const box = mailbox();
    const broken = { module: 'scorecard', provider: (async () => Promise.reject(new Error('timeout'))) as DigestProvider };
    const r = await runDigest(deps('2026-12-04', box.n, [broken]));
    expect(r.delivery).toBe('sent');
    expect(box.sent[0]!.text).toContain('Could not load scorecard');
  });

  it('lists sections in the agreed order and leaves out empty ones', () => {
    const m = composeDigest('2026-12-01', [
      { key: 'renewals', title: 'Renewals due soon', lines: [{ text: 'Vercel' }] },
      { key: 'inbox', title: 'New inbox items', lines: [{ text: 'A' }] },
      { key: 'overdue', title: 'Overdue', lines: [] },
    ], 'https://desk.example');
    expect(m.subject).toBe('Aurion Desk, Tue 1 Dec 2026: 2 items');
    expect(m.text.indexOf('New inbox items')).toBeLessThan(m.text.indexOf('Renewals due soon'));
    expect(m.text).not.toContain('Overdue');
    expect(m.html).not.toMatch(/<script/i);
  });

  it('escapes anything a lead typed before it goes into the HTML email', () => {
    const m = composeDigest('2026-12-01', [{ key: 'inbox', title: 'New inbox items', lines: [{ text: '<img src=x onerror=alert(1)>' }] }], 'https://desk.example');
    expect(m.html).toContain('&lt;img');
    expect(m.html).not.toContain('<img');
  });
});

describe('cron routes', () => {
  const req = (auth?: string) => new Request('https://desk.example/api/cron/digest', { headers: auth ? { authorization: auth } : {} });
  it('refuse a missing or wrong CRON_SECRET', () => {
    const secret = 'c'.repeat(32);
    expect(requireCronSecret(req(), secret)?.status).toBe(401);
    expect(requireCronSecret(req(`Bearer ${'x'.repeat(32)}`), secret)?.status).toBe(401);
    expect(requireCronSecret(req(`Bearer ${secret}`), undefined)?.status).toBe(401);
    expect(requireCronSecret(req(`Bearer ${secret}`), secret)).toBeNull();
  });
});
