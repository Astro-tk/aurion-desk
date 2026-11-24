import { addDays, formatDate } from '@/lib/format';
import type { DigestProvider, DigestSection } from '../types';

interface Row {
  id: string;
  full_name: string | null;
  organisation_name: string | null;
  next_action: string | null;
  next_date: string | null;
  score: number | null;
  stage_key: string;
  do_not_contact: boolean;
}

const name = (r: Row) => r.full_name || r.organisation_name || 'Unnamed lead';
const PROMISING_STAGES = ['checker_used', 'audit_booked', 'audit_done', 'proposal_sent'];

/** Pipeline sections of the 18:00 digest: promising leads, follow-ups due tomorrow, overdue. */
const provider: DigestProvider = async ({ date, db, appUrl }) => {
  const tomorrow = addDays(date, 1);
  const weekEnd = addDays(date, 7);
  const sel = 'id, full_name, organisation_name, next_action, next_date, score, stage_key, do_not_contact';
  const [promising, dueTomorrow, overdue] = await Promise.all([
    db
      .from('lead_overview')
      .select(sel)
      .is('archived_at', null)
      .eq('do_not_contact', false)
      .or(`score.gte.4,and(stage_key.in.(${PROMISING_STAGES.join(',')}),next_date.lte.${weekEnd})`)
      .order('score', { ascending: false, nullsFirst: false })
      .limit(10),
    db.from('lead_overview').select(sel).is('archived_at', null).eq('next_date', tomorrow).limit(25),
    db.from('lead_overview').select(sel).is('archived_at', null).lt('next_date', date).eq('is_overdue', true).order('next_date').limit(25),
  ]);
  const link = (id: string) => `${appUrl}/pipeline/${id}`;
  const sections: DigestSection[] = [
    {
      key: 'promising',
      title: 'Promising leads',
      lines: ((promising.data ?? []) as Row[]).map((r) => ({
        text: `${name(r)}${r.score !== null ? `, score ${r.score}` : ''}${r.next_action ? `: ${r.next_action}` : ''}`,
        href: link(r.id),
      })),
    },
    {
      key: 'due_tomorrow',
      title: `Follow-ups due tomorrow (${formatDate(tomorrow)})`,
      lines: ((dueTomorrow.data ?? []) as Row[]).map((r) => ({
        text: `${name(r)}${r.next_action ? `: ${r.next_action}` : ''}${r.do_not_contact ? ' (said no: do not contact)' : ''}`,
        href: link(r.id),
      })),
    },
    {
      key: 'overdue',
      title: 'Overdue',
      lines: ((overdue.data ?? []) as Row[]).map((r) => ({
        text: `${name(r)}, due ${formatDate(r.next_date)}${r.next_action ? `: ${r.next_action}` : ''}`,
        href: link(r.id),
      })),
    },
  ];
  return sections;
};

export default provider;
