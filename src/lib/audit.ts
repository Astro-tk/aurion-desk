import 'server-only';
import { serviceDb } from '@/lib/db/service';

export type AuthAuditAction =
  | 'sign_in'
  | 'sign_in_failed'
  | 'sign_in_locked'
  | 'sign_out'
  | 'mfa_enrolled'
  | 'mfa_verified'
  | 'mfa_failed'
  | 'mfa_removed'
  | 'password_changed'
  | 'session_expired'
  | 'export';

/**
 * Writes a sign-in style event to the append-only audit log. Table changes are audited by
 * database triggers; this covers the things that are not table changes.
 * Context must never contain personal data: use hashes.
 */
export async function auditAuth(action: AuthAuditAction, actorId: string | null, context: Record<string, unknown> = {}): Promise<void> {
  const { error } = await serviceDb('system').rpc('audit_auth_event', {
    p_action: action,
    p_actor_id: actorId,
    p_context: context,
  });
  if (error) console.error('audit_auth_event failed', error.message);
}
