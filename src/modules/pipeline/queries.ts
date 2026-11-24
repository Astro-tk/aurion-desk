import 'server-only';
import type { DeskClient } from '@/lib/db/server';
import { todaySast } from '@/lib/format';
import type { PipelineFilters } from './filters';

export interface LeadOverview {
  id: string;
  contact_id: string | null;
  organisation_id: string | null;
  source_key: string | null;
  channel_key: string | null;
  stage_key: string;
  first_contact_date: string | null;
  next_action: string | null;
  next_action_is_ai_draft: boolean;
  next_date: string | null;
  summary: string | null;
  summary_is_ai_draft: boolean;
  ai_model: string | null;
  score: number | null;
  founding_office: boolean;
  notes: string | null;
  created_from: 'import' | 'form' | 'chatbot' | 'manual';
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  full_name: string | null;
  email: string | null;
  phone_e164: string | null;
  role_title: string | null;
  linkedin_url: string | null;
  forgotten_at: string | null;
  organisation_name: string | null;
  organisation_type: string | null;
  town: string | null;
  consent_status: 'asked' | 'yes' | 'no' | null;
  do_not_contact: boolean;
  is_overdue: boolean;
  stage_position: number;
  organisation_website: string | null;
}

export const LEAD_LIMIT = 1000;

export async function listLeads(db: DeskClient, f: PipelineFilters): Promise<LeadOverview[]> {
  let q = db.from('lead_overview').select('*');
  q = f.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
  if (f.stage) q = q.eq('stage_key', f.stage);
  if (f.channel) q = q.eq('channel_key', f.channel);
  if (f.source) q = q.eq('source_key', f.source);
  if (f.type) q = q.eq('organisation_type', f.type);
  if (f.overdue) q = q.eq('is_overdue', true);
  if (f.consent === 'none') q = q.is('consent_status', null);
  else if (f.consent) q = q.eq('consent_status', f.consent);
  if (f.q) {
    const term = `%${f.q}%`;
    q = q.or(`full_name.ilike.${term},organisation_name.ilike.${term},email.ilike.${term},town.ilike.${term}`);
  }
  switch (f.sort ?? 'next_date') {
    case 'newest':
      q = q.order('created_at', { ascending: false });
      break;
    case 'stage':
      q = q.order('stage_position').order('next_date', { ascending: true, nullsFirst: false });
      break;
    case 'firm':
      q = q.order('organisation_name', { ascending: true, nullsFirst: false });
      break;
    case 'name':
      q = q.order('full_name', { ascending: true, nullsFirst: false });
      break;
    default:
      q = q.order('next_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
  }
  const { data, error } = await q.limit(LEAD_LIMIT);
  if (error) throw new Error(`Could not load leads: ${error.message}`);
  return (data ?? []) as LeadOverview[];
}

export async function getLead(db: DeskClient, id: string): Promise<LeadOverview | null> {
  const { data } = await db.from('lead_overview').select('*').eq('id', id).maybeSingle();
  return (data as LeadOverview | null) ?? null;
}

export interface ActivityRow {
  id: string;
  occurred_at: string;
  method_key: string;
  direction: 'inbound' | 'outbound';
  purpose_key: string;
  outcome: string | null;
  follow_up_date: string | null;
  notes: string | null;
}
export interface ConsentRow {
  id: number;
  status: 'asked' | 'yes' | 'no';
  method_key: string;
  wording_shown: string;
  evidence_type: string;
  evidence_ref: string | null;
  recorded_at: string;
}
export interface StageHistoryRow {
  id: number;
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
  source: string;
  note: string | null;
}
export interface EventRow {
  id: number;
  occurred_at: string;
  source: string;
  type: string;
  subject_type: string | null;
  payload: Record<string, unknown>;
}

export async function getLeadDetail(db: DeskClient, lead: LeadOverview) {
  const subjects = [`and(subject_type.eq.lead,subject_id.eq.${lead.id})`];
  if (lead.contact_id) subjects.push(`and(subject_type.eq.contact,subject_id.eq.${lead.contact_id})`);
  const inbox = lead.contact_id
    ? await db.from('inbox_items').select('id').eq('contact_id', lead.contact_id)
    : { data: [] as Array<{ id: string }> };
  for (const i of inbox.data ?? []) subjects.push(`and(subject_type.eq.inbox_item,subject_id.eq.${i.id})`);

  const [activities, consent, stages, events, org] = await Promise.all([
    db
      .from('activities')
      .select('id, occurred_at, method_key, direction, purpose_key, outcome, follow_up_date, notes')
      .or(lead.contact_id ? `lead_id.eq.${lead.id},contact_id.eq.${lead.contact_id}` : `lead_id.eq.${lead.id}`)
      .order('occurred_at', { ascending: false }),
    lead.contact_id
      ? db
          .from('consent_records')
          .select('id, status, method_key, wording_shown, evidence_type, evidence_ref, recorded_at')
          .eq('contact_id', lead.contact_id)
          .order('recorded_at', { ascending: false })
          .order('id', { ascending: false })
      : Promise.resolve({ data: [] }),
    db.from('stage_history').select('id, from_stage, to_stage, changed_at, source, note').eq('lead_id', lead.id).order('changed_at', { ascending: false }),
    db.from('events').select('id, occurred_at, source, type, subject_type, payload').or(subjects.join(',')).order('occurred_at', { ascending: false }).limit(100),
    lead.organisation_id
      ? db.from('organisations').select('id, name, type_key, town, website').eq('id', lead.organisation_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    activities: (activities.data ?? []) as ActivityRow[],
    consent: (consent.data ?? []) as ConsentRow[],
    stageHistory: (stages.data ?? []) as StageHistoryRow[],
    events: (events.data ?? []) as EventRow[],
    organisation: org.data as { id: string; name: string; type_key: string | null; town: string | null; website: string | null } | null,
  };
}

export interface FollowUp {
  id: string;
  full_name: string | null;
  organisation_name: string | null;
  next_action: string | null;
  next_date: string;
  do_not_contact: boolean;
  stage_key: string;
}

/**
 * Follow-ups are the lead's next date. Logging an activity with a follow-up date moves the
 * lead's next date, so there is one place to look and one thing to clear.
 */
export async function overdueFollowUps(db: DeskClient, limit = 10): Promise<{ rows: FollowUp[]; total: number }> {
  const { data, count } = await db
    .from('lead_overview')
    .select('id, full_name, organisation_name, next_action, next_date, do_not_contact, stage_key', { count: 'exact' })
    .is('archived_at', null)
    .eq('is_overdue', true)
    .order('next_date')
    .limit(limit);
  return { rows: (data ?? []) as FollowUp[], total: count ?? 0 };
}

export async function followUpsOn(db: DeskClient, date: string, limit = 25): Promise<FollowUp[]> {
  const { data } = await db
    .from('lead_overview')
    .select('id, full_name, organisation_name, next_action, next_date, do_not_contact, stage_key')
    .is('archived_at', null)
    .eq('next_date', date)
    .limit(limit);
  return (data ?? []) as FollowUp[];
}

export function todayIso(): string {
  return todaySast();
}

export async function foundingOfficePlacesLeft(db: DeskClient): Promise<{ left: number; places: number; closes: string }> {
  const [{ data: settings }, { count }] = await Promise.all([
    db.from('app_settings').select('key, value').in('key', ['founding_office_places', 'founding_office_closes']),
    db.from('leads').select('id', { count: 'exact', head: true }).eq('stage_key', 'signed').eq('founding_office', true),
  ]);
  const places = Number(settings?.find((s) => s.key === 'founding_office_places')?.value ?? 3);
  const closes = String(settings?.find((s) => s.key === 'founding_office_closes')?.value ?? '2027-03-31');
  return { left: Math.max(0, places - (count ?? 0)), places, closes };
}

export interface SavedView {
  id: string;
  name: string;
  query: { search: string };
}

export async function listSavedViews(db: DeskClient, memberId: string): Promise<SavedView[]> {
  const { data } = await db.from('saved_views').select('id, name, query').eq('member_id', memberId).eq('module', 'pipeline').order('name');
  return (data ?? []) as SavedView[];
}
