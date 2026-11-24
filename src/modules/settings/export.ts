import { strToU8, zipSync } from 'fflate';
import { NextResponse } from 'next/server';
import { auditAuth } from '@/lib/audit';
import { ForbiddenError, requireCapability } from '@/lib/auth/session';
import { toCsv } from '@/lib/csv';
import { userDb } from '@/lib/db/server';
import { recordEvent } from '@/lib/events';
import { todaySast } from '@/lib/format';

/**
 * Every desk table you can read, one CSV each, in one ZIP. Runs as you (RLS applies).
 * Contains personal data: store it in your password manager's secure files or offline, never email it.
 */
export const EXPORT_TABLES = [
  'organisations', 'contacts', 'leads', 'stage_history', 'consent_records', 'activities', 'inbox_items',
  'tasks', 'blueprint_sections', 'blueprint_documents', 'targets', 'scorecard_entries', 'platforms',
  'events', 'audit_log', 'job_runs', 'notifications', 'import_batches', 'saved_views', 'members',
  'org_types', 'lead_sources', 'channels', 'contact_methods', 'activity_purposes', 'stages', 'app_settings',
] as const;

const PAGE = 1000;

function cell(v: unknown): unknown {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

export async function GET() {
  let memberId: string;
  try {
    memberId = (await requireCapability('data.export')).userId;
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    throw e;
  }
  const db = await userDb();
  const files: Record<string, Uint8Array> = {};
  const counts: Record<string, number> = {};
  for (const table of EXPORT_TABLES) {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(table).select('*').range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: `Export stopped at ${table}: ${error.message}` }, { status: 500 });
      rows.push(...((data ?? []) as Record<string, unknown>[]));
      if (!data || data.length < PAGE) break;
    }
    const header = rows.length ? Object.keys(rows[0]!) : ['(empty)'];
    files[`${table}.csv`] = strToU8(toCsv(header, rows.map((r) => header.map((h) => cell(r[h])))));
    counts[table] = rows.length;
  }
  files['README.txt'] = strToU8(
    `Aurion Desk export, ${todaySast()}.\r\nOne CSV per table. Money columns are in cents. Times are UTC.\r\nThis file contains personal information protected by POPIA. Keep it encrypted and do not email it.\r\n`,
  );
  const zip = zipSync(files, { level: 6 });
  await auditAuth('export', memberId, { what: 'all_tables', counts });
  await recordEvent(db, { type: 'export_created', source: 'manual', payload: { tables: EXPORT_TABLES.length } });
  return new NextResponse(Buffer.from(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="aurion-desk-export-${todaySast()}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
