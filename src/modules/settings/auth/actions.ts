'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { userDb } from '@/lib/db/server';
import { env } from '@/lib/env';
import { clientIp } from '@/lib/request';
import { auditAuth } from '@/lib/audit';
import { attemptKeys, lockoutSeconds, recordAttempt } from '@/lib/auth/throttle';
import { SESSION_COOKIE, encodeSessionCookie, sessionCookieOptions } from '@/lib/auth/session-cookie';

export interface FormState {
  error?: string;
  info?: string;
}

const GENERIC_FAIL = 'That email and password do not match. Check both and try again.';

const signInSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
  next: z.string().max(300).optional(),
});

function safeNext(next: string | undefined): string {
  // Only same-site paths, never "//host" or a full URL.
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login')) return next;
  return '/';
}

function lockedMessage(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') || undefined,
  });
  if (!parsed.success) return { error: 'Enter your email and password.' };
  const email = parsed.data.email.toLowerCase();
  const ip = clientIp(await headers());
  const { emailHash, ipHash } = attemptKeys(email, ip);

  const locked = await lockoutSeconds(emailHash, ipHash);
  if (locked > 0) {
    await auditAuth('sign_in_locked', null, { email_hash: emailHash.slice(0, 16), ip_hash: ipHash.slice(0, 16) });
    return { error: lockedMessage(locked) };
  }

  // Only owner emails may even try. Same message as a wrong password, so the list is not revealed.
  if (!env().OWNER_EMAILS.includes(email)) {
    await recordAttempt(emailHash, ipHash, false);
    await auditAuth('sign_in_failed', null, { reason: 'not_owner', ip_hash: ipHash.slice(0, 16) });
    return { error: GENERIC_FAIL };
  }

  const db = await userDb();
  const { data, error } = await db.auth.signInWithPassword({ email, password: parsed.data.password });
  if (error || !data.user) {
    await recordAttempt(emailHash, ipHash, false);
    await auditAuth('sign_in_failed', null, { reason: 'bad_password', ip_hash: ipHash.slice(0, 16) });
    return { error: GENERIC_FAIL };
  }

  await recordAttempt(emailHash, ipHash, true);
  await auditAuth('sign_in', data.user.id, { ip_hash: ipHash.slice(0, 16) });

  const now = Date.now();
  (await cookies()).set(
    SESSION_COOKIE,
    encodeSessionCookie(env().SESSION_SECRET, { u: data.user.id, s: now, l: now }),
    sessionCookieOptions,
  );
  const next = safeNext(parsed.data.next);
  redirect(next === '/' ? '/login/2fa' : `/login/2fa?next=${encodeURIComponent(next)}`);
}

/** Starts (or restarts) authenticator-app enrolment. Returns the QR code and the manual key. */
export async function startEnrolmentAction(): Promise<{ factorId?: string; qr?: string; secret?: string; error?: string }> {
  const db = await userDb();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) return { error: 'Your session ended. Sign in again.' };

  const { data: factors } = await db.auth.mfa.listFactors();
  if ((factors?.totp ?? []).some((f) => f.status === 'verified')) {
    return { error: 'Two-factor is already set up. Enter the code from your app.' };
  }
  // Clear half-finished enrolments so they do not pile up.
  for (const f of factors?.all ?? []) {
    if (f.status === 'unverified') await db.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) return { error: 'Could not start two-factor setup. Try again.' };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

const codeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  factorId: z.string().uuid().optional(),
  enrolling: z.enum(['1', '0']).default('0'),
  next: z.string().max(300).optional(),
});

export async function verifyCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = codeSchema.safeParse({
    code: String(formData.get('code') ?? '').replace(/\s/g, ''),
    factorId: formData.get('factorId') || undefined,
    enrolling: formData.get('enrolling') || '0',
    next: formData.get('next') || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Enter the 6-digit code.' };

  const db = await userDb();
  const { data: claimData } = await db.auth.getClaims();
  const claims = claimData?.claims as { sub?: string; email?: string } | undefined;
  if (!claims?.sub || !claims.email) return { error: 'Your session ended. Sign in again.' };

  const ip = clientIp(await headers());
  const { emailHash, ipHash } = attemptKeys(claims.email, ip);
  const locked = await lockoutSeconds(emailHash, ipHash);
  if (locked > 0) return { error: lockedMessage(locked) };

  let factorId = parsed.data.factorId;
  if (!factorId) {
    const { data: factors } = await db.auth.mfa.listFactors();
    factorId = factors?.totp.find((f) => f.status === 'verified')?.id;
  }
  if (!factorId) return { error: 'Set up your authenticator app first.' };

  const { error } = await db.auth.mfa.challengeAndVerify({ factorId, code: parsed.data.code });
  if (error) {
    await recordAttempt(emailHash, ipHash, false);
    await auditAuth('mfa_failed', claims.sub, { ip_hash: ipHash.slice(0, 16) });
    return { error: 'That code did not work. Codes change every 30 seconds; try the current one.' };
  }

  await recordAttempt(emailHash, ipHash, true);
  await auditAuth(parsed.data.enrolling === '1' ? 'mfa_enrolled' : 'mfa_verified', claims.sub, {});
  redirect(safeNext(parsed.data.next));
}

export async function signOutAction(): Promise<void> {
  const db = await userDb();
  const { data } = await db.auth.getClaims();
  await db.auth.signOut({ scope: 'local' });
  (await cookies()).delete(SESSION_COOKIE);
  if (data?.claims?.sub) await auditAuth('sign_out', data.claims.sub as string, {});
  redirect('/login?notice=signed_out');
}
