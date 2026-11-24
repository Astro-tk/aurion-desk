/**
 * An in-memory Postgres (PGlite) with every Desk migration applied and an owner signed in at
 * aal2. The local verification scripts use it so they never need, or touch, a real database.
 * Everything disappears when the script ends.
 */
export { asRole, createTestDb as createLocalDb, OWNER_ID, ownerClaims, seedMembers, SERVICE } from '../tests/helpers/db';

export function table(rows: readonly unknown[]): void {
  if (rows.length === 0) {
    console.log('  (none)');
    return;
  }
  console.table(rows);
}
