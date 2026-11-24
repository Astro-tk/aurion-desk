import type { Notifier, OutboundMessage } from '@/integrations/types';

/**
 * Send-once delivery. Every alert and digest first CLAIMS a dedupe key in desk.notifications
 * (desk.claim_notification). Only the first claim sends, so a cron job that runs twice, or an
 * ingest retry, never sends a second copy. A failed send can be claimed again and retried.
 */
export interface NotificationStore {
  claim(key: string, channel: Notifier['key'], subject: string, jobRunId?: string | null): Promise<boolean>;
  markSent(key: string, providerId?: string): Promise<void>;
  markFailed(key: string, error: string): Promise<void>;
  markSkipped(key: string, reason: string): Promise<void>;
}

export type DeliveryResult = 'sent' | 'already_sent' | 'not_configured' | 'failed';

export async function deliverOnce(
  notifier: Notifier,
  key: string,
  message: OutboundMessage,
  store: NotificationStore,
  jobRunId?: string | null,
): Promise<DeliveryResult> {
  if (!notifier.isConfigured()) return 'not_configured';
  const claimed = await store.claim(key, notifier.key, message.subject, jobRunId);
  if (!claimed) return 'already_sent';
  try {
    const { providerId } = await notifier.send(message);
    await store.markSent(key, providerId);
    return 'sent';
  } catch (err) {
    await store.markFailed(key, (err as Error).message.slice(0, 500));
    return 'failed';
  }
}
