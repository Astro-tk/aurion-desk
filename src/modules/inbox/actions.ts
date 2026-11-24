'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { anthropicProvider } from '@/integrations/anthropic';
import { check, fields, formObject, run, type ActionResult } from '@/lib/actions';
import { requireCapability } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { draftLeadSummary } from './ai-draft';
import type { InboxItem } from './queries';

const acceptSchema = z.object({
  id: fields.uuid,
  channel_key: fields.key.optional(),
  source_key: fields.key.optional(),
});

export async function acceptInboxAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let leadId: string | null = null;
  let aiOutcome: string = 'skipped';
  const result = await run(async () => {
    await requireCapability('inbox.decide');
    await requireCapability('pipeline.write');
    const input = acceptSchema.parse(formObject(fd));
    const db = await userDb({ source: 'manual' });
    const item = check(await db.from('inbox_items').select('*').eq('id', input.id).single()) as InboxItem;
    const accepted = check(
      await db.rpc('accept_inbox_item', { p_id: input.id, p_channel_key: input.channel_key ?? null, p_source_key: input.source_key ?? null }),
    ) as { lead_id: string; new_lead: boolean };
    leadId = accepted.lead_id;
    aiOutcome = await draftLeadSummary(db, anthropicProvider, item, accepted.lead_id);
    revalidatePath('/inbox');
    revalidatePath('/pipeline');
    revalidatePath('/');
    return { ok: true };
  });
  if (!result.ok || !leadId) return result;
  redirect(`/pipeline/${leadId}?notice=${aiOutcome === 'failed' ? 'accepted_no_ai' : 'accepted'}`);
}

const dismissSchema = z.object({ id: fields.uuid, reason: fields.requiredText(300, 'A reason') });

export async function dismissInboxAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const result = await run(async () => {
    await requireCapability('inbox.decide');
    const input = dismissSchema.parse(formObject(fd));
    const db = await userDb({ source: 'manual' });
    check(await db.rpc('dismiss_inbox_item', { p_id: input.id, p_reason: input.reason }));
    revalidatePath('/inbox');
    revalidatePath('/');
    return { ok: true };
  });
  if (!result.ok) return result;
  redirect('/inbox?notice=dismissed');
}
