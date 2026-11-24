'use client';

import { useActionState } from 'react';
import type { ClientActionResult } from '@/components/forms';
import type { PreviewData } from './actions';

type Preview = ClientActionResult & { data?: PreviewData };

export function ImportBlueprint({
  preview,
  apply,
}: {
  preview: (prev: ClientActionResult, fd: FormData) => Promise<ClientActionResult>;
  apply: (prev: ClientActionResult, fd: FormData) => Promise<ClientActionResult>;
}) {
  const [checked, runPreview, previewing] = useActionState<Preview, FormData>(preview as (p: Preview, fd: FormData) => Promise<Preview>, { ok: true });
  const [done, runApply, applying] = useActionState<ClientActionResult, FormData>(apply, { ok: true });
  const d = checked.ok ? checked.data : undefined;
  const applied = done.ok && Boolean(done.message);

  return (
    <div className="space-y-4">
      <form action={runPreview} className="card space-y-3 p-3">
        <h2 className="text-sm font-semibold">1. Choose blueprint.md</h2>
        <p className="text-sm text-ink-2">Desk reads it and shows exactly what would change. Nothing is saved at this step.</p>
        <input className="input" type="file" name="file" accept=".md,text/markdown,text/plain" required aria-label="Blueprint markdown file" />
        <button className="btn-primary" disabled={previewing}>
          {previewing ? 'Reading' : 'Show me the changes'}
        </button>
        {!checked.ok ? <p role="alert" className="text-sm text-danger">{checked.error}</p> : null}
      </form>

      {d ? (
        <section className="card space-y-3 p-3" aria-label="Import preview">
          <h2 className="text-sm font-semibold">{d.title}</h2>
          {d.problems.length ? (
            <ul className="list-disc pl-5 text-sm text-danger">
              {d.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <table className="data-table">
            <thead>
              <tr>
                <th>Section</th>
                <th className="text-right">Tasks</th>
                <th className="text-right">With a due date</th>
              </tr>
            </thead>
            <tbody>
              {d.counts.map((c) => (
                <tr key={c.key}>
                  <td>{c.title}</td>
                  <td className="num text-right">{c.tasks}</td>
                  <td className="num text-right">{c.dated}</td>
                </tr>
              ))}
              <tr>
                <td className="font-semibold">Total</td>
                <td className="num text-right font-semibold">{d.totalTasks}</td>
                <td className="num text-right font-semibold">{d.counts.reduce((n, c) => n + c.dated, 0)}</td>
              </tr>
            </tbody>
          </table>

          {d.firstImport ? (
            <p className="text-sm text-ink-2">First import: all {d.totalTasks} tasks will be added.</p>
          ) : (
            <div className="space-y-2 text-sm">
              <ul className="flex flex-wrap gap-2">
                <li className="chip num">{d.diff.unchanged} unchanged</li>
                <li className="chip-accent num">{d.diff.added.length} new</li>
                <li className="chip num">{d.diff.reworded.length} reworded</li>
                <li className="chip num">{d.diff.restored.length} back again</li>
                <li className={`${d.diff.removed.length ? 'chip-warn' : 'chip'} num`}>{d.diff.removed.length} removed</li>
                <li className="chip num">{d.diff.ticksKept} ticks kept</li>
              </ul>
              {d.diff.ticksLost ? (
                <p className="text-warn">{d.diff.ticksLost} ticked task(s) are no longer in the file. They stay in history but leave the list.</p>
              ) : null}
              <DiffList title="New tasks" items={d.diff.added.map((t) => t.title)} />
              <DiffList title="Reworded (tick kept)" items={d.diff.reworded.map((r) => `${r.from.title}  becomes  ${r.to.title}`)} />
              <DiffList title="Removed" items={d.diff.removed.map((t) => `${t.title}${t.doneAt ? ' (was ticked)' : ''}`)} />
              <DiffList title="New sections" items={d.diff.sectionsAdded} />
            </div>
          )}

          <form action={runApply} className="space-y-2 border-t border-line pt-3">
            <input type="hidden" name="text" value={d.text} />
            <input type="hidden" name="filename" value={d.filename} />
            <input type="hidden" name="expected_version" value={d.expectedVersion ?? ''} />
            <button className="btn-primary" disabled={applying || applied || d.problems.length > 0}>
              {applying ? 'Applying' : applied ? 'Applied' : '2. Apply these changes'}
            </button>
            {!done.ok ? <p role="alert" className="text-sm text-danger">{done.error}</p> : null}
            {done.ok && done.message ? (
              <p role="status" className="text-sm">
                {done.message} <a href="/blueprint" className="underline">Open the Blueprint</a>
              </p>
            ) : null}
          </form>
        </section>
      ) : null}
    </div>
  );
}

function DiffList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <details>
      <summary className="cursor-pointer font-medium">
        {title} ({items.length})
      </summary>
      <ul className="mt-1 max-h-64 list-disc overflow-auto pl-5 text-ink-2">
        {items.map((i, n) => (
          <li key={n}>{i}</li>
        ))}
      </ul>
    </details>
  );
}
