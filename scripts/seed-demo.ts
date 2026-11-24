/**
 * Fills a DEMO database with fictional data for screenshots.
 *
 *   npm run seed:demo
 *
 * Refuses unless the database in DATABASE_URL is marked demo (npm run db:migrate -- --mode demo)
 * and has no leads yet, so it can never touch your real Desk. Set DEMO=true in that
 * deployment's environment too; Desk refuses to start if the two disagree.
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLocalEnv, requireEnv } from './_shared';

loadLocalEnv();

async function main(): Promise<void> {
  const sql = postgres(requireEnv('DATABASE_URL'), { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const [instance] = await sql<{ mode: string }[]>`select mode from desk.instance`;
    if (instance?.mode !== 'demo') {
      throw new Error(`This database is marked "${instance?.mode ?? 'nothing'}", not demo. Refusing to add demo data.`);
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(process.cwd(), 'db', 'seed', 'demo.sql'), 'utf8'));
    });
    console.log('Demo data added: 10 fictional people, 8 leads, 2 inbox items, 4 weeks of scorecard numbers.');
    console.log('Import the blueprint from the Blueprint page to complete the picture.');
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(`\nStopped: ${(err as Error).message}`);
  process.exitCode = 1;
});
