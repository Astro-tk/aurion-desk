import type { Metadata } from 'next';
import { LoginForm } from '@/modules/settings/auth/LoginForm';
import { Notice } from '@/components/ui';

export const metadata: Metadata = { title: 'Sign in' };

const NOTICES: Record<string, { kind: 'info' | 'warn'; text: string }> = {
  expired: { kind: 'info', text: 'You were signed out after a period without activity. Sign in again.' },
  signin_again: { kind: 'info', text: 'Please sign in again.' },
  signed_out: { kind: 'info', text: 'You are signed out.' },
  not_allowed: { kind: 'warn', text: 'That account does not have access to Desk.' },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const notice = sp.notice ? NOTICES[sp.notice] : undefined;
  return (
    <div className="card space-y-4 p-4">
      <h1 className="text-base font-semibold">Sign in</h1>
      {notice ? <Notice kind={notice.kind}>{notice.text}</Notice> : null}
      <LoginForm next={sp.next} />
    </div>
  );
}
