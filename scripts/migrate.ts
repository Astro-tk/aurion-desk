/**
 * Applies db/migrations/*.sql in order to the database in DATABASE_URL.
 *
 *   npm run db:migrate -- --mode production     (first run on the real project)
 *   npm run db:migrate -- --mode demo           (first run on a demo/dev project)
 *   npm run db:migrate                          (later runs; mode is already recorded)
 *   npm run db:migrate -- --status              (list applied and pending, change nothing)
 *
 * History lives in desk.schema_migrations, NOT in Supabase's own migration table, so
 * it never collides with aurion-assistant's migrations in the shared project.
 * Each file runs inside one transaction: it applies completely or not at all.
 */
import postgres from 'postgres';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadLocalEnv } from './_shared';

loadLocalEnv();

const dir = join(process.cwd(), 'db', 'migrations');
const args = process.argv.slice(2);
const statusOnly = args.includes('--status');
const modeArg = args[args.indexOf('--mode') + 1];
const mode = args.includes('--mode') ? modeArg : undefined;

if (mode && mode !== 'production' && mode !== 'demo') {
  console.error('--mode must be "production" or "demo".');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Put it in .env.local (see .env.example) and run again.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => undefined, prepare: false });

async function main(): Promise<void> {
  await sql.unsafe(`
    create schema if not exists desk;
    create table if not exists desk.schema_migrations (
      filename   text primary key,
      sha256     text not null,
      applied_at timestamptz not null default now()
    );
    alter table desk.schema_migrations enable row level security;
    revoke all on desk.schema_migrations from public;
  `);

  const applied = new Map(
    (await sql<{ filename: string; sha256: string }[]>`select filename, sha256 from desk.schema_migrations`).map((r) => [
      r.filename,
      r.sha256,
    ]),
  );
  const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();

  let pending = 0;
  for (const file of files) {
    const body = readFileSync(join(dir, file), 'utf8');
    // Line endings are ignored, so a Windows checkout (CRLF) matches what was applied (LF).
    const hash = createHash('sha256').update(body.replace(/\r\n/g, '\n')).digest('hex');
    const previous = applied.get(file);
    if (previous) {
      if (previous !== hash) {
        throw new Error(
          `${file} was changed after it was applied. Never edit an applied migration; add a new numbered file instead.`,
        );
      }
      if (statusOnly) console.log(`applied   ${file}`);
      continue;
    }
    pending += 1;
    if (statusOnly) {
      console.log(`PENDING   ${file}`);
      continue;
    }
    process.stdout.write(`applying  ${file} ... `);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into desk.schema_migrations (filename, sha256) values (${file}, ${hash})`;
    });
    console.log('done');
  }

  if (statusOnly) {
    console.log(pending === 0 ? 'Nothing pending.' : `${pending} pending.`);
    return;
  }

  const instance = await sql<{ mode: string }[]>`select mode from desk.instance`;
  if (instance.length === 0) {
    if (!mode) {
      throw new Error(
        'First run: say what this database is for. Run again with --mode production (your real Desk) or --mode demo.',
      );
    }
    await sql`insert into desk.instance (mode) values (${mode})`;
    console.log(`This database is now marked as: ${mode}`);
  } else if (mode && instance[0]!.mode !== mode) {
    throw new Error(`This database is marked "${instance[0]!.mode}", not "${mode}". Refusing to continue.`);
  }

  console.log(pending === 0 ? 'Database already up to date.' : `Applied ${pending} migration(s).`);
}

main()
  .catch((err: unknown) => {
    console.error(`\nMigration stopped: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
