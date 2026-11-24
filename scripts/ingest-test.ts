/**
 * Sends test payloads to both ingest endpoints and prints what happened.
 *
 *   npm run ingest:test                 local: the real handlers, in this process, on an in-memory database
 *   npm run ingest:test -- --url https://desk.aurioncreative.com
 *                                       live: real HTTP requests (needs INGEST_SIGNING_SECRET in .env.local)
 *
 * Live mode creates real Inbox items named "Desk test". Dismiss them afterwards with reason "test".
 */
import { createChatbotSource, signChatbotBody } from '../src/integrations/chatbot';
import type { Notifier } from '../src/integrations/types';
import { createFormSource } from '../src/integrations/website-form';
import type { NotificationStore } from '../src/lib/notify';
import { sendLeadAlerts } from '../src/modules/inbox/alerts';
import { handleIngest, type IngestDeps } from '../src/modules/inbox/ingest-handler';
import { argValue, loadLocalEnv } from './_shared';
import { asRole, createLocalDb, SERVICE, table } from './_localdb';

loadLocalEnv();

const SITE = 'https://aurioncreative.com';
const stamp = Date.now().toString(36);

const formBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ form_id: 'contact', page_url: `${SITE}/contact.html`, name: 'Desk test (form)', email: `desk-test-${stamp}@example.com`, message: 'Needs: Workflow Audit\n\nThis is a test from npm run ingest:test.', consent: false, consent_wording: '', _gotcha: '', ...over });
const chatBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ name: 'Desk test (chatbot)', company: 'Test Co', email: `desk-test-bot-${stamp}@example.com`, phone: '', need: 'Test lead from npm run ingest:test', offer: 'Workflow Audit', score: 4, reason: 'Test', consent: true, consent_wording: 'Consent given in the Aurion Assistant chat to be contacted about this enquiry.', transcript_id: `web-test-${stamp}-s4`, channel: 'web', ...over });

interface Case {
  name: string;
  expect: number;
  build: (base: string, secret: string) => Request;
}

function cases(secret: string): Case[] {
  const now = () => String(Math.floor(Date.now() / 1000));
  const signed = (base: string, body: string, ts = now(), key = secret) =>
    new Request(`${base}/api/ingest/chatbot`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-aurion-timestamp': ts, 'x-aurion-signature': signChatbotBody(key, ts, body) }, body });
  const form = (base: string, body: string, origin: string | null = SITE) =>
    new Request(`${base}/api/ingest/form`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body });
  const replayBody = chatBody({ transcript_id: `web-replay-${stamp}-s2`, score: 2 });
  const replayTs = now();
  return [
    { name: 'form: valid, no consent', expect: 202, build: (b) => form(b, formBody()) },
    { name: 'form: valid, consent ticked', expect: 202, build: (b) => form(b, formBody({ form_id: 'homepage', email: `desk-test-c-${stamp}@example.com`, consent: true, consent_wording: 'Aurion may contact me about this enquiry.' })) },
    { name: 'form: honeypot filled (looks fine, stores nothing)', expect: 202, build: (b) => form(b, formBody({ _gotcha: 'spam', email: `bot-${stamp}@example.com` })) },
    { name: 'form: foreign origin', expect: 403, build: (b) => form(b, formBody(), 'https://evil.example') },
    { name: 'form: no origin', expect: 403, build: (b) => form(b, formBody(), null) },
    { name: 'form: bad email', expect: 422, build: (b) => form(b, formBody({ email: 'not-an-email' })) },
    { name: 'chatbot: signed, score 4 (alert)', expect: 202, build: (b) => signed(b, chatBody()) },
    { name: 'chatbot: bad signature', expect: 401, build: (b) => signed(b, chatBody(), undefined, 'wrong-secret-'.repeat(4)) },
    { name: 'chatbot: timestamp 10 minutes old', expect: 401, build: (b) => signed(b, chatBody(), String(Math.floor(Date.now() / 1000) - 600)) },
    { name: 'chatbot: first send of a request', expect: 202, build: (b) => signed(b, replayBody, replayTs) },
    { name: 'chatbot: exact replay of that request', expect: 409, build: (b) => signed(b, replayBody, replayTs) },
  ];
}

async function live(base: string): Promise<void> {
  const secret = process.env.INGEST_SIGNING_SECRET;
  if (!secret) throw new Error('Set INGEST_SIGNING_SECRET in .env.local (the same value as in Vercel).');
  const rows = [];
  for (const c of cases(secret)) {
    const res = await fetch(c.build(base, secret));
    rows.push({ test: c.name, expected: c.expect, got: res.status, result: res.status === c.expect ? 'PASS' : 'FAIL' });
  }
  table(rows);
  console.log('Open the Desk Inbox: you should see two form items and two chatbot items named "Desk test". Dismiss them with reason "test".');
  if (rows.some((r) => r.result === 'FAIL')) process.exitCode = 1;
}

async function local(): Promise<void> {
  const secret = 'local-test-secret-'.repeat(3);
  const db = await createLocalDb();
  const sent: string[] = [];
  const pending: Promise<unknown>[] = [];
  const consoleMail: Notifier = { key: 'email', isConfigured: () => true, send: async (m) => (sent.push(m.subject), { providerId: 'local' }) };
  const store: NotificationStore = {
    claim: async (k, ch, s) => (await asRole<{ ok: boolean }>(db, SERVICE, `select desk.claim_notification($1,$2,$3) ok`, [k, ch, s]))[0]!.ok,
    markSent: async (k) => void (await asRole(db, SERVICE, `update desk.notifications set status='sent' where dedupe_key=$1`, [k])),
    markFailed: async (k, e) => void (await asRole(db, SERVICE, `update desk.notifications set status='failed', error=$2 where dedupe_key=$1`, [k, e])),
    markSkipped: async () => undefined,
  };
  const deps = (source: 'form' | 'chatbot'): IngestDeps => ({
    ipKey: () => 'local-ip',
    rateLimit: async (b, w, m) => (await asRole<{ ok: boolean }>(db, SERVICE, `select desk.rate_limit_take($1,$2,$3) ok`, [b, w, m]))[0]!.ok,
    claimNonce: async (h) => {
      try {
        await asRole(db, SERVICE, `insert into desk.ingest_nonces (signature_hash) values ($1)`, [h]);
        return true;
      } catch {
        return false;
      }
    },
    isSuppressed: async () => false,
    store: async (lead, suppressed) => {
      const [r] = await asRole<{ r: { inbox_item_id: string; duplicate: boolean; suppressed: boolean } }>(
        db, SERVICE, `select desk.ingest_lead($1::jsonb) r`,
        [JSON.stringify({ source: lead.source, dedupe_key: lead.dedupeKey, name: lead.name, company: lead.company, email: lead.email, phone: lead.phone, message: lead.message, form_id: lead.formId, page_url: lead.pageUrl, need: lead.need, offer: lead.offer, score: lead.score, score_reason: lead.scoreReason, transcript_id: lead.transcriptId, consent_ticked: lead.consentTicked, consent_wording: lead.consentWording, suppressed, payload: lead.payload })],
        { 'x-desk-actor': 'ingest', 'x-desk-source': source },
      );
      return { inboxItemId: r!.r.inbox_item_id, duplicate: r!.r.duplicate, suppressed: r!.r.suppressed };
    },
    afterStore: (lead, stored) => void pending.push(sendLeadAlerts({ lead, inboxItemId: stored.inboxItemId, threshold: 4, notifiers: [consoleMail], store, appUrl: 'https://desk.aurioncreative.com' })),
  });
  const formSource = createFormSource({ allowedOrigins: [SITE, 'https://www.aurioncreative.com'] });
  const chatSource = createChatbotSource({ secret });

  const rows = [];
  for (const c of cases(secret)) {
    const req = c.build('https://desk.local', secret);
    const isForm = req.url.endsWith('/form');
    const res = await handleIngest(req, isForm ? formSource : chatSource, deps(isForm ? 'form' : 'chatbot'));
    const body = (await res.json()) as Record<string, unknown>;
    rows.push({ test: c.name, expected: c.expect, got: res.status, result: res.status === c.expect ? 'PASS' : 'FAIL', reply: JSON.stringify(body).slice(0, 60) });
  }
  await Promise.all(pending);
  console.log('\nRequests (real handlers, in-memory database):');
  table(rows);
  console.log('\nInbox items created:');
  table((await db.query(`select source, form_id, name, score, consent_ticked, status from desk.inbox_items order by received_at`)).rows);
  console.log('\nConsent records (only for an explicit tick or chatbot yes):');
  table((await db.query(`select c.full_name as contact, r.status, r.method_key as via, r.evidence_type as evidence from desk.consent_records r join desk.contacts c on c.id = r.contact_id`)).rows);
  console.log('\nEvents written:');
  table((await db.query(`select source, type, count(*)::int as n from desk.events group by 1, 2 order by 2`)).rows);
  console.log(`\nAlert emails that would be sent (score 4 or more): ${sent.length ? sent.join(' | ') : 'none'}`);
  if (rows.some((r) => r.result === 'FAIL')) process.exitCode = 1;
}

const url = argValue('--url');
(url ? live(url.replace(/\/$/, '')) : local()).catch((err: unknown) => {
  console.error(`\nStopped: ${(err as Error).message}`);
  process.exitCode = 1;
});
