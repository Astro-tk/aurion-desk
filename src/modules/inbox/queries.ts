import 'server-only';
import type { DeskClient } from '@/lib/db/server';

export interface InboxItem {
  id: string;
  source: 'form' | 'chatbot';
  received_at: string;
  status: 'new' | 'accepted' | 'dismissed';
  contact_id: string | null;
  name: string | null;
  company: string | null;
  email: string | null;
  phone_e164: string | null;
  message: string | null;
  form_id: string | null;
  page_url: string | null;
  need: string | null;
  offer: string | null;
  score: number | null;
  score_reason: string | null;
  transcript_id: string | null;
  consent_ticked: boolean;
  consent_wording: string | null;
  suppressed: boolean;
  lead_id: string | null;
  dismiss_reason: string | null;
  decided_at: string | null;
}

const COLS =
  'id, source, received_at, status, contact_id, name, company, email, phone_e164, message, form_id, page_url, need, offer, score, score_reason, transcript_id, consent_ticked, consent_wording, suppressed, lead_id, dismiss_reason, decided_at';

export async function listInbox(db: DeskClient, status: InboxItem['status'], limit = 200): Promise<InboxItem[]> {
  const { data, error } = await db.from('inbox_items').select(COLS).eq('status', status).order('received_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`Could not load the inbox: ${error.message}`);
  return (data ?? []) as InboxItem[];
}

export async function getInboxItem(db: DeskClient, id: string): Promise<InboxItem | null> {
  const { data } = await db.from('inbox_items').select(COLS).eq('id', id).maybeSingle();
  return (data as InboxItem | null) ?? null;
}

export async function inboxCounts(db: DeskClient): Promise<{ new: number }> {
  const { count } = await db.from('inbox_items').select('id', { count: 'exact', head: true }).eq('status', 'new');
  return { new: count ?? 0 };
}

export function itemTitle(i: Pick<InboxItem, 'name' | 'company' | 'email'>): string {
  return [i.name, i.company].filter(Boolean).join(', ') || i.email || 'Unnamed enquiry';
}
