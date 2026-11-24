import { NextResponse, type NextRequest } from 'next/server';
import { auditAuth } from '@/lib/audit';
import { ForbiddenError, requireCapability } from '@/lib/auth/session';
import { toCsv } from '@/lib/csv';
import { userDb } from '@/lib/db/server';
import { todaySast } from '@/lib/format';
import { channelLabel, getLists, labelOf } from '@/lib/lists';
import { parseFilters } from '../filters';
import { listLeads } from '../queries';

/** CSV of the current Pipeline view. Same 16 columns as the tracker, plus Desk's own fields. */
export async function GET(request: NextRequest) {
  let memberId: string;
  try {
    memberId = (await requireCapability('data.export')).userId;
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    throw e;
  }
  const f = parseFilters(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const db = await userDb();
  const [lists, leads] = await Promise.all([getLists(db), listLeads(db, f)]);
  const consentLabel = { yes: 'Yes', no: 'No (never contact)', asked: 'Asked' } as const;
  const csv = toCsv(
    ['Firm', 'Type', 'Town', 'Website', 'Contact', 'Role', 'LinkedIn URL', 'Email', 'Source', 'First contact date', 'Channel', 'Consent', 'Stage', 'Next action', 'Next date', 'Notes', 'Phone', 'Score', 'Desk ID'],
    leads.map((l) => [
      l.organisation_name,
      labelOf(lists.orgTypes, l.organisation_type),
      l.town,
      l.organisation_website,
      l.full_name,
      l.role_title,
      l.linkedin_url,
      l.email,
      labelOf(lists.sources, l.source_key),
      l.first_contact_date,
      channelLabel(lists.channels, l.channel_key),
      l.consent_status ? consentLabel[l.consent_status] : 'Not asked',
      labelOf(lists.stages, l.stage_key),
      l.next_action,
      l.next_date,
      l.notes,
      l.phone_e164,
      l.score,
      l.id,
    ]),
  );
  await auditAuth('export', memberId, { what: 'pipeline_view', rows: leads.length });
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="aurion-pipeline-${todaySast()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
