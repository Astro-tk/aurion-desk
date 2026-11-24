import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

/** Every Desk query is schema "desk". Rows are typed per module with Zod or interfaces. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DeskClient = SupabaseClient<any, 'desk', 'desk', any, any>;

export type EventSourceHeader = 'manual' | 'import' | 'form' | 'chatbot' | 'system';

/**
 * Supabase client acting AS THE SIGNED-IN USER. Row Level Security applies to every query,
 * so even a buggy page cannot read past the policies (aal2 + capability).
 * Use this for everything a person does in the app.
 */
export async function userDb(opts: { source?: EventSourceHeader } = {}): Promise<DeskClient> {
  const store = await cookies();
  const e = env();
  return createServerClient(e.SUPABASE_URL, e.SUPABASE_ANON_KEY, {
    db: { schema: 'desk' },
    global: { headers: opts.source ? { 'x-desk-source': opts.source } : {} },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes them.
        }
      },
    },
  }) as unknown as DeskClient;
}
