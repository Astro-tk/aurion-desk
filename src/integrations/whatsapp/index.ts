import 'server-only';
import { env } from '@/lib/env';
import type { Notifier, OutboundMessage } from '../types';

/**
 * WhatsApp alert through the chatbot's existing approved template (new_lead_alert by default),
 * which takes three body values: who, need, score. Only active when every WHATSAPP_* variable
 * below is set; otherwise isConfigured() is false and the alert is skipped cleanly.
 */
export class WhatsAppNotifier implements Notifier {
  key = 'whatsapp' as const;

  isConfigured(): boolean {
    const e = env();
    return Boolean(e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID && e.WHATSAPP_ALERT_NUMBER && e.WHATSAPP_ALERT_TEMPLATE);
  }

  async send(message: OutboundMessage): Promise<{ providerId?: string }> {
    const e = env();
    const params = (message.templateParams ?? [message.subject]).map((p) =>
      // Template values may not contain newlines, tabs or more than four spaces in a row.
      p.replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 200) || '-',
    );
    const res = await fetch(`https://graph.facebook.com/${e.WHATSAPP_GRAPH_VERSION}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${e.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: (e.WHATSAPP_ALERT_NUMBER ?? '').replace(/\D/g, ''),
        type: 'template',
        template: {
          name: e.WHATSAPP_ALERT_TEMPLATE,
          language: { code: e.WHATSAPP_TEMPLATE_LANGUAGE },
          components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }> };
    return { providerId: body.messages?.[0]?.id };
  }
}

export const whatsappNotifier = new WhatsAppNotifier();
