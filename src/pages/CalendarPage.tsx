import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Flag, Lock, Plus, Unlock, Trash2 } from 'lucide-react';
import { useTasks, useCourses, useScheduleBlocks, useSettings, useActions } from '@/store';
import {
  addDays,
  fromISO,
  isSameDay,
  startOfMonth,
  startOfWeek,
  toISO,
  todayISO,
} from '@/lib/date';
import {
  findTaskForBlock,
  groupBlocksByDate,
  groupTasksByDeadline,
  sortScheduleBlocks,
} from '@/lib/schedule';
import type { ScheduleBlock, Task } from '@/types';
import { CourseBadge, PriorityDot, Dialog, Button } from '@/components/ui';

type View = 'month' | 'week' | 'day';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

interface CalendarPageProps {
  onOpenTask: (t: Task) => void;
  onAddTaskOnDate: (date: string) => void;
  initialView?: string;
  initialDate?: string;
}

export function CalendarPage({ onOpenTask, onAddTaskOnDate, initialView, initialDate }: CalendarPageProps) {
  const { tasks, taskById } = useTasks();
  const { courseById } = useCourses();
  const { scheduleBlocks } = useScheduleBlocks();
  const { settings } = useSettings();
  const [view, setView] = useState<View>(() => {
    if (initialView === 'week') return 'week';
    if (initialView === 'day') return 'day';
    return 'month';
  });
  const [cursor, setCursor] = useState(() => {
    if (initialDate) {
      const d = fromISO(initialDate);
      if (d && !isNaN(d.getTime())) return d;
    }
    return new Date();
  });
  const [selected, setSelected] = useState<string>(todayISO());
  const [editingBlock, setEditingBlock] = useState<ScheduleBlock | null>(null);
  const { updateScheduleBlock, deleteScheduleBlock, lockScheduleBlock } = useActions();

  // Study sessions are sourced ONLY from ScheduleBlock (by block.date).
  const blocksByDate = useMemo(() => groupBlocksByDate(scheduleBlocks), [scheduleBlocks]);
  // Deadlines are sourced ONLY from Task.dueDate — kept visually separate.
  const tasksByDueDate = useMemo(() => groupTasksByDeadline(tasks), [tasks]);
  const dueDates = useMemo(() => new Set(Object.keys(tasksByDueDate)), [tasksByDueDate]);

  const move = (dir: number) => {
    if (view === 'month') setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
    else if (view === 'week') setCursor(addDays(cursor, dir * 7));
    else setCursor(addDays(cursor, dir));
  };

  const monthGrid = useMemo(() => {
    const first = startOfMonth(cursor);
    const gridStart = startOfWeek(first, settings.startOfWeek);
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
    return cells;
  }, [cursor, settings.startOfWeek]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor, settings.startOfWeek);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [cursor, settings.startOfWeek]);

  const title =
    view === 'month'
      ? `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`
      : view === 'week'
        ? `${weekDays[0].getMonth() + 1}月${weekDays[0].getDate()}日 - ${weekDays[6].getMonth() + 1}月${weekDays[6].getDate()}日`
        : `${cursor.getFullYear()}年${cursor.getMonth() + 1}月${cursor.getDate()}日`;

  // Day detail: study sessions (sorted) + separate deadline list.
  const selectedBlocks = sortScheduleBlocks(blocksByDate[selected] || []).filter(
    (b) => findTaskForBlock(taskById, b) !== undefined,
  );
  const selectedDueTasks = tasksByDueDate[selected] || [];

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

      {/* Legend: study sessions vs deadlines are intentionally distinct. */}
      <div className="flex items-center gap-4 text-[11px] text-ink-400">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-brand-400" /> 学习安排（ScheduleBlock）
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-rose-500" /> 截止日（dueDate）
        </span>
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
                  const dayBlocks = blocksByDate[iso] || [];
                  const hasDue = dueDates.has(iso);
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
                      {hasDue && (
                        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-rose-500" />
                      )}
                      <div className="mt-1 space-y-0.5">
                        {dayBlocks.slice(0, 3).map((b) => {
                          const task = findTaskForBlock(taskById, b);
                          if (!task) return null;
                          return (
                            <div
                              key={b.id}
                              onClick={(e) => { e.stopPropagation(); setEditingBlock(b); }}
                              className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] hover:bg-brand-100"
                            >
                              <PriorityDot priority={task.priority} />
                              <span className={`truncate ${task.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-600'}`}>
                                {task.title}
                              </span>
                            </div>
                          );
                        })}
                        {dayBlocks.length > 3 && (
                          <p className="px-1 text-[10px] text-ink-400">+{dayBlocks.length - 3} 更多</p>
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
                const dayBlocks = blocksByDate[iso] || [];
                const dueTasks = tasksByDueDate[iso] || [];
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
                    {dueTasks.length > 0 && (
                      <div className="mb-1 flex items-center justify-center gap-1 text-[10px] font-medium text-rose-500">
                        <Flag className="h-2.5 w-2.5" /> 截止 {dueTasks.length}
                      </div>
                    )}
                    <div className="flex-1 space-y-1 overflow-y-auto">
                      {dayBlocks.map((b) => {
                        const task = findTaskForBlock(taskById, b);
                        if (!task) return null;
                        return (
                          <div
                            key={b.id}
                            onClick={(e) => { e.stopPropagation(); setEditingBlock(b); }}
                            className="rounded-md bg-white px-1.5 py-1 text-[10px] shadow-sm hover:bg-brand-100"
                          >
                            <div className="flex items-center gap-1">
                              <PriorityDot priority={task.priority} />
                              <span className={`truncate ${task.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-600'}`}>
                                {task.title}
                              </span>
                            </div>
                            <p className="mt-0.5 text-ink-400">{b.startTime}</p>
                          </div>
                        );
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {view === 'day' && (
            <div className="space-y-1">
              {Array.from({ length: 24 }, (_, h) => {
                const hourBlocks = (blocksByDate[selected] || []).filter(
                  (b) => parseInt(b.startTime.split(':')[0]) === h,
                );
                return (
                  <div key={h} className="flex gap-3 border-t border-brand-50 py-2">
                    <span className="w-12 flex-shrink-0 text-xs font-medium text-ink-400">{String(h).padStart(2, '0')}:00</span>
                    <div className="flex-1 space-y-1">
                      {hourBlocks.map((b) => {
                        const task = findTaskForBlock(taskById, b);
                        if (!task) return null;
                        return (
                          <button
                            key={b.id}
                            onClick={() => setEditingBlock(b)}
                            className="flex w-full items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-left transition hover:bg-brand-100"
                          >
                            <PriorityDot priority={task.priority} />
                            <span className={`flex-1 truncate text-sm ${task.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-700'}`}>
                              {task.title}
                            </span>
                            <CourseBadge course={task.courseId ? courseById.get(task.courseId) : undefined} />
                            <span className="text-[11px] text-ink-400">{b.startTime}-{b.endTime}</span>
                          </button>
                        );
                      })}
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

          {/* Study sessions — sourced from ScheduleBlock */}
          <p className="mb-2 text-xs font-semibold text-ink-500">今日学习安排</p>
          {selectedBlocks.length === 0 ? (
            <p className="py-3 text-center text-xs text-ink-400">这一天还没有学习安排</p>
          ) : (
            <div className="stagger space-y-2">
              {selectedBlocks.map((b) => {
                const task = findTaskForBlock(taskById, b);
                if (!task) return null;
                return (
                  <button
                    key={b.id}
                    onClick={() => setEditingBlock(b)}
                    className="flex w-full items-center gap-2 rounded-xl border border-brand-50 px-3 py-2.5 text-left transition hover:bg-brand-50/50"
                  >
                    <PriorityDot priority={task.priority} />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-medium ${task.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
                        {task.title}
                      </p>
                      <p className="text-[11px] text-ink-400">{b.startTime} - {b.endTime} · {b.plannedMinutes} 分钟</p>
                    </div>
                    <CourseBadge course={task.courseId ? courseById.get(task.courseId) : undefined} />
                  </button>
                );
              })}
            </div>
          )}

          {/* Deadlines — sourced from Task.dueDate, visually distinct */}
          <p className="mb-2 mt-4 flex items-center gap-1 text-xs font-semibold text-rose-500">
            <Flag className="h-3 w-3" /> 今日截止
          </p>
          {selectedDueTasks.length === 0 ? (
            <p className="py-3 text-center text-xs text-ink-400">今日无任务截止</p>
          ) : (
            <div className="space-y-2">
              {selectedDueTasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onOpenTask(t)}
                  className="flex w-full items-center gap-2 rounded-xl border border-rose-100 bg-rose-50/40 px-3 py-2.5 text-left transition hover:bg-rose-50"
                >
                  <Flag className="h-3.5 w-3.5 flex-shrink-0 text-rose-500" />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-medium ${t.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
                      {t.title}
                    </p>
                  </div>
                  <CourseBadge course={t.courseId ? courseById.get(t.courseId) : undefined} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ScheduleBlock Editor Dialog */}
      <ScheduleBlockEditor
        block={editingBlock}
        onClose={() => setEditingBlock(null)}
        onSave={(patch) => { if (editingBlock) { updateScheduleBlock(editingBlock.id, patch); setEditingBlock(null); } }}
        onDelete={(id) => { deleteScheduleBlock(id); setEditingBlock(null); }}
        onToggleLock={(id, locked) => { lockScheduleBlock(id, locked); }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScheduleBlock Editor — inline dialog for editing a single ScheduleBlock
// ---------------------------------------------------------------------------

interface ScheduleBlockEditorProps {
  block: ScheduleBlock | null;
  onClose: () => void;
  onSave: (patch: Partial<ScheduleBlock>) => void;
  onDelete: (id: string) => void;
  onToggleLock: (id: string, locked: boolean) => void;
}

function ScheduleBlockEditor({ block, onClose, onSave, onDelete, onToggleLock }: ScheduleBlockEditorProps) {
  if (!block) return null;

  return (
    <Dialog open={!!block} onClose={onClose} title="编辑学习时段">
      <div className="space-y-4">
        {/* Block info */}
        <div className="rounded-xl bg-sand-50 p-3">
          <p className="text-xs text-ink-500">时段 ID</p>
          <p className="text-sm font-mono text-ink-700 break-all">{block.id}</p>
        </div>

        {/* Date */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink-500">日期</label>
          <input
            type="date"
            value={block.date}
            onChange={(e) => onSave({ date: e.target.value })}
            className="w-full rounded-xl border border-brand-100 bg-sand-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-200"
          />
        </div>

        {/* Time range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink-500">开始时间</label>
            <input
              type="time"
              value={block.startTime}
              onChange={(e) => onSave({ startTime: e.target.value })}
              className="w-full rounded-xl border border-brand-100 bg-sand-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-200"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink-500">结束时间</label>
            <input
              type="time"
              value={block.endTime}
              onChange={(e) => onSave({ endTime: e.target.value })}
              className="w-full rounded-xl border border-brand-100 bg-sand-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-200"
            />
          </div>
        </div>

        {/* Status */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink-500">状态</label>
          <div className="flex gap-1.5">
            {(['planned', 'done', 'skipped'] as const).map((s) => (
              <button
                key={s}
                onClick={() => onSave({ status: s })}
                className={`flex-1 rounded-xl px-2 py-2.5 text-xs font-medium transition ${
                  block.status === s
                    ? s === 'done'
                      ? 'bg-emerald-500 text-white'
                      : s === 'skipped'
                        ? 'bg-slate-400 text-white'
                        : 'bg-brand-500 text-white'
                    : 'bg-sand-50 text-ink-500 hover:bg-brand-50'
                }`}
              >
                {s === 'planned' ? '计划中' : s === 'done' ? '已完成' : '已跳过'}
              </button>
            ))}
          </div>
        </div>

        {/* Source */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink-500">来源</label>
          <div className="flex gap-1.5">
            {(['manual', 'scheduler', 'external'] as const).map((s) => (
              <button
                key={s}
                onClick={() => onSave({ source: s })}
                className={`flex-1 rounded-xl px-2 py-2.5 text-xs font-medium transition ${
                  block.source === s
                    ? 'bg-brand-500 text-white'
                    : 'bg-sand-50 text-ink-500 hover:bg-brand-50'
                }`}
              >
                {s === 'manual' ? '手动' : s === 'scheduler' ? '自动排程' : '外部'}
              </button>
            ))}
          </div>
        </div>

        {/* Lock toggle */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-ink-600">锁定（禁止移动/调整）</span>
          <button
            onClick={() => onToggleLock(block.id, !block.locked)}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${
              block.locked
                ? 'bg-amber-100 text-amber-700'
                : 'bg-sand-50 text-ink-500 hover:bg-brand-50'
            }`}
          >
            {block.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            {block.locked ? '已锁定' : '未锁定'}
          </button>
        </div>

        {/* Task association */}
        <div className="rounded-xl bg-sand-50 p-3">
          <p className="text-xs text-ink-500">关联任务 ID</p>
          <p className="text-sm font-mono text-ink-700">{block.taskId ?? '（无关联任务）'}</p>
        </div>

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-sand-50 p-3">
          <div>
            <p className="text-[11px] text-ink-400">创建时间</p>
            <p className="text-xs font-mono text-ink-600">{new Date(block.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[11px] text-ink-400">更新时间</p>
            <p className="text-xs font-mono text-ink-600">{new Date(block.updatedAt).toLocaleString()}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-brand-50 pt-4">
          <Button variant="danger" size="sm" onClick={() => onDelete(block.id)}>
            <Trash2 className="h-3.5 w-3.5" /> 删除时段
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
