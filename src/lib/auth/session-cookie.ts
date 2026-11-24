import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Desk's own session clock, kept in a signed cookie beside Supabase's cookies.
 * It enforces: at most 7 days from sign-in, and at most 12 hours without activity.
 * (Supabase can do this too on its Pro plan; this works on any plan.)
 */
export const SESSION_COOKIE = 'desk_session';
export const ABSOLUTE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;
export const IDLE_LIMIT_MS = 12 * 60 * 60 * 1000;
/** Only rewrite the cookie when it is at least this old, to avoid a write on every request. */
export const TOUCH_AFTER_MS = 60 * 1000;

export interface SessionClock {
  /** auth user id */
  u: string;
  /** signed in at (ms since epoch) */
  s: number;
  /** last seen at (ms since epoch) */
  l: number;
}

export type SessionCheck =
  | { ok: true; clock: SessionClock; needsTouch: boolean }
  | { ok: false; reason: 'missing' | 'invalid' | 'other_user' | 'expired_absolute' | 'expired_idle' };

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function encodeSessionCookie(secret: string, clock: SessionClock): string {
  const payload = Buffer.from(JSON.stringify(clock)).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

export function checkSessionCookie(
  secret: string,
  value: string | undefined,
  userId: string,
  now: number,
): SessionCheck {
  if (!value) return { ok: false, reason: 'missing' };
  const [payload, mac] = value.split('.');
  if (!payload || !mac) return { ok: false, reason: 'invalid' };
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'invalid' };

  let clock: SessionClock;
  try {
    clock = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClock;
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (typeof clock.u !== 'string' || typeof clock.s !== 'number' || typeof clock.l !== 'number') {
    return { ok: false, reason: 'invalid' };
  }
  if (clock.u !== userId) return { ok: false, reason: 'other_user' };
  if (now - clock.s > ABSOLUTE_LIMIT_MS) return { ok: false, reason: 'expired_absolute' };
  if (now - clock.l > IDLE_LIMIT_MS) return { ok: false, reason: 'expired_idle' };
  return { ok: true, clock, needsTouch: now - clock.l > TOUCH_AFTER_MS };
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: ABSOLUTE_LIMIT_MS / 1000,
};
