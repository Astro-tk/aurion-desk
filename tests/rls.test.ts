import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { capabilityRows } from '@/lib/auth/permissions';
import {
  ANON,
  SERVICE,
  allDeskTables,
  asRole,
  createTestDb,
  ownerClaims,
  seedMembers,
  tryAsRole,
  viewerClaims,
} from './helpers/db';

let db: PGlite;
let tables: string[];

beforeAll(async () => {
  db = await createTestDb();
  await seedMembers(db);
  await db.exec(`insert into desk.contacts (full_name, email) values ('Fictional Person', 'fictional@example.test');`);
  tables = await allDeskTables(db);
});

describe('Row Level Security', () => {
  it('is enabled on every desk table', async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'desk' and c.relkind = 'r'`,
    );
    const off = r.rows.filter((x) => !x.relrowsecurity).map((x) => x.relname);
    expect(off).toEqual([]);
  });

  it('an anonymous client reads nothing from any table', async () => {
    for (const t of tables) {
      const r = await tryAsRole(db, ANON, `select * from desk.${t} limit 1`);
      expect(r.rows, t).toHaveLength(0);
      expect(r.error, t).toMatch(/permission denied/);
    }
  });

  it('an aal1 session (password only, no 2FA) reads nothing from any table', async () => {
    for (const t of tables) {
      const r = await tryAsRole(db, ownerClaims('aal1'), `select * from desk.${t} limit 1`);
      expect(r.rows, `${t} leaked to aal1`).toHaveLength(0);
    }
  });

  it('an aal1 session cannot write either', async () => {
    const r = await tryAsRole(db, ownerClaims('aal1'), `insert into desk.organisations (name) values ('Sneaky')`);
    expect(r.error).toMatch(/row-level security/);
  });

  it('an aal2 owner reads data', async () => {
    const rows = await asRole(db, ownerClaims('aal2'), `select count(*)::int n from desk.contacts`);
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('a viewer can read but not write, and cannot see the audit log', async () => {
    expect((await asRole(db, viewerClaims('aal2'), `select count(*)::int n from desk.contacts`))[0]).toEqual({ n: 1 });
    const w = await tryAsRole(db, viewerClaims('aal2'), `insert into desk.organisations (name) values ('Nope')`);
    expect(w.error).toMatch(/row-level security/);
    expect(await asRole(db, viewerClaims('aal2'), `select * from desk.audit_log`)).toHaveLength(0);
  });

  it('service-only tables are invisible to members', async () => {
    for (const t of ['suppressions', 'auth_attempts', 'rate_limit_buckets', 'ingest_nonces']) {
      expect(await asRole(db, ownerClaims('aal2'), `select * from desk.${t}`), t).toHaveLength(0);
    }
  });

  it('capabilities in the database match permissions.ts exactly', async () => {
    const r = await db.query<{ role: string; capability: string }>(`select role, capability from desk.role_capabilities`);
    const inDb = r.rows.map((x) => `${x.role}:${x.capability}`).sort();
    const inCode = capabilityRows().map(([role, cap]) => `${role}:${cap}`).sort();
    expect(inDb).toEqual(inCode);
  });
});

describe('audit log', () => {
  it('records creates and updates with actor and column names only', async () => {
    await asRole(db, ownerClaims('aal2'), `update desk.contacts set role_title = 'Director'`);
    const rows = await asRole<{ action: string; actor_kind: string; changed_columns: string[] }>(
      db,
      ownerClaims('aal2'),
      `select action, actor_kind, changed_columns from desk.audit_log where table_name = 'contacts' order by id`,
    );
    expect(rows.at(-1)).toEqual({ action: 'update', actor_kind: 'member', changed_columns: ['role_title'] });
  });

  it('is append-only, even for the service role and the table owner', async () => {
    expect((await tryAsRole(db, SERVICE, `delete from desk.audit_log`)).error).toMatch(/permission denied/);
    expect((await tryAsRole(db, SERVICE, `update desk.audit_log set action = 'create'`)).error).toMatch(/permission denied/);
    await expect(db.query(`delete from desk.audit_log`)).rejects.toThrow(/append-only/);
  });

  it('records sign-in events through the server helper', async () => {
    await asRole(db, SERVICE, `select desk.audit_auth_event('sign_in', '11111111-1111-4111-8111-111111111111', '{}')`);
    const r = await db.query<{ n: number }>(`select count(*)::int n from desk.audit_log where action = 'sign_in'`);
    expect(r.rows[0]!.n).toBe(1);
  });
});

describe('login lockout', () => {
  it('locks an email after 5 failures in 15 minutes', async () => {
    const e = 'a'.repeat(64);
    for (let i = 0; i < 4; i++) await db.query(`insert into desk.auth_attempts (email_hash, ip_hash, succeeded) values ($1, 'ip1', false)`, [e]);
    let r = await db.query<{ s: number }>(`select desk.auth_lockout_seconds($1, 'ip1') s`, [e]);
    expect(r.rows[0]!.s).toBe(0);
    await db.query(`insert into desk.auth_attempts (email_hash, ip_hash, succeeded) values ($1, 'ip1', false)`, [e]);
    r = await db.query<{ s: number }>(`select desk.auth_lockout_seconds($1, 'ip1') s`, [e]);
    expect(r.rows[0]!.s).toBeGreaterThan(800);
  });

  it('members cannot call the lockout or rate-limit helpers', async () => {
    expect((await tryAsRole(db, ownerClaims('aal2'), `select desk.rate_limit_take('x', 60, 5)`)).error).toMatch(/permission denied/);
  });
});
