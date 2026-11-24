import { z } from 'zod';
import { parseCsv } from '@/lib/csv';
import { parseFlexibleDate } from '@/lib/dates';

/**
 * Pipeline CSV import: the dry run. Pure, so it is tested without a database.
 * Nothing is written until the report shows zero errors and you press Import.
 */

export const TRACKER_COLUMNS = [
  'Firm',
  'Type',
  'Town',
  'Website',
  'Contact',
  'Role',
  'LinkedIn URL',
  'Email',
  'Source',
  'First contact date',
  'Channel',
  'Consent',
  'Stage',
  'Next action',
  'Next date',
  'Notes',
] as const;
export type TrackerColumn = (typeof TRACKER_COLUMNS)[number];

export interface ListOption {
  key: string;
  label: string;
  number?: number | null;
}

export interface ImportLookups {
  orgTypes: ListOption[];
  sources: ListOption[];
  channels: ListOption[];
  stages: ListOption[];
  /** Lower-cased emails already in Desk. */
  existingEmails: Set<string>;
  today: string;
}

export type ConsentStatus = 'asked' | 'yes' | 'no';

export interface NormalisedRow {
  row: number; // 1-based line number in the file, header = 1
  firm: string | null;
  type_key: string | null;
  town: string | null;
  website: string | null;
  domain: string | null;
  contact_name: string | null;
  role_title: string | null;
  linkedin_url: string | null;
  email: string | null;
  source_key: string | null;
  first_contact_date: string | null;
  channel_key: string | null;
  consent_status: ConsentStatus | null;
  consent_raw: string | null;
  consent_method: string | null;
  stage_key: string;
  next_action: string | null;
  next_date: string | null;
  notes: string | null;
}

export interface Problem {
  column: TrackerColumn | 'Row' | 'File';
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface RowResult {
  row: number;
  status: 'ok' | 'skip' | 'error';
  label: string; // firm / contact, for the on-screen report only
  problems: Problem[];
  data: NormalisedRow | null;
}

export interface DryRunReport {
  ok: boolean; // true when nothing blocks the import
  fileProblems: Problem[];
  rows: RowResult[];
  counts: { total: number; ok: number; skip: number; error: number; warnings: number };
}

const emailSchema = z.email();

function clean(v: string | undefined): string | null {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

function matchOption(value: string, options: ListOption[], allowNumberPrefix = false): ListOption | undefined {
  const v = value.trim().toLowerCase();
  const stripped = allowNumberPrefix ? v.replace(/^\d{1,2}\.\s*/, '') : v;
  const num = allowNumberPrefix ? Number(v.match(/^(\d{1,2})\.?$/)?.[1]) : NaN;
  return options.find(
    (o) =>
      o.label.toLowerCase() === v ||
      o.label.toLowerCase() === stripped ||
      o.key === v ||
      o.key === stripped.replace(/\s+/g, '_') ||
      (!Number.isNaN(num) && o.number === num),
  );
}

export function parseConsent(raw: string | null): { status: ConsentStatus | null; ok: boolean } {
  if (!raw) return { status: null, ok: true };
  const v = raw.trim().toLowerCase();
  if (v === 'not asked' || v === '') return { status: null, ok: true };
  if (v === 'asked') return { status: 'asked', ok: true };
  if (v === 'yes') return { status: 'yes', ok: true };
  if (v === 'no' || v.startsWith('no (')) return { status: 'no', ok: true };
  return { status: null, ok: false };
}

/** How a consent ask most likely travelled, from the marketing channel. */
export function consentMethodForChannel(channelKey: string | null): string {
  switch (channelKey) {
    case 'linkedin':
      return 'linkedin';
    case 'firm_email':
    case 'partners':
    case 'beelevel_audience':
      return 'email';
    case 'boq_checker':
      return 'website_form';
    default:
      return 'other';
  }
}

function normaliseWebsite(raw: string): { url: string; domain: string } | null {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes('.')) return null;
    u.protocol = 'https:';
    return { url: u.toString().replace(/\/$/, ''), domain: u.hostname.replace(/^www\./, '').toLowerCase() };
  } catch {
    return null;
  }
}

export function dryRunPipelineCsv(text: string, lookups: ImportLookups): DryRunReport {
  const fileProblems: Problem[] = [];
  const table = parseCsv(text);
  const empty: DryRunReport = { ok: false, fileProblems, rows: [], counts: { total: 0, ok: 0, skip: 0, error: 0, warnings: 0 } };

  if (table.length === 0) {
    fileProblems.push({ column: 'File', level: 'error', code: 'empty', message: 'The file is empty.' });
    return empty;
  }

  const header = table[0]!.map(normHeader);
  const index = new Map<TrackerColumn, number>();
  const missing: string[] = [];
  for (const col of TRACKER_COLUMNS) {
    const i = header.indexOf(col.toLowerCase());
    if (i === -1) missing.push(col);
    else index.set(col, i);
  }
  if (missing.length > 0) {
    const looksLikeLists = header.includes('status') && header.includes('consent') && !header.includes('firm');
    fileProblems.push({
      column: 'File',
      level: 'error',
      code: 'missing_columns',
      message: `Missing columns: ${missing.join(', ')}.${looksLikeLists ? ' This looks like the dropdown lists sheet, not the tracker. Export the tracker tab instead.' : ''}`,
    });
    return empty;
  }
  const known = new Set(TRACKER_COLUMNS.map((c) => c.toLowerCase()));
  const extra = header.filter((h) => h && !known.has(h));
  if (extra.length) {
    fileProblems.push({ column: 'File', level: 'warning', code: 'extra_columns', message: `Ignored columns: ${extra.join(', ')}.` });
  }
  if (table.length === 1) {
    fileProblems.push({ column: 'File', level: 'error', code: 'no_rows', message: 'The file has a header but no rows.' });
    return { ...empty, fileProblems };
  }

  const seenEmails = new Map<string, number>();
  const rows: RowResult[] = [];

  table.slice(1).forEach((cells, i) => {
    const rowNo = i + 2;
    const get = (c: TrackerColumn) => clean(cells[index.get(c)!]);
    if (cells.every((c) => c.trim() === '')) return; // blank line
    const problems: Problem[] = [];
    const err = (column: TrackerColumn | 'Row', code: string, message: string) => problems.push({ column, level: 'error', code, message });
    const warn = (column: TrackerColumn | 'Row', code: string, message: string) => problems.push({ column, level: 'warning', code, message });

    const firm = get('Firm');
    const contactName = get('Contact');
    const emailRaw = get('Email');
    const linkedinRaw = get('LinkedIn URL');
    if (!firm && !contactName && !emailRaw && !linkedinRaw) err('Row', 'no_identity', 'Needs at least a firm, a contact name, an email or a LinkedIn URL.');

    const tooLong = (c: TrackerColumn, v: string | null, max: number) => {
      if (v && v.length > max) err(c, 'too_long', `Longer than ${max} characters.`);
    };
    tooLong('Firm', firm, 200);
    tooLong('Contact', contactName, 200);
    tooLong('Role', get('Role'), 200);
    tooLong('Town', get('Town'), 100);
    tooLong('Next action', get('Next action'), 500);

    let email: string | null = null;
    if (emailRaw) {
      const e = emailRaw.toLowerCase();
      if (!emailSchema.safeParse(e).success) err('Email', 'bad_email', `"${emailRaw}" is not an email address.`);
      else {
        email = e;
        const first = seenEmails.get(e);
        if (first) err('Email', 'duplicate_in_file', `Same email as row ${first}.`);
        else seenEmails.set(e, rowNo);
      }
    }

    let linkedin: string | null = null;
    if (linkedinRaw) {
      const withScheme = /^https?:\/\//i.test(linkedinRaw) ? linkedinRaw.replace(/^http:/i, 'https:') : `https://${linkedinRaw}`;
      if (!/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(withScheme)) err('LinkedIn URL', 'bad_linkedin', 'Not a linkedin.com address.');
      else linkedin = withScheme;
    }

    let website: { url: string; domain: string } | null = null;
    const websiteRaw = get('Website');
    if (websiteRaw) {
      website = normaliseWebsite(websiteRaw);
      if (!website) err('Website', 'bad_website', `"${websiteRaw}" is not a web address.`);
    }

    const pick = (col: TrackerColumn, options: ListOption[], listName: string, numberPrefix = false): string | null => {
      const v = get(col);
      if (!v) return null;
      const hit = matchOption(v, options, numberPrefix);
      if (!hit) err(col, 'unknown_value', `"${v}" is not in the ${listName} list. Add it in Settings, or fix the cell.`);
      return hit?.key ?? null;
    };
    const typeKey = pick('Type', lookups.orgTypes, 'Type');
    const sourceKey = pick('Source', lookups.sources, 'Source');
    const channelKey = pick('Channel', lookups.channels, 'Channel', true);

    const stageRaw = get('Stage');
    let stageKey = 'new';
    if (stageRaw) {
      const s = matchOption(stageRaw, lookups.stages);
      if (!s) err('Stage', 'unknown_stage', `"${stageRaw}" is not a stage. Use one of: ${lookups.stages.map((x) => x.label).join(', ')}.`);
      else stageKey = s.key;
    }

    const consentRaw = get('Consent');
    const consent = parseConsent(consentRaw);
    if (!consent.ok) err('Consent', 'unknown_consent', `"${consentRaw}" is not a consent value. Use Not asked, Asked, Yes or No.`);
    if (consent.status && !contactName && !email && !linkedin) {
      err('Consent', 'consent_without_person', 'Consent needs a person: add a contact name or email.');
    }

    const dateCol = (col: TrackerColumn): string | null => {
      const v = get(col);
      if (!v) return null;
      const d = parseFlexibleDate(v);
      if (!d) err(col, 'bad_date', `"${v}" is not a date. Use 2026-12-01 or 01/12/2026.`);
      return d;
    };
    const firstContact = dateCol('First contact date');
    const nextDate = dateCol('Next date');
    if (firstContact && firstContact > lookups.today) warn('First contact date', 'future_date', 'First contact date is in the future.');
    if (nextDate && nextDate < lookups.today) warn('Next date', 'overdue', 'Next date has passed; this lead will show as overdue.');
    if (consent.status === 'no' && get('Next action')) warn('Next action', 'next_action_on_no', 'This person said no. Desk will block outbound messages to them.');

    const hasError = problems.some((p) => p.level === 'error');
    let status: RowResult['status'] = hasError ? 'error' : 'ok';
    if (!hasError && email && lookups.existingEmails.has(email)) {
      status = 'skip';
      warn('Email', 'already_in_desk', 'Already in Desk. This row will be skipped, not overwritten.');
    }

    rows.push({
      row: rowNo,
      status,
      label: [contactName, firm].filter(Boolean).join(', ') || email || `Row ${rowNo}`,
      problems,
      data: hasError
        ? null
        : {
            row: rowNo,
            firm,
            type_key: typeKey,
            town: get('Town'),
            website: website?.url ?? null,
            domain: website?.domain ?? null,
            contact_name: contactName,
            role_title: get('Role'),
            linkedin_url: linkedin,
            email,
            source_key: sourceKey,
            first_contact_date: firstContact,
            channel_key: channelKey,
            consent_status: consent.status,
            consent_raw: consentRaw,
            consent_method: consentMethodForChannel(channelKey),
            stage_key: stageKey,
            next_action: get('Next action'),
            next_date: nextDate,
            notes: get('Notes'),
          },
    });
  });

  const counts = {
    total: rows.length,
    ok: rows.filter((r) => r.status === 'ok').length,
    skip: rows.filter((r) => r.status === 'skip').length,
    error: rows.filter((r) => r.status === 'error').length,
    warnings: rows.reduce((n, r) => n + r.problems.filter((p) => p.level === 'warning').length, 0),
  };
  const ok = counts.error === 0 && !fileProblems.some((p) => p.level === 'error') && counts.ok > 0;
  return { ok, fileProblems, rows, counts };
}

/** What may be stored in import_batches.report: row numbers and problem codes, never cell values. */
export function reportForStorage(report: DryRunReport) {
  return {
    counts: report.counts,
    file: report.fileProblems.map((p) => ({ level: p.level, code: p.code })),
    rows: report.rows
      .filter((r) => r.problems.length > 0)
      .map((r) => ({ row: r.row, status: r.status, problems: r.problems.map((p) => ({ column: p.column, level: p.level, code: p.code })) })),
  };
}
