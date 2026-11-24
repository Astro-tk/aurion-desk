import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createChatbotSource, signChatbotBody } from '@/integrations/chatbot';
import type { AIProvider, IngestedLead, Notifier } from '@/integrations/types';
import { createFormSource, DEFAULT_CONSENT_WORDING } from '@/integrations/website-form';
import { deliverOnce, type NotificationStore } from '@/lib/notify';
import { draftLeadSummary } from '@/modules/inbox/ai-draft';
import { sendLeadAlerts } from '@/modules/inbox/alerts';
import { handleIngest, type IngestDeps } from '@/modules/inbox/ingest-handler';
import type { InboxItem } from '@/modules/inbox/queries';
import { asRole, createTestDb, ownerClaims, seedMembers, SERVICE, tryAsRole } from './helpers/db';

const SITE = 'https://www.aurioncreative.com';
const SECRET = 's'.repeat(48);
const NOW = 1_796_000_000_000; // a fixed instant in late 2026

function fakeDeps(overrides: Partial<IngestDeps> = {}) {
  const stored: IngestedLead[] = [];
  const nonces = new Set<string>();
  const after = vi.fn();
  const deps: IngestDeps = {
    rateLimit: async () => true,
    claimNonce: async (h) => (nonces.has(h) ? false : (nonces.add(h), true)),
    isSuppressed: async () => false,
    store: async (lead) => {
      stored.push(lead);
      return { inboxItemId: `item-${stored.length}`, duplicate: false, suppressed: false };
    },
    afterStore: after,
    ipKey: () => 'ip',
    ...overrides,
  };
  return { deps, stored, after };
}

const formSource = createFormSource({ allowedOrigins: ['https://aurioncreative.com', SITE], now: () => new Date(NOW) });
const chatbotSource = createChatbotSource({ secret: SECRET, now: () => NOW });

function formRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://desk.aurioncreative.com/api/ingest/form', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const goodForm = { name: 'Fictional Person', email: 'Person@Example.test', phone: '082 123 4567', company: 'Sample QS', message: 'We price BOQs by hand.', form_id: 'contact' };

describe('POST /api/ingest/form', () => {
  it('accepts a valid form from an allowed origin and returns CORS-friendly JSON', async () => {
    const { deps, stored, after } = fakeDeps();
    const res = await handleIngest(formRequest(goodForm), formSource, deps);
    expect(res.status).toBe(202);
    expect(stored[0]).toMatchObject({ email: 'person@example.test', phone: '+27821234567', consentTicked: false, consentWording: null });
    expect(after).toHaveBeenCalledOnce();
  });

  it('refuses requests with no Origin or a foreign Origin', async () => {
    const { deps, stored } = fakeDeps();
    expect((await handleIngest(formRequest(goodForm, { origin: '' }), formSource, deps)).status).toBe(403);
    expect((await handleIngest(formRequest(goodForm, { origin: 'https://evil.example' }), formSource, deps)).status).toBe(403);
    expect((await handleIngest(formRequest(goodForm, { origin: 'https://aurioncreative.com.evil.example' }), formSource, deps)).status).toBe(403);
    expect(stored).toHaveLength(0);
  });

  it('honeypot: looks successful but stores nothing', async () => {
    const { deps, stored, after } = fakeDeps();
    const res = await handleIngest(formRequest({ ...goodForm, _gotcha: 'http://spam.example' }), formSource, deps);
    expect(res.status).toBe(202);
    expect(stored).toHaveLength(0);
    expect(after).not.toHaveBeenCalled();
  });

  it('rejects payloads over the size limit', async () => {
    const { deps } = fakeDeps();
    const res = await handleIngest(formRequest({ ...goodForm, message: 'x'.repeat(20_000) }), formSource, deps);
    expect(res.status).toBe(413);
  });

  it('validates with Zod: bad email, no way to reach them, unknown content type', async () => {
    const { deps, stored } = fakeDeps();
    expect((await handleIngest(formRequest({ ...goodForm, email: 'nope' }), formSource, deps)).status).toBe(422);
    expect((await handleIngest(formRequest({ name: 'No contact' }), formSource, deps)).status).toBe(422);
    expect((await handleIngest(formRequest('<xml/>', { 'content-type': 'text/xml' }), formSource, deps)).status).toBe(422);
    expect(stored).toHaveLength(0);
  });

  it('rate limits per IP', async () => {
    const { deps } = fakeDeps({ rateLimit: async () => false });
    const res = await handleIngest(formRequest(goodForm), formSource, deps);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });

  it('records consent only for an explicit tick, with the wording shown', async () => {
    const { deps, stored } = fakeDeps();
    await handleIngest(formRequest({ ...goodForm, consent: 'on' }), formSource, deps);
    expect(stored[0]).toMatchObject({ consentTicked: true, consentWording: DEFAULT_CONSENT_WORDING });
  });

  it('accepts form-encoded posts too', async () => {
    const { deps, stored } = fakeDeps();
    const body = new URLSearchParams({ email: 'a@example.test', form_id: 'homepage' }).toString();
    const res = await handleIngest(formRequest(body, { 'content-type': 'application/x-www-form-urlencoded' }), formSource, deps);
    expect(res.status).toBe(202);
    expect(stored[0]!.formId).toBe('homepage');
  });
});

describe('POST /api/ingest/chatbot (HMAC)', () => {
  const lead = { name: 'Chat Person', company: 'Chat Co', email: 'chat@example.test', phone: null, need: 'Tender packs', offer: 'Command Centre', score: 4, reason: 'Clear pain, budget hinted', consent: true, transcript_id: 'web:abc123' };
  const signed = (body: string, ts = String(Math.floor(NOW / 1000)), secret = SECRET) =>
    new Request('https://desk.aurioncreative.com/api/ingest/chatbot', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-aurion-timestamp': ts, 'x-aurion-signature': signChatbotBody(secret, ts, body) },
      body,
    });

  it('accepts a correctly signed lead', async () => {
    const { deps, stored } = fakeDeps();
    const res = await handleIngest(signed(JSON.stringify(lead)), chatbotSource, deps);
    expect(res.status).toBe(202);
    expect(stored[0]).toMatchObject({ source: 'chatbot', score: 4, dedupeKey: 'chatbot:web:abc123', consentTicked: true });
  });

  it('rejects a bad signature', async () => {
    const { deps, stored } = fakeDeps();
    expect((await handleIngest(signed(JSON.stringify(lead), undefined, 'w'.repeat(48)), chatbotSource, deps)).status).toBe(401);
    const tampered = signed(JSON.stringify(lead));
    const body = JSON.stringify({ ...lead, score: 5 });
    const forged = new Request(tampered.url, { method: 'POST', headers: tampered.headers, body });
    expect((await handleIngest(forged, chatbotSource, deps)).status).toBe(401);
    expect(stored).toHaveLength(0);
  });

  it('rejects an old (or future) timestamp, even with a valid signature', async () => {
    const { deps } = fakeDeps();
    const old = String(Math.floor(NOW / 1000) - 301);
    const future = String(Math.floor(NOW / 1000) + 301);
    expect((await handleIngest(signed(JSON.stringify(lead), old), chatbotSource, deps)).status).toBe(401);
    expect((await handleIngest(signed(JSON.stringify(lead), future), chatbotSource, deps)).status).toBe(401);
  });

  it('rejects missing signature headers', async () => {
    const { deps } = fakeDeps();
    const req = new Request('https://desk.aurioncreative.com/api/ingest/chatbot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect((await handleIngest(req, chatbotSource, deps)).status).toBe(401);
  });

  it('refuses a replay of the exact same signed request', async () => {
    const { deps } = fakeDeps();
    const body = JSON.stringify(lead);
    const ts = String(Math.floor(NOW / 1000));
    expect((await handleIngest(signed(body, ts), chatbotSource, deps)).status).toBe(202);
    expect((await handleIngest(signed(body, ts), chatbotSource, deps)).status).toBe(409);
  });

  it('validates the payload after the signature', async () => {
    const { deps } = fakeDeps();
    expect((await handleIngest(signed(JSON.stringify({ ...lead, score: 9 })), chatbotSource, deps)).status).toBe(422);
    expect((await handleIngest(signed(JSON.stringify({ ...lead, email: null, phone: null })), chatbotSource, deps)).status).toBe(422);
  });
});

// ---------------------------------------------------------------- database

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
  await seedMembers(db);
});

const ingest = (p: Record<string, unknown>) =>
  asRole<{ r: { inbox_item_id: string; duplicate: boolean; contact_id: string; suppressed: boolean } }>(db, SERVICE, `select desk.ingest_lead($1::jsonb) r`, [JSON.stringify(p)], {
    'x-desk-actor': 'ingest',
    'x-desk-source': String(p.source),
  }).then((rows) => rows[0]!.r);

describe('desk.ingest_lead', () => {
  it('creates the contact, the inbox item and an event; no consent without a tick', async () => {
    const r = await ingest({ source: 'form', dedupe_key: 'form:1', name: 'Form Person', email: 'form@example.test', company: 'Form Co', form_id: 'contact', consent_ticked: false });
    expect(r.duplicate).toBe(false);
    expect((await db.query(`select * from desk.consent_records where contact_id = $1`, [r.contact_id])).rows).toHaveLength(0);
    const ev = await db.query<{ source: string; type: string }>(`select source, type from desk.events where subject_id = $1`, [r.inbox_item_id]);
    expect(ev.rows).toEqual([{ source: 'form', type: 'form_submitted' }]);
  });

  it('dedupes: the same dedupe key is reported as a duplicate, and the same email reuses the contact', async () => {
    const again = await ingest({ source: 'form', dedupe_key: 'form:1', email: 'form@example.test' });
    expect(again.duplicate).toBe(true);
    const second = await ingest({ source: 'chatbot', dedupe_key: 'chatbot:t1', email: 'FORM@example.test'.toLowerCase(), phone: '+27820000001', score: 4, transcript_id: 't1', consent_ticked: true, consent_wording: 'Chat consent' });
    const contacts = await db.query<{ n: number; phone: string }>(`select count(*)::int n, max(phone_e164) phone from desk.contacts where email = 'form@example.test'`);
    expect(contacts.rows[0]).toEqual({ n: 1, phone: '+27820000001' }); // blank phone filled in
    const consent = await db.query<{ status: string; evidence_type: string; evidence_ref: string }>(
      `select status, evidence_type, evidence_ref from desk.consent_records where contact_id = $1`,
      [second.contact_id],
    );
    expect(consent.rows).toEqual([{ status: 'yes', evidence_type: 'chat_transcript', evidence_ref: 't1' }]);
  });

  it('dedupes on phone when the email is new', async () => {
    const r = await ingest({ source: 'chatbot', dedupe_key: 'chatbot:t2', phone: '+27820000001', score: 2, transcript_id: 't2' });
    const n = await db.query<{ n: number }>(`select count(*)::int n from desk.contacts where phone_e164 = '+27820000001'`);
    expect(n.rows[0]!.n).toBe(1);
    expect(r.duplicate).toBe(false);
  });

  it('flags a returning person whose latest consent is "no"', async () => {
    const first = await ingest({ source: 'form', dedupe_key: 'form:no1', email: 'no@example.test' });
    await db.query(`insert into desk.consent_records (contact_id, status, method_key, wording_shown, evidence_type) values ($1, 'no', 'email', 'Asked by email', 'manual')`, [first.contact_id]);
    const back = await ingest({ source: 'form', dedupe_key: 'form:no2', email: 'no@example.test' });
    expect(back.suppressed).toBe(true);
  });

  it('cannot be called by a signed-in member or anonymously', async () => {
    expect((await tryAsRole(db, ownerClaims('aal2'), `select desk.ingest_lead('{}'::jsonb)`)).error).toMatch(/permission denied/);
    expect((await tryAsRole(db, { role: 'anon' }, `select desk.ingest_lead('{}'::jsonb)`)).error).toMatch(/permission denied/);
  });
});

describe('accept and dismiss', () => {
  it('accept creates a lead with the score, then a second accept of a new item for the same person reuses it', async () => {
    const item = (await db.query<{ id: string }>(`select id from desk.inbox_items where dedupe_key = 'chatbot:t1'`)).rows[0]!;
    const [a] = await asRole<{ r: { lead_id: string; new_lead: boolean } }>(db, ownerClaims('aal2'), `select desk.accept_inbox_item($1, 'linkedin', 'website_chatbot') r`, [item.id]);
    expect(a!.r.new_lead).toBe(true);
    const lead = (await db.query<{ score: number; created_from: string }>(`select score, created_from from desk.leads where id = $1`, [a!.r.lead_id])).rows[0];
    expect(lead).toEqual({ score: 4, created_from: 'chatbot' });

    const other = (await db.query<{ id: string }>(`select id from desk.inbox_items where dedupe_key = 'form:1'`)).rows[0]!;
    const [b] = await asRole<{ r: { lead_id: string; new_lead: boolean } }>(db, ownerClaims('aal2'), `select desk.accept_inbox_item($1, null, null) r`, [other.id]);
    expect(b!.r).toEqual({ lead_id: a!.r.lead_id, new_lead: false });
  });

  it('an item cannot be decided twice, and aal1 cannot decide at all', async () => {
    const item = (await db.query<{ id: string }>(`select id from desk.inbox_items where dedupe_key = 'chatbot:t1'`)).rows[0]!;
    expect((await tryAsRole(db, ownerClaims('aal2'), `select desk.dismiss_inbox_item($1, 'spam')`, [item.id])).error).toMatch(/already handled/);
    const fresh = (await db.query<{ id: string }>(`select id from desk.inbox_items where dedupe_key = 'chatbot:t2'`)).rows[0]!;
    expect((await tryAsRole(db, ownerClaims('aal1'), `select desk.accept_inbox_item($1, null, null)`, [fresh.id])).error).toMatch(/Not allowed/);
  });

  it('dismiss needs a reason and writes an event', async () => {
    const fresh = (await db.query<{ id: string }>(`select id from desk.inbox_items where dedupe_key = 'chatbot:t2'`)).rows[0]!;
    expect((await tryAsRole(db, ownerClaims('aal2'), `select desk.dismiss_inbox_item($1, '  ')`, [fresh.id])).error).toMatch(/reason/);
    await asRole(db, ownerClaims('aal2'), `select desk.dismiss_inbox_item($1, 'Job seeker')`, [fresh.id]);
    const ev = await db.query<{ type: string }>(`select type from desk.events where subject_id = $1 order by id`, [fresh.id]);
    expect(ev.rows.map((e) => e.type)).toEqual(['chatbot_lead_received', 'inbox_dismissed']);
  });
});

// ---------------------------------------------------------------- alerts and the AI draft

function dbNotificationStore(): NotificationStore {
  return {
    claim: async (key, channel, subject) =>
      (await asRole<{ ok: boolean }>(db, SERVICE, `select desk.claim_notification($1, $2, $3) ok`, [key, channel, subject]))[0]!.ok,
    markSent: async (key) => void (await asRole(db, SERVICE, `update desk.notifications set status = 'sent' where dedupe_key = $1`, [key])),
    markFailed: async (key, e) => void (await asRole(db, SERVICE, `update desk.notifications set status = 'failed', error = $2 where dedupe_key = $1`, [key, e])),
    markSkipped: async () => undefined,
  };
}

function fakeNotifier(key: Notifier['key'], configured = true, fail = false) {
  const sent: string[] = [];
  const n: Notifier = {
    key,
    isConfigured: () => configured,
    send: async (m) => {
      if (fail) throw new Error('provider down');
      sent.push(m.subject);
      return { providerId: 'x' };
    },
  };
  return { n, sent };
}

const hotLead: IngestedLead = {
  source: 'chatbot', dedupeKey: 'chatbot:hot', name: 'Hot Lead', company: 'Hot Co', email: 'hot@example.test', phone: null, message: null,
  formId: null, pageUrl: null, need: 'BOQ checks', offer: 'Command Centre', score: 5, scoreReason: 'Ready', transcriptId: 'hot', consentTicked: true, consentWording: 'x', payload: {},
};

describe('lead alerts', () => {
  it('score 4 or more emails once; a second run sends nothing; WhatsApp is skipped cleanly when not set up', async () => {
    const email = fakeNotifier('email');
    const wa = fakeNotifier('whatsapp', false);
    const opts = { lead: hotLead, inboxItemId: '00000000-0000-4000-8000-000000000001', threshold: 4, notifiers: [email.n, wa.n], store: dbNotificationStore(), appUrl: 'https://desk.example' };
    expect(await sendLeadAlerts(opts)).toEqual({ email: 'sent', whatsapp: 'not_configured' });
    expect(await sendLeadAlerts(opts)).toEqual({ email: 'already_sent', whatsapp: 'not_configured' });
    expect(email.sent).toEqual(['New lead: Hot Lead, Hot Co (score 5/5)']);
  });

  it('below the threshold nothing is sent', async () => {
    const email = fakeNotifier('email');
    const r = await sendLeadAlerts({ lead: { ...hotLead, score: 3 }, inboxItemId: 'x', threshold: 4, notifiers: [email.n], store: dbNotificationStore(), appUrl: '' });
    expect(r).toEqual({ all: 'below_threshold' });
    expect(email.sent).toHaveLength(0);
  });

  it('a failed send can be retried and then succeeds once', async () => {
    const store = dbNotificationStore();
    const down = fakeNotifier('email', true, true);
    expect(await deliverOnce(down.n, 'alert:retry:email', { subject: 's', text: 't' }, store)).toBe('failed');
    const up = fakeNotifier('email');
    expect(await deliverOnce(up.n, 'alert:retry:email', { subject: 's', text: 't' }, store)).toBe('sent');
    expect(await deliverOnce(up.n, 'alert:retry:email', { subject: 's', text: 't' }, store)).toBe('already_sent');
  });
});

describe('AI draft on accept', () => {
  const item = { source: 'form', name: 'A', company: 'B', message: 'm', need: null, offer: null, score: null, score_reason: null } as unknown as InboxItem;

  function fakeDb(lead: Record<string, unknown>) {
    const updates: Array<Record<string, unknown>> = [];
    const chain = {
      select: () => chain,
      eq: () => chain,
      single: async () => ({ data: lead, error: null }),
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: async () => ({ error: null }) };
      },
      insert: async () => ({ error: null }),
    };
    return { db: { from: () => chain } as never, updates };
  }

  it('if the API fails, the accept still succeeds and nothing is written', async () => {
    const ai: AIProvider = { key: 'x', isConfigured: () => true, summariseLead: async () => Promise.reject(new Error('529 overloaded')) };
    const { db: fake, updates } = fakeDb({ summary: null, next_action: null });
    await expect(draftLeadSummary(fake, ai, item, 'lead-1')).resolves.toBe('failed');
    expect(updates).toHaveLength(0);
  });

  it('writes both fields marked as AI draft, but never over text you wrote', async () => {
    const ai: AIProvider = { key: 'x', isConfigured: () => true, summariseLead: async () => ({ summary: 'Two lines.', nextAction: 'Offer an audit.', model: 'claude-haiku-5-5' }) };
    const { db: fake, updates } = fakeDb({ summary: null, next_action: 'Call Tuesday', next_action_is_ai_draft: false });
    expect(await draftLeadSummary(fake, ai, item, 'lead-1')).toBe('drafted');
    expect(updates[0]).toEqual({ ai_model: 'claude-haiku-5-5', summary: 'Two lines.', summary_is_ai_draft: true });
  });

  it('is skipped cleanly when no API key is set', async () => {
    const ai: AIProvider = { key: 'x', isConfigured: () => false, summariseLead: vi.fn() };
    expect(await draftLeadSummary(fakeDb({}).db, ai, item, 'lead-1')).toBe('skipped');
    expect(ai.summariseLead).not.toHaveBeenCalled();
  });
});
