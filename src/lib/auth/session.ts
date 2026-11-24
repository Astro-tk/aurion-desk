import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { userDb } from '@/lib/db/server';
import { env } from '@/lib/env';
import { can, isRole, type Capability, type Role } from './permissions';

export interface Member {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
}

export interface AuthState {
  userId: string;
  email: string;
  aal: 'aal1' | 'aal2';
  member: Member | null;
}

/** Verified claims plus the member row (the row is only readable at aal2, by RLS). Cached per request. */
export const getAuthState = cache(async (): Promise<AuthState | null> => {
  const db = await userDb();
  const { data } = await db.auth.getClaims();
  const claims = data?.claims as { sub?: string; email?: string; aal?: string } | undefined;
  if (!claims?.sub) return null;
  const email = (claims.email ?? '').toLowerCase();
  if (!env().OWNER_EMAILS.includes(email)) return null;
  const aal = claims.aal === 'aal2' ? 'aal2' : 'aal1';

  let member: Member | null = null;
  if (aal === 'aal2') {
    const { data: row } = await db
      .from('members')
      .select('user_id, email, display_name, role, disabled_at')
      .eq('user_id', claims.sub)
      .maybeSingle();
    if (row && !row.disabled_at && isRole(row.role)) {
      member = { userId: row.user_id, email: row.email, displayName: row.display_name, role: row.role };
    }
  }
  return { userId: claims.sub, email, aal, member };
});

/** For pages and layouts: a fully signed-in member, or a redirect. */
export async function requireMember(): Promise<Member> {
  const state = await getAuthState();
  if (!state) redirect('/login');
  if (state.aal !== 'aal2') redirect('/login/2fa');
  if (!state.member) redirect('/login?notice=not_allowed');
  return state.member;
}

export class ForbiddenError extends Error {
  constructor(public readonly capability: Capability) {
    super('You do not have permission to do that.');
  }
}

/** For server actions and route handlers. Throws ForbiddenError (never redirects). */
export async function requireCapability(capability: Capability): Promise<Member> {
  const state = await getAuthState();
  if (!state || state.aal !== 'aal2' || !state.member) throw new ForbiddenError(capability);
  if (!can(state.member.role, capability)) throw new ForbiddenError(capability);
  return state.member;
}

/** For conditional UI only (hiding a button). Enforcement is requireCapability() and RLS. */
export async function memberCan(capability: Capability): Promise<boolean> {
  const state = await getAuthState();
  return Boolean(state?.member && can(state.member.role, capability));
}
