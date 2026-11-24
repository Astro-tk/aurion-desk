import { formatCount, formatRand } from '@/lib/format';
import { targetValue, type MetricCell, type Target } from './compute';

export function formatMetric(t: Target, v: number | null): string {
  if (v === null) return 'None';
  if (t.unit === 'cents') return formatRand(v, { wholeRands: true });
  if (t.unit === 'milestone') return v >= 1 ? 'Done' : 'Not yet';
  if (t.unit === 'hours') return `${formatCount(v)} h`;
  return formatCount(v);
}

export function formatTarget(t: Target): string {
  const v = targetValue(t);
  if (v === null) return t.unit === 'cents' ? 'Record it' : 'All';
  const base = formatMetric(t, v);
  return t.cap_value !== null ? `${base}, cap ${formatMetric(t, t.cap_value)}` : base;
}

export function StatusChip({ cell }: { cell: MetricCell }) {
  if (cell.status === 'met') return <span className="chip-accent">On target</span>;
  if (cell.status === 'over_cap') return <span className="chip-danger">Over the cap</span>;
  if (cell.status === 'under') return <span className="chip-warn">Under</span>;
  return <span className="chip">Not entered</span>;
}
