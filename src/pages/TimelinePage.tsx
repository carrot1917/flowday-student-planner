import { useMemo } from 'react';
import { Plus, Calendar } from 'lucide-react';
import { useFlow } from '@/store';
import { relativeDue, todayISO } from '@/lib/date';
import { deadlineBucket, type DeadlineBucket } from '@/lib/schedule';
import { formatEstimate } from '@/lib/domain';
import type { Course, Task } from '@/types';
import { Checkbox, CourseBadge, PriorityDot, StatusBadge, EmptyState } from '@/components/ui';

interface TimelinePageProps {
  onOpenTask: (t: Task) => void;
  onAddTaskOnDate: (date: string) => void;
}

// Order + visual identity for the five deadline groups.
const BUCKETS: { key: DeadlineBucket; label: string; dot: string }[] = [
  { key: 'overdue', label: '逾期', dot: '#f43f5e' },
  { key: 'today', label: '今天', dot: '#3494fb' },
  { key: 'tomorrow', label: '明天', dot: '#0ea5e9' },
  { key: 'thisWeek', label: '本周', dot: '#8b5cf6' },
  { key: 'later', label: '以后', dot: '#94a3b8' },
];

const TONE_CLASS: Record<string, string> = {
  overdue: 'text-rose-500',
  today: 'text-brand-600',
  soon: 'text-sky-500',
  later: 'text-ink-400',
};

export function TimelinePage({ onOpenTask, onAddTaskOnDate }: TimelinePageProps) {
  const { tasks, courseById, toggleDone, settings } = useFlow();

  const buckets = useMemo(() => {
    const groups: Record<DeadlineBucket, Task[]> = {
      overdue: [],
      today: [],
      tomorrow: [],
      thisWeek: [],
      later: [],
    };
    const today = todayISO();
    for (const t of tasks) {
      groups[deadlineBucket(t.dueDate, today, settings.startOfWeek)].push(t);
    }
    // Earliest deadline first within each group.
    (Object.keys(groups) as DeadlineBucket[]).forEach((k) =>
      groups[k].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    );
    return groups;
  }, [tasks, settings.startOfWeek]);

  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-ink-900">截止时间线</h1>
          <p className="text-xs text-ink-400">按截止日查看未来的学习任务</p>
        </div>
        <button
          onClick={() => onAddTaskOnDate(todayISO())}
          className="flex items-center gap-1 rounded-xl bg-brand-50 px-3 py-2 text-xs font-medium text-brand-600 hover:bg-brand-100"
        >
          <Plus className="h-3.5 w-3.5" /> 添加任务
        </button>
      </div>

      {tasks.length === 0 ? (
        <EmptyState icon={Calendar} title="还没有任务" hint="添加任务后，它们的截止日会在这里分组展示" />
      ) : (
        <div className="space-y-6">
          {BUCKETS.filter((b) => buckets[b.key].length > 0).map((b) => (
            <section key={b.key}>
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: b.dot }} />
                <h2 className="text-sm font-bold text-ink-700">{b.label}</h2>
                <span className="text-xs text-ink-400">{buckets[b.key].length}</span>
              </div>
              <div className="space-y-2">
                {buckets[b.key].map((t) => (
                  <DeadlineCard
                    key={t.id}
                    task={t}
                    course={t.courseId ? courseById.get(t.courseId) : undefined}
                    onToggle={() => toggleDone(t.id)}
                    onOpen={() => onOpenTask(t)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

interface DeadlineCardProps {
  task: Task;
  course: Course | undefined;
  onToggle: () => void;
  onOpen: () => void;
}

function DeadlineCard({ task, course, onToggle, onOpen }: DeadlineCardProps) {
  const done = task.status === 'done';
  const due = relativeDue(task.dueDate);
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-brand-50 bg-white px-4 py-3 transition hover:border-brand-200 hover:shadow-sm">
      <div className="mt-0.5" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={done} onChange={onToggle} />
      </div>
      <button onClick={onOpen} className="flex min-w-0 flex-1 flex-col gap-1.5 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className={`truncate text-sm font-semibold ${done ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
            {task.title}
          </span>
          <span className={`flex-shrink-0 text-[11px] font-medium ${TONE_CLASS[due.tone]}`}>{due.label}</span>
        </div>
        {task.description && <p className="truncate text-xs text-ink-400">{task.description}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <PriorityDot priority={task.priority} />
          <StatusBadge status={task.status} />
          <CourseBadge course={course} />
          {task.estimatedMinutes ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              {formatEstimate(task.estimatedMinutes)}
            </span>
          ) : null}
        </div>
      </button>
    </div>
  );
}
