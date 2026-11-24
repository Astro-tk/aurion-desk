import { addDays, sastParts, weekStart, type IsoDate } from '@/lib/format';

/** Pure scorecard maths, tested without a database. */

export interface Target {
  id: string;
  kind: 'channel' | 'weekly';
  metric_key: string;
  label: string;
  channel_key: string | null;
  period_start: IsoDate;
  period_end: IsoDate | null;
  unit: 'count' | 'hours' | 'cents' | 'milestone';
  target_value: number | null;
  target_cents: number | null;
  cap_value: number | null;
  due_date: IsoDate | null;
  count_source: 'leads' | 'stage_history' | 'manual';
  source_filter: { to_stage?: string; source_key?: string };
  sort_order: number;
  active: boolean;
}

export interface Entry {
  target_id: string;
  period_start: IsoDate;
  value: number | null;
  value_cents: number | null;
}

export interface StageChange {
  to_stage: string;
  changed_at: string; // timestamptz
  source: string;
}

export interface LeadFact {
  channel_key: string | null;
  source_key: string | null;
  first_contact_date: IsoDate | null;
}

export interface MetricCell {
  value: number | null; // null = nothing entered yet
  auto: boolean;
  status: 'met' | 'under' | 'over_cap' | 'none';
}

/** The SAST calendar day of a UTC timestamp. */
export function sastDate(ts: string): IsoDate {
  const p = sastParts(new Date(ts));
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function lastWeeks(fromWeek: IsoDate, n: number): IsoDate[] {
  return Array.from({ length: n }, (_, i) => addDays(fromWeek, -7 * (n - 1 - i)));
}

export function targetValue(t: Target): number | null {
  return t.unit === 'cents' ? t.target_cents : t.target_value;
}

function status(t: Target, value: number | null): MetricCell['status'] {
  if (value === null) return 'none';
  if (t.cap_value !== null && value > t.cap_value) return 'over_cap';
  const target = targetValue(t);
  if (target === null) return 'none';
  return value >= target ? 'met' : 'under';
}

export function weeklyTargetsInForce(targets: Target[], week: IsoDate): Target[] {
  return targets
    .filter((t) => t.kind === 'weekly' && t.active && t.period_start <= addDays(week, 6) && (t.period_end === null || t.period_end >= week))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * Value of one weekly metric in one week. Audits booked and proposals sent are counted from
 * stage changes made that week (imports excluded, so loading the tracker does not count as
 * a week's work). Everything else is what you entered on Sunday.
 */
export function weeklyCell(t: Target, week: IsoDate, changes: StageChange[], entries: Entry[]): MetricCell {
  if (t.count_source === 'stage_history' && t.source_filter.to_stage) {
    const end = addDays(week, 6);
    const n = changes.filter((c) => {
      if (c.to_stage !== t.source_filter.to_stage || c.source === 'import') return false;
      const d = sastDate(c.changed_at);
      return d >= week && d <= end;
    }).length;
    return { value: n, auto: true, status: status(t, n) };
  }
  const e = entries.find((x) => x.target_id === t.id && x.period_start === week);
  const v = e ? (t.unit === 'cents' ? e.value_cents : e.value) : null;
  return { value: v === null || v === undefined ? null : Number(v), auto: false, status: status(t, v === null || v === undefined ? null : Number(v)) };
}

/** Channel targets for a period: "logged" from leads where it makes sense, otherwise manual. */
export function channelCell(t: Target, leads: LeadFact[], entries: Entry[]): MetricCell {
  if (t.count_source === 'leads') {
    const end = t.period_end ?? '9999-12-31';
    const n = leads.filter(
      (l) =>
        l.channel_key === t.channel_key &&
        l.first_contact_date !== null &&
        l.first_contact_date >= t.period_start &&
        l.first_contact_date <= end &&
        (!t.source_filter.source_key || l.source_key === t.source_filter.source_key),
    ).length;
    return { value: n, auto: true, status: status(t, n) };
  }
  const e = entries.find((x) => x.target_id === t.id && x.period_start === t.period_start);
  const v = e ? (t.unit === 'cents' ? e.value_cents : e.value) : null;
  return { value: v === null || v === undefined ? null : Number(v), auto: false, status: status(t, v === null || v === undefined ? null : Number(v)) };
}

export function currentWeek(today: IsoDate): IsoDate {
  return weekStart(today);
}
