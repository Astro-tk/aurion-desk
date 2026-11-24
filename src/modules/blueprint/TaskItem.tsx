import { AppIcon } from '@/components/ui/AppIcon';
import { formatDate, formatDateTime } from '@/lib/format';
import { toggleTaskAction } from './actions';
import type { TaskRow } from './queries';

/** A tick box that works without JavaScript: a one-button form. Ticks persist with their date. */
export function TaskItem({ task, canWrite, today, showRef = false }: { task: TaskRow; canWrite: boolean; today: string; showRef?: boolean }) {
  const done = Boolean(task.done_at);
  const overdue = !done && task.due_date !== null && task.due_date < today;
  return (
    <li className="flex items-start gap-2 py-1.5">
      <form action={toggleTaskAction} className="shrink-0">
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="done" value={done ? '0' : '1'} />
        <button
          disabled={!canWrite}
          aria-label={done ? `Untick: ${task.title}` : `Tick: ${task.title}`}
          aria-pressed={done}
          className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded border ${done ? 'border-accent bg-accent text-accent-ink' : 'border-ink-3 hover:border-ink'}`}
        >
          {done ? <AppIcon name="check" size={14} /> : null}
        </button>
      </form>
      <div className="min-w-0 text-sm">
        <span className={done ? 'text-ink-3 line-through' : ''}>{task.title}</span>
        <div className="flex flex-wrap gap-x-2 text-xs text-ink-3">
          {task.due_date ? <span className={`num ${overdue ? 'font-semibold text-danger' : ''}`}>Due {formatDate(task.due_date)}</span> : null}
          {done ? <span className="num">Done {formatDateTime(task.done_at)}</span> : null}
          {showRef && (task.source_ref || task.section_label) ? <span>{task.source_ref ?? task.section_label}</span> : null}
        </div>
      </div>
    </li>
  );
}
