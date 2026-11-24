import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import type { Heading, List, ListItem, Node, Parent, PhrasingContent, Root, RootContent } from 'mdast';
import { sha256Hex } from '@/lib/crypto';
import { monthIndex } from '@/lib/dates';
import { isIsoDate, weekdayOf, WEEKDAY_ABBREVIATIONS } from '@/lib/format';

/**
 * Turns blueprint.md into sections and tasks.
 *  - "## 10. December run sheet ..." is a section; "### Tue 1 Dec" is a subsection.
 *  - "- [ ] ..." items become tasks; everything else (prose, tables, plain lists) is kept as the
 *    section's body and rendered as-is.
 *  - Under the run sheet, a "### Tue 1 Dec" heading gives its tasks a due date. The year comes
 *    from the byline date ("Nov 14, 2026"); the weekday must match, or the import stops.
 *  - Keys are stable across edits: numbered sections key on their number ("s10"), subsections
 *    on their date ("s10/d2026-12-01") or the words before ":" / "(" ("s3/channel-1").
 */

export interface ParsedSection {
  key: string;
  parentKey: string | null;
  level: 2 | 3;
  number: string | null;
  title: string;
  position: number;
  runDate: string | null;
  bodyMarkdown: string;
}

export interface ParsedTask {
  matchKey: string;
  sectionKey: string;
  title: string;
  position: number;
  dueDate: string | null;
  sourceRef: string;
}

export interface ParsedBlueprint {
  title: string;
  docDate: string | null;
  sha256: string;
  sourceMarkdown: string;
  sections: ParsedSection[];
  tasks: ParsedTask[];
  problems: string[]; // anything here blocks the import
}

const MONTH_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})\b/;
const DAY_HEADING_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+(\d{1,2})\s+([A-Za-z]{3,9})\b/;

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** For matching: case, spacing and punctuation do not matter. */
export function normaliseTaskText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`*_"'“”‘’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function plainText(node: Node): string {
  if ('value' in node && typeof (node as { value: unknown }).value === 'string') return (node as { value: string }).value;
  if ('children' in node) return (node as Parent).children.map(plainText).join('');
  return '';
}

/** Task text, keeping inline code in backticks so search strings stay copyable. */
function taskText(item: ListItem): string {
  const para = item.children.find((c) => c.type === 'paragraph');
  if (!para || para.type !== 'paragraph') return '';
  const render = (n: PhrasingContent): string => {
    if (n.type === 'inlineCode') return `\`${n.value}\``;
    if (n.type === 'text') return n.value;
    if ('children' in n) return (n.children as PhrasingContent[]).map(render).join('');
    return '';
  };
  return para.children.map(render).join('').replace(/\s+/g, ' ').trim();
}

export function cleanSource(md: string): string {
  return md
    .replace(/\r\n/g, '\n')
    .replace(/&#32;/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*(&#91;|\[)embedded content/i.test(line))
    .join('\n');
}

function docDateFrom(md: string): string | null {
  const head = md.split('\n').slice(0, 8).join('\n');
  const m = head.match(MONTH_RE);
  if (!m) return null;
  const mo = monthIndex(m[1]!);
  if (!mo) return null;
  const iso = `${m[3]}-${String(mo).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

function runDateFor(heading: string, docDate: string | null, problems: string[]): string | null {
  const m = heading.match(DAY_HEADING_RE);
  if (!m) return null;
  const month = monthIndex(m[3]!);
  if (!month || !docDate) {
    problems.push(`Cannot work out a date for "${heading}" (no byline date found).`);
    return null;
  }
  const docYear = Number(docDate.slice(0, 4));
  const docMonth = Number(docDate.slice(5, 7));
  const year = month < docMonth ? docYear + 1 : docYear; // a January run sheet in a November doc is next year
  const iso = `${year}-${String(month).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  if (!isIsoDate(iso)) {
    problems.push(`"${heading}" is not a real date.`);
    return null;
  }
  const expected = WEEKDAY_ABBREVIATIONS[weekdayOf(iso)]!;
  if (m[1]!.slice(0, 3) !== expected) {
    problems.push(`"${heading}": ${m[2]} ${m[3]} ${year} is a ${expected}, not a ${m[1]}.`);
  }
  return iso;
}

function headingText(h: Heading): string {
  return plainText(h).replace(/\s+/g, ' ').trim();
}

export function parseBlueprint(rawMarkdown: string): ParsedBlueprint {
  const source = cleanSource(rawMarkdown);
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as Root;
  const problems: string[] = [];
  const docDate = docDateFrom(source);
  const sections: ParsedSection[] = [];
  const tasks: ParsedTask[] = [];
  const occurrences = new Map<string, number>();
  const usedKeys = new Set<string>();

  let title = 'Blueprint';
  let current: ParsedSection | null = null;
  let currentL2: ParsedSection | null = null;
  const bodies = new Map<string, string[]>();

  const slice = (n: RootContent) => source.slice(n.position!.start.offset!, n.position!.end.offset!);
  const uniqueKey = (k: string) => {
    let key = k;
    for (let i = 2; usedKeys.has(key); i++) key = `${k}-${i}`;
    usedKeys.add(key);
    return key;
  };

  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth === 1) {
      title = headingText(node);
      continue;
    }
    if (node.type === 'heading' && (node.depth === 2 || node.depth === 3)) {
      const text = headingText(node);
      if (node.depth === 2) {
        const num = text.match(/^(\d+)\.\s+/)?.[1] ?? null;
        const s: ParsedSection = {
          key: uniqueKey(num ? `s${num}` : slugify(text)),
          parentKey: null,
          level: 2,
          number: num,
          title: num ? text.replace(/^\d+\.\s+/, '') : text,
          position: sections.length,
          runDate: null,
          bodyMarkdown: '',
        };
        sections.push(s);
        current = currentL2 = s;
      } else {
        const parent = currentL2;
        const isRunSheet = parent ? /run sheet/i.test(parent.title) : false;
        const runDate = isRunSheet ? runDateFor(text, docDate, problems) : null;
        const shortName = slugify(text.split(/[:(]/)[0]!);
        const s: ParsedSection = {
          key: uniqueKey(`${parent?.key ?? 'top'}/${runDate ? `d${runDate}` : shortName}`),
          parentKey: parent?.key ?? null,
          level: 3,
          number: null,
          title: text,
          position: sections.length,
          runDate,
          bodyMarkdown: '',
        };
        sections.push(s);
        current = s;
      }
      continue;
    }
    if (!current) continue; // byline and intro before the first section
    if (node.type === 'list' && (node as List).children.some((li) => typeof li.checked === 'boolean')) {
      const list = node as List;
      for (const item of list.children) {
        if (typeof item.checked !== 'boolean') continue;
        const text = taskText(item);
        if (!text) continue;
        const norm = normaliseTaskText(text);
        const base = `${current.key}::${norm}`;
        const n = (occurrences.get(base) ?? 0) + 1;
        occurrences.set(base, n);
        const sectionPath = current.parentKey ? `${sections.find((s) => s.key === current!.parentKey)?.number ?? ''}. ${currentL2?.title ?? ''} > ${current.title}` : `${current.number ? `${current.number}. ` : ''}${current.title}`;
        tasks.push({
          matchKey: `${base}::${n}`,
          sectionKey: current.key,
          title: text.slice(0, 1000),
          position: tasks.length,
          dueDate: current.runDate,
          sourceRef: sectionPath.replace(/^\.\s*/, ''),
        });
      }
      continue;
    }
    const arr = bodies.get(current.key) ?? [];
    arr.push(slice(node));
    bodies.set(current.key, arr);
  }

  for (const s of sections) s.bodyMarkdown = (bodies.get(s.key) ?? []).join('\n\n');
  if (sections.length === 0) problems.push('No "## " sections found. Is this the blueprint file?');

  return { title, docDate, sha256: sha256Hex(rawMarkdown), sourceMarkdown: rawMarkdown, sections, tasks, problems };
}

/** Task counts per top-level section, for reports. */
export function countsBySection(bp: ParsedBlueprint): Array<{ key: string; title: string; tasks: number; dated: number }> {
  return bp.sections
    .filter((s) => s.level === 2)
    .map((s) => {
      const keys = new Set([s.key, ...bp.sections.filter((c) => c.parentKey === s.key).map((c) => c.key)]);
      const mine = bp.tasks.filter((t) => keys.has(t.sectionKey));
      return { key: s.key, title: `${s.number ? `${s.number}. ` : ''}${s.title}`, tasks: mine.length, dated: mine.filter((t) => t.dueDate).length };
    });
}
