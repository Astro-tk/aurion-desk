import type { IngestedLead, Notifier, OutboundMessage } from '@/integrations/types';
import { deliverOnce, type DeliveryResult, type NotificationStore } from '@/lib/notify';

export const DEFAULT_ALERT_THRESHOLD = 4;

export function alertMessage(lead: IngestedLead, inboxItemId: string, appUrl: string): OutboundMessage {
  const who = [lead.name, lead.company].filter(Boolean).join(', ') || 'Unnamed visitor';
  const need = lead.need || lead.message?.slice(0, 120) || 'not stated';
  const score = lead.score !== null ? String(lead.score) : 'unscored';
  const link = `${appUrl}/inbox/${inboxItemId}`;
  const text = [
    `A promising lead arrived in Aurion Desk (${lead.source === 'chatbot' ? 'website chatbot' : 'website form'}).`,
    '',
    `Who: ${who}`,
    `Need: ${need}`,
    lead.offer ? `Offer: ${lead.offer}` : null,
    `Score: ${score} of 5${lead.scoreReason ? `. ${lead.scoreReason}` : ''}`,
    `Consent to contact: ${lead.consentTicked ? 'yes' : 'not given'}`,
    '',
    `Open it: ${link}`,
  ]
    .filter((l) => l !== null)
    .join('\n');
  return {
    subject: `New lead: ${who} (score ${score}/5)`,
    text,
    templateParams: [who, need, score],
  };
}

/**
 * Alert on a high-scoring item: email always (when configured), WhatsApp only when every
 * WHATSAPP_* variable is set. Each channel is claimed separately, so a retry never repeats one.
 */
export async function sendLeadAlerts(opts: {
  lead: IngestedLead;
  inboxItemId: string;
  threshold: number;
  notifiers: Notifier[];
  store: NotificationStore;
  appUrl: string;
}): Promise<Record<string, DeliveryResult | 'below_threshold'>> {
  const { lead, inboxItemId, threshold } = opts;
  if (lead.score === null || lead.score < threshold) return { all: 'below_threshold' };
  const message = alertMessage(lead, inboxItemId, opts.appUrl);
  const results: Record<string, DeliveryResult> = {};
  for (const n of opts.notifiers) {
    results[n.key] = await deliverOnce(n, `alert:${inboxItemId}:${n.key}`, message, opts.store);
  }
  return results;
}
