import { useEffect, useState } from 'react';
import { X, Trash2, Plus, Sparkles } from 'lucide-react';
import type { Priority, Tag, Task } from '@/types';
import { PRIORITY_LABELS, TAG_LABELS } from '@/types';
import { useFlow } from '@/store';
import { aiDecomposeSubtasks } from '@/lib/ai';
import { todayISO } from '@/lib/date';
import { Checkbox } from './ui';

interface TaskModalProps {
  task: Task | null;
  defaultDate?: string;
  onClose: () => void;
}

const PRIORITIES: Priority[] = ['high', 'medium', 'low'];
const TAGS: Tag[] = ['math', 'english', 'coding', 'reading', 'other'];

export function TaskModal({ task, defaultDate, onClose }: TaskModalProps) {
  const { addTask, updateTask, deleteTask } = useFlow();
  const isEdit = !!task;

  const [draft, setDraft] = useState<Task>(() =>
    task ?? {
      id: '',
      title: '',
      description: '',
      dueDate: defaultDate ?? todayISO(),
      startTime: '',
      endTime: '',
      priority: 'medium',
      tag: 'other',
      status: 'todo',
      createdAt: 0,
      completedAt: null,
      subtasks: [],
    },
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (patch: Partial<Task>) => setDraft((d) => ({ ...d, ...patch }));

  const handleSave = () => {
    if (!draft.title.trim()) return;
    if (isEdit) {
      updateTask(task!.id, draft);
    } else {
      addTask(draft);
    }
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="开始时间 (可选)">
              <input
                type="time"
                value={draft.startTime}
                onChange={(e) => set({ startTime: e.target.value })}
                className="w-full rounded-xl border border-brand-100 bg-sand-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-200"
              />
            </Field>
            <Field label="结束时间 (可选)">
              <input
                type="time"
                value={draft.endTime}
                onChange={(e) => set({ endTime: e.target.value })}
                className="w-full rounded-xl border border-brand-100 bg-sand-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-200"
              />
            </Field>
          </div>

          <Field label="标签">
            <div className="flex flex-wrap gap-1.5">
              {TAGS.map((t) => (
                <button
                  key={t}
                  onClick={() => set({ tag: t })}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    draft.tag === t
                      ? 'bg-brand-500 text-white'
                      : 'bg-sand-50 text-ink-500 hover:bg-brand-50'
                  }`}
                >
                  {TAG_LABELS[t]}
                </button>
              ))}
            </div>
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
              disabled={!draft.title.trim()}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-ink-500">{label}</label>
      {children}
    </div>
  );
}
