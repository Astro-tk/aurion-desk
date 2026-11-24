import { normaliseTaskText, type ParsedBlueprint, type ParsedTask } from './parser';

/**
 * Re-import diff. Tasks match by section and text (case, spacing and punctuation ignored).
 * A task whose wording changed a little in the same section is paired as "reworded" and keeps
 * its tick. Nothing is applied until you have seen this diff.
 */
export interface CurrentTask {
  id: string;
  matchKey: string;
  sectionKey: string;
  title: string;
  doneAt: string | null;
  removed: boolean; // removed_at is set (dropped by an earlier import)
}

export interface BlueprintDiff {
  added: ParsedTask[];
  removed: CurrentTask[];
  reworded: Array<{ from: CurrentTask; to: ParsedTask }>;
  restored: Array<{ from: CurrentTask; to: ParsedTask }>;
  unchanged: number;
  ticksKept: number;
  ticksLost: number; // ticked tasks that disappear (kept in history, hidden from the list)
  sectionsAdded: string[];
  sectionsRemoved: string[];
}

function words(s: string): Set<string> {
  return new Set(normaliseTaskText(s).split(' ').filter((w) => w.length > 1));
}

export function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

export const REWORD_THRESHOLD = 0.6;

export function computeBlueprintDiff(current: CurrentTask[], currentSectionKeys: string[], parsed: ParsedBlueprint): BlueprintDiff {
  const active = new Map(current.filter((t) => !t.removed).map((t) => [t.matchKey, t]));
  const removedByKey = new Map(current.filter((t) => t.removed).map((t) => [t.matchKey, t]));
  const parsedKeys = new Set(parsed.tasks.map((t) => t.matchKey));

  let unchanged = 0;
  let ticksKept = 0;
  const restored: BlueprintDiff['restored'] = [];
  let addedCandidates: ParsedTask[] = [];
  for (const t of parsed.tasks) {
    const a = active.get(t.matchKey);
    if (a) {
      unchanged++;
      if (a.doneAt) ticksKept++;
      continue;
    }
    const r = removedByKey.get(t.matchKey);
    if (r) {
      restored.push({ from: r, to: t });
      if (r.doneAt) ticksKept++;
      continue;
    }
    addedCandidates.push(t);
  }
  let removedCandidates = [...active.values()].filter((t) => !parsedKeys.has(t.matchKey));

  // Pair rewording within the same section, best match first.
  const pairs: Array<{ from: CurrentTask; to: ParsedTask; score: number }> = [];
  for (const from of removedCandidates) {
    for (const to of addedCandidates) {
      if (from.sectionKey !== to.sectionKey) continue;
      const score = similarity(from.title, to.title);
      if (score >= REWORD_THRESHOLD) pairs.push({ from, to, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  const reworded: BlueprintDiff['reworded'] = [];
  for (const p of pairs) {
    if (usedFrom.has(p.from.id) || usedTo.has(p.to.matchKey)) continue;
    usedFrom.add(p.from.id);
    usedTo.add(p.to.matchKey);
    reworded.push({ from: p.from, to: p.to });
    if (p.from.doneAt) ticksKept++;
  }
  removedCandidates = removedCandidates.filter((t) => !usedFrom.has(t.id));
  addedCandidates = addedCandidates.filter((t) => !usedTo.has(t.matchKey));

  const newSectionKeys = new Set(parsed.sections.map((s) => s.key));
  const oldSectionKeys = new Set(currentSectionKeys);
  return {
    added: addedCandidates,
    removed: removedCandidates,
    reworded,
    restored,
    unchanged,
    ticksKept,
    ticksLost: removedCandidates.filter((t) => t.doneAt).length,
    sectionsAdded: parsed.sections.filter((s) => !oldSectionKeys.has(s.key)).map((s) => s.title),
    sectionsRemoved: currentSectionKeys.filter((k) => !newSectionKeys.has(k)),
  };
}

/** The payload desk.apply_blueprint() takes. */
export function applyPayload(parsed: ParsedBlueprint, diff: BlueprintDiff, expectedVersion: number | null) {
  return {
    expected_version: expectedVersion,
    doc: { title: parsed.title, doc_date: parsed.docDate, source_markdown: parsed.sourceMarkdown, sha256: parsed.sha256 },
    sections: parsed.sections.map((s) => ({
      key: s.key,
      parent_key: s.parentKey,
      level: s.level,
      number: s.number,
      title: s.title,
      position: s.position,
      run_date: s.runDate,
      body_markdown: s.bodyMarkdown,
    })),
    tasks: parsed.tasks.map((t) => ({
      match_key: t.matchKey,
      section_key: t.sectionKey,
      title: t.title,
      position: t.position,
      due_date: t.dueDate,
      source_ref: t.sourceRef,
    })),
    renames: [...diff.reworded, ...diff.restored].map((r) => ({ id: r.from.id, match_key: r.to.matchKey })),
  };
}
