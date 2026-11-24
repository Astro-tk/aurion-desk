import 'server-only';
import { cache } from 'react';
import { serviceDb } from '@/lib/db/service';
import { env } from '@/lib/env';

/**
 * Demo and real data never share a database. desk.instance records what this database is
 * ('production' or 'demo'); DEMO in the environment must agree, or Desk refuses to run.
 */
export const isDemo = cache(async (): Promise<boolean> => {
  const { data, error } = await serviceDb('system').from('instance').select('mode').maybeSingle();
  if (error) throw new Error(`Could not read desk.instance: ${error.message}`);
  if (!data) throw new Error('desk.instance is empty. Run: npm run db:migrate -- --mode production (or demo).');
  const dbDemo = data.mode === 'demo';
  if (dbDemo !== env().DEMO) {
    throw new Error(
      `DEMO=${env().DEMO} but this database is marked "${data.mode}". Refusing to mix demo and real data.`,
    );
  }
  return dbDemo;
});
