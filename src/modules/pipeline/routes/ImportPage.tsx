import { PageHeader } from '@/components/ui';
import { requireMember } from '@/lib/auth/session';
import { importCommitAction, importDryRunAction } from '../actions';
import { TRACKER_COLUMNS } from '../csv-import';
import { ImportWizard } from '../ImportWizard';

export default async function ImportPage() {
  await requireMember();
  return (
    <>
      <PageHeader title="Import the tracker" subtitle="From Google Sheets: File, Download, Comma-separated values (.csv)." />
      <details className="card mb-4 p-3 text-sm text-ink-2">
        <summary className="cursor-pointer font-medium text-ink">What the file needs</summary>
        <p className="mt-2">A header row with these 16 columns, in any order:</p>
        <p className="mt-1 font-mono text-xs">{TRACKER_COLUMNS.join(', ')}</p>
        <p className="mt-2">
          Type, Source and Channel must match your lists in Settings. Stage must be one of the eight stages. Consent can be Not asked, Asked, Yes or
          No (never contact). Dates can be 2026-12-01 or 01/12/2026. People already in Desk (same email) are skipped, never overwritten.
        </p>
      </details>
      <ImportWizard dryRun={importDryRunAction} commit={importCommitAction} />
    </>
  );
}
