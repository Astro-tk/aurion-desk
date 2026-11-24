import Link from 'next/link';
import { Card } from '@/components/ui';
import { memberCan } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { todaySast } from '@/lib/format';
import { tasksDueBy } from './queries';
import { TaskItem } from './TaskItem';

export default async function BlueprintHomeCard() {
  const today = todaySast();
  const [tasks, canWrite] = await Promise.all([tasksDueBy(await userDb(), today, 12), memberCan('blueprint.write')]);
  return (
    <Card title="Today's blueprint tasks" action={<Link href="/blueprint?view=today" className="text-xs underline">Blueprint</Link>}>
      {tasks.length === 0 ? (
        <p className="text-sm text-ink-3">Nothing due today and nothing overdue.</p>
      ) : (
        <ul className="divide-y divide-line">
          {tasks.map((t) => (
            <TaskItem key={t.id} task={t} canWrite={canWrite} today={today} />
          ))}
        </ul>
      )}
    </Card>
  );
}
