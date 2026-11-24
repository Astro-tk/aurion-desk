import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { EXPORT_TABLES } from '@/modules/settings/export';
import { allDeskTables, asRole, createTestDb, ownerClaims, seedMembers, SERVICE, tryAsRole, viewerClaims } from './helpers/db';

let db: PGlite;
let contactId: string;
let leadId: string;
let itemId: string;

beforeAll(async () => {
  db = await createTestDb();
  await seedMembers(db);
  const [r] = await asRole<{ r: { inbox_item_id: string; contact_id: string } }>(
    db,
    SERVICE,
    `select desk.ingest_lead($1::jsonb) r`,
    [JSON.stringify({ source: 'form', dedupe_key: 'form:popia', name: 'Private Person', email: 'private@example.test', phone: '+27829999999', company: 'Private Co', message: 'My home address is 1 Example Street', form_id: 'contact', consent_ticked: true, consent_wording: 'Aurion may contact me about this enquiry.' })],
    { 'x-desk-source': 'form' },
  );
  contactId = r!.r.contact_id;
  itemId = r!.r.inbox_item_id;
  const [a] = await asRole<{ r: { lead_id: string } }>(db, ownerClaims('aal2'), `select desk.accept_inbox_item($1, null, 'website_form') r`, [itemId]);
  leadId = a!.r.lead_id;
  await asRole(db, ownerClaims('aal2'), `insert into desk.activities (lead_id, method_key, direction, purpose_key, notes) values ($1, 'email', 'outbound', 'reply', 'Spoke about their daughter')`, [leadId]);
});

describe('danger zone: delete a contact (POPIA)', () => {
  it('a viewer, or an aal1 session, cannot do it', async () => {
    expect((await tryAsRole(db, viewerClaims('aal2'), `select desk.forget_contact($1, null, null)`, [contactId])).error).toMatch(/Not allowed/);
    expect((await tryAsRole(db, ownerClaims('aal1'), `select desk.forget_contact($1, null, null)`, [contactId])).error).toMatch(/Not allowed/);
  });

  it('removes personal data everywhere and keeps an anonymous trail', async () => {
    const emailHash = 'e'.repeat(64);
    await asRole(db, ownerClaims('aal2'), `select desk.forget_contact($1, $2, null)`, [contactId, emailHash]);

    const c = (await db.query(`select full_name, email, phone_e164, forgotten_at is not null as gone from desk.contacts where id = $1`, [contactId])).rows[0];
    expect(c).toEqual({ full_name: null, email: null, phone_e164: null, gone: true });

    const item = (await db.query(`select name, email, phone_e164, message, company, payload from desk.inbox_items where id = $1`, [itemId])).rows[0];
    expect(item).toEqual({ name: null, email: null, phone_e164: null, message: null, company: null, payload: { redacted: true } });

    const lead = (await db.query(`select notes, summary from desk.leads where id = $1`, [leadId])).rows[0];
    expect(lead).toEqual({ notes: null, summary: null });

    const act = (await db.query<{ notes: string | null }>(`select notes from desk.activities where lead_id = $1`, [leadId])).rows;
    expect(act.every((a) => a.notes === null)).toBe(true);

    const ev = await db.query<{ payload: Record<string, unknown> }>(`select payload from desk.events where subject_id in ($1, $2, $3) and type <> 'contact_forgotten'`, [contactId, leadId, itemId]);
    expect(ev.rows.length).toBeGreaterThan(2);
    expect(ev.rows.every((e) => e.payload.redacted === true)).toBe(true);

    // Nothing personal is left anywhere in the database.
    const dump = JSON.stringify((await db.query(`select to_jsonb(t) j from desk.contacts t union all select to_jsonb(t) from desk.inbox_items t union all select to_jsonb(t) from desk.events t union all select to_jsonb(t) from desk.leads t union all select to_jsonb(t) from desk.activities t union all select to_jsonb(t) from desk.audit_log t`)).rows);
    for (const secret of ['Private Person', 'private@example.test', '+27829999999', 'Example Street', 'daughter']) expect(dump).not.toContain(secret);

    // What stays: the consent history (no personal data), the suppression fingerprint, the audit record.
    expect((await db.query(`select count(*)::int n from desk.consent_records where contact_id = $1`, [contactId])).rows[0]).toEqual({ n: 1 });
    expect((await db.query(`select reason from desk.suppressions where identifier_hash = $1`, [emailHash])).rows[0]).toEqual({ reason: 'forgotten' });
    expect((await db.query(`select actor_kind from desk.audit_log where action = 'forget' and record_id = $1`, [contactId])).rows[0]).toEqual({ actor_kind: 'member' });
  });
});

describe('settings lists and export', () => {
  it('owners can add list values; viewers cannot', async () => {
    await asRole(db, ownerClaims('aal2'), `insert into desk.lead_sources (key, label) values ('trade_show', 'Trade show')`);
    expect((await tryAsRole(db, viewerClaims('aal2'), `insert into desk.lead_sources (key, label) values ('nope', 'Nope')`)).error).toMatch(/row-level security/);
    expect((await tryAsRole(db, ownerClaims('aal2'), `update desk.stages set label = 'Hot'`)).error).toMatch(/permission denied|row-level security/);
  });

  it('the ZIP export covers every table a member can read', async () => {
    const serviceOnly = ['suppressions', 'auth_attempts', 'rate_limit_buckets', 'ingest_nonces', 'instance', 'roles', 'role_capabilities'];
    const expected = (await allDeskTables(db)).filter((t) => !serviceOnly.includes(t)).sort();
    expect([...EXPORT_TABLES].sort()).toEqual(expected);
  });
});
