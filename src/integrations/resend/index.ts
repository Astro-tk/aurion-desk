import 'server-only';
import { env } from '@/lib/env';
import type { Notifier, OutboundMessage } from '../types';

/**
 * Email through Resend's HTTP API.
 * Why Resend: aurion-assistant already sends its alerts through Resend from a verified
 * aurioncreative.com sender, so Desk reuses that verified domain: no new DNS records, one
 * provider for every transactional email. Brevo stays for the nurture sequence and newsletter.
 * HTTP, not SMTP: serverless functions handle SMTP connections slowly; HTTP returns a message id.
 */
export class ResendNotifier implements Notifier {
  key = 'email' as const;

  isConfigured(): boolean {
    const e = env();
    return Boolean(e.RESEND_API_KEY && e.MAIL_FROM && this.recipients().length);
  }

  private recipients(): string[] {
    const e = env();
    return (e.ALERT_EMAIL_TO ?? e.OWNER_EMAILS.join(','))
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }

  async send(message: OutboundMessage): Promise<{ providerId?: string }> {
    const e = env();
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: e.MAIL_FROM, to: this.recipients(), subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { providerId: body.id };
  }
}

export const resendNotifier = new ResendNotifier();
