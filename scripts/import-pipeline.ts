/**
 * Pipeline CSV dry run, locally, before you upload anything.
 *
 *   npm run import:pipeline -- ../Pipeline.csv
 *   npm run import:pipeline -- tracker.csv --commit     (also shows what the import would add)
 *
 * Runs against an in-memory copy of Desk's database with the standard lists. Nothing is saved
 * anywhere. The real import is on the Pipeline > Import CSV page.
 */
import { readFileSync } from 'node:fs';
import { todaySast } from '../src/lib/format';
import { dryRunPipelineCsv } from '../src/modules/pipeline/csv-import';
import { asRole, createLocalDb, OWNER_ID, ownerClaims, seedMembers, table } from './_localdb';

async function main(): Promise<void> {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!file) throw new Error('Give the CSV path, e.g. npm run import:pipeline -- ../Pipeline.csv');
  const text = readFileSync(file, 'utf8');
  const db = await createLocalDb();
  await seedMembers(db);
  const q = async (t: string, extra = '') => (await db.query<{ key: string; label: string; number?: number }>(`select key, label${extra} from desk.${t}`)).rows;
  const report = dryRunPipelineCsv(text, {
    orgTypes: await q('org_types'),
    sources: await q('lead_sources'),
    channels: await q('channels', ', number'),
    stages: await q('stages'),
    existingEmails: new Set(),
    today: todaySast(),
  });

  console.log(`\nDRY RUN: ${file}`);
  console.log(`Rows: ${report.counts.total}   ready: ${report.counts.ok}   skipped: ${report.counts.skip}   with errors: ${report.counts.error}   warnings: ${report.counts.warnings}`);
  for (const p of report.fileProblems) console.log(`${p.level === 'error' ? 'FILE ERROR' : 'File warning'}: ${p.message}`);
  const problems = report.rows.flatMap((r) => r.problems.map((p) => ({ row: r.row, who: r.label, level: p.level, column: p.column, problem: p.message })));
  if (problems.length) {
    console.log('\nEvery problem, by row:');
    table(problems);
  }
  console.log(report.ok ? '\nResult: ready to import. Nothing blocks it.' : '\nResult: NOT ready. Nothing would be imported until every error is fixed.');

  if (process.argv.includes('--commit') && report.ok) {
    const [batch] = await asRole<{ id: string }>(db, ownerClaims('aal2'), `insert into desk.import_batches (kind, sha256, status, created_by) values ('pipeline_csv', 'local', 'dry_run', $1) returning id`, [OWNER_ID]);
    const rows = report.rows.filter((r) => r.status === 'ok').map((r) => r.data);
    const [r] = await asRole<{ r: unknown }>(db, ownerClaims('aal2'), `select desk.import_pipeline($1, $2::jsonb) r`, [batch!.id, JSON.stringify(rows)], { 'x-desk-source': 'import' });
    console.log('\nTrial import into the in-memory copy (nothing saved):', r!.r);
    table((await db.query(`select stage_key as stage, count(*)::int as leads from desk.leads group by 1 order by 1`)).rows);
  }
}

main().catch((err: unknown) => {
  console.error(`\nStopped: ${(err as Error).message}`);
  process.exitCode = 1;
});
