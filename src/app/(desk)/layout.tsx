import Link from 'next/link';
import type { ReactNode } from 'react';
import { MobileBar, Sidebar } from '@/components/shell/Sidebar';
import { requireMember } from '@/lib/auth/session';
import { isDemo } from '@/lib/instance';
import { signOutAction } from '@/modules/settings/auth/actions';
import { toggleThemeAction } from '@/modules/settings/theme';

/**
 * Every signed-in page sits under this layout. requireMember() repeats the proxy's check
 * on the server (aal2 + active member), so a proxy misconfiguration still cannot expose a page.
 */
export default async function DeskLayout({ children }: { children: ReactNode }) {
  const member = await requireMember();
  const demo = await isDemo();
  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-56 shrink-0 border-r border-line bg-surface px-2 py-3 md:block">
        <Link href="/" className="mb-4 block px-2">
          <div className="text-sm font-semibold tracking-tight">Aurion Desk</div>
          <div className="text-[11px] text-ink-3">Engineering-led software studio</div>
        </Link>
        <Sidebar role={member.role} />
      </aside>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs text-ink-3">
          <span className="truncate">
            {demo ? <span className="chip-warn mr-2">Demo data</span> : null}
            Signed in as {member.displayName}
          </span>
          <div className="flex items-center gap-3">
            <form action={toggleThemeAction}>
              <button className="underline">Light or dark</button>
            </form>
            <form action={signOutAction}>
              <button className="underline">Sign out</button>
            </form>
          </div>
        </div>
        <main className="mx-auto max-w-6xl px-4 pt-4 pb-24 md:pb-8">{children}</main>
      </div>
      <MobileBar role={member.role} />
    </div>
  );
}
