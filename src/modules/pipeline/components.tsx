import Link from 'next/link';
import { channelLabel, labelOf, type Lists } from '@/lib/lists';
import { formatDate } from '@/lib/format';
import type { LeadOverview } from './queries';

export function ConsentChip({ status }: { status: LeadOverview['consent_status'] }) {
  if (status === 'no') return <span className="chip-danger">Said no</span>;
  if (status === 'yes') return <span className="chip">Consent yes</span>;
  if (status === 'asked') return <span className="chip">Asked</span>;
  return null;
}

export function AiDraftChip() {
  return <span className="chip-warn">AI draft</span>;
}

export function leadTitle(l: Pick<LeadOverview, 'full_name' | 'organisation_name' | 'email' | 'forgotten_at'>): string {
  if (l.forgotten_at) return 'Deleted contact';
  return l.full_name || l.organisation_name || l.email || 'Unnamed lead';
}

export function NextDate({ lead }: { lead: Pick<LeadOverview, 'next_date' | 'is_overdue'> }) {
  if (!lead.next_date) return <span className="text-ink-3">None</span>;
  return <span className={`num ${lead.is_overdue ? 'font-semibold text-danger' : ''}`}>{formatDate(lead.next_date)}{lead.is_overdue ? ' (overdue)' : ''}</span>;
}

export function LeadTable({ leads, lists }: { leads: LeadOverview[]; lists: Lists }) {
  return (
    <div className="card max-h-[70dvh] overflow-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Lead</th>
            <th>Stage</th>
            <th>Next</th>
            <th>Next date</th>
            <th className="hidden md:table-cell">Channel</th>
            <th className="hidden lg:table-cell">Source</th>
            <th className="hidden lg:table-cell">First contact</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id} className={l.is_overdue ? 'bg-danger-bg/40' : ''}>
              <td className="min-w-40">
                <Link href={`/pipeline/${l.id}`} className="font-medium underline-offset-2 hover:underline">
                  {leadTitle(l)}
                </Link>
                <div className="text-xs text-ink-3">{[l.full_name ? l.organisation_name : null, l.town].filter(Boolean).join(', ')}</div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  <ConsentChip status={l.consent_status} />
                  {l.score !== null ? <span className="chip num">Score {l.score}</span> : null}
                </div>
              </td>
              <td className="whitespace-nowrap">{labelOf(lists.stages, l.stage_key)}</td>
              <td className="min-w-40 text-ink-2">{l.next_action}</td>
              <td>
                <NextDate lead={l} />
              </td>
              <td className="hidden whitespace-nowrap md:table-cell">{channelLabel(lists.channels, l.channel_key)}</td>
              <td className="hidden whitespace-nowrap lg:table-cell">{labelOf(lists.sources, l.source_key)}</td>
              <td className="hidden lg:table-cell">
                <span className="num">{formatDate(l.first_contact_date)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
