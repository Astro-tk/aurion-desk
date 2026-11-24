import 'server-only';
import type { DeskClient } from '@/lib/db/server';
import { addDays, sastDayStartUtc, type IsoDate } from '@/lib/format';
import type { Entry, LeadFact, StageChange, Target } from './compute';

export async function loadTargets(db: DeskClient): Promise<Target[]> {
  const { data } = await db.from('targets').select('*').eq('active', true).order('sort_order');
  return ((data ?? []) as Target[]).map((t) => ({
    ...t,
    target_value: t.target_value === null ? null : Number(t.target_value),
    cap_value: t.cap_value === null ? null : Number(t.cap_value),
    target_cents: t.target_cents === null ? null : Number(t.target_cents),
  }));
}

export async function loadEntries(db: DeskClient, from: IsoDate, to: IsoDate): Promise<Entry[]> {
  const { data } = await db.from('scorecard_entries').select('target_id, period_start, value, value_cents').gte('period_start', from).lte('period_start', to);
  return ((data ?? []) as Entry[]).map((e) => ({
    ...e,
    value: e.value === null ? null : Number(e.value),
    value_cents: e.value_cents === null ? null : Number(e.value_cents),
  }));
}

export async function loadStageChanges(db: DeskClient, fromWeek: IsoDate, toWeek: IsoDate, stages: string[]): Promise<StageChange[]> {
  const { data } = await db
    .from('stage_history')
    .select('to_stage, changed_at, source')
    .in('to_stage', stages)
    .gte('changed_at', sastDayStartUtc(fromWeek))
    .lt('changed_at', sastDayStartUtc(addDays(toWeek, 7)));
  return (data ?? []) as StageChange[];
}

export async function loadLeadFacts(db: DeskClient, from: IsoDate, to: IsoDate): Promise<LeadFact[]> {
  const out: LeadFact[] = [];
  for (let start = 0; ; start += 1000) {
    const { data } = await db
      .from('leads')
      .select('channel_key, source_key, first_contact_date')
      .gte('first_contact_date', from)
      .lte('first_contact_date', to)
      .range(start, start + 999);
    out.push(...((data ?? []) as LeadFact[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
