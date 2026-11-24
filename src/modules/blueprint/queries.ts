import 'server-only';
import type { DeskClient } from '@/lib/db/server';
import type { CurrentTask } from './diff';

export interface SectionRow {
  id: string;
  key: string;
  parent_id: string | null;
  level: number;
  number: string | null;
  title: string;
  position: number;
  run_date: string | null;
  body_markdown: string;
}

export interface TaskRow {
  id: string;
  kind: 'blueprint' | 'adhoc';
  title: string;
  section_id: string | null;
  section_label: string | null;
  source_ref: string | null;
  position: number | null;
  due_date: string | null;
  done_at: string | null;
  lead_id: string | null;
}

const TASK_COLS = 'id, kind, title, section_id, section_label, source_ref, position, due_date, done_at, lead_id';

export async function loadBlueprint(db: DeskClient) {
  const [doc, sections, tasks] = await Promise.all([
    db.from('blueprint_documents').select('id, version, title, doc_date, imported_at').eq('is_current', true).maybeSingle(),
    db.from('blueprint_sections').select('id, key, parent_id, level, number, title, position, run_date, body_markdown').is('removed_at', null).order('position'),
    db.from('tasks').select(TASK_COLS).is('removed_at', null).order('position', { nullsFirst: false }).order('created_at').limit(2000),
  ]);
  return {
    doc: doc.data as { id: string; version: number; title: string; doc_date: string | null; imported_at: string } | null,
    sections: (sections.data ?? []) as SectionRow[],
    tasks: (tasks.data ?? []) as TaskRow[],
  };
}

/** Undone tasks due on or before a date (today's list plus anything overdue). */
export async function tasksDueBy(db: DeskClient, date: string, limit = 50): Promise<TaskRow[]> {
  const { data } = await db
    .from('tasks')
    .select(TASK_COLS)
    .is('removed_at', null)
    .is('done_at', null)
    .lte('due_date', date)
    .order('due_date')
    .order('position', { nullsFirst: false })
    .limit(limit);
  return (data ?? []) as TaskRow[];
}

/** Everything the diff needs: every blueprint task (removed ones too) and the current version. */
export async function currentForDiff(db: DeskClient): Promise<{ tasks: CurrentTask[]; sectionKeys: string[]; version: number | null }> {
  const [tasks, sections, doc] = await Promise.all([
    db.from('tasks').select('id, match_key, title, done_at, removed_at, section:blueprint_sections(key)').eq('kind', 'blueprint').limit(5000),
    db.from('blueprint_sections').select('key').is('removed_at', null),
    db.from('blueprint_documents').select('version').eq('is_current', true).maybeSingle(),
  ]);
  type Row = { id: string; match_key: string; title: string; done_at: string | null; removed_at: string | null; section: { key: string } | null };
  return {
    tasks: ((tasks.data ?? []) as unknown as Row[]).map((t) => ({
      id: t.id,
      matchKey: t.match_key,
      sectionKey: t.section?.key ?? '',
      title: t.title,
      doneAt: t.done_at,
      removed: t.removed_at !== null,
    })),
    sectionKeys: ((sections.data ?? []) as Array<{ key: string }>).map((s) => s.key),
    version: (doc.data as { version: number } | null)?.version ?? null,
  };
}
