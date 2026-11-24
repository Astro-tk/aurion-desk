'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { check, fields, formObject, run, type ActionResult } from '@/lib/actions';
import { requireCapability } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { applyPayload, computeBlueprintDiff, type BlueprintDiff } from './diff';
import { countsBySection, parseBlueprint } from './parser';
import { currentForDiff } from './queries';

export async function toggleTaskAction(fd: FormData): Promise<void> {
  await run(async () => {
    const member = await requireCapability('blueprint.write');
    const { id, done } = z.object({ id: fields.uuid, done: z.enum(['1', '0']) }).parse(formObject(fd));
    const db = await userDb({ source: 'manual' });
    check(
      await db
        .from('tasks')
        .update(done === '1' ? { done_at: new Date().toISOString(), done_by: member.userId } : { done_at: null, done_by: null })
        .eq('id', id),
    );
    revalidatePath('/blueprint');
    revalidatePath('/');
    return { ok: true };
  });
}

const adhocSchema = z.object({
  title: fields.requiredText(1000, 'The task'),
  due_date: fields.isoDate.optional(),
  section_label: fields.optionalText(100),
});

export async function addTaskAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const member = await requireCapability('blueprint.write');
    const input = adhocSchema.parse(formObject(fd));
    const db = await userDb({ source: 'manual' });
    check(
      await db.from('tasks').insert({
        kind: 'adhoc',
        title: input.title,
        due_date: input.due_date ?? null,
        section_label: input.section_label ?? 'Ad hoc',
        created_by: member.userId,
      }),
    );
    revalidatePath('/blueprint');
    revalidatePath('/');
    return { ok: true, message: 'Task added.' };
  });
}

const MAX_MD = 2 * 1024 * 1024;

export interface PreviewData {
  text: string;
  filename: string;
  title: string;
  docDate: string | null;
  problems: string[];
  counts: ReturnType<typeof countsBySection>;
  totalTasks: number;
  diff: BlueprintDiff;
  expectedVersion: number | null;
  firstImport: boolean;
}

async function readUpload(fd: FormData): Promise<{ text: string; filename: string } | null> {
  const file = fd.get('file');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_MD) return null;
    return { text: await file.text(), filename: file.name };
  }
  const text = fd.get('text');
  if (typeof text === 'string' && text.trim()) return text.length > MAX_MD ? null : { text, filename: String(fd.get('filename') ?? 'blueprint.md') };
  return null;
}

/** Step 1: parse and diff. Nothing is saved. */
export async function previewBlueprintAction(_prev: ActionResult, fd: FormData): Promise<ActionResult<PreviewData>> {
  return run(async () => {
    await requireCapability('blueprint.import');
    const upload = await readUpload(fd);
    if (!upload) return { ok: false, error: 'Choose blueprint.md (under 2 MB).' };
    const parsed = parseBlueprint(upload.text);
    const current = await currentForDiff(await userDb());
    const diff = computeBlueprintDiff(current.tasks, current.sectionKeys, parsed);
    return {
      ok: true,
      data: {
        text: upload.text,
        filename: upload.filename,
        title: parsed.title,
        docDate: parsed.docDate,
        problems: parsed.problems,
        counts: countsBySection(parsed),
        totalTasks: parsed.tasks.length,
        diff,
        expectedVersion: current.version,
        firstImport: current.version === null,
      },
    };
  });
}

/** Step 2: apply exactly what was previewed. */
export async function applyBlueprintAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await requireCapability('blueprint.import');
    const upload = await readUpload(fd);
    if (!upload) return { ok: false, error: 'The file is missing. Preview it again.' };
    const expected = fd.get('expected_version');
    const expectedVersion = expected === '' || expected === null ? null : Number(expected);
    const parsed = parseBlueprint(upload.text);
    if (parsed.problems.length) return { ok: false, error: 'Fix the problems listed above first.' };
    const db = await userDb({ source: 'import' });
    const current = await currentForDiff(db);
    if (current.version !== expectedVersion) return { ok: false, error: 'The blueprint changed since your preview. Preview it again.' };
    const diff = computeBlueprintDiff(current.tasks, current.sectionKeys, parsed);
    const result = check(await db.rpc('apply_blueprint', { p: applyPayload(parsed, diff, expectedVersion) })) as {
      version: number;
      added: number;
      updated: number;
      removed: number;
    };
    revalidatePath('/blueprint');
    revalidatePath('/');
    return {
      ok: true,
      message: `Version ${result.version} is live: ${result.added} new, ${result.updated} kept, ${result.removed} removed. ${diff.ticksKept} ticks kept.`,
    };
  });
}
