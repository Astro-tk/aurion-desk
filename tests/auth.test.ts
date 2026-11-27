import { describe, expect, it } from 'vitest';
import { classifyPath, decideAccess, type AccessClaims } from '@/lib/auth/access';
import {
  ABSOLUTE_LIMIT_MS,
  IDLE_LIMIT_MS,
  checkSessionCookie,
  encodeSessionCookie,
  type SessionCheck,
} from '@/lib/auth/session-cookie';
import { buildPageCsp, COMMON_SECURITY_HEADERS } from '@/lib/security-headers';
import { passwordSchema } from '@/lib/auth/password';
import nextConfig from '../next.config';
import { allAppRoutes } from './helpers/routes';

const SECRET = 'x'.repeat(40);
const OWNER = 'owner@example.test';
const USER = '11111111-1111-4111-8111-111111111111';
const now = Date.UTC(2026, 11, 1, 10, 0, 0);
const goodSession: SessionCheck = checkSessionCookie(SECRET, encodeSessionCookie(SECRET, { u: USER, s: now - 1000, l: now - 1000 }), USER, now);
const aal1: AccessClaims = { sub: USER, email: OWNER, aal: 'aal1' };
const aal2: AccessClaims = { sub: USER, email: OWNER, aal: 'aal2' };

function decide(path: string, claims: AccessClaims | null, session: SessionCheck | null = goodSession) {
  return decideAccess({ kind: classifyPath(path), pathname: path, claims, ownerEmails: [OWNER], session: claims ? session : null });
}

const routes = allAppRoutes();
const PUBLIC = new Set(['/login', '/login/2fa', '/api/ingest/form', '/api/ingest/chatbot', '/api/ingest/event', '/robots.txt']);

describe('public surface', () => {
  it('is only login, 2FA, the three ingest endpoints (and robots.txt); cron routes need CRON_SECRET', () => {
    for (const r of routes) {
      const kind = classifyPath(r.path);
      const reachableSignedOut = decide(r.path, null).type === 'pass';
      if (reachableSignedOut) {
        expect(PUBLIC.has(r.path) || kind === 'cron', `${r.path} (${r.file}) is reachable signed out`).toBe(true);
      }
    }
  });

  it('cron routes are not session pages: each one checks CRON_SECRET itself', async () => {
    const { readFileSync } = await import('node:fs');
    for (const r of routes.filter((x) => classifyPath(x.path) === 'cron')) {
      expect(readFileSync(r.file, 'utf8'), r.file).toMatch(/requireCronSecret/);
    }
  });
});

describe('2FA enforcement: an aal1 session is blocked from every page and API', () => {
  it('finds routes to check', () => {
    expect(routes.length).toBeGreaterThan(3);
  });

  for (const r of allAppRoutes()) {
    const kind = classifyPath(r.path);
    if (kind === 'login' || kind === 'mfa' || kind === 'ingest' || kind === 'cron' || kind === 'static') continue;
    it(`aal1 cannot reach ${r.path}`, () => {
      const d = decide(r.path, aal1);
      if (r.type === 'api') expect(d).toMatchObject({ type: 'deny', status: 401 });
      else expect(d).toEqual({ type: 'redirect', to: '/login/2fa' });
    });
    it(`signed-out cannot reach ${r.path}`, () => {
      const d = decide(r.path, null);
      expect(d.type).not.toBe('pass');
    });
    it(`aal2 owner reaches ${r.path}`, () => {
      expect(decide(r.path, aal2).type).toBe('pass');
    });
  }

  it('aal1 may open the 2FA page, and nothing else, even unlisted paths', () => {
    expect(decide('/login/2fa', aal1).type).toBe('pass');
    expect(decide('/some/future/page', aal1)).toEqual({ type: 'redirect', to: '/login/2fa' });
    expect(decide('/api/future', aal1)).toMatchObject({ type: 'deny', status: 401 });
  });

  it('a signed-in user who is not an owner email is signed out', () => {
    const d = decide('/pipeline', { sub: USER, email: 'stranger@example.test', aal: 'aal2' });
    expect(d).toMatchObject({ type: 'redirect', signOut: true });
  });

  it('an aal2 user is sent away from the login pages', () => {
    expect(decide('/login', aal2)).toEqual({ type: 'redirect', to: '/' });
    expect(decide('/login/2fa', aal2)).toEqual({ type: 'redirect', to: '/' });
  });

  it('a missing Desk session cookie ends the session', () => {
    expect(decide('/pipeline', aal2, { ok: false, reason: 'missing' })).toMatchObject({ type: 'redirect', signOut: true });
  });
});

describe('session expiry (7 days absolute, 12 hours idle)', () => {
  const cookie = (s: number, l: number) => encodeSessionCookie(SECRET, { u: USER, s, l });

  it('accepts a fresh session', () => {
    expect(checkSessionCookie(SECRET, cookie(now - 60_000, now - 60_000), USER, now).ok).toBe(true);
  });
  it('expires after 12 hours idle', () => {
    expect(checkSessionCookie(SECRET, cookie(now - IDLE_LIMIT_MS - 2000, now - IDLE_LIMIT_MS - 1000), USER, now)).toEqual({ ok: false, reason: 'expired_idle' });
  });
  it('expires 7 days after sign-in even if active', () => {
    expect(checkSessionCookie(SECRET, cookie(now - ABSOLUTE_LIMIT_MS - 1000, now - 1000), USER, now)).toEqual({ ok: false, reason: 'expired_absolute' });
  });
  it('rejects a tampered cookie', () => {
    const c = cookie(now, now);
    const [payload, mac] = c.split('.');
    const forged = Buffer.from(JSON.stringify({ u: USER, s: now + 9e9, l: now + 9e9 })).toString('base64url');
    expect(checkSessionCookie(SECRET, `${forged}.${mac}`, USER, now)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkSessionCookie(SECRET, `${payload}.AAAA`, USER, now)).toEqual({ ok: false, reason: 'invalid' });
  });
  it("rejects another user's cookie", () => {
    expect(checkSessionCookie(SECRET, cookie(now, now), 'someone-else', now)).toEqual({ ok: false, reason: 'other_user' });
  });
  it('expired sessions redirect to login and sign out', () => {
    const d = decide('/', aal2, { ok: false, reason: 'expired_idle' });
    expect(d).toMatchObject({ type: 'redirect', signOut: true });
    if (d.type === 'redirect') expect(d.to).toContain('notice=expired');
  });
});

describe('security headers', () => {
  it('page CSP is strict in production', () => {
    const csp = buildPageCsp('abc', false);
    expect(csp).toContain(`frame-ancestors 'none'`);
    expect(csp).toContain(`object-src 'none'`);
    expect(csp).toContain(`script-src 'self' 'nonce-abc' 'strict-dynamic'`);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('every response gets X-Frame-Options, Referrer-Policy, HSTS and X-Robots-Tag', async () => {
    const keys = COMMON_SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(['X-Frame-Options', 'Referrer-Policy', 'Strict-Transport-Security', 'X-Robots-Tag']));
    expect(COMMON_SECURITY_HEADERS.find((h) => h.key === 'X-Robots-Tag')?.value).toBe('noindex, nofollow');
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === '/:path*');
    expect(all?.headers.map((h) => h.key)).toEqual(expect.arrayContaining(keys));
    const api = rules.find((r) => r.source === '/api/:path*');
    expect(api?.headers.find((h) => h.key === 'Content-Security-Policy')?.value).toContain(`default-src 'none'`);
  });
});

describe('password rules', () => {
  it('needs at least 14 characters', () => {
    expect(passwordSchema().safeParse('short-pass-1').success).toBe(false);
    expect(passwordSchema().safeParse('correct horse battery staple').success).toBe(true);
  });
  it('refuses a password built from the email name', () => {
    expect(passwordSchema('thato@aurioncreative.com').safeParse('thato-is-the-best-1').success).toBe(false);
  });
});
