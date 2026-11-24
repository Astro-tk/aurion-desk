import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestDb } from './helpers/db';

const DEMO = readFileSync(join(process.cwd(), 'db', 'seed', 'demo.sql'), 'utf8');

describe('demo mode', () => {
  it('refuses to seed a database marked production', async () => {
    const db = await createTestDb();
    await db.query(`insert into desk.instance (mode) values ('production')`);
    await expect(db.exec(DEMO)).rejects.toThrow(/not marked demo/);
    expect((await db.query(`select count(*)::int n from desk.leads`)).rows[0]).toEqual({ n: 0 });
  });

  it('refuses a database with no mark at all', async () => {
    const db = await createTestDb();
    await expect(db.exec(DEMO)).rejects.toThrow(/not marked demo/);
  });

  it('seeds a demo database with fictional, undeliverable data, and only once', async () => {
    const db = await createTestDb();
    await db.query(`insert into desk.instance (mode) values ('demo')`);
    await db.exec(DEMO);
    const counts = (
      await db.query<Record<string, number>>(
        `select (select count(*)::int from desk.leads) leads, (select count(*)::int from desk.inbox_items) inbox,
                (select count(*)::int from desk.contacts where email not like '%.example') real_looking_emails,
                (select count(*)::int from desk.lead_overview where do_not_contact) said_no,
                (select count(*)::int from desk.lead_overview where is_overdue) overdue`,
      )
    ).rows[0];
    expect(counts).toEqual({ leads: 8, inbox: 2, real_looking_emails: 0, said_no: 1, overdue: 2 });
    await expect(db.exec(DEMO)).rejects.toThrow(/already has leads/);
  });
});
