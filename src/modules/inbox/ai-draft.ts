import 'server-only';
import type { AIProvider } from '@/integrations/types';
import type { DeskClient } from '@/lib/db/server';
import { recordEvent } from '@/lib/events';
import type { InboxItem } from './queries';

/**
 * The one AI feature in Phase 1. Writes a 2-line summary and a suggested next action onto the
 * lead, marked "AI draft". Never overwrites anything you wrote yourself. Any failure is logged
 * and swallowed: the accept has already succeeded.
 */
export async function draftLeadSummary(db: DeskClient, ai: AIProvider, item: InboxItem, leadId: string): Promise<'drafted' | 'skipped' | 'failed'> {
  if (!ai.isConfigured()) return 'skipped';
  try {
    const { data: lead } = await db.from('leads').select('summary, next_action, summary_is_ai_draft, next_action_is_ai_draft').eq('id', leadId).single();
    const result = await ai.summariseLead({
      source: item.source,
      name: item.name,
      company: item.company,
      message: item.message,
      need: item.need,
      offer: item.offer,
      score: item.score,
      scoreReason: item.score_reason,
    });
    if (!result) return 'failed';
    const patch: Record<string, unknown> = { ai_model: result.model };
    if (!lead?.summary || lead.summary_is_ai_draft) Object.assign(patch, { summary: result.summary, summary_is_ai_draft: true });
    if (!lead?.next_action || lead.next_action_is_ai_draft) Object.assign(patch, { next_action: result.nextAction, next_action_is_ai_draft: true });
    const { error } = await db.from('leads').update(patch).eq('id', leadId);
    if (error) throw new Error(error.message);
    await recordEvent(db, { type: 'ai_draft_created', source: 'system', subjectType: 'lead', subjectId: leadId, payload: { model: result.model } });
    return 'drafted';
  } catch (err) {
    console.error('AI draft failed (accept still succeeded):', (err as Error).message);
    return 'failed';
  }
}
