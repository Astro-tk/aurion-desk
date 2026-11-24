import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * In-memory Postgres (PGlite) with the real Desk migrations applied, plus a stand-in for
 * the parts of Supabase that the migrations rely on: the anon / authenticated / service_role
 * roles and auth.uid() / auth.jwt(), which read request.jwt.claims exactly as Supabase does.
 */
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
`;

export const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
}

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { citext } });
  await db.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return db;
}

export const OWNER_ID = '11111111-1111-4111-8111-111111111111';
export const VIEWER_ID = '33333333-3333-4333-8333-333333333333';

export async function seedMembers(db: PGlite): Promise<void> {
  await db.exec(`
    insert into auth.users values ('${OWNER_ID}', 'owner@example.test'), ('${VIEWER_ID}', 'viewer@example.test');
    insert into desk.members (user_id, email, display_name, role) values
      ('${OWNER_ID}', 'owner@example.test', 'Owner', 'owner'),
      ('${VIEWER_ID}', 'viewer@example.test', 'Viewer', 'viewer');
  `);
}

export type Claims = Record<string, unknown>;
export const ANON: Claims = { role: 'anon' };
export const SERVICE: Claims = { role: 'service_role' };
export const ownerClaims = (aal: 'aal1' | 'aal2'): Claims => ({ sub: OWNER_ID, role: 'authenticated', aal, email: 'owner@example.test' });
export const viewerClaims = (aal: 'aal1' | 'aal2'): Claims => ({ sub: VIEWER_ID, role: 'authenticated', aal });

const ROLE_FOR = (c: Claims) => (c.role === 'service_role' ? 'service_role' : c.role === 'authenticated' ? 'authenticated' : 'anon');

function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Run SQL as a Supabase caller: sets the JWT claims (and optional request headers),
 * switches to the matching database role, then resets.
 */
export async function asRole<T = Record<string, unknown>>(
  db: PGlite,
  claims: Claims,
  sql: string,
  params: unknown[] = [],
  headers: Record<string, string> = {},
): Promise<T[]> {
  await db.exec(`reset role;
    select set_config('request.jwt.claims', ${quote(JSON.stringify(claims))}, false);
    select set_config('request.headers', ${quote(JSON.stringify(headers))}, false);
    set role ${ROLE_FOR(claims)};`);
  try {
    const result = await db.query<T>(sql, params);
    return result.rows;
  } finally {
    await db.exec(`reset role;
      select set_config('request.jwt.claims', '', false);
      select set_config('request.headers', '', false);`);
  }
}

/** Same as asRole but returns the error message instead of throwing. */
export async function tryAsRole(db: PGlite, claims: Claims, sql: string, params: unknown[] = [], headers: Record<string, string> = {}) {
  try {
    return { rows: await asRole(db, claims, sql, params, headers), error: null as string | null };
  } catch (e) {
    return { rows: [] as Record<string, unknown>[], error: (e as Error).message };
  }
}

export async function allDeskTables(db: PGlite): Promise<string[]> {
  const r = await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'desk' order by 1`);
  return r.rows.map((x) => x.tablename);
}
