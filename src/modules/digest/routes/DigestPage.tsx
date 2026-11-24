import { Card, PageHeader } from '@/components/ui';
import { requireMember } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { formatDateTime, todaySast } from '@/lib/format';
import { composeDigest } from '../compose';
import { digestProviders } from '../providers';
import { env } from '@/lib/env';
import type { DigestSection } from '../../types';

/** Preview of tonight's digest (built from live data) and the job log. */
export default async function DigestPage() {
  await requireMember();
  const db = await userDb();
  const date = todaySast();
  const sections: DigestSection[] = [];
  for (const { module, provider } of await digestProviders()) {
    try {
      sections.push(...(await provider({ date, now: new Date(), db, appUrl: env().APP_URL })));
    } catch {
      sections.push({ key: `error_${module}`, title: `Could not load ${module}`, lines: [] });
    }
  }
  const message = composeDigest(date, sections, env().APP_URL);
  const [{ data: runs }, { data: sends }] = await Promise.all([
    db.from('job_runs').select('id, job, run_key, started_at, finished_at, status, error').order('started_at', { ascending: false }).limit(30),
    db.from('notifications').select('id, dedupe_key, channel, status, claimed_at, sent_at, error').order('claimed_at', { ascending: false }).limit(30),
  ]);

  return (
    <>
      <PageHeader title="Digest" subtitle="Sent every day at 18:00. This is what tonight's email would say right now." />
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={message.subject}>
          <pre className="text-xs whitespace-pre-wrap text-ink-2">{message.text}</pre>
        </Card>
        <div className="space-y-3">
          <Card title="Recent job runs">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Started</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {((runs ?? []) as Array<{ id: string; job: string; run_key: string; started_at: string; status: string; error: string | null }>).map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.job} <span className="text-xs text-ink-3">{r.run_key}</span>
                    </td>
                    <td className="num">{formatDateTime(r.started_at)}</td>
                    <td>
                      <span className={r.status === 'failed' ? 'chip-danger' : r.status === 'succeeded' ? 'chip-accent' : 'chip'}>{r.status}</span>
                      {r.error ? <div className="text-xs text-danger">{r.error}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Recent sends">
            <ul className="space-y-1 text-sm">
              {((sends ?? []) as Array<{ id: string; dedupe_key: string; status: string; claimed_at: string; error: string | null }>).map((n) => (
                <li key={n.id} className="flex flex-wrap gap-2">
                  <span className="num text-xs text-ink-3">{formatDateTime(n.claimed_at)}</span>
                  <span>{n.dedupe_key}</span>
                  <span className={n.status === 'failed' ? 'chip-danger' : 'chip'}>{n.status}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
