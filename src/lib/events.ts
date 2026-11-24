import 'server-only';
import type { DeskClient } from '@/lib/db/server';

export type EventSource = 'website' | 'chatbot' | 'whatsapp' | 'form' | 'manual' | 'import' | 'system';

export interface NewEvent {
  type: string; // snake_case, e.g. "inbox_dismissed"
  source: EventSource;
  subjectType?: string;
  subjectId?: string;
  actorId?: string | null;
  occurredAt?: string;
  idempotencyKey?: string;
  payload?: Record<string, unknown>;
}

/**
 * Writes one row to desk.events. Lead creation, stage changes, consent and activities are
 * written by database triggers; this is for everything else. Payloads must stay small and
 * should not repeat personal data that already lives on the subject.
 */
export async function recordEvent(db: DeskClient, e: NewEvent): Promise<void> {
  const { error } = await db.from('events').insert({
    type: e.type,
    source: e.source,
    subject_type: e.subjectType ?? null,
    subject_id: e.subjectId ?? null,
    // Omitted = the database fills in the signed-in user (auth.uid()); service-role writes stay null.
    ...(e.actorId !== undefined ? { actor_id: e.actorId } : {}),
    occurred_at: e.occurredAt,
    idempotency_key: e.idempotencyKey ?? null,
    payload: e.payload ?? {},
  });
  // A duplicate idempotency key means this event is already recorded: fine.
  if (error && error.code !== '23505') console.error('recordEvent failed', e.type, error.message);
}
