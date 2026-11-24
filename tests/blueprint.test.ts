import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { applyPayload, computeBlueprintDiff, type CurrentTask } from '@/modules/blueprint/diff';
import { countsBySection, parseBlueprint } from '@/modules/blueprint/parser';
import { asRole, createTestDb, ownerClaims, seedMembers, tryAsRole } from './helpers/db';

const SOURCE = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'blueprint.md'), 'utf8');

describe('blueprint parsing', () => {
  const bp = parseBlueprint(SOURCE);

  it('reads the title, the byline date and every checklist item', () => {
    expect(bp.title).toBe('Aurion Creative: December Execution Blueprint');
    expect(bp.docDate).toBe('2026-11-14');
    expect(bp.problems).toEqual([]);
    expect(bp.tasks).toHaveLength(189);
  });

  it('counts tasks per section', () => {
    const counts = Object.fromEntries(countsBySection(bp).map((c) => [c.key, c.tasks]));
    expect(counts).toEqual({ s1: 0, s2: 0, s3: 28, s4: 25, s5: 14, s6: 9, s7: 8, s8: 16, s9: 12, s10: 77, s11: 0, sources: 0 });
  });

  it('gives run-sheet tasks the date in their heading ("Tue 1 Dec" is 1 Dec 2026)', () => {
    const first = bp.tasks.find((t) => t.sectionKey === 's10/d2026-12-01')!;
    expect(first).toMatchObject({ title: 'Read the Vesconite contract and note the four clauses', dueDate: '2026-12-01' });
    expect(bp.tasks.filter((t) => t.dueDate).length).toBe(77);
    expect(new Set(bp.tasks.filter((t) => t.dueDate).map((t) => t.dueDate)).size).toBe(24);
    expect(bp.sections.find((s) => s.title === 'Wed 16 Dec, public holiday')?.runDate).toBe('2026-12-16');
    expect(bp.tasks.filter((t) => !t.sectionKey.startsWith('s10')).every((t) => t.dueDate === null)).toBe(true);
  });

  it('keeps tables and prose as the section body, and drops export artefacts', () => {
    const s1 = bp.sections.find((s) => s.key === 's1')!;
    expect(s1.bodyMarkdown).toContain('| Workflow Audit |');
    expect(bp.sections.find((s) => s.key === 's2')!.bodyMarkdown).not.toContain('embedded content');
    expect(bp.sections.find((s) => s.key === 's3/channel-2')!.bodyMarkdown).toContain('| A. QS principals |');
  });

  it('keeps inline code in task text', () => {
    expect(bp.tasks.some((t) => t.title.includes('`quantity surveyor`'))).toBe(true);
  });

  it('refuses a run-sheet heading whose weekday does not match its date', () => {
    const broken = SOURCE.replace('### Tue 1 Dec', '### Wed 1 Dec');
    expect(parseBlueprint(broken).problems).toEqual(['"Wed 1 Dec": 1 Dec 2026 is a Tue, not a Wed.']);
  });
});

describe('re-import keeps ticks', () => {
  let db: PGlite;
  const owner = ownerClaims('aal2');

  async function current(): Promise<{ tasks: CurrentTask[]; sectionKeys: string[]; version: number | null }> {
    const t = await db.query<{ id: string; match_key: string; title: string; done_at: string | null; removed_at: string | null; key: string }>(
      `select t.id, t.match_key, t.title, t.done_at, t.removed_at, s.key from desk.tasks t join desk.blueprint_sections s on s.id = t.section_id where t.kind = 'blueprint'`,
    );
    const s = await db.query<{ key: string }>(`select key from desk.blueprint_sections where removed_at is null`);
    const v = await db.query<{ version: number }>(`select version from desk.blueprint_documents where is_current`);
    return {
      tasks: t.rows.map((r) => ({ id: r.id, matchKey: r.match_key, sectionKey: r.key, title: r.title, doneAt: r.done_at, removed: r.removed_at !== null })),
      sectionKeys: s.rows.map((r) => r.key),
      version: v.rows[0]?.version ?? null,
    };
  }

  async function importText(text: string) {
    const parsed = parseBlueprint(text);
    const cur = await current();
    const diff = computeBlueprintDiff(cur.tasks, cur.sectionKeys, parsed);
    const [r] = await asRole<{ r: { version: number; added: number; updated: number; removed: number } }>(
      db,
      owner,
      `select desk.apply_blueprint($1::jsonb) r`,
      [JSON.stringify(applyPayload(parsed, diff, cur.version))],
      { 'x-desk-source': 'import' },
    );
    return { diff, result: r!.r };
  }

  const tick = (title: string) => asRole(db, owner, `update desk.tasks set done_at = now() where title = $1 and removed_at is null`, [title]);
  const doneOf = async (title: string) =>
    (await db.query<{ done: boolean; removed: boolean }>(`select done_at is not null done, removed_at is not null removed from desk.tasks where title = $1`, [title])).rows;

  beforeAll(async () => {
    db = await createTestDb();
    await seedMembers(db);
  });

  it('first import adds all 189 tasks and stores the source markdown', async () => {
    const { result } = await importText(SOURCE);
    expect(result).toMatchObject({ version: 1, added: 189, updated: 0, removed: 0 });
    const doc = await db.query<{ len: number }>(`select length(source_markdown) len from desk.blueprint_documents where is_current`);
    expect(doc.rows[0]!.len).toBe(SOURCE.length);
  });

  it('an updated file keeps ticks on unchanged and reworded tasks, and shows the diff first', async () => {
    await tick('Read the Vesconite contract and note the four clauses');
    await tick('Create the Aurion Pipeline tracker');
    await tick('Publish the site');
    const edited = SOURCE.replace('- [ ] Create the Aurion Pipeline tracker', '- [ ] Create the Aurion Pipeline tracker sheet')
      .replace('- [ ] Publish the site\n', '')
      .replace('### Wed 2 Dec\n\n', '### Wed 2 Dec\n\n- [ ] Order business cards\n')
      .replace('## 10. December run sheet, day by day', '## 10. December run sheet');

    const parsed = parseBlueprint(edited);
    const cur = await current();
    const diff = computeBlueprintDiff(cur.tasks, cur.sectionKeys, parsed);
    expect(diff.added.map((t) => t.title)).toEqual(['Order business cards']);
    expect(diff.reworded.map((r) => [r.from.title, r.to.title])).toEqual([['Create the Aurion Pipeline tracker', 'Create the Aurion Pipeline tracker sheet']]);
    expect(diff.removed.map((t) => t.title)).toEqual(['Publish the site']);
    expect(diff.ticksKept).toBe(2);
    expect(diff.ticksLost).toBe(1);

    const { result } = await importText(edited);
    expect(result).toMatchObject({ version: 2, added: 1, removed: 1 });
    expect(await doneOf('Read the Vesconite contract and note the four clauses')).toEqual([{ done: true, removed: false }]);
    expect(await doneOf('Create the Aurion Pipeline tracker sheet')).toEqual([{ done: true, removed: false }]);
    // The removed task keeps its tick in history.
    expect(await doneOf('Publish the site')).toEqual([{ done: true, removed: true }]);
    // Renaming the section heading did not lose anything: sections key on their number.
    const s = await db.query<{ title: string }>(`select title from desk.blueprint_sections where key = 's10'`);
    expect(s.rows[0]!.title).toBe('December run sheet');
  });

  it('a task that comes back is restored with its old tick', async () => {
    const { diff } = await importText(SOURCE);
    expect(diff.restored.map((r) => r.to.title)).toEqual(['Publish the site']);
    expect(await doneOf('Publish the site')).toEqual([{ done: true, removed: false }]);
  });

  it('refuses a stale apply, and members without import rights', async () => {
    const parsed = parseBlueprint(SOURCE);
    const stale = applyPayload(parsed, computeBlueprintDiff([], [], parsed), 1);
    expect((await tryAsRole(db, owner, `select desk.apply_blueprint($1::jsonb)`, [JSON.stringify(stale)])).error).toMatch(/changed since/);
    expect((await tryAsRole(db, ownerClaims('aal1'), `select desk.apply_blueprint($1::jsonb)`, [JSON.stringify(stale)])).error).toMatch(/Not allowed/);
  });

  it('ticking writes task_done and unticking writes task_reopened', async () => {
    await asRole(db, owner, `update desk.tasks set done_at = null where title = 'Publish the site'`);
    const ev = await db.query<{ type: string }>(`select type from desk.events where subject_type = 'task' order by id`);
    expect(ev.rows.map((e) => e.type)).toEqual(['task_done', 'task_done', 'task_done', 'task_reopened']);
  });
});
