import { addDays, formatDateTime, sastDayStartUtc } from '@/lib/format';
import type { DigestProvider } from '../types';

/** Yesterday's failed job runs and failed sends (SAST day). */
const provider: DigestProvider = async ({ date, db, appUrl }) => {
  const from = sastDayStartUtc(addDays(date, -1));
  const to = sastDayStartUtc(date);
  const [jobs, sends] = await Promise.all([
    db.from('job_runs').select('job, run_key, started_at, error').eq('status', 'failed').gte('started_at', from).lt('started_at', to).order('started_at'),
    db.from('notifications').select('dedupe_key, claimed_at, error').eq('status', 'failed').gte('claimed_at', from).lt('claimed_at', to),
  ]);
  const lines = [
    ...((jobs.data ?? []) as Array<{ job: string; run_key: string; started_at: string; error: string | null }>).map((j) => ({
      text: `${j.job} (${j.run_key}) failed at ${formatDateTime(j.started_at)}: ${(j.error ?? 'no detail').slice(0, 140)}`,
      href: `${appUrl}/digest`,
    })),
    ...((sends.data ?? []) as Array<{ dedupe_key: string; error: string | null }>).map((n) => ({
      text: `Send failed: ${n.dedupe_key}: ${(n.error ?? '').slice(0, 120)}`,
      href: `${appUrl}/digest`,
    })),
  ];
  return [{ key: 'job_failures', title: "Yesterday's job failures", lines }];
};

export default provider;
