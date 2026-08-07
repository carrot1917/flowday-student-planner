import { useMemo, useState } from 'react';
import { Clock, Sunrise, Sun, Sunset, Moon, Plus } from 'lucide-react';
import { useFlow } from '@/store';
import { todayISO, toISO, addDays } from '@/lib/date';
import type { Task } from '@/types';
import { Checkbox, PriorityDot, TagBadge } from '@/components/ui';

interface TimelinePageProps {
  onOpenTask: (t: Task) => void;
  onAddTaskOnDate: (date: string) => void;
}

function periodFor(hour: number): { icon: React.ComponentType<{ className?: string }>; label: string; tint: string } {
  if (hour < 6) return { icon: Moon, label: '深夜', tint: 'text-indigo-400' };
  if (hour < 12) return { icon: Sunrise, label: '上午', tint: 'text-amber-400' };
  if (hour < 14) return { icon: Sun, label: '中午', tint: 'text-orange-400' };
  if (hour < 18) return { icon: Sun, label: '下午', tint: 'text-brand-400' };
  if (hour < 22) return { icon: Sunset, label: '傍晚', tint: 'text-rose-400' };
  return { icon: Moon, label: '夜晚', tint: 'text-indigo-400' };
}

export function TimelinePage({ onOpenTask, onAddTaskOnDate }: TimelinePageProps) {
  const { tasks, toggleDone } = useFlow();
  const [date, setDate] = useState<string>(todayISO());

  const dayTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.dueDate === date)
        .sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99')),
    [tasks, date],
  );

  const scheduled = dayTasks.filter((t) => t.startTime);
  const unscheduled = dayTasks.filter((t) => !t.startTime);

  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => toISO(addDays(new Date(), i - 1))), []);

  return (
    <div className="animate-fade-in space-y-5">
      {/* Date selector */}
      <div className="flex flex-wrap items-center gap-2">
        {dates.map((d) => {
          const dt = new Date(d);
          const isToday = d === todayISO();
          const isActive = d === date;
          return (
            <button
              key={d}
              onClick={() => setDate(d)}
              className={`flex flex-col items-center rounded-xl border px-3 py-2 transition ${
                isActive
                  ? 'border-brand-400 bg-brand-500 text-white'
                  : 'border-brand-100 bg-white text-ink-600 hover:bg-brand-50'
              }`}
            >
              <span className="text-[10px] opacity-80">{isToday ? '今天' : `${dt.getMonth() + 1}/${dt.getDate()}`}</span>
              <span className="text-sm font-bold">{dt.getDate()}</span>
            </button>
          );
        })}
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-brand-100 bg-white px-3 py-2 text-xs text-ink-600 outline-none focus:border-brand-400"
        />
        <button
          onClick={() => onAddTaskOnDate(date)}
          className="ml-auto flex items-center gap-1 rounded-xl bg-brand-50 px-3 py-2 text-xs font-medium text-brand-600 hover:bg-brand-100"
        >
          <Plus className="h-3.5 w-3.5" /> 添加任务
        </button>
      </div>

      {dayTasks.length === 0 ? (
        <div className="rounded-2xl border border-brand-50 bg-white py-16 text-center">
          <Clock className="mx-auto h-10 w-10 text-brand-200" />
          <p className="mt-3 text-sm font-semibold text-ink-700">这一天还没有安排</p>
          <p className="mt-1 text-xs text-ink-400">添加带时间的任务，就能在这里看到学习流程</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-brand-50 bg-white p-5">
          <div className="relative">
            {/* vertical line */}
            <div className="absolute left-[18px] top-2 bottom-2 w-px bg-brand-100" />

            <div className="space-y-4">
              {scheduled.map((t) => {
                const hour = parseInt(t.startTime!.split(':')[0]);
                const p = periodFor(hour);
                const Icon = p.icon;
                return (
                  <div key={t.id} className="relative flex gap-4">
                    <div className={`z-10 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white ring-2 ring-brand-100 ${p.tint}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <button
                      onClick={() => onOpenTask(t)}
                      className="flex flex-1 items-start gap-3 rounded-2xl border border-brand-50 bg-white px-4 py-3.5 text-left transition hover:border-brand-200 hover:shadow-sm"
                    >
                      <div onClick={(e) => { e.stopPropagation(); toggleDone(t.id); }} className="mt-0.5">
                        <Checkbox checked={t.status === 'done'} onChange={() => toggleDone(t.id)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-sm font-bold text-brand-600">
                            <Clock className="h-3.5 w-3.5" />
                            {t.startTime}{t.endTime && ` - ${t.endTime}`}
                          </span>
                          <span className="text-[11px] text-ink-400">{p.label}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <PriorityDot priority={t.priority} />
                          <p className={`text-sm font-medium ${t.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
                            {t.title}
                          </p>
                        </div>
                        {t.description && <p className="mt-1 text-xs text-ink-400">{t.description}</p>}
                        <div className="mt-2 flex items-center gap-1.5">
                          <TagBadge tag={t.tag} />
                          {t.subtasks.length > 0 && (
                            <span className="text-[11px] text-ink-400">
                              子任务 {t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}

              {unscheduled.length > 0 && (
                <div className="relative flex gap-4 pt-2">
                  <div className="z-10 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white text-ink-400 ring-2 ring-brand-100">
                    <Clock className="h-4 w-4" />
                  </div>
                  <div className="flex-1 space-y-2 rounded-xl bg-sand-50 px-4 py-3">
                    <p className="text-xs font-semibold text-ink-500">未安排时间</p>
                    {unscheduled.map((t) => (
                      <div
                        key={t.id}
                        className="flex w-full items-center gap-2.5 rounded-xl bg-white px-3 py-2.5 transition hover:bg-brand-50/50"
                      >
                        <Checkbox checked={t.status === 'done'} onChange={() => toggleDone(t.id)} />
                        <button onClick={() => onOpenTask(t)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <PriorityDot priority={t.priority} />
                          <span className={`flex-1 truncate text-sm ${t.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-700'}`}>
                            {t.title}
                          </span>
                        </button>
                        <TagBadge tag={t.tag} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
