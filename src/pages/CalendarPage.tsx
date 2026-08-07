import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useFlow } from '@/store';
import {
  addDays,
  fromISO,
  isSameDay,
  startOfMonth,
  startOfWeek,
  toISO,
  todayISO,
} from '@/lib/date';
import type { Task } from '@/types';
import { PriorityDot, TagBadge } from '@/components/ui';

type View = 'month' | 'week' | 'day';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

interface CalendarPageProps {
  onOpenTask: (t: Task) => void;
  onAddTaskOnDate: (date: string) => void;
}

export function CalendarPage({ onOpenTask, onAddTaskOnDate }: CalendarPageProps) {
  const { tasks } = useFlow();
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<string>(todayISO());

  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const t of tasks) {
      (map[t.dueDate] ||= []).push(t);
    }
    return map;
  }, [tasks]);

  const move = (dir: number) => {
    if (view === 'month') setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
    else if (view === 'week') setCursor(addDays(cursor, dir * 7));
    else setCursor(addDays(cursor, dir));
  };

  const monthGrid = useMemo(() => {
    const first = startOfMonth(cursor);
    const gridStart = startOfWeek(first, 1);
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
    return cells;
  }, [cursor]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor, 1);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [cursor]);

  const title =
    view === 'month'
      ? `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`
      : view === 'week'
        ? `${weekDays[0].getMonth() + 1}月${weekDays[0].getDate()}日 - ${weekDays[6].getMonth() + 1}月${weekDays[6].getDate()}日`
        : `${cursor.getFullYear()}年${cursor.getMonth() + 1}月${cursor.getDate()}日`;

  const selectedTasks = (tasksByDate[selected] || []).sort((a, b) => (a.startTime || '99').localeCompare(b.startTime || '99'));

  return (
    <div className="animate-fade-in space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => move(-1)} className="rounded-lg border border-brand-100 bg-white p-2 text-ink-500 hover:bg-brand-50">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="min-w-[140px] text-center text-base font-bold text-ink-900">{title}</h2>
          <button onClick={() => move(1)} className="rounded-lg border border-brand-100 bg-white p-2 text-ink-500 hover:bg-brand-50">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setCursor(new Date()); setSelected(todayISO()); }}
            className="ml-1 rounded-lg border border-brand-100 bg-white px-3 py-2 text-xs font-medium text-brand-600 hover:bg-brand-50"
          >
            今天
          </button>
        </div>
        <div className="flex rounded-xl border border-brand-100 bg-white p-1">
          {(['month', 'week', 'day'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                view === v ? 'bg-brand-500 text-white' : 'text-ink-500 hover:bg-brand-50'
              }`}
            >
              {v === 'month' ? '月视图' : v === 'week' ? '周视图' : '日视图'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Calendar */}
        <div className="lg:col-span-2 rounded-2xl border border-brand-50 bg-white p-4">
          {view === 'month' && (
            <>
              <div className="mb-2 grid grid-cols-7 gap-1">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="py-1 text-center text-xs font-semibold text-ink-400">周{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {monthGrid.map((d) => {
                  const iso = toISO(d);
                  const inMonth = d.getMonth() === cursor.getMonth();
                  const isToday = isSameDay(d, new Date());
                  const isSelected = iso === selected;
                  const dayTasks = tasksByDate[iso] || [];
                  return (
                    <button
                      key={iso}
                      onClick={() => setSelected(iso)}
                      className={`relative flex min-h-[64px] flex-col rounded-lg border p-1.5 text-left transition ${
                        isSelected
                          ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200'
                          : 'border-transparent hover:border-brand-100 hover:bg-brand-50/40'
                      } ${inMonth ? '' : 'opacity-40'}`}
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                          isToday ? 'bg-brand-500 text-white' : inMonth ? 'text-ink-700' : 'text-ink-400'
                        }`}
                      >
                        {d.getDate()}
                      </span>
                      <div className="mt-1 space-y-0.5">
                        {dayTasks.slice(0, 3).map((t) => (
                          <div
                            key={t.id}
                            onClick={(e) => { e.stopPropagation(); onOpenTask(t); }}
                            className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] hover:bg-brand-100"
                          >
                            <PriorityDot priority={t.priority} />
                            <span className={`truncate ${t.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-600'}`}>
                              {t.title}
                            </span>
                          </div>
                        ))}
                        {dayTasks.length > 3 && (
                          <p className="px-1 text-[10px] text-ink-400">+{dayTasks.length - 3} 更多</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {view === 'week' && (
            <div className="grid grid-cols-7 gap-1">
              {weekDays.map((d) => {
                const iso = toISO(d);
                const isToday = isSameDay(d, new Date());
                const isSelected = iso === selected;
                const dayTasks = tasksByDate[iso] || [];
                return (
                  <button
                    key={iso}
                    onClick={() => setSelected(iso)}
                    className={`flex min-h-[200px] flex-col rounded-lg border p-2 text-left transition ${
                      isSelected ? 'border-brand-400 bg-brand-50' : 'border-brand-50 hover:bg-brand-50/40'
                    }`}
                  >
                    <div className="mb-1 text-center">
                      <p className="text-[11px] text-ink-400">周{WEEKDAYS[(d.getDay() + 6) % 7]}</p>
                      <span
                        className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                          isToday ? 'bg-brand-500 text-white' : 'text-ink-700'
                        }`}
                      >
                        {d.getDate()}
                      </span>
                    </div>
                    <div className="flex-1 space-y-1 overflow-y-auto">
                      {dayTasks.map((t) => (
                        <div
                          key={t.id}
                          onClick={(e) => { e.stopPropagation(); onOpenTask(t); }}
                          className="rounded-md bg-white px-1.5 py-1 text-[10px] shadow-sm hover:bg-brand-100"
                        >
                          <div className="flex items-center gap-1">
                            <PriorityDot priority={t.priority} />
                            <span className={`truncate ${t.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-600'}`}>
                              {t.title}
                            </span>
                          </div>
                          {t.startTime && <p className="mt-0.5 text-ink-400">{t.startTime}</p>}
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {view === 'day' && (
            <div className="space-y-1">
              {Array.from({ length: 24 }, (_, h) => {
                const hourTasks = (tasksByDate[selected] || []).filter(
                  (t) => t.startTime && parseInt(t.startTime.split(':')[0]) === h,
                );
                return (
                  <div key={h} className="flex gap-3 border-t border-brand-50 py-2">
                    <span className="w-12 flex-shrink-0 text-xs font-medium text-ink-400">{String(h).padStart(2, '0')}:00</span>
                    <div className="flex-1 space-y-1">
                      {hourTasks.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => onOpenTask(t)}
                          className="flex w-full items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-left transition hover:bg-brand-100"
                        >
                          <PriorityDot priority={t.priority} />
                          <span className={`flex-1 truncate text-sm ${t.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-700'}`}>
                            {t.title}
                          </span>
                          <TagBadge tag={t.tag} />
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Day detail */}
        <div className="rounded-2xl border border-brand-50 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-ink-400">{fromISO(selected).getFullYear()}年{fromISO(selected).getMonth() + 1}月{fromISO(selected).getDate()}日</p>
              <p className="text-sm font-bold text-ink-900">当日安排</p>
            </div>
            <button
              onClick={() => onAddTaskOnDate(selected)}
              className="flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-100"
            >
              <Plus className="h-3.5 w-3.5" /> 添加
            </button>
          </div>
          {selectedTasks.length === 0 ? (
            <p className="py-10 text-center text-xs text-ink-400">这一天还没有安排任务</p>
          ) : (
            <div className="stagger space-y-2">
              {selectedTasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onOpenTask(t)}
                  className="flex w-full items-center gap-2 rounded-xl border border-brand-50 px-3 py-2.5 text-left transition hover:bg-brand-50/50"
                >
                  <PriorityDot priority={t.priority} />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-medium ${t.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
                      {t.title}
                    </p>
                    {t.startTime && <p className="text-[11px] text-ink-400">{t.startTime}{t.endTime && ` - ${t.endTime}`}</p>}
                  </div>
                  <TagBadge tag={t.tag} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
