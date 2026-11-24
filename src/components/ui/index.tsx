import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatDate, formatDateTime, formatRand } from '@/lib/format';
import { AppIcon } from './AppIcon';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/** Empty states are one plain sentence and one action. */
export function EmptyState({ sentence, actionLabel, actionHref }: { sentence: string; actionLabel?: string; actionHref?: string }) {
  return (
    <div className="card flex flex-col items-start gap-3 p-4 text-sm text-ink-2 sm:flex-row sm:items-center sm:justify-between">
      <p>{sentence}</p>
      {actionLabel && actionHref ? (
        <Link href={actionHref} className="btn-primary">
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      ) : null}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Money({ cents, whole }: { cents: number | null | undefined; whole?: boolean }) {
  return <span className="num">{formatRand(cents ?? null, { wholeRands: whole })}</span>;
}

export function DateText({ value, withTime }: { value: string | null | undefined; withTime?: boolean }) {
  if (!value) return <span className="text-ink-3">None</span>;
  return <span className="num">{withTime ? formatDateTime(value) : formatDate(value.length > 10 ? new Date(value) : value)}</span>;
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'error' | 'ok' | 'warn'; children: ReactNode }) {
  const cls =
    kind === 'error'
      ? 'border-danger bg-danger-bg text-danger'
      : kind === 'warn'
        ? 'border-warn bg-warn-bg text-warn'
        : kind === 'ok'
          ? 'border-accent text-ink'
          : 'border-line text-ink-2';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${cls}`}>
      {kind === 'error' || kind === 'warn' ? <AppIcon name="alert" size={16} className="mt-0.5 shrink-0" /> : null}
      <div>{children}</div>
    </div>
  );
}

/** Progress as an SVG bar (no inline styles, so the strict CSP holds). */
export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="h-1.5 w-full" role="img" aria-label={label ?? `${Math.round(pct * 100)}%`}>
      <rect x="0" y="0" width="100" height="6" rx="3" className="fill-surface-2" />
      <rect x="0" y="0" width={pct * 100} height="6" rx="3" className="fill-accent" />
    </svg>
  );
}

/** Tiny trend line. values are oldest to newest. Target drawn as a dashed line. */
export function Sparkline({ values, target, label }: { values: Array<number | null>; target?: number | null; label: string }) {
  const nums = values.filter((v): v is number => v !== null);
  const max = Math.max(1, target ?? 0, ...nums);
  const w = 120;
  const h = 32;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const y = (v: number) => h - 2 - (v / max) * (h - 4);
  let d = '';
  values.forEach((v, i) => {
    if (v === null) return;
    d += `${d === '' ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v).toFixed(1)} `;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-28" role="img" aria-label={label}>
      {target ? <line x1="0" x2={w} y1={y(target)} y2={y(target)} className="stroke-ink-3" strokeDasharray="3 3" strokeWidth="1" /> : null}
      {d ? <path d={d} fill="none" className="stroke-accent" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /> : null}
    </svg>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="num text-lg font-semibold">{value}</div>
      {sub ? <div className="text-xs text-ink-3">{sub}</div> : null}
    </div>
  );
}

export { AppIcon };
