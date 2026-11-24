import { describe, expect, it } from 'vitest';
import { createTestDb, migrationFiles } from './helpers/db';

describe('migrations', () => {
  it('apply cleanly, in order, on an empty database', async () => {
    const db = await createTestDb();
    const r = await db.query<{ n: number }>(`select count(*)::int n from pg_tables where schemaname = 'desk'`);
    expect(r.rows[0]!.n).toBeGreaterThan(25);
    expect(migrationFiles()[0]).toBe('0001_foundation.sql');
  });
});
