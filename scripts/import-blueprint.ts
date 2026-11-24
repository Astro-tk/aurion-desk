/**
 * Blueprint import check, locally.
 *
 *   npm run import:blueprint -- ../Blueprint.md
 *
 * Parses the file, applies it to an in-memory copy of Desk's database exactly as the
 * Blueprint > Re-import page does, and prints the task count per section from that database.
 * Nothing is saved anywhere.
 */
import { readFileSync } from 'node:fs';
import { applyPayload, computeBlueprintDiff } from '../src/modules/blueprint/diff';
import { parseBlueprint } from '../src/modules/blueprint/parser';
import { asRole, createLocalDb, ownerClaims, seedMembers, table } from './_localdb';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error('Give the markdown path, e.g. npm run import:blueprint -- ../Blueprint.md');
  const parsed = parseBlueprint(readFileSync(file, 'utf8'));
  console.log(`\n${parsed.title}`);
  console.log(`Byline date: ${parsed.docDate ?? 'not found'}. Sections: ${parsed.sections.length}. Tasks: ${parsed.tasks.length}.`);
  if (parsed.problems.length) {
    console.log('\nPROBLEMS (the import would stop):');
    parsed.problems.forEach((p) => console.log(`  - ${p}`));
    process.exitCode = 1;
    return;
  }
  const db = await createLocalDb();
  await seedMembers(db);
  const diff = computeBlueprintDiff([], [], parsed);
  const [r] = await asRole<{ r: Record<string, number> }>(db, ownerClaims('aal2'), `select desk.apply_blueprint($1::jsonb) r`, [JSON.stringify(applyPayload(parsed, diff, null))], { 'x-desk-source': 'import' });
  console.log('Applied to the in-memory copy:', r!.r);

  const rows = (
    await db.query<{ section: string; tasks: number; with_due_date: number; first_due: string | null; last_due: string | null }>(`
      select coalesce(p.number || '. ', '') || p.title as section,
             count(t.id)::int as tasks,
             count(t.due_date)::int as with_due_date,
             to_char(min(t.due_date), 'DD Mon YYYY') as first_due,
             to_char(max(t.due_date), 'DD Mon YYYY') as last_due
        from desk.blueprint_sections p
        left join desk.blueprint_sections c on c.parent_id = p.id
        left join desk.tasks t on t.section_id in (p.id, c.id) and t.removed_at is null
       where p.level = 2
       group by p.id, p.number, p.title, p.position
       order by p.position`)
  ).rows;
  console.log('\nTasks per section, read back from the database:');
  table(rows.map((x) => ({ ...x, first_due: x.first_due ?? '', last_due: x.last_due ?? '' })));
  const total = rows.reduce((n, x) => n + x.tasks, 0);
  console.log(`Total: ${total} tasks, ${rows.reduce((n, x) => n + x.with_due_date, 0)} with a due date.`);
}

main().catch((err: unknown) => {
  console.error(`\nStopped: ${(err as Error).message}`);
  process.exitCode = 1;
});
