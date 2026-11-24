'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { check, fields, formObject, run, type ActionResult } from '@/lib/actions';
import { requireCapability } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { parseRandToCents } from '@/lib/format';
import { BILLING_CYCLES, PLATFORM_STATUSES, loginLocationSchema } from './logic';

const platformSchema = z.object({
  id: fields.uuid.optional(),
  name: fields.requiredText(100, 'Name'),
  purpose: fields.optionalText(300),
  url: z.url('Use a full address starting with https://').regex(/^https:\/\//, 'Use https://').max(500).optional(),
  monthly_cost: z.string().max(30).optional(),
  billing_cycle: z.enum(Object.keys(BILLING_CYCLES) as [keyof typeof BILLING_CYCLES]),
  renewal_date: fields.isoDate.optional(),
  auto_advance: z.enum(['on']).optional(),
  login_location: loginLocationSchema.optional(),
  owner_email: z.email().max(200).optional(),
  status: z.enum(Object.keys(PLATFORM_STATUSES) as [keyof typeof PLATFORM_STATUSES]),
  notes: fields.optionalText(2000),
});

export async function savePlatformAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const result = await run(async () => {
    await requireCapability('platforms.write');
    const input = platformSchema.parse(formObject(fd));
    let cents: number | null = null;
    if (input.monthly_cost) {
      cents = parseRandToCents(input.monthly_cost);
      if (cents === null || cents < 0) return { ok: false, error: 'Monthly cost must be an amount in rand, like 450 or 1 299.99.' };
    }
    const row = {
      name: input.name,
      purpose: input.purpose ?? null,
      url: input.url ?? null,
      monthly_cost_cents: cents,
      billing_cycle: input.billing_cycle,
      renewal_date: input.renewal_date ?? null,
      auto_advance: input.auto_advance === 'on',
      login_location: input.login_location ?? null,
      owner_email: input.owner_email?.toLowerCase() ?? null,
      status: input.status,
      notes: input.notes ?? null,
    };
    const db = await userDb({ source: 'manual' });
    if (input.id) check(await db.from('platforms').update(row).eq('id', input.id));
    else check(await db.from('platforms').insert(row));
    revalidatePath('/platforms');
    revalidatePath('/');
    return { ok: true };
  });
  if (!result.ok) return result;
  redirect('/platforms?notice=saved');
}
