import type { Notifier } from '@/integrations/types';
import type { DeskClient } from '@/lib/db/server';
import { withJobRun, type JobStore } from '@/lib/jobs';
import { deliverOnce, type NotificationStore } from '@/lib/notify';
import type { DigestProvider, DigestSection } from '../types';
import { composeDigest } from './compose';

export interface DigestDeps {
  date: string; // SAST date the digest is for
  now: Date;
  db: DeskClient;
  appUrl: string;
  providers: Array<{ module: string; provider: DigestProvider }>;
  notifier: Notifier;
  notifications: NotificationStore;
  jobs: JobStore;
}

/**
 * The 18:00 digest. Safe to run twice: the email is sent only after claiming
 * "digest:<date>:email" in desk.notifications, which only the first run can do.
 * A section that fails to load is replaced by a one-line note instead of stopping the email.
 */
export async function runDigest(deps: DigestDeps) {
  return withJobRun(deps.jobs, 'digest', deps.date, async (runId) => {
    const sections: DigestSection[] = [];
    const sectionErrors: string[] = [];
    for (const { module, provider } of deps.providers) {
      try {
        sections.push(...(await provider({ date: deps.date, now: deps.now, db: deps.db, appUrl: deps.appUrl })));
      } catch (err) {
        sectionErrors.push(`${module}: ${(err as Error).message}`);
        sections.push({ key: `error_${module}`, title: `Could not load ${module}`, lines: [{ text: 'Open Desk to check this section.' }] });
      }
    }
    const message = composeDigest(deps.date, sections, deps.appUrl);
    const result = await deliverOnce(deps.notifier, `digest:${deps.date}:${deps.notifier.key}`, message, deps.notifications, runId);
    const status = result === 'sent' ? 'succeeded' : result === 'failed' ? 'failed' : 'skipped';
    if (result === 'failed') throw new Error('The digest email could not be sent. It will be retried on the next run.');
    return {
      status,
      delivery: result,
      details: { delivery: result, sections: sections.map((s) => ({ key: s.key, lines: s.lines.length })), sectionErrors },
    } as const;
  });
}
