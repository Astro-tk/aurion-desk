import Link from 'next/link';
import { AppIcon } from '@/components/ui/AppIcon';
import { can, type Role } from '@/lib/auth/permissions';
import { MODULES } from '@/modules/registry';
import type { ModuleManifest } from '@/modules/types';

function visible(m: ModuleManifest, role: Role): boolean {
  return m.status === 'later' || !m.capability || can(role, m.capability);
}

function NavItem({ m }: { m: ModuleManifest }) {
  if (m.status === 'later') {
    return (
      <li>
        <span aria-disabled="true" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-3" title={m.description}>
          <AppIcon name={m.icon} size={16} />
          <span className="flex-1">{m.label}</span>
          <span className="text-[10px] tracking-wide uppercase">Coming later</span>
        </span>
      </li>
    );
  }
  return (
    <li>
      <Link href={m.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
        <AppIcon name={m.icon} size={16} />
        <span>{m.label}</span>
      </Link>
    </li>
  );
}

export function Sidebar({ role }: { role: Role }) {
  const items = MODULES.filter((m) => visible(m, role));
  const phase1 = items.filter((m) => m.phase === 1);
  const later = items.filter((m) => m.phase !== 1);
  return (
    <nav aria-label="Main" className="space-y-4">
      <ul className="space-y-0.5">{phase1.map((m) => <NavItem key={m.key} m={m} />)}</ul>
      <div>
        <div className="px-2 pb-1 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">Phases 2 and 3</div>
        <ul className="space-y-0.5">{later.map((m) => <NavItem key={m.key} m={m} />)}</ul>
      </div>
    </nav>
  );
}

/** Phone: a fixed bottom bar with the primary modules, and a "More" menu for the rest. */
export function MobileBar({ role }: { role: Role }) {
  const primary = MODULES.filter((m) => m.status === 'live' && m.mobilePrimary && visible(m, role));
  return (
    <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface md:hidden">
      <ul className="grid grid-cols-5">
        {primary.slice(0, 4).map((m) => (
          <li key={m.key}>
            <Link href={m.href} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-ink-2">
              <AppIcon name={m.icon} size={20} />
              {m.label}
            </Link>
          </li>
        ))}
        <li>
          <details className="group relative">
            <summary className="flex cursor-pointer list-none flex-col items-center gap-0.5 py-2 text-[11px] text-ink-2">
              <AppIcon name="menu" size={20} />
              More
            </summary>
            <div className="absolute right-2 bottom-14 w-60 rounded-lg border border-line bg-surface p-2 shadow-lg">
              <Sidebar role={role} />
            </div>
          </details>
        </li>
      </ul>
    </nav>
  );
}
