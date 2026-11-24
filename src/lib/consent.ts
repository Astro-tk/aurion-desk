import 'server-only';
import type { DeskClient } from '@/lib/db/server';
import { serviceDb } from '@/lib/db/service';
import { identifierHash } from '@/lib/crypto';
import { env } from '@/lib/env';

export type ConsentStatus = 'asked' | 'yes' | 'no';

export class ConsentBlockedError extends Error {
  constructor() {
    super('This contact said no. Desk will not draft or log an outbound message to them.');
  }
}

/** The contact's current consent: their latest record, or null if never asked. */
export async function currentConsent(db: DeskClient, contactId: string): Promise<ConsentStatus | null> {
  const { data } = await db
    .from('consent_records')
    .select('status')
    .eq('contact_id', contactId)
    .order('recorded_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.status as ConsentStatus | undefined) ?? null;
}

/**
 * Call before drafting OR logging any outbound message (Phase 2 reply drafts must call this too).
 * The database enforces the same rule on desk.activities, so this is the friendly early check.
 */
export async function assertMayContact(db: DeskClient, contactId: string | null): Promise<void> {
  if (!contactId) return;
  if ((await currentConsent(db, contactId)) === 'no') throw new ConsentBlockedError();
}

/** After a "no": remember keyed hashes of the email and phone, so a returning form is flagged. */
export async function suppressIdentifiers(email: string | null, phone: string | null, reason: 'consent_no' | 'forgotten'): Promise<void> {
  const pepper = env().HASH_PEPPER;
  const rows = [
    email ? { identifier_hash: identifierHash(pepper, 'email', email), kind: 'email', reason } : null,
    phone ? { identifier_hash: identifierHash(pepper, 'phone', phone), kind: 'phone', reason } : null,
  ].filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return;
  const { error } = await serviceDb('system').from('suppressions').upsert(rows, { onConflict: 'identifier_hash', ignoreDuplicates: true });
  if (error) console.error('suppression insert failed', error.message);
}

export async function isSuppressed(email: string | null, phone: string | null): Promise<boolean> {
  const pepper = env().HASH_PEPPER;
  const hashes = [email ? identifierHash(pepper, 'email', email) : null, phone ? identifierHash(pepper, 'phone', phone) : null].filter(
    (h): h is string => Boolean(h),
  );
  if (hashes.length === 0) return false;
  const { data } = await serviceDb('system').from('suppressions').select('identifier_hash').in('identifier_hash', hashes).limit(1);
  return (data ?? []).length > 0;
}
