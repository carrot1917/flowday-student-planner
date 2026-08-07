import { CheckCircle2, Plus, Sparkles, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { useFlow } from '@/store';
import { todayISO, formatLong, relativeDue } from '@/lib/date';
import { aiSummary } from '@/lib/ai';
import { Checkbox, PriorityDot, TagBadge, EmptyState } from '@/components/ui';
import type { Task } from '@/types';

interface DashboardProps {
  onOpenTask: (t: Task) => void;
  onAddTask: () => void;
  onNavigate: (p: 'tasks' | 'ai') => void;
}

const ENCOURAGEMENTS = [
  '今天的努力，是明天的底气。',
  '每完成一项任务，离目标就近一步。',
  '专注当下，未来自会到来。',
  '学习如流水，日积月累终成江河。',
  '保持节奏，你比昨天更好。',
];

export function Dashboard({ onOpenTask, onAddTask, onNavigate }: DashboardProps) {
  const { tasks, toggleDone } = useFlow();
  const today = todayISO();
  const todayTasks = useMemo(() => tasks.filter((t) => t.dueDate === today), [tasks, today]);
  const done = todayTasks.filter((t) => t.status === 'done').length;
  const pending = todayTasks.length - done;
  const progress = todayTasks.length ? Math.round((done / todayTasks.length) * 100) : 0;
  const summary = useMemo(() => aiSummary(tasks), [tasks]);
  const encouragement = ENCOURAGEMENTS[new Date().getDate() % ENCOURAGEMENTS.length];

  return (
    <div className="animate-fade-in space-y-5">
      {/* Hero — combines greeting, date, progress, and quick actions */}
      <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-brand-300 via-brand-400 to-brand-600 p-6 text-white shadow-xl shadow-brand-300/30 md:p-8">
        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-16 -left-10 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-white/80">{formatLong(new Date())}</p>
            <h2 className="mt-1 text-2xl font-bold md:text-3xl">你好，今天也要加油呀</h2>
            <p className="mt-2 max-w-md text-sm text-white/85">{encouragement}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                onClick={onAddTask}
                className="flex items-center gap-1.5 rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-brand-600 shadow-sm transition hover:scale-105"
              >
                <Plus className="h-4 w-4" /> 快速添加任务
              </button>
              <button
                onClick={() => onNavigate('ai')}
                className="flex items-center gap-1.5 rounded-2xl bg-white/20 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/30"
              >
                <Sparkles className="h-4 w-4" /> AI 帮我安排
              </button>
            </div>
          </div>

          {/* Progress ring */}
          <div className="flex items-center gap-4 rounded-2xl bg-white/15 px-5 py-4 backdrop-blur-sm">
            <ProgressRing percent={progress} />
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm">
                <span className="font-bold">{done}</span>
                <span className="text-white/70">已完成</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="font-bold">{pending}</span>
                <span className="text-white/70">待完成</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="font-bold">{todayTasks.length}</span>
                <span className="text-white/70">今日总数</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI summary strip */}
      <div className="flex items-start gap-3 rounded-2xl border border-brand-100 bg-white/70 px-5 py-4 backdrop-blur-sm">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-100 to-brand-200 text-brand-600">
          <TrendingUp className="h-4 w-4" />
        </div>
        <p className="pt-1 text-sm leading-relaxed text-ink-600">{summary.text}</p>
      </div>

      {/* Today's tasks */}
      <div className="rounded-[24px] border border-brand-100 bg-white/80 p-5 backdrop-blur-sm">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-bold text-ink-900">今日任务</p>
          <button onClick={() => onNavigate('tasks')} className="text-xs font-medium text-brand-500 hover:text-brand-600">
            查看全部 →
          </button>
        </div>
        {todayTasks.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="今天还没有任务" hint="点击「添加任务」开始规划你的一天" />
        ) : (
          <div className="stagger space-y-2">
            {todayTasks.map((t) => (
              <div
                key={t.id}
                className="flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 transition hover:border-brand-100 hover:bg-brand-50/50"
              >
                <Checkbox checked={t.status === 'done'} onChange={() => toggleDone(t.id)} />
                <button onClick={() => onOpenTask(t)} className="min-w-0 flex-1 text-left">
                  <p className={`truncate text-sm font-medium ${t.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
                    {t.title}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <PriorityDot priority={t.priority} />
                    {t.startTime && <span className="text-[11px] text-ink-400">{t.startTime}</span>}
                    <TagBadge tag={t.tag} />
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressRing({ percent }: { percent: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;
  return (
    <div className="relative h-20 w-20 flex-shrink-0">
      <svg className="h-20 w-20 -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="white"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.7s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold text-white">{percent}%</span>
      </div>
    </div>
  );
}
