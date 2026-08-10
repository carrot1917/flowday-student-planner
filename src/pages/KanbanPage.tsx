import { useState, type DragEvent } from 'react';
import { GripVertical, ListTodo, Loader, CheckCircle2 } from 'lucide-react';
import { useFlow } from '@/store';
import { relativeDue } from '@/lib/date';
import type { Status, Task } from '@/types';
import { Checkbox, CourseBadge, PriorityDot } from '@/components/ui';

const COLUMNS: { id: Status; label: string; icon: React.ComponentType<{ className?: string }>; tint: string; bg: string }[] = [
  { id: 'todo', label: '待开始', icon: ListTodo, tint: 'bg-slate-100 text-slate-500', bg: 'from-slate-50 to-white' },
  { id: 'doing', label: '进行中', icon: Loader, tint: 'bg-brand-100 text-brand-600', bg: 'from-brand-50 to-white' },
  { id: 'done', label: '已完成', icon: CheckCircle2, tint: 'bg-emerald-100 text-emerald-600', bg: 'from-emerald-50 to-white' },
];

interface KanbanPageProps {
  onOpenTask: (t: Task) => void;
}

export function KanbanPage({ onOpenTask }: KanbanPageProps) {
  const { tasks, courseById, setStatus, toggleDone } = useFlow();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Status | null>(null);

  const onDragStart = (e: DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: DragEvent, col: Status) => {
    e.preventDefault();
    setOverCol(col);
  };
  const onDrop = (e: DragEvent, col: Status) => {
    e.preventDefault();
    if (dragId) setStatus(dragId, col);
    setDragId(null);
    setOverCol(null);
  };

  return (
    <div className="animate-fade-in grid grid-cols-1 gap-5 md:grid-cols-3">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => t.status === col.id);
        const Icon = col.icon;
        return (
          <div
            key={col.id}
            onDragOver={(e) => onDragOver(e, col.id)}
            onDrop={(e) => onDrop(e, col.id)}
            onDragLeave={() => setOverCol(null)}
            className={`flex flex-col rounded-[24px] border bg-gradient-to-b ${col.bg} p-4 transition ${
              overCol === col.id ? 'drop-target border-brand-300' : 'border-brand-100'
            }`}
          >
            <div className="mb-4 flex items-center justify-between px-1">
              <div className="flex items-center gap-2.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${col.tint}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <p className="text-sm font-bold text-ink-900">{col.label}</p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-ink-500 shadow-sm">{items.length}</span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto" style={{ minHeight: '140px' }}>
              {items.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <p className="text-xs text-ink-400">拖动任务到这里</p>
                </div>
              ) : (
                items.map((t) => {
                  const r = relativeDue(t.dueDate);
                  return (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, t.id)}
                      onDragEnd={() => { setDragId(null); setOverCol(null); }}
                      className={`group cursor-grab rounded-2xl border border-brand-50 bg-white p-4 shadow-sm transition hover:shadow-md active:cursor-grabbing ${
                        dragId === t.id ? 'dragging' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div onClick={(e) => { e.stopPropagation(); toggleDone(t.id); }} className="mt-0.5">
                          <Checkbox checked={t.status === 'done'} onChange={() => toggleDone(t.id)} />
                        </div>
                        <button onClick={() => onOpenTask(t)} className="min-w-0 flex-1 text-left">
                          <p className={`text-sm font-medium ${t.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
                            {t.title}
                          </p>
                          {t.description && <p className="mt-1 line-clamp-2 text-xs text-ink-400">{t.description}</p>}
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <PriorityDot priority={t.priority} />
                            <CourseBadge course={t.courseId ? courseById.get(t.courseId) : undefined} />
                            <span
                              className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                r.tone === 'overdue'
                                  ? 'bg-rose-100 text-rose-600'
                                  : r.tone === 'today'
                                    ? 'bg-brand-100 text-brand-600'
                                    : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {r.label}
                            </span>
                          </div>
                        </button>
                        <GripVertical className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-300 opacity-0 transition group-hover:opacity-100 group-hover:text-brand-400" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
