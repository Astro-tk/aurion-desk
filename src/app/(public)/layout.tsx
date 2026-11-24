import type { ReactNode } from 'react';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-6">
        <div className="text-lg font-semibold tracking-tight">Aurion Desk</div>
        <div className="text-xs text-ink-3">Private. Authorised people only.</div>
      </div>
      {children}
    </main>
  );
}
