import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { parseCsv, toCsv } from '@/lib/csv';
import { dryRunPipelineCsv, reportForStorage, type ImportLookups } from '@/modules/pipeline/csv-import';
import { asRole, createTestDb, OWNER_ID, ownerClaims, seedMembers, tryAsRole, viewerClaims } from './helpers/db';

const sample = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'tracker-sample.csv'), 'utf8');
const realListsCsv = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'lists-sheet.csv'), 'utf8');

let db: PGlite;
let lookups: ImportLookups;

async function loadLookups(existing: string[] = []): Promise<ImportLookups> {
  const q = async (t: string, extra = '') => (await db.query<{ key: string; label: string; number?: number }>(`select key, label${extra} from desk.${t}`)).rows;
  return {
    orgTypes: await q('org_types'),
    sources: await q('lead_sources'),
    channels: await q('channels', ', number'),
    stages: await q('stages'),
    existingEmails: new Set(existing),
    today: '2026-12-05',
  };
}

beforeAll(async () => {
  db = await createTestDb();
  await seedMembers(db);
  lookups = await loadLookups();
});

describe('CSV reader', () => {
  it('handles quotes, commas and newlines inside fields, and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
    ]);
  });
  it('neutralises spreadsheet formulas on export', () => {
    expect(toCsv(['h'], [['=HYPERLINK("x")']])).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('pipeline CSV dry run', () => {
  it('refuses the lists sheet (the real pipeline.csv) and says why', () => {
    const r = dryRunPipelineCsv(realListsCsv, lookups);
    expect(r.ok).toBe(false);
    expect(r.fileProblems[0]!.code).toBe('missing_columns');
    expect(r.fileProblems[0]!.message).toMatch(/dropdown lists sheet/);
  });

  it('lists every problem row before anything is committed', () => {
    const r = dryRunPipelineCsv(sample, lookups);
    const byRow = Object.fromEntries(r.rows.map((x) => [x.row, x]));
    expect(r.counts.total).toBe(11);
    expect(r.ok).toBe(false); // errors block the whole import
    expect(byRow[6]!.problems.map((p) => p.code)).toContain('duplicate_in_file');
    expect(byRow[7]!.problems.map((p) => p.code)).toContain('unknown_value');
    expect(byRow[8]!.problems.map((p) => p.code)).toContain('bad_date');
    expect(byRow[9]!.problems.map((p) => p.code)).toEqual(expect.arrayContaining(['unknown_consent', 'unknown_stage']));
    expect(byRow[10]!.problems.map((p) => p.code)).toContain('bad_email');
    expect(byRow[11]!.problems.map((p) => p.code)).toContain('no_identity');
    expect(r.counts.error).toBe(6);
    // warnings do not block
    expect(byRow[12]!.status).toBe('ok');
    expect(byRow[12]!.problems.map((p) => p.code)).toContain('overdue');
    expect(byRow[12]!.data!.linkedin_url).toBe('https://linkedin.com/in/naledi-friend');
  });

  it('maps the Consent column to consent records and channel numbers to keys', () => {
    const r = dryRunPipelineCsv(sample, lookups);
    const row = (n: number) => r.rows.find((x) => x.row === n)!.data!;
    expect(row(2)).toMatchObject({ consent_status: 'asked', channel_key: 'linkedin', stage_key: 'permission_given', consent_method: 'linkedin', website: 'https://fictionalqs.example', domain: 'fictionalqs.example' });
    expect(row(3)).toMatchObject({ consent_status: 'yes', first_contact_date: '2026-12-02', consent_method: 'email' });
    expect(row(4)).toMatchObject({ consent_status: 'no', stage_key: 'not_now', first_contact_date: '2026-12-03' });
    expect(row(5)).toMatchObject({ consent_status: null, stage_key: 'new' });
  });

  it('marks people already in Desk as skipped, not errors', () => {
    const r = dryRunPipelineCsv(sample, { ...lookups, existingEmails: new Set(['pieter@sample-ce.example']) });
    expect(r.rows.find((x) => x.row === 3)!.status).toBe('skip');
  });

  it('stores no cell values in the saved report', () => {
    const stored = JSON.stringify(reportForStorage(dryRunPipelineCsv(sample, lookups)));
    expect(stored).not.toMatch(/@|Ayanda|Fictional/);
  });
});

describe('pipeline import commit (database)', () => {
  const clean = () => {
    const lines = sample.trim().split('\n');
    return [lines[0], ...lines.slice(1).filter((_, i) => ![4, 5, 6, 7, 8, 9].includes(i))].join('\n');
  };

  it('imports leads, organisations and consent records in one transaction', async () => {
    const r = dryRunPipelineCsv(clean(), lookups);
    expect(r.ok).toBe(true);
    const [batch] = await asRole<{ id: string }>(
      db,
      ownerClaims('aal2'),
      `insert into desk.import_batches (kind, sha256, status, created_by) values ('pipeline_csv', 'x', 'dry_run', $1) returning id`,
      [OWNER_ID],
    );
    const rows = r.rows.filter((x) => x.status === 'ok').map((x) => x.data);
    const [res] = await asRole<{ r: { leads: number; consents: number } }>(
      db,
      ownerClaims('aal2'),
      `select desk.import_pipeline($1, $2::jsonb) r`,
      [batch!.id, JSON.stringify(rows)],
      { 'x-desk-source': 'import' },
    );
    expect(res!.r).toMatchObject({ leads: 5, consents: 4 });
    const consent = await db.query<{ status: string; evidence_type: string }>(`select status, evidence_type from desk.consent_records`);
    expect(consent.rows.every((c) => c.evidence_type === 'import')).toBe(true);
    // Stage history from an import is tagged so the weekly scorecard ignores it.
    const sh = await db.query<{ n: number }>(`select count(*)::int n from desk.stage_history where source = 'import'`);
    expect(sh.rows[0]!.n).toBe(5);
    const ev = await db.query<{ n: number }>(`select count(*)::int n from desk.events where type = 'pipeline_imported'`);
    expect(ev.rows[0]!.n).toBe(1);
  });

  it('cannot run twice for the same batch, and a viewer cannot import', async () => {
    const [b] = (await db.query<{ id: string }>(`select id from desk.import_batches limit 1`)).rows;
    const again = await tryAsRole(db, ownerClaims('aal2'), `select desk.import_pipeline($1, '[]'::jsonb)`, [b!.id]);
    expect(again.error).toMatch(/dry run again/);
    const viewer = await tryAsRole(db, viewerClaims('aal2'), `select desk.import_pipeline($1, '[]'::jsonb)`, [b!.id]);
    expect(viewer.error).toMatch(/Not allowed/);
  });
});

describe('consent: append-only and the "no" block', () => {
  let contactId: string;

  beforeAll(async () => {
    const [c] = (await db.query<{ id: string }>(`select id from desk.contacts where email = 'lerato@demobuilders.example'`)).rows;
    contactId = c!.id;
  });

  it('records cannot be updated or deleted by anyone', async () => {
    expect((await tryAsRole(db, ownerClaims('aal2'), `update desk.consent_records set status = 'yes'`)).error).toMatch(/permission denied/);
    expect((await tryAsRole(db, ownerClaims('aal2'), `delete from desk.consent_records`)).error).toMatch(/permission denied/);
    await expect(db.query(`update desk.consent_records set status = 'yes'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from desk.consent_records`)).rejects.toThrow(/append-only/);
  });

  it('the latest record is the current consent, and "no" flags the lead', async () => {
    const [row] = await asRole<{ consent_status: string; do_not_contact: boolean }>(
      db,
      ownerClaims('aal2'),
      `select consent_status, do_not_contact from desk.lead_overview where contact_id = $1`,
      [contactId],
    );
    expect(row).toEqual({ consent_status: 'no', do_not_contact: true });
  });

  it('blocks logging an outbound message to a "no", but allows inbound', async () => {
    const out = await tryAsRole(
      db,
      ownerClaims('aal2'),
      `insert into desk.activities (contact_id, method_key, direction, purpose_key) values ($1, 'email', 'outbound', 'follow_up')`,
      [contactId],
    );
    expect(out.error).toMatch(/said no/);
    const inbound = await tryAsRole(
      db,
      ownerClaims('aal2'),
      `insert into desk.activities (contact_id, method_key, direction, purpose_key) values ($1, 'email', 'inbound', 'reply')`,
      [contactId],
    );
    expect(inbound.error).toBeNull();
  });

  it('a later "yes" (they came back and asked) lifts the block, and the old "no" stays on record', async () => {
    await asRole(
      db,
      ownerClaims('aal2'),
      `insert into desk.consent_records (contact_id, status, method_key, wording_shown, evidence_type) values ($1, 'yes', 'email', 'They emailed asking for a demo', 'manual')`,
      [contactId],
    );
    const ok = await tryAsRole(
      db,
      ownerClaims('aal2'),
      `insert into desk.activities (contact_id, method_key, direction, purpose_key) values ($1, 'email', 'outbound', 'reply')`,
      [contactId],
    );
    expect(ok.error).toBeNull();
    const all = await db.query<{ status: string }>(`select status from desk.consent_records where contact_id = $1 order by id`, [contactId]);
    expect(all.rows.map((r) => r.status)).toEqual(['no', 'yes']);
  });
});

describe('quick add', () => {
  it('creates organisation, contact and lead, and returns the existing lead for a known email', async () => {
    const p = { name: 'Quick Person', firm: 'Quick Firm', email: 'quick@example.test', channel_key: 'linkedin' };
    const [first] = await asRole<{ r: { lead_id: string; existing: boolean } }>(db, ownerClaims('aal2'), `select desk.quick_add_lead($1::jsonb) r`, [JSON.stringify(p)]);
    expect(first!.r.existing).toBe(false);
    const [second] = await asRole<{ r: { lead_id: string; existing: boolean } }>(db, ownerClaims('aal2'), `select desk.quick_add_lead($1::jsonb) r`, [JSON.stringify(p)]);
    expect(second!.r).toEqual({ lead_id: first!.r.lead_id, existing: true });
  });

  it('dedupes on phone when there is no email', async () => {
    const p = { name: 'Phone Person', phone: '+27821234567' };
    const [a] = await asRole<{ r: { lead_id: string } }>(db, ownerClaims('aal2'), `select desk.quick_add_lead($1::jsonb) r`, [JSON.stringify(p)]);
    const [b] = await asRole<{ r: { lead_id: string; existing: boolean } }>(db, ownerClaims('aal2'), `select desk.quick_add_lead($1::jsonb) r`, [JSON.stringify({ phone: '+27821234567' })]);
    expect(b!.r).toEqual({ lead_id: a!.r.lead_id, existing: true });
  });

  it('every stage change writes stage_history and an event', async () => {
    const [l] = (await db.query<{ id: string }>(`select id from desk.leads where created_from = 'manual' limit 1`)).rows;
    await asRole(db, ownerClaims('aal2'), `update desk.leads set stage_key = 'audit_booked' where id = $1`, [l!.id]);
    const sh = await db.query<{ from_stage: string; to_stage: string }>(`select from_stage, to_stage from desk.stage_history where lead_id = $1 order by id`, [l!.id]);
    expect(sh.rows.at(-1)).toEqual({ from_stage: 'new', to_stage: 'audit_booked' });
    const ev = await db.query<{ type: string }>(`select type from desk.events where subject_id = $1 order by id`, [l!.id]);
    expect(ev.rows.map((e) => e.type)).toEqual(['lead_created', 'stage_changed']);
  });
});
