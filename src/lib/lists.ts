import 'server-only';
import { cache } from 'react';
import type { DeskClient } from '@/lib/db/server';

export interface ListItem {
  key: string;
  label: string;
  active: boolean;
  sort_order: number;
  number?: number | null;
}
export interface Stage {
  key: string;
  label: string;
  position: number;
  is_closed: boolean;
}

export interface Lists {
  stages: Stage[];
  orgTypes: ListItem[];
  sources: ListItem[];
  channels: ListItem[];
  contactMethods: ListItem[];
  activityPurposes: ListItem[];
}

/** The editable lists live in config tables (Settings > Lists). Stages are fixed by the blueprint. */
export const EDITABLE_LISTS = {
  org_types: 'Types',
  lead_sources: 'Sources',
  channels: 'Channels',
  contact_methods: 'Ways of contact',
  activity_purposes: 'Activity purposes',
} as const;
export type EditableList = keyof typeof EDITABLE_LISTS;

async function loadLists(db: DeskClient): Promise<Lists> {
  const sel = 'key, label, active, sort_order';
  const [stages, orgTypes, sources, channels, methods, purposes] = await Promise.all([
    db.from('stages').select('key, label, position, is_closed').order('position'),
    db.from('org_types').select(sel).order('sort_order'),
    db.from('lead_sources').select(sel).order('sort_order'),
    db.from('channels').select(`${sel}, number`).order('sort_order'),
    db.from('contact_methods').select(sel).order('sort_order'),
    db.from('activity_purposes').select(sel).order('sort_order'),
  ]);
  return {
    stages: (stages.data ?? []) as Stage[],
    orgTypes: (orgTypes.data ?? []) as ListItem[],
    sources: (sources.data ?? []) as ListItem[],
    channels: (channels.data ?? []) as ListItem[],
    contactMethods: (methods.data ?? []) as ListItem[],
    activityPurposes: (purposes.data ?? []) as ListItem[],
  };
}

export const getLists = cache(loadLists);

export function labelOf(items: Array<{ key: string; label: string }>, key: string | null | undefined): string {
  if (!key) return '';
  return items.find((i) => i.key === key)?.label ?? key;
}

/** "2. LinkedIn" style label for channels, as the tracker shows them. */
export function channelLabel(channels: ListItem[], key: string | null | undefined): string {
  const c = channels.find((x) => x.key === key);
  if (!c) return key ?? '';
  return c.number ? `${c.number}. ${c.label}` : c.label;
}
