import { z } from 'zod';

/** Pipeline filters live in the URL, so a saved view is just a named query string. */
export const SORTS = {
  next_date: 'Next date',
  newest: 'Newest first',
  stage: 'Stage',
  firm: 'Firm',
  name: 'Name',
} as const;
export type SortKey = keyof typeof SORTS;

const keyish = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,40}$/)
  .optional()
  .catch(undefined);

export const filterSchema = z.object({
  q: z
    .string()
    .max(80)
    .transform((s) => s.replace(/[^\p{L}\p{N}@.\-' ]/gu, ' ').trim())
    .optional()
    .catch(undefined),
  stage: keyish,
  channel: keyish,
  source: keyish,
  type: keyish,
  consent: z.enum(['yes', 'no', 'asked', 'none']).optional().catch(undefined),
  overdue: z.enum(['1']).optional().catch(undefined),
  archived: z.enum(['1']).optional().catch(undefined),
  sort: z.enum(Object.keys(SORTS) as [SortKey, ...SortKey[]]).optional().catch(undefined),
  layout: z.enum(['table', 'board']).optional().catch(undefined),
});
export type PipelineFilters = z.infer<typeof filterSchema>;

export function parseFilters(sp: Record<string, string | string[] | undefined>): PipelineFilters {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return filterSchema.parse(flat);
}

export function filtersToQuery(f: PipelineFilters, overrides: Partial<PipelineFilters> = {}): string {
  const merged = { ...f, ...overrides };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}
