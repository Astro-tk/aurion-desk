import 'server-only';
import { serviceDb } from '@/lib/db/service';
import { identifierHash } from '@/lib/crypto';
import { env } from '@/lib/env';

/**
 * Login and 2FA throttling, stored in desk.auth_attempts as keyed hashes only.
 * Rule (desk.auth_lockout_seconds): 5 failures for one email in 15 minutes locks it for 15 minutes;
 * 20 failures from one IP in an hour locks that IP for an hour.
 */
export function attemptKeys(email: string, ip: string) {
  const pepper = env().HASH_PEPPER;
  return { emailHash: identifierHash(pepper, 'email', email), ipHash: identifierHash(pepper, 'ip', ip) };
}

export async function lockoutSeconds(emailHash: string, ipHash: string): Promise<number> {
  const { data, error } = await serviceDb('system').rpc('auth_lockout_seconds', {
    p_email_hash: emailHash,
    p_ip_hash: ipHash,
  });
  if (error) {
    // Fail closed: if we cannot check, we do not let the attempt through.
    console.error('auth_lockout_seconds failed', error.message);
    return 60;
  }
  return Number(data ?? 0);
}

export async function recordAttempt(emailHash: string, ipHash: string, succeeded: boolean): Promise<void> {
  const { error } = await serviceDb('system')
    .from('auth_attempts')
    .insert({ email_hash: emailHash, ip_hash: ipHash, succeeded });
  if (error) console.error('auth_attempts insert failed', error.message);
}
