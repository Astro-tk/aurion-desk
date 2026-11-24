import { describe, expect, it } from 'vitest';
import { createFormSource, DEFAULT_CONSENT_WORDING } from '@/integrations/website-form';

/**
 * Contract with the website's desk-forms branch (assets/js/desk-ingest.js): these are the exact
 * shapes it sends. If either side changes, this test should change with it.
 */
const source = createFormSource({ allowedOrigins: ['https://aurioncreative.com', 'https://www.aurioncreative.com'] });

const fromSite = (over: Record<string, unknown>) =>
  JSON.stringify({
    form_id: 'contact',
    page_url: 'https://aurioncreative.com/contact.html',
    name: 'Fictional Visitor',
    email: 'visitor@example.test',
    phone: '',
    company: '',
    message: 'Needs: Workflow Audit\n\nWe price BOQs by hand.',
    consent: false,
    consent_wording: '',
    _gotcha: '',
    ...over,
  });

describe('website form contract', () => {
  it('accepts the contact page payload without consent and records none', () => {
    const r = source.parse(fromSite({}), 'application/json');
    expect(r.ok && r.lead).toMatchObject({ formId: 'contact', consentTicked: false, consentWording: null, phone: null, company: null });
  });

  it('accepts the homepage and pricing payloads with consent and keeps the wording', () => {
    for (const form_id of ['homepage', 'pricing']) {
      const r = source.parse(fromSite({ form_id, consent: true, consent_wording: DEFAULT_CONSENT_WORDING }), 'application/json');
      expect(r.ok && r.lead).toMatchObject({ formId: form_id, consentTicked: true, consentWording: 'Aurion may contact me about this enquiry.' });
    }
  });

  it('treats a filled honeypot as a bot', () => {
    const r = source.parse(fromSite({ _gotcha: 'x' }), 'application/json');
    expect(r).toEqual({ ok: true, lead: null });
  });
});

// ---------------------------------------------------------------- chatbot contract
import { createChatbotSource } from '@/integrations/chatbot';
import { createHmac } from 'node:crypto';

describe('chatbot contract (aurion-assistant desk-ingest branch, src/desk.ts toDeskLead)', () => {
  const secret = 'k'.repeat(48);
  const now = 1_796_000_000_000;
  const chatbot = createChatbotSource({ secret, now: () => now });
  // Exactly the shape toDeskLead() builds, including the empty strings it sends for unknown fields.
  const body = JSON.stringify({
    name: 'Lerato Mokoena',
    company: 'Kopano Quantity Surveyors',
    email: 'lerato@example.co.za',
    phone: '',
    need: 'BOQ mapping for 3 projects a month',
    offer: 'Project Command',
    score: 4,
    reason: 'Clear process pain',
    consent: true,
    consent_wording: 'Consent given in the Aurion Assistant chat to be contacted about this enquiry.',
    transcript_id: 'web-0123456789abcdef01234567-s4',
    channel: 'web',
  });
  const ts = String(Math.floor(now / 1000));
  // Signed independently of Desk's own helper, the way the chatbot does it.
  const sig = 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  const req = new Request('https://desk.example/api/ingest/chatbot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-aurion-timestamp': ts, 'x-aurion-signature': sig },
    body,
  });

  it('verifies the chatbot signature and accepts its payload', async () => {
    expect(await chatbot.authenticate(req, body)).toEqual({ ok: true });
    const r = chatbot.parse(body, 'application/json');
    expect(r.ok && r.lead).toMatchObject({ score: 4, phone: null, consentTicked: true, dedupeKey: 'chatbot:web-0123456789abcdef01234567-s4' });
  });
});
