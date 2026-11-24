'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { check, fields, formObject, run, type ActionResult } from '@/lib/actions';
import { passwordSchema } from '@/lib/auth/password';
import { requireCapability } from '@/lib/auth/session';
import { identifierHash } from '@/lib/crypto';
import { userDb } from '@/lib/db/server';
import { env } from '@/lib/env';
import { parseRandToCents } from '@/lib/format';
import { EDITABLE_LISTS, type EditableList } from '@/lib/lists';
import { slugify } from '@/modules/blueprint/parser';
import { auditAuth } from '@/lib/audit';

const listName = z.enum(Object.keys(EDITABLE_LISTS) as [EditableList, ...EditableList[]]);

// ---------------------------------------------------------------- lists

export async function addListItemAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await requireCapability('settings.write');
    const input = z.object({ list: listName, label: fields.requiredText(80, 'Label') }).parse(formObject(fd));
    const key = slugify(input.label).replace(/-/g, '_').replace(/^(\d)/, 'n$1').slice(0, 40);
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) return { ok: false, error: 'Use a label with at least two letters.' };
    const db = await userDb();
    const { data: max } = await db.from(input.list).select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
    const row: Record<string, unknown> = { key, label: input.label, sort_order: Number((max as { sort_order?: number } | null)?.sort_order ?? 0) + 1 };
    check(await db.from(input.list).insert(row));
    revalidatePath('/settings');
    return { ok: true, message: `Added "${input.label}".` };
  });
}

export async function updateListItemAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await requireCapability('settings.write');
    const input = z
      .object({ list: listName, key: fields.key, label: fields.requiredText(80, 'Label'), sort_order: z.coerce.number().int().min(0).max(999), active: z.enum(['on']).optional() })
      .parse(formObject(fd));
    const db = await userDb();
    // Keys never change, so history keeps its meaning; rows are switched off, never deleted.
    check(await db.from(input.list).update({ label: input.label, sort_order: input.sort_order, active: input.active === 'on' }).eq('key', input.key));
    revalidatePath('/settings');
    return { ok: true, message: 'Saved.' };
  });
}

// ---------------------------------------------------------------- targets

export async function updateTargetAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await requireCapability('settings.write');
    const input = z
      .object({
        id: fields.uuid,
        label: fields.requiredText(120, 'Label'),
        target: z.string().max(30).optional(),
        cap: z.string().max(30).optional(),
        active: z.enum(['on']).optional(),
      })
      .parse(formObject(fd));
    const db = await userDb();
    const t = check(await db.from('targets').select('unit').eq('id', input.id).single()) as { unit: string };
    const patch: Record<string, unknown> = { label: input.label, active: input.active === 'on' };
    if (t.unit === 'cents') {
      const c = input.target ? parseRandToCents(input.target) : null;
      if (input.target && c === null) return { ok: false, error: 'Target must be an amount in rand.' };
      patch.target_cents = c;
    } else {
      const n = input.target ? Number(input.target) : null;
      const cap = input.cap ? Number(input.cap) : null;
      if ((n !== null && !Number.isFinite(n)) || (cap !== null && !Number.isFinite(cap))) return { ok: false, error: 'Targets must be numbers.' };
      patch.target_value = n;
      patch.cap_value = cap;
    }
    check(await db.from('targets').update(patch).eq('id', input.id));
    revalidatePath('/settings');
    revalidatePath('/scorecard');
    return { ok: true, message: 'Target saved.' };
  });
}

const newTargetSchema = z.object({
  kind: z.enum(['weekly', 'channel']),
  label: fields.requiredText(120, 'Label'),
  channel_key: fields.key.optional(),
  period_start: fields.isoDate,
  period_end: fields.isoDate.optional(),
  unit: z.enum(['count', 'hours', 'milestone']),
  target: z.coerce.number().min(0).max(100000).optional(),
  count_source: z.enum(['manual', 'leads']),
});

export async function addTargetAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await requireCapability('settings.write');
    const input = newTargetSchema.parse(formObject(fd));
    if (input.kind === 'channel' && !input.channel_key) return { ok: false, error: 'Choose a channel.' };
    const db = await userDb();
    check(
      await db.from('targets').insert({
        kind: input.kind,
        metric_key: slugify(input.label).replace(/-/g, '_').replace(/^(\d)/, 'n$1').slice(0, 60) || 'metric',
        label: input.label,
        channel_key: input.kind === 'channel' ? input.channel_key : null,
        period_start: input.period_start,
        period_end: input.period_end ?? null,
        unit: input.unit,
        target_value: input.target ?? null,
        count_source: input.kind === 'weekly' ? 'manual' : input.count_source,
        sort_order: 100,
      }),
    );
    revalidatePath('/settings');
    revalidatePath('/scorecard');
    return { ok: true, message: 'Target added.' };
  });
}

// ---------------------------------------------------------------- profile and password

export async function updateProfileAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const member = await requireCapability('settings.write');
    const { display_name } = z.object({ display_name: fields.requiredText(80, 'Name') }).parse(formObject(fd));
    const db = await userDb();
    check(await db.from('members').update({ display_name }).eq('user_id', member.userId));
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Saved.' };
  });
}

export async function changePasswordAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const member = await requireCapability('settings.write');
    const pw = String(fd.get('password') ?? '');
    const again = String(fd.get('password_again') ?? '');
    const parsed = passwordSchema(member.email).safeParse(pw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
    if (pw !== again) return { ok: false, error: 'The two passwords do not match.' };
    const db = await userDb();
    const { error } = await db.auth.updateUser({ password: pw });
    if (error) return { ok: false, error: 'Supabase did not accept the new password. If it asks you to sign in again first, do that and retry.' };
    await auditAuth('password_changed', member.userId, {});
    return { ok: true, message: 'Password changed.' };
  });
}

// ---------------------------------------------------------------- two-factor management

export async function startBackupFactorAction(): Promise<{ factorId?: string; qr?: string; secret?: string; error?: string }> {
  try {
    await requireCapability('settings.write');
  } catch {
    return { error: 'You do not have permission to do that.' };
  }
  const db = await userDb();
  const { data: factors } = await db.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) if (f.status === 'unverified') await db.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Backup ${new Date().toISOString().slice(0, 16)}` });
  if (error || !data) return { error: 'Could not start. Try again.' };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyBackupFactorAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const member = await requireCapability('settings.write');
    const input = z.object({ factorId: fields.uuid, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }).parse({
      factorId: fd.get('factorId'),
      code: String(fd.get('code') ?? '').replace(/\s/g, ''),
    });
    const db = await userDb();
    const { error } = await db.auth.mfa.challengeAndVerify({ factorId: input.factorId, code: input.code });
    if (error) return { ok: false, error: 'That code did not work. Try the current one.' };
    await auditAuth('mfa_enrolled', member.userId, { what: 'backup_factor' });
    revalidatePath('/settings');
    return { ok: true, message: 'Backup authenticator added.' };
  });
}

export async function removeFactorAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const member = await requireCapability('settings.write');
    const { factorId } = z.object({ factorId: fields.uuid }).parse(formObject(fd));
    const db = await userDb();
    const { data } = await db.auth.mfa.listFactors();
    const verified = (data?.totp ?? []).filter((f) => f.status === 'verified');
    if (verified.length <= 1) return { ok: false, error: 'You need at least one authenticator. Add a backup first, then remove this one.' };
    const { error } = await db.auth.mfa.unenroll({ factorId });
    if (error) return { ok: false, error: 'Could not remove it. Try again.' };
    await auditAuth('mfa_removed', member.userId, {});
    revalidatePath('/settings');
    return { ok: true, message: 'Removed.' };
  });
}

// ---------------------------------------------------------------- danger zone: POPIA delete

export async function forgetContactAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await requireCapability('contacts.forget');
    const input = z.object({ contact_id: fields.uuid, confirm: z.string() }).parse(formObject(fd));
    if (input.confirm !== 'DELETE') return { ok: false, error: 'Type DELETE in capitals to confirm.' };
    const db = await userDb({ source: 'manual' });
    const c = check(await db.from('contacts').select('email, phone_e164, forgotten_at').eq('id', input.contact_id).single()) as {
      email: string | null;
      phone_e164: string | null;
      forgotten_at: string | null;
    };
    if (c.forgotten_at) return { ok: false, error: 'This person was already deleted.' };
    const pepper = env().HASH_PEPPER;
    check(
      await db.rpc('forget_contact', {
        p_contact_id: input.contact_id,
        p_email_hash: c.email ? identifierHash(pepper, 'email', c.email) : null,
        p_phone_hash: c.phone_e164 ? identifierHash(pepper, 'phone', c.phone_e164) : null,
      }),
    );
    revalidatePath('/settings');
    revalidatePath('/pipeline');
    return { ok: true, message: 'Personal data deleted. An anonymous record of the deletion stays in the audit log.' };
  });
}
