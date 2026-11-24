'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { check, fields, formObject, run, type ActionResult } from '@/lib/actions';
import { requireCapability } from '@/lib/auth/session';
import { assertMayContact, suppressIdentifiers } from '@/lib/consent';
import { sha256Hex } from '@/lib/crypto';
import { userDb } from '@/lib/db/server';
import { recordEvent } from '@/lib/events';
import { todaySast } from '@/lib/format';
import { getLists } from '@/lib/lists';
import { toE164 } from '@/lib/phone';
import { dryRunPipelineCsv, reportForStorage, type DryRunReport } from './csv-import';

const optionalKey = fields.key.optional();
const optionalDate = fields.isoDate.optional();

// ---------------------------------------------------------------- quick add

const quickAddSchema = z
  .object({
    name: fields.optionalText(200),
    firm: fields.optionalText(200),
    email: z.email('That email address does not look right.').max(200).optional(),
    phone: fields.optionalText(40),
    channel_key: optionalKey,
    source_key: optionalKey,
    next_action: fields.optionalText(500),
    next_date: optionalDate,
  })
  .refine((v) => v.name || v.firm || v.email || v.phone, { message: 'Add at least a name, a firm, an email or a phone.', path: ['name'] });

export async function quickAddLeadAction(_prev: ActionResult, fd: FormData): Promise<ActionResult<{ leadId: string }>> {
  return run(async () => {
    await requireCapability('pipeline.write');
    const input = quickAddSchema.parse(formObject(fd));
    const phone = input.phone ? toE164(input.phone) : null;
    if (input.phone && !phone) return { ok: false, error: 'That phone number does not look right. Try 082 123 4567 or +27 82 123 4567.' };
    const db = await userDb({ source: 'manual' });
    const result = check(
      await db.rpc('quick_add_lead', {
        p: { ...input, email: input.email?.toLowerCase(), phone, first_contact_date: todaySast() },
      }),
    ) as { lead_id: string; existing: boolean };
    revalidatePath('/pipeline');
    revalidatePath('/');
    if (result.existing) redirect(`/pipeline/${result.lead_id}?notice=existing`);
    return { ok: true, message: 'Lead added. Add another, or open the Pipeline.', data: { leadId: result.lead_id } };
  });
}

// ---------------------------------------------------------------- stage

const stageSchema = z.object({ lead_id: fields.uuid, stage_key: fields.key, note: fields.optionalText(300) });

export async function changeStageAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await requireCapability('pipeline.write');
    const input = stageSchema.parse(formObject(fd));
    const db = await userDb({ source: 'manual' });
    // The stage_history row and stage_changed event are written by a database trigger.
    check(await db.from('leads').update({ stage_key: input.stage_key }).eq('id', input.lead_id));
    if (input.note) {
      await recordEvent(db, { type: 'stage_note', source: 'manual', subjectType: 'lead', subjectId: input.lead_id, payload: { note: input.note } });
    }
    revalidatePath('/pipeline');
    revalidatePath(`/pipeline/${input.lead_id}`);
    return { ok: true, message: 'Stage changed.' };
  });
}

/** Plain form action for the board's one-tap stage select. */
export async function boardStageAction(fd: FormData): Promise<void> {
  await changeStageAction({ ok: true }, fd);
}

// ---------------------------------------------------------------- lead fields

const leadSchema = z.object({
  lead_id: fields.uuid,
  channel_key: optionalKey,
  source_key: optionalKey,
  first_contact_date: optionalDate,
  next_action: fields.optionalText(500),
  next_date: optionalDate,
  summary: fields.optionalText(1000),
  score: z.coerce.number().int().min(0).max(5).optional(),
  founding_office: z.enum(['on']).optional(),
  notes: fields.optionalText(5000),
});

export async function updateLeadAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await requireCapability('pipeline.write');
    const input = leadSchema.parse(formObject(fd));
    const db = await userDb({ source: 'manual' });
    const before = check(await db.from('leads').select('summary, next_action').eq('id', input.lead_id).single()) as {
      summary: string | null;
      next_action: string | null;
    };
    const patch: Record<string, unknown> = {
      channel_key: input.channel_key ?? null,
      source_key: input.source_key ?? null,
      first_contact_date: input.first_contact_date ?? null,
      next_action: input.next_action ?? null,
      next_date: input.next_date ?? null,
      summary: input.summary ?? null,
      score: input.score ?? null,
      founding_office: input.founding_office === 'on',
      notes: input.notes ?? null,
    };
    // Once you edit an AI draft it is yours: the "AI draft" label goes.
    if ((input.summary ?? null) !== before.summary) patch.summary_is_ai_draft = false;
    if ((input.next_action ?? null) !== before.next_action) patch.next_action_is_ai_draft = false;
    check(await db.from('leads').update(patch).eq('id', input.lead_id));
    revalidatePath(`/pipeline/${input.lead_id}`);
    revalidatePath('/pipeline');
    return { ok: true, message: 'Saved.' };
  });
}

export async function archiveLeadAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await requireCapability('pipeline.write');
    const { lead_id, restore } = z.object({ lead_id: fields.uuid, restore: z.enum(['1']).optional() }).parse(formObject(fd));
    const db = await userDb({ source: 'manual' });
    check(await db.from('leads').update({ archived_at: restore ? null : new Date().toISOString() }).eq('id', lead_id));
    await recordEvent(db, { type: restore ? 'lead_restored' : 'lead_archived', source: 'manual', subjectType: 'lead', subjectId: lead_id });
    revalidatePath('/pipeline');
    revalidatePath(`/pipeline/${lead_id}`);
    return { ok: true, message: restore ? 'Restored.' : 'Archived. It no longer shows in the pipeline.' };
  });
}

// ---------------------------------------------------------------- contact and organisation

const contactSchema = z.object({
  contact_id: fields.uuid,
  lead_id: fields.uuid,
  full_name: fields.optionalText(200),
  role_title: fields.optionalText(200),
  email: z.email('That email address does not look right.').max(200).optional(),
  phone: fields.optionalText(40),
  linkedin_url: z
    .string()
    .regex(/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//i, 'Use the full https://www.linkedin.com/... address.')
    .optional(),
});

export async function updateContactAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await requireCapability('pipeline.write');
    const input = contactSchema.parse(formObject(fd));
    const phone = input.phone ? toE164(input.phone) : null;
    if (input.phone && !phone) return { ok: false, error: 'That phone number does not look right.' };
    const db = await userDb({ source: 'manual' });
    check(
      await db
        .from('contacts')
        .update({
          full_name: input.full_name ?? null,
          role_title: input.role_title ?? null,
          email: input.email?.toLowerCase() ?? null,
          phone_e164: phone,
          linkedin_url: input.linkedin_url ?? null,
        })
        .eq('id', input.contact_id),
    );
    revalidatePath(`/pipeline/${input.lead_id}`);
    return { ok: true, message: 'Contact saved.' };
  });
}

const orgSchema = z.object({
  organisation_id: fields.uuid,
  lead_id: fields.uuid,
  name: fields.requiredText(200, 'Firm'),
  type_key: optionalKey,
  town: fields.optionalText(100),
  website: z.url('Use a full address like https://example.co.za').max(300).optional(),
});

export async function updateOrganisationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await requireCapability('pipeline.write');
    const input = orgSchema.parse(formObject(fd));
    const db = await userDb({ source: 'manual' });
    const domain = input.website ? new URL(input.website).hostname.replace(/^www\./, '') : null;
    check(
      await db
        .from('organisations')
        .update({ name: input.name, type_key: input.type_key ?? null, town: input.town ?? null, website: input.website ?? null, domain })
        .eq('id', input.organisation_id),
    );
    revalidatePath(`/pipeline/${input.lead_id}`);
    return { ok: true, message: 'Organisation saved.' };
  });
}

// ---------------------------------------------------------------- activities

const activitySchema = z.object({
  lead_id: fields.uuid,
  method_key: fields.key,
  direction: z.enum(['inbound', 'outbound']),
  purpose_key: fields.key,
  occurred_on: optionalDate,
  outcome: fields.optionalText(500),
  follow_up_date: optionalDate,
  notes: fields.optionalText(5000),
});

export async function logActivityAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await requireCapability('pipeline.write');
    const input = activitySchema.parse(formObject(fd));
    const db = await userDb({ source: 'manual' });
    const lead = check(await db.from('leads').select('contact_id').eq('id', input.lead_id).single()) as { contact_id: string | null };
    if (input.direction === 'outbound') await assertMayContact(db, lead.contact_id);
    const occurredAt = input.occurred_on && input.occurred_on !== todaySast() ? `${input.occurred_on}T12:00:00+02:00` : new Date().toISOString();
    // The database refuses outbound activities to a "no" as well (error DK001).
    check(
      await db.from('activities').insert({
        lead_id: input.lead_id,
        contact_id: lead.contact_id,
        method_key: input.method_key,
        direction: input.direction,
        purpose_key: input.purpose_key,
        occurred_at: occurredAt,
        outcome: input.outcome ?? null,
        follow_up_date: input.follow_up_date ?? null,
        notes: input.notes ?? null,
      }),
    );
    if (input.follow_up_date) check(await db.from('leads').update({ next_date: input.follow_up_date }).eq('id', input.lead_id));
    revalidatePath(`/pipeline/${input.lead_id}`);
    return { ok: true, message: input.follow_up_date ? 'Logged. Next date moved to the follow-up date.' : 'Logged.' };
  });
}

// ---------------------------------------------------------------- consent (append-only)

const consentSchema = z.object({
  lead_id: fields.uuid,
  contact_id: fields.uuid,
  status: z.enum(['asked', 'yes', 'no']),
  method_key: fields.key,
  wording_shown: fields.requiredText(1000, 'The wording you used'),
});

export async function recordConsentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const member = await requireCapability('pipeline.write');
    const input = consentSchema.parse(formObject(fd));
    const db = await userDb({ source: 'manual' });
    check(
      await db.from('consent_records').insert({
        contact_id: input.contact_id,
        status: input.status,
        method_key: input.method_key,
        wording_shown: input.wording_shown,
        evidence_type: 'manual',
        evidence_ref: null,
        recorded_by: member.userId,
      }),
    );
    if (input.status === 'no') {
      const c = check(await db.from('contacts').select('email, phone_e164').eq('id', input.contact_id).single()) as {
        email: string | null;
        phone_e164: string | null;
      };
      await suppressIdentifiers(c.email, c.phone_e164, 'consent_no');
    }
    revalidatePath(`/pipeline/${input.lead_id}`);
    revalidatePath('/pipeline');
    return { ok: true, message: input.status === 'no' ? 'Recorded. Desk will block outbound messages to this person.' : 'Consent recorded.' };
  });
}

// ---------------------------------------------------------------- saved views

export async function saveViewAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const member = await requireCapability('pipeline.read');
    const input = z.object({ name: fields.requiredText(60, 'View name'), search: z.string().max(500).default('') }).parse(formObject(fd));
    const db = await userDb();
    check(
      await db
        .from('saved_views')
        .upsert({ member_id: member.userId, module: 'pipeline', name: input.name, query: { search: input.search } }, { onConflict: 'member_id,module,name' }),
    );
    revalidatePath('/pipeline');
    return { ok: true, message: `Saved as "${input.name}".` };
  });
}

export async function deleteViewAction(fd: FormData): Promise<void> {
  await run(async () => {
    const member = await requireCapability('pipeline.read');
    const { id } = z.object({ id: fields.uuid }).parse(formObject(fd));
    const db = await userDb();
    check(await db.from('saved_views').delete().eq('id', id).eq('member_id', member.userId));
    revalidatePath('/pipeline');
    return { ok: true };
  });
}

// ---------------------------------------------------------------- CSV import

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

async function buildReport(text: string): Promise<DryRunReport> {
  const db = await userDb();
  const lists = await getLists(db);
  const emails = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('contacts').select('email').not('email', 'is', null).range(from, from + 999);
    (data ?? []).forEach((r: { email: string }) => emails.add(r.email.toLowerCase()));
    if (!data || data.length < 1000) break;
  }
  return dryRunPipelineCsv(text, {
    orgTypes: lists.orgTypes.filter((x) => x.active),
    sources: lists.sources.filter((x) => x.active),
    channels: lists.channels.filter((x) => x.active),
    stages: lists.stages.map((s) => ({ key: s.key, label: s.label })),
    existingEmails: emails,
    today: todaySast(),
  });
}

export async function importDryRunAction(_prev: ActionResult, fd: FormData): Promise<ActionResult<{ batchId: string | null; report: DryRunReport; text: string; filename: string }>> {
  return run(async () => {
    const member = await requireCapability('pipeline.import');
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a CSV file first.' };
    if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: 'That file is larger than 5 MB.' };
    const text = await file.text();
    const report = await buildReport(text);
    const db = await userDb();
    const batch = check(
      await db
        .from('import_batches')
        .insert({
          kind: 'pipeline_csv',
          filename: file.name.slice(0, 200),
          sha256: sha256Hex(text),
          row_count: report.counts.total,
          status: 'dry_run',
          report: reportForStorage(report),
          created_by: member.userId,
        })
        .select('id')
        .single(),
    ) as { id: string };
    return { ok: true, data: { batchId: batch.id, report, text, filename: file.name } };
  });
}

export async function importCommitAction(_prev: ActionResult, fd: FormData): Promise<ActionResult<{ leads: number; skipped: number; consents: number }>> {
  return run(async () => {
    await requireCapability('pipeline.import');
    const { batch_id, text } = z.object({ batch_id: fields.uuid, text: z.string().max(MAX_IMPORT_BYTES) }).parse({
      batch_id: fd.get('batch_id'),
      text: fd.get('text'),
    });
    const db = await userDb({ source: 'import' });
    const batch = check(await db.from('import_batches').select('sha256, status').eq('id', batch_id).single()) as { sha256: string; status: string };
    if (batch.status !== 'dry_run') return { ok: false, error: 'This file was already imported.' };
    if (batch.sha256 !== sha256Hex(text)) return { ok: false, error: 'The file changed after the dry run. Run the dry run again.' };
    // Re-check against the database as it is now, not as it was at the dry run.
    const report = await buildReport(text);
    if (!report.ok) return { ok: false, error: 'The dry run now finds problems (the data in Desk changed). Run it again.' };
    const rows = report.rows.filter((r) => r.status === 'ok' && r.data).map((r) => r.data);
    const result = check(await db.rpc('import_pipeline', { p_batch_id: batch_id, p_rows: rows })) as {
      leads: number;
      skipped: number;
      consents: number;
    };
    revalidatePath('/pipeline');
    revalidatePath('/');
    return {
      ok: true,
      message: `Imported ${result.leads} lead${result.leads === 1 ? '' : 's'} and ${result.consents} consent record${result.consents === 1 ? '' : 's'}. Skipped ${result.skipped + report.counts.skip}.`,
      data: result,
    };
  });
}
