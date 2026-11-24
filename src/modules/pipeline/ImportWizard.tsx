'use client';

import { useActionState } from 'react';
import type { ClientActionResult } from '@/components/forms';
import type { DryRunReport } from './csv-import';

type DryRunData = { batchId: string | null; report: DryRunReport; text: string; filename: string };
type DryRunResult = ClientActionResult & { data?: DryRunData };

export function ImportWizard({
  dryRun,
  commit,
}: {
  dryRun: (prev: ClientActionResult, fd: FormData) => Promise<ClientActionResult>;
  commit: (prev: ClientActionResult, fd: FormData) => Promise<ClientActionResult>;
}) {
  const [checked, runDry, checking] = useActionState<DryRunResult, FormData>(dryRun as (p: DryRunResult, fd: FormData) => Promise<DryRunResult>, { ok: true });
  const [done, runCommit, committing] = useActionState<ClientActionResult, FormData>(commit, { ok: true });
  const data = checked.ok ? checked.data : undefined;
  const report = data?.report;
  const committed = done.ok && Boolean(done.message);

  return (
    <div className="space-y-4">
      <form action={runDry} className="card space-y-3 p-3">
        <h2 className="text-sm font-semibold">1. Dry run</h2>
        <p className="text-sm text-ink-2">Choose the tracker CSV. Desk checks every row and lists every problem. Nothing is saved at this step.</p>
        <input className="input" type="file" name="file" accept=".csv,text/csv" required aria-label="Tracker CSV file" />
        <button className="btn-primary" disabled={checking}>
          {checking ? 'Checking' : 'Check the file'}
        </button>
        {!checked.ok ? (
          <p role="alert" className="text-sm text-danger">
            {checked.error}
          </p>
        ) : null}
      </form>

      {report ? (
        <section className="card p-3" aria-label="Dry run report">
          <h2 className="mb-2 text-sm font-semibold">Report for {data?.filename}</h2>
          <ul className="mb-3 flex flex-wrap gap-2 text-sm">
            <li className="chip num">{report.counts.total} rows</li>
            <li className="chip-accent num">{report.counts.ok} ready</li>
            <li className="chip num">{report.counts.skip} skipped</li>
            <li className={`${report.counts.error ? 'chip-danger' : 'chip'} num`}>{report.counts.error} with errors</li>
            <li className="chip num">{report.counts.warnings} warnings</li>
          </ul>
          {report.fileProblems.map((p) => (
            <p key={p.code} className={`mb-2 text-sm ${p.level === 'error' ? 'text-danger' : 'text-warn'}`}>
              {p.message}
            </p>
          ))}
          {report.rows.some((r) => r.problems.length) ? (
            <div className="max-h-96 overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Who</th>
                    <th>Result</th>
                    <th>Problems</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows
                    .filter((r) => r.problems.length > 0)
                    .map((r) => (
                      <tr key={r.row}>
                        <td className="num">{r.row}</td>
                        <td>{r.label}</td>
                        <td>{r.status === 'error' ? <span className="chip-danger">Error</span> : r.status === 'skip' ? <span className="chip">Skip</span> : <span className="chip">Warning</span>}</td>
                        <td>
                          <ul className="space-y-0.5 text-xs">
                            {r.problems.map((p, i) => (
                              <li key={i} className={p.level === 'error' ? 'text-danger' : 'text-ink-2'}>
                                <strong>{p.column}:</strong> {p.message}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : report.counts.total > 0 ? (
            <p className="text-sm text-ink-2">No problems found.</p>
          ) : null}
        </section>
      ) : null}

      {report && data?.batchId ? (
        <form action={runCommit} className="card space-y-3 p-3">
          <h2 className="text-sm font-semibold">2. Import</h2>
          {report.ok ? (
            <p className="text-sm text-ink-2">
              {report.counts.ok} lead{report.counts.ok === 1 ? '' : 's'} will be added, with their consent records (evidence: import). Rows marked Skip are left out.
            </p>
          ) : (
            <p className="text-sm text-danger">Fix the errors in your spreadsheet, export it again and run the dry run again. Nothing is imported while any row has an error.</p>
          )}
          <input type="hidden" name="batch_id" value={data.batchId} />
          <input type="hidden" name="text" value={data.text} />
          <button className="btn-primary" disabled={!report.ok || committing || committed}>
            {committing ? 'Importing' : committed ? 'Imported' : `Import ${report.counts.ok} lead${report.counts.ok === 1 ? '' : 's'}`}
          </button>
          {!done.ok ? (
            <p role="alert" className="text-sm text-danger">
              {done.error}
            </p>
          ) : done.message ? (
            <p role="status" className="text-sm">
              {done.message} <a href="/pipeline" className="underline">Open the Pipeline</a>
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
