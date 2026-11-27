import type { SessionCheck } from './session-cookie';

/**
 * Pure access rules for every request. src/proxy.ts applies them; tests/access.test.ts
 * walks every page and API route in src/app and proves an aal1 session reaches none of them.
 *
 * Public surface: /login, /login/2fa, and the three ingest endpoints (form, chatbot, website events). Nothing else.
 */

export type RouteKind =
  | 'static' // robots.txt, favicon, build assets
  | 'login' // /login
  | 'mfa' // /login/2fa
  | 'ingest' // /api/ingest/form, /api/ingest/chatbot (authenticate themselves)
  | 'cron' // /api/cron/* (CRON_SECRET bearer, checked in the route)
  | 'api' // every other /api route: needs aal2
  | 'app'; // every other page: needs aal2

export const INGEST_PATHS = ['/api/ingest/form', '/api/ingest/chatbot', '/api/ingest/event'] as const;

export function classifyPath(pathname: string): RouteKind {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/robots.txt' || path === '/favicon.ico' || path === '/icon.svg' || path.startsWith('/_next/')) {
    return 'static';
  }
  if (path === '/login') return 'login';
  if (path === '/login/2fa') return 'mfa';
  if ((INGEST_PATHS as readonly string[]).includes(path)) return 'ingest';
  if (path.startsWith('/api/cron/')) return 'cron';
  if (path === '/api' || path.startsWith('/api/')) return 'api';
  return 'app';
}

export interface AccessClaims {
  sub: string;
  email?: string;
  aal?: string;
}

export type AccessDecision =
  | { type: 'pass'; touchSession?: boolean }
  | { type: 'redirect'; to: string; signOut?: boolean; reason?: string }
  | { type: 'deny'; status: 401 | 403; signOut?: boolean; reason?: string };

export interface AccessInput {
  kind: RouteKind;
  pathname: string;
  claims: AccessClaims | null;
  ownerEmails: readonly string[];
  session: SessionCheck | null; // null when there are no claims
}

function loginRedirect(pathname: string, extra?: string): string {
  const params = new URLSearchParams();
  if (pathname !== '/' && !pathname.startsWith('/login')) params.set('next', pathname);
  if (extra) params.set('notice', extra);
  const q = params.toString();
  return q ? `/login?${q}` : '/login';
}

export function decideAccess({ kind, pathname, claims, ownerEmails, session }: AccessInput): AccessDecision {
  if (kind === 'static' || kind === 'ingest' || kind === 'cron') return { type: 'pass' };

  const isApi = kind === 'api';

  // Not signed in.
  if (!claims) {
    if (kind === 'login') return { type: 'pass' };
    if (isApi) return { type: 'deny', status: 401, reason: 'signed_out' };
    return { type: 'redirect', to: loginRedirect(pathname) };
  }

  // Signed in, but not an owner email: end the session.
  const email = (claims.email ?? '').toLowerCase();
  if (!email || !ownerEmails.includes(email)) {
    if (isApi) return { type: 'deny', status: 403, signOut: true, reason: 'not_owner' };
    return { type: 'redirect', to: '/login?notice=not_allowed', signOut: true, reason: 'not_owner' };
  }

  // Desk's own 7-day / 12-hour clock.
  if (!session || !session.ok) {
    const reason = session && !session.ok ? session.reason : 'missing';
    const notice = reason === 'expired_idle' || reason === 'expired_absolute' ? 'expired' : 'signin_again';
    if (kind === 'login') return { type: 'pass' };
    if (isApi) return { type: 'deny', status: 401, signOut: true, reason };
    return { type: 'redirect', to: loginRedirect(pathname, notice), signOut: true, reason };
  }

  const fullyVerified = claims.aal === 'aal2';

  if (!fullyVerified) {
    // aal1: password done, 2FA not yet. Only the 2FA screen.
    if (kind === 'mfa') return { type: 'pass', touchSession: session.needsTouch };
    if (isApi) return { type: 'deny', status: 401, reason: 'mfa_required' };
    return { type: 'redirect', to: '/login/2fa' };
  }

  if (kind === 'login' || kind === 'mfa') return { type: 'redirect', to: '/' };
  return { type: 'pass', touchSession: session.needsTouch };
}
