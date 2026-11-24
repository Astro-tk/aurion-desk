import Link from 'next/link';
import { ActionForm, Field } from '@/components/forms';
import { Markdown } from '@/components/Markdown';
import { EmptyState, PageHeader, ProgressBar } from '@/components/ui';
import { memberCan, requireMember } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { formatDate, formatDateWithWeekday, todaySast } from '@/lib/format';
import { addTaskAction } from '../actions';
import { loadBlueprint, type SectionRow, type TaskRow } from '../queries';
import { TaskItem } from '../TaskItem';

function progress(tasks: TaskRow[]) {
  const done = tasks.filter((t) => t.done_at).length;
  return { done, total: tasks.length, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
}

export default async function BlueprintPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireMember();
  const sp = await searchParams;
  const view = sp.view === 'today' ? 'today' : 'all';
  const db = await userDb();
  const [{ doc, sections, tasks }, canWrite, canImport] = await Promise.all([loadBlueprint(db), memberCan('blueprint.write'), memberCan('blueprint.import')]);
  const today = todaySast();

  if (!doc && tasks.length === 0) {
    return (
      <>
        <PageHeader title="Blueprint" />
        <EmptyState sentence="No blueprint imported yet." actionLabel={canImport ? 'Import blueprint.md' : undefined} actionHref="/blueprint/import" />
      </>
    );
  }

  const blueprintTasks = tasks.filter((t) => t.kind === 'blueprint');
  const adhoc = tasks.filter((t) => t.kind === 'adhoc');
  const overall = progress(blueprintTasks);
  const topLevel = sections.filter((s) => s.level === 2);
  const childrenOf = (s: SectionRow) => sections.filter((c) => c.parent_id === s.id);
  const tasksIn = (ids: string[]) => blueprintTasks.filter((t) => t.section_id && ids.includes(t.section_id));
  const todayTasks = tasks.filter((t) => t.due_date !== null && (t.due_date === today || (t.due_date < today && !t.done_at)));

  return (
    <>
      <PageHeader
        title="Blueprint"
        subtitle={doc ? `${doc.title}. Version ${doc.version}${doc.doc_date ? `, dated ${formatDate(doc.doc_date)}` : ''}.` : undefined}
        actions={
          canImport ? (
            <Link href="/blueprint/import" className="btn">
              Re-import
            </Link>
          ) : null
        }
      />

      <section className="card mb-3 p-3" aria-label="Overall progress">
        <div className="mb-1 flex items-baseline justify-between text-sm">
          <span className="font-medium">Overall</span>
          <span className="num text-ink-2">
            {overall.done} of {overall.total} ({overall.pct}%)
          </span>
        </div>
        <ProgressBar value={overall.done} max={overall.total} label={`${overall.pct}% of blueprint tasks done`} />
      </section>

      <nav className="mb-3 flex gap-2" aria-label="Blueprint view">
        <Link href="/blueprint" className={view === 'all' ? 'chip-accent' : 'chip'}>
          All sections
        </Link>
        <Link href="/blueprint?view=today" className={view === 'today' ? 'chip-accent' : 'chip'}>
          Today
        </Link>
      </nav>

      {view === 'today' ? (
        <section className="card p-3">
          <h2 className="mb-2 text-sm font-semibold">{formatDateWithWeekday(today)}</h2>
          {todayTasks.length === 0 ? (
            <p className="text-sm text-ink-3">Nothing due today and nothing overdue.</p>
          ) : (
            <ul className="divide-y divide-line">
              {todayTasks.map((t) => (
                <TaskItem key={t.id} task={t} canWrite={canWrite} today={today} showRef />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <div className="space-y-2">
          {topLevel.map((s) => {
            const kids = childrenOf(s);
            const p = progress(tasksIn([s.id, ...kids.map((k) => k.id)]));
            return (
              <details key={s.id} className="card" open={sp.open === s.key}>
                <summary className="flex cursor-pointer list-none flex-col gap-1 p-3">
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">
                      {s.number ? `${s.number}. ` : ''}
                      {s.title}
                    </span>
                    {p.total ? (
                      <span className="num shrink-0 text-xs text-ink-2">
                        {p.done}/{p.total}
                      </span>
                    ) : null}
                  </span>
                  {p.total ? <ProgressBar value={p.done} max={p.total} label={`${s.title}: ${p.pct}%`} /> : null}
                </summary>
                <div className="border-t border-line p-3">
                  <Markdown source={s.body_markdown} />
                  <SectionTasks tasks={tasksIn([s.id])} canWrite={canWrite} today={today} />
                  {kids.map((k) => {
                    const kp = progress(tasksIn([k.id]));
                    return (
                      <div key={k.id} className="mt-4">
                        <h3 className="flex items-baseline justify-between text-sm font-semibold">
                          <span>{k.title}</span>
                          {kp.total ? <span className="num text-xs font-normal text-ink-3">{kp.done}/{kp.total}</span> : null}
                        </h3>
                        <Markdown source={k.body_markdown} />
                        <SectionTasks tasks={tasksIn([k.id])} canWrite={canWrite} today={today} />
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      )}

      <section className="card mt-4 p-3">
        <h2 className="mb-2 text-sm font-semibold">Ad hoc tasks</h2>
        {adhoc.length ? (
          <ul className="mb-3 divide-y divide-line">
            {adhoc.map((t) => (
              <TaskItem key={t.id} task={t} canWrite={canWrite} today={today} />
            ))}
          </ul>
        ) : null}
        {canWrite ? (
          <ActionForm action={addTaskAction} submitLabel="Add task" resetOnSuccess className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end" submitClass="btn">
            <Field label="Task" htmlFor="adhoc_title">
              <input className="input" id="adhoc_title" name="title" required />
            </Field>
            <Field label="Due" htmlFor="adhoc_due">
              <input className="input" id="adhoc_due" name="due_date" type="date" />
            </Field>
          </ActionForm>
        ) : null}
      </section>
    </>
  );
}

function SectionTasks({ tasks, canWrite, today }: { tasks: TaskRow[]; canWrite: boolean; today: string }) {
  if (tasks.length === 0) return null;
  return (
    <ul className="mt-2 divide-y divide-line">
      {tasks.map((t) => (
        <TaskItem key={t.id} task={t} canWrite={canWrite} today={today} />
      ))}
    </ul>
  );
}
