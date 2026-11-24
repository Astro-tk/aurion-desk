import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { userDb } from '@/lib/db/server';
import { TwoFactorForm } from '@/modules/settings/auth/TwoFactorForm';
import { signOutAction } from '@/modules/settings/auth/actions';

export const metadata: Metadata = { title: 'Two-factor check' };

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = await userDb();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) redirect('/login');
  const { data: factors } = await db.auth.mfa.listFactors();
  const enrolled = (factors?.totp ?? []).some((f) => f.status === 'verified');

  return (
    <div className="card space-y-4 p-4">
      <h1 className="text-base font-semibold">{enrolled ? 'Enter your code' : 'Set up two-factor'}</h1>
      <TwoFactorForm enrolled={enrolled} next={sp.next} />
      <form action={signOutAction}>
        <button className="text-xs text-ink-3 underline">Use a different account</button>
      </form>
    </div>
  );
}
