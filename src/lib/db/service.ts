import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { DeskClient } from './server';

export type ServiceActor = 'ingest' | 'cron' | 'import' | 'system';

/**
 * Service-role client: BYPASSES Row Level Security.
 * Only for: the ingest endpoints, cron jobs, auth bookkeeping (lockout, audit) and seed scripts.
 * 'server-only' makes the build fail if this file is ever imported into browser code.
 */
export function serviceDb(actor: ServiceActor, source?: 'form' | 'chatbot' | 'system' | 'import'): DeskClient {
  const e = env();
  const headers: Record<string, string> = { 'x-desk-actor': actor };
  if (source) headers['x-desk-source'] = source;
  return createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: 'desk' },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers },
  }) as unknown as DeskClient;
}
