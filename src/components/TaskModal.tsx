import { useEffect, useMemo, useState } from 'react';
import { X, Trash2, Plus, Sparkles, Clock3, CircleAlert } from 'lucide-react';
import type { Priority, Task } from '@/types';
import { PRIORITY_LABELS, UNCATEGORIZED_COLOR, UNCATEGORIZED_LABEL } from '@/types';
import { useCourses, useActions } from '@/store';
import {
  ESTIMATED_MINUTES_PRESETS,
  findCourse,
  parseEstimatedMinutes,
} from '@/lib/domain';
import { aiDecomposeSubtasks } from '@/lib/ai';
import { createTask } from '@/lib/storage';
import { todayISO } from '@/lib/date';
import { Checkbox } from './ui';

interface TaskModalProps {
  task: Task | null;
  defaultDate?: string;
  onClose: () => void;
}

const PRIORITIES: Priority[] = ['high', 'medium', 'low'];

export function TaskModal({ task, defaultDate, onClose }: TaskModalProps) {
  const { addTask, updateTask, deleteTask } = useActions();
  const { courses } = useCourses();
  const isEdit = !!task;

  const [draft, setDraft] = useState<Task>(() =>
    task ?? createTask({ dueDate: defaultDate ?? todayISO() }),
  );
  // The estimate is edited as raw text so an in-progress value never reaches state.
  const [estimateRaw, setEstimateRaw] = useState<string>(() =>
    task?.estimatedMinutes ? String(task.estimatedMinutes) : '',
  );

  const estimate = useMemo(() => parseEstimatedMinutes(estimateRaw), [estimateRaw]);
  const selectedCourse = findCourse(courses, draft.courseId);
  // A task can point at a course that was deleted — show it as 未分类 rather than crashing.
  const danglingCourse = !!draft.courseId && !selectedCourse;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (patch: Partial<Task>) => setDraft((d) => ({ ...d, ...patch }));

  const canSave = !!draft.title.trim() && estimate.ok;

  const handleSave = () => {
    if (!canSave || !estimate.ok) return;
    const course = findCourse(courses, draft.courseId);
    const payload: Task = {
      ...draft,
      title: draft.title.trim(),
      // Dangling ids are cleaned up on save so the task settles as 未分类.
      courseId: course?.id,
      estimatedMinutes: estimate.value,
    };
    if (isEdit) updateTask(task!.id, payload);
    else addTask(payload);
    onClose();
  };

  const handleDelete = () => {
    if (isEdit) deleteTask(task!.id);
    onClose();
  };

  const handleDecompose = () => {
    if (!draft.title.trim()) return;
    const subs = aiDecomposeSubtasks(draft.title);
    set({ subtasks: [...draft.subtasks, ...subs] });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/30 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="animate-pop-in w-full max-w-lg overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-brand-50 px-6 py-4">
          <h2 className="text-base font-bold text-ink-900">{isEdit ? '编辑任务' : '新建任务'}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-brand-50">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
          <Field label="任务名称">
            <input
              autoFocus
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="例如：复习数学第三章"
              className="w-full rounded-xl border border-brand-100 bg-sand-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-200"
            />
          </Field>

          <Field label="描述">
            <textarea
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="补充任务细节..."
              rows={2}
              className="w-full resize-none rounded-xl border border-brand-100 bg-sand-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-200"
            />
          </Field>

          <Field label="课程">
            <div className="flex flex-wrap gap-1.5">
              <CourseChip
                label={UNCATEGORIZED_LABEL}
                color={UNCATEGORIZED_COLOR}
                active={!selectedCourse}
                onClick={() => set({ courseId: undefined })}
              />
              {courses.map((c) => (
                <CourseChip
                  key={c.id}
                  label={c.name}
                  color={c.color}
                  active={selectedCourse?.id === c.id}
                  onClick={() => set({ courseId: c.id })}
                />
              ))}
            </div>
            {courses.length === 0 && (
              <p className="mt-1.5 text-[11px] text-ink-400">还没有课程 — 可在「设置 → 课程管理」中添加。</p>
            )}
            {danglingCourse && (
              <p className="mt-1.5 text-[11px] text-amber-600">原课程已被删除，保存后该任务将标记为{UNCATEGORIZED_LABEL}。</p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="截止日期">
              <input
                type="date"
                value={draft.dueDate}
                onChange={(e) => set({ dueDate: e.target.value })}
                className="w-full rounded-xl border border-brand-100 bg-sand-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-200"
              />
            </Field>
            <Field label="优先级">
              <div className="flex gap-1.5">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    onClick={() => set({ priority: p })}
                    className={`flex-1 rounded-xl px-2 py-2.5 text-xs font-medium transition ${
                      draft.priority === p
                        ? p === 'high'
                          ? 'bg-rose-500 text-white'
                          : p === 'medium'
                            ? 'bg-amber-500 text-white'
                            : 'bg-emerald-500 text-white'
                        : 'bg-sand-50 text-ink-500 hover:bg-brand-50'
                    }`}
                  >
                    {PRIORITY_LABELS[p]}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <Field label="预计学习时长 (可选)">
            <div className="flex flex-wrap items-center gap-1.5">
              {ESTIMATED_MINUTES_PRESETS.map((m) => (
                <button
                  key={m}
                  onClick={() => setEstimateRaw(estimateRaw === String(m) ? '' : String(m))}
                  className={`rounded-xl px-3 py-2 text-xs font-medium transition ${
                    estimateRaw === String(m)
                      ? 'bg-brand-500 text-white'
                      : 'bg-sand-50 text-ink-500 hover:bg-brand-50'
                  }`}
                >
                  {m} 分钟
                </button>
              ))}
              <div className="relative ml-auto w-28">
                <Clock3 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
                <input
                  inputMode="numeric"
                  value={estimateRaw}
                  onChange={(e) => setEstimateRaw(e.target.value)}
                  placeholder="分钟"
                  className={`w-full rounded-xl border bg-sand-50 py-2.5 pl-8 pr-2.5 text-sm outline-none transition focus:bg-white focus:ring-2 ${
                    estimate.ok
                      ? 'border-brand-100 focus:border-brand-400 focus:ring-brand-200'
                      : 'border-rose-300 focus:border-rose-400 focus:ring-rose-200'
                  }`}
                />
              </div>
            </div>
            {!estimate.ok && (
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-rose-500">
                <CircleAlert className="h-3 w-3" /> {estimate.message}
              </p>
            )}
          </Field>

          <Field label="子任务">
            <div className="space-y-1.5">
              {draft.subtasks.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg bg-sand-50 px-2.5 py-2">
                  <Checkbox
                    checked={s.done}
                    size="sm"
                    onChange={() => set({ subtasks: draft.subtasks.map((x, xi) => (xi === i ? { ...x, done: !x.done } : x)) })}
                  />
                  <input
                    value={s.title}
                    onChange={(e) => set({ subtasks: draft.subtasks.map((x, xi) => (xi === i ? { ...x, title: e.target.value } : x)) })}
                    className="flex-1 bg-transparent text-xs outline-none"
                  />
                  <button
                    onClick={() => set({ subtasks: draft.subtasks.filter((_, xi) => xi !== i) })}
                    className="text-ink-400 hover:text-rose-500"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <button
                  onClick={() => set({ subtasks: [...draft.subtasks, { id: Math.random().toString(36).slice(2), title: '', done: false }] })}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-brand-600 hover:bg-brand-50"
                >
                  <Plus className="h-3.5 w-3.5" /> 添加子任务
                </button>
                <button
                  onClick={handleDecompose}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-violet-600 hover:bg-violet-50"
                >
                  <Sparkles className="h-3.5 w-3.5" /> AI 拆解
                </button>
              </div>
            </div>
          </Field>
        </div>

        <div className="flex items-center justify-between border-t border-brand-50 px-6 py-4">
          {isEdit ? (
            <button onClick={handleDelete} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-rose-500 hover:bg-rose-50">
              <Trash2 className="h-4 w-4" /> 删除
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-ink-500 hover:bg-brand-50">
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="rounded-xl bg-gradient-to-r from-brand-500 to-brand-400 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-brand-300/40 transition hover:shadow-lg disabled:opacity-40"
            >
              {isEdit ? '保存' : '创建'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CourseChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition"
      style={
        active
          ? { backgroundColor: color, color: '#fff' }
          : { backgroundColor: `${color}14`, color, boxShadow: `inset 0 0 0 1px ${color}33` }
      }
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: active ? '#fff' : color }}
      />
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-ink-500">{label}</label>
      {children}
    </div>
  );
}
