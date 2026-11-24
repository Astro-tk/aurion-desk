import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { classifyPath, decideAccess, type AccessClaims } from '@/lib/auth/access';
import {
  SESSION_COOKIE,
  checkSessionCookie,
  encodeSessionCookie,
  sessionCookieOptions,
} from '@/lib/auth/session-cookie';
import { buildPageCsp } from '@/lib/security-headers';

/**
 * Runs before every request (Node.js runtime). It:
 *  1. lets ingest and cron routes through untouched (they authenticate themselves);
 *  2. reads and refreshes the Supabase session;
 *  3. applies decideAccess(): signed-out -> /login, aal1 -> /login/2fa only, idle or old -> sign out;
 *  4. sets a per-request nonce Content-Security-Policy on pages.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const kind = classifyPath(pathname);
  if (kind === 'static' || kind === 'ingest' || kind === 'cron') return NextResponse.next();

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const secret = process.env.SESSION_SECRET;
  const ownerEmails = (process.env.OWNER_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!url || !anonKey || !secret || secret.length < 32 || ownerEmails.length === 0) {
    // Fail closed: misconfiguration must never open the app.
    return new NextResponse('Aurion Desk is not configured. See README step 5.', { status: 503 });
  }

  const isDev = process.env.NODE_ENV === 'development';
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildPageCsp(nonce, isDev);

  const forward = () => {
    const h = new Headers(request.headers);
    h.set('x-nonce', nonce);
    h.set('Content-Security-Policy', csp);
    return NextResponse.next({ request: { headers: h } });
  };

  let response = forward();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = forward();
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const raw = data?.claims as (AccessClaims & Record<string, unknown>) | undefined;
  const claims: AccessClaims | null = raw?.sub ? { sub: raw.sub, email: raw.email, aal: raw.aal } : null;

  const now = Date.now();
  const session = claims
    ? checkSessionCookie(secret, request.cookies.get(SESSION_COOKIE)?.value, claims.sub, now)
    : null;

  const decision = decideAccess({ kind, pathname, claims, ownerEmails, session });

  const finish = (res: NextResponse) => {
    // carry refreshed Supabase cookies onto whatever we return
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    if (kind !== 'api') res.headers.set('Content-Security-Policy', csp);
    return res;
  };

  if (decision.type === 'pass') {
    if (decision.touchSession && session?.ok) {
      response.cookies.set(
        SESSION_COOKIE,
        encodeSessionCookie(secret, { ...session.clock, l: now }),
        sessionCookieOptions,
      );
    }
    if (kind !== 'api') response.headers.set('Content-Security-Policy', csp);
    return response;
  }

  if (decision.signOut) {
    await supabase.auth.signOut({ scope: 'local' });
  }

  const res =
    decision.type === 'redirect'
      ? NextResponse.redirect(new URL(decision.to, request.url))
      : NextResponse.json({ error: decision.reason ?? 'unauthorised' }, { status: decision.status });
  const out = finish(res);
  if (decision.signOut) out.cookies.delete(SESSION_COOKIE);
  return out;
}

export const config = {
  // Prefetches are NOT skipped: a request header must never be a way around the guard.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
