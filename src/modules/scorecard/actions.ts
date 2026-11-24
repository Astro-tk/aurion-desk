'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { check, fields, run, type ActionResult } from '@/lib/actions';
import { requireCapability } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { recordEvent } from '@/lib/events';
import { parseRandToCents } from '@/lib/format';

/**
 * Saves the Sunday entries for one period. Inputs are named "v_<target id>". A blank input
 * leaves that metric as it was; "0" is a real zero.
 */
export async function saveEntriesAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const member = await requireCapability('scorecard.write');
    const period = fields.isoDate.parse(fd.get('period_start'));
    const db = await userDb({ source: 'manual' });
    const ids = [...fd.keys()].filter((k) => k.startsWith('v_')).map((k) => k.slice(2));
    if (ids.length === 0) return { ok: false, error: 'Nothing to save.' };
    z.array(fields.uuid).parse(ids);
    const { data: targets } = await db.from('targets').select('id, unit, count_source').in('id', ids);
    const rows: Array<Record<string, unknown>> = [];
    const problems: Record<string, string> = {};
    for (const t of (targets ?? []) as Array<{ id: string; unit: string; count_source: string }>) {
      if (t.count_source !== 'manual') continue;
      const raw = String(fd.get(`v_${t.id}`) ?? '').trim();
      if (raw === '') continue;
      if (t.unit === 'cents') {
        const cents = parseRandToCents(raw);
        if (cents === null || cents < 0) problems[t.id] = `"${raw}" is not an amount in rand.`;
        else rows.push({ target_id: t.id, period_start: period, value_cents: cents, value: null, entered_by: member.userId });
      } else {
        const n = Number(raw.replace(',', '.'));
        if (!Number.isFinite(n) || n < 0 || n > 100000) problems[t.id] = `"${raw}" is not a number.`;
        else rows.push({ target_id: t.id, period_start: period, value: n, value_cents: null, entered_by: member.userId });
      }
    }
    if (Object.keys(problems).length) return { ok: false, error: 'Some numbers could not be read.', fieldErrors: problems };
    if (rows.length === 0) return { ok: true, message: 'Nothing changed.' };
    check(await db.from('scorecard_entries').upsert(rows, { onConflict: 'target_id,period_start' }));
    await recordEvent(db, { type: 'scorecard_entered', source: 'manual', actorId: member.userId, subjectType: 'scorecard_period', subjectId: period, payload: { metrics: rows.length } });
    revalidatePath('/scorecard');
    revalidatePath('/');
    return { ok: true, message: `Saved ${rows.length} number${rows.length === 1 ? '' : 's'}.` };
  });
}
