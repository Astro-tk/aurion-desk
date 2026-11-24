import 'server-only';
import { serviceDb } from '@/lib/db/service';
import type { NotificationStore } from './notify';

/** desk.notifications through the service role (alerts and the digest run without a user). */
export function serviceNotificationStore(): NotificationStore {
  const db = serviceDb('cron');
  return {
    async claim(key, channel, subject, jobRunId) {
      const { data, error } = await db.rpc('claim_notification', { p_key: key, p_channel: channel, p_subject: subject, p_job_run: jobRunId ?? null });
      if (error) throw new Error(`claim_notification: ${error.message}`);
      return data === true;
    },
    async markSent(key, providerId) {
      await db.from('notifications').update({ status: 'sent', sent_at: new Date().toISOString(), provider_message_id: providerId ?? null }).eq('dedupe_key', key);
    },
    async markFailed(key, error) {
      await db.from('notifications').update({ status: 'failed', error }).eq('dedupe_key', key);
    },
    async markSkipped(key, reason) {
      await db.from('notifications').update({ status: 'skipped', error: reason }).eq('dedupe_key', key);
    },
  };
}
