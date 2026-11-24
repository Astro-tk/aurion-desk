import { resendNotifier } from '@/integrations/resend';
import { requireCronSecret } from '@/lib/cron';
import { serviceDb } from '@/lib/db/service';
import { env } from '@/lib/env';
import { isIsoDate, todaySast } from '@/lib/format';
import type { JobStore } from '@/lib/jobs';
import { serviceNotificationStore } from '@/lib/notification-store';
import { withJobRun } from '@/lib/jobs';
import { nextRenewal, type Platform } from '@/modules/platforms/logic';
import { digestProviders } from '../providers';
import { runDigest } from '../run';

export function serviceJobStore(): JobStore {
  const db = serviceDb('cron', 'system');
  return {
    async start(job, runKey) {
      const { data, error } = await db.from('job_runs').insert({ job, run_key: runKey }).select('id').single();
      if (error) throw new Error(`job_runs: ${error.message}`);
      return (data as { id: string }).id;
    },
    async finish(id, status, details = {}, error) {
      await db.from('job_runs').update({ status, details, error: error ?? null, finished_at: new Date().toISOString() }).eq('id', id);
    },
  };
}

/** GET /api/cron/digest: Vercel Cron at 16:00 UTC (18:00 SAST). ?date=YYYY-MM-DD for a manual re-run. */
export async function digestGet(request: Request): Promise<Response> {
  const denied = requireCronSecret(request, process.env.CRON_SECRET);
  if (denied) return denied;
  const asked = new URL(request.url).searchParams.get('date');
  const date = asked && isIsoDate(asked) ? asked : todaySast();
  try {
    const r = await runDigest({
      date,
      now: new Date(),
      db: serviceDb('cron', 'system'),
      appUrl: env().APP_URL,
      providers: await digestProviders(),
      notifier: resendNotifier,
      notifications: serviceNotificationStore(),
      jobs: serviceJobStore(),
    });
    return Response.json({ ok: true, date, delivery: r.delivery, runId: r.runId });
  } catch (err) {
    return Response.json({ ok: false, date, error: (err as Error).message }, { status: 500 });
  }
}

/**
 * GET /api/cron/housekeeping: daily, 03:30 SAST. Data minimisation and upkeep:
 * old login attempts (30 days), rate-limit counters (2 days), replay nonces (15 minutes),
 * and platform renewal dates rolled forward once they pass.
 */
export async function housekeepingGet(request: Request): Promise<Response> {
  const denied = requireCronSecret(request, process.env.CRON_SECRET);
  if (denied) return denied;
  const db = serviceDb('cron', 'system');
  const today = todaySast();
  try {
    const r = await withJobRun(serviceJobStore(), 'housekeeping', today, async () => {
      const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
      await db.from('auth_attempts').delete().lt('at', ago(30 * 86_400_000));
      await db.from('rate_limit_buckets').delete().lt('window_start', ago(2 * 86_400_000));
      await db.from('ingest_nonces').delete().lt('seen_at', ago(15 * 60_000));
      const { data } = await db.from('platforms').select('*').eq('auto_advance', true).lt('renewal_date', today);
      let rolled = 0;
      for (const p of (data ?? []) as Platform[]) {
        const next = nextRenewal(p, today);
        if (next) {
          await db.from('platforms').update({ renewal_date: next }).eq('id', p.id);
          rolled++;
        }
      }
      return { details: { renewalsRolled: rolled } };
    });
    return Response.json({ ok: true, runId: r.runId, details: r.details });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
