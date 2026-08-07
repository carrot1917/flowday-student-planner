import { useMemo, useState } from 'react';
import { Search, ListTodo, ArrowUpDown, Filter } from 'lucide-react';
import { useFlow } from '@/store';
import { relativeDue } from '@/lib/date';
import type { Priority, Status, Tag, Task } from '@/types';
import { PRIORITY_LABELS, STATUS_LABELS, TAG_LABELS } from '@/types';
import { Checkbox, EmptyState, PriorityBadge, PriorityDot, StatusBadge, TagBadge } from '@/components/ui';

interface TasksPageProps {
  onOpenTask: (t: Task) => void;
}

type SortKey = 'due' | 'priority' | 'created';

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function TasksPage({ onOpenTask }: TasksPageProps) {
  const { tasks, toggleDone } = useFlow();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [tagFilter, setTagFilter] = useState<Tag | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('due');

  const filtered = useMemo(() => {
    let list = tasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (tagFilter !== 'all' && t.tag !== tagFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === 'due') return a.dueDate.localeCompare(b.dueDate);
      if (sort === 'priority') return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return b.createdAt - a.createdAt;
    });
    return list;
  }, [tasks, query, statusFilter, tagFilter, sort]);

  return (
    <div className="animate-fade-in space-y-4">
      {/* Search + sort */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索任务..."
            className="w-full rounded-2xl border border-brand-100 bg-white/70 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-2xl border border-brand-100 bg-white/70 px-2.5 py-2">
            <ArrowUpDown className="h-3.5 w-3.5 text-ink-400" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="bg-transparent text-xs font-medium text-ink-600 outline-none"
            >
              <option value="due">按截止日期</option>
              <option value="priority">按优先级</option>
              <option value="created">按创建时间</option>
            </select>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-xs font-semibold text-ink-400"><Filter className="h-3.5 w-3.5" /> 状态</span>
        <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>全部</FilterChip>
        {(['todo', 'doing', 'done'] as Status[]).map((s) => (
          <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
            {STATUS_LABELS[s]}
          </FilterChip>
        ))}
        <span className="mx-1 h-4 w-px bg-brand-100" />
        <span className="text-xs font-semibold text-ink-400">标签</span>
        <FilterChip active={tagFilter === 'all'} onClick={() => setTagFilter('all')}>全部</FilterChip>
        {(['math', 'english', 'coding', 'reading', 'other'] as Tag[]).map((t) => (
          <FilterChip key={t} active={tagFilter === t} onClick={() => setTagFilter(t)}>
            {TAG_LABELS[t]}
          </FilterChip>
        ))}
      </div>

      {/* List */}
      <div className="rounded-[24px] border border-brand-100 bg-white/80">
        {filtered.length === 0 ? (
          <EmptyState icon={ListTodo} title="没有匹配的任务" hint="试试调整搜索或筛选条件" />
        ) : (
          <div className="divide-y divide-brand-50/60">
            {filtered.map((t) => {
              const r = relativeDue(t.dueDate);
              return (
                <div
                  key={t.id}
                  className="group flex items-center gap-3 rounded-2xl px-4 py-3.5 transition hover:bg-brand-50/40"
                >
                  <Checkbox checked={t.status === 'done'} onChange={() => toggleDone(t.id)} />
                  <button onClick={() => onOpenTask(t)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <PriorityDot priority={t.priority} />
                      <p className={`truncate text-sm font-medium ${t.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
                        {t.title}
                      </p>
                    </div>
                    {t.description && <p className="mt-0.5 truncate text-xs text-ink-400">{t.description}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <TagBadge tag={t.tag} />
                      <StatusBadge status={t.status} />
                      {t.startTime && <span className="text-[11px] text-ink-400">{t.startTime}{t.endTime && `-${t.endTime}`}</span>}
                      {t.subtasks.length > 0 && (
                        <span className="text-[11px] text-ink-400">
                          子任务 {t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}
                        </span>
                      )}
                    </div>
                  </button>
                  <span
                    className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      r.tone === 'overdue'
                        ? 'bg-rose-100 text-rose-600'
                        : r.tone === 'today'
                          ? 'bg-brand-100 text-brand-600'
                          : r.tone === 'soon'
                            ? 'bg-amber-100 text-amber-600'
                            : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {r.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active ? 'bg-brand-500 text-white' : 'bg-white/70 text-ink-500 ring-1 ring-brand-100 hover:bg-brand-50'
      }`}
    >
      {children}
    </button>
  );
}
