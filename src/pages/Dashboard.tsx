import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Plus, Sparkles, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { useTasks, useCourses, useScheduleBlocks, useActions } from '@/store';
import { formatEstimate } from '@/lib/domain';
import { todayISO, formatLong, relativeDue } from '@/lib/date';
import { aiSummary } from '@/lib/ai';
import {
  findTaskForBlock,
  groupBlocksByDate,
  overdueTasks,
  sumPlannedMinutes,
  todayDueTasks,
} from '@/lib/schedule';
import { Checkbox, CourseBadge, PriorityDot, StatusBadge, EmptyState } from '@/components/ui';
import type { ScheduleBlock, Task } from '@/types';

interface DashboardProps {
  onOpenTask: (t: Task) => void;
  onAddTask: () => void;
  onNavigate: (p: 'tasks' | 'ai' | 'calendar' | 'timeline') => void;
}

const ENCOURAGEMENTS = [
  '今天的努力，是明天的底气。',
  '每完成一项任务，离目标就近一步。',
  '专注当下，未来自会到来。',
  '学习如流水，日积月累终成江河。',
  '保持节奏，你比昨天更好。',
];

export function Dashboard({ onOpenTask, onAddTask, onNavigate }: DashboardProps) {
  const { tasks, taskById } = useTasks();
  const { courseById } = useCourses();
  const { scheduleBlocks } = useScheduleBlocks();
  const { toggleDone } = useActions();
  const today = todayISO();

  const { todayStudy, todayDue, overdue, plannedMin, done, progress } = useMemo(() => {
    const blocks = groupBlocksByDate(scheduleBlocks)[today] ?? [];
    const study = blocks
      .map((b) => ({ block: b, task: findTaskForBlock(taskById, b) }))
      .filter((x): x is { block: ScheduleBlock; task: Task } => Boolean(x.task));
    const due = todayDueTasks(tasks, today);
    const over = overdueTasks(tasks, today);
    const doneCount = due.filter((t) => t.status === 'done').length;
    return {
      todayStudy: study,
      todayDue: due,
      overdue: over,
      plannedMin: sumPlannedMinutes(blocks),
      done: doneCount,
      progress: due.length ? Math.round((doneCount / due.length) * 100) : 0,
    };
  }, [tasks, scheduleBlocks, taskById, today]);

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

          {/* Progress ring — today's deadline completion rate */}
          <div className="flex items-center gap-4 rounded-2xl bg-white/15 px-5 py-4 backdrop-blur-sm">
            <ProgressRing percent={progress} />
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm">
                <span className="font-bold">{done}</span>
                <span className="text-white/70">已完成</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="font-bold">{todayDue.length - done}</span>
                <span className="text-white/70">待完成</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="font-bold">{todayDue.length}</span>
                <span className="text-white/70">今日截止</span>
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

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={Clock} label="今日计划" value={`${plannedMin} 分钟`} />
        <StatCard icon={CalendarClock} label="今日截止" value={`${todayDue.length} 项`} />
        <StatCard icon={AlertTriangle} label="逾期" value={`${overdue.length} 项`} danger={overdue.length > 0} />
      </div>

      {/* 今日学习 — from ScheduleBlock */}
      <SectionCard
        title="今日学习"
        onViewAll={todayStudy.length ? () => onNavigate('calendar') : undefined}
        viewAllLabel="查看日历"
      >
        {todayStudy.length === 0 ? (
          <EmptyState icon={CalendarClock} title="今天还没有学习安排" hint="用智能排期规划你的学习时间" />
        ) : (
          <div className="stagger space-y-2">
            {todayStudy.map(({ block, task }) => {
              const course = task.courseId ? courseById.get(task.courseId) : undefined;
              return (
                <button
                  key={block.id}
                  onClick={() => onOpenTask(task)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-left transition hover:border-brand-100 hover:bg-brand-50/50"
                >
                  <span className="flex-shrink-0 text-xs font-medium tabular-nums text-ink-400">
                    {block.startTime}–{block.endTime}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{task.title}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <CourseBadge course={course} />
                      <span className="text-[11px] text-ink-400">{block.plannedMinutes} 分钟</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* 今日截止 — deadline === today */}
      <SectionCard
        title="今日截止"
        onViewAll={todayDue.length ? () => onNavigate('tasks') : undefined}
        viewAllLabel="查看全部"
      >
        {todayDue.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="今天没有截止任务" hint="好好享受没有 deadline 的一天" />
        ) : (
          <div className="stagger space-y-2">
            {todayDue.map((t) => (
              <DeadlineRow key={t.id} task={t} onOpenTask={onOpenTask} toggleDone={toggleDone} courseById={courseById} />
            ))}
          </div>
        )}
      </SectionCard>

      {/* 逾期 — not done and past deadline */}
      <SectionCard
        title="逾期"
        onViewAll={overdue.length ? () => onNavigate('timeline') : undefined}
        viewAllLabel="查看时间线"
      >
        {overdue.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="没有逾期任务" hint="保持住这个好状态" />
        ) : (
          <div className="stagger space-y-2">
            {overdue.map((t) => (
              <DeadlineRow key={t.id} task={t} onOpenTask={onOpenTask} toggleDone={toggleDone} courseById={courseById} />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function DeadlineRow({
  task,
  onOpenTask,
  toggleDone,
  courseById,
}: {
  task: Task;
  onOpenTask: (t: Task) => void;
  toggleDone: (id: string) => void;
  courseById: Map<string, import('@/types').Course>;
}) {
  const course = task.courseId ? courseById.get(task.courseId) : undefined;
  const est = formatEstimate(task.estimatedMinutes);
  const due = relativeDue(task.dueDate);
  return (
    <div className="flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 transition hover:border-brand-100 hover:bg-brand-50/50">
      <Checkbox checked={task.status === 'done'} onChange={() => toggleDone(task.id)} />
      <button onClick={() => onOpenTask(task)} className="min-w-0 flex-1 text-left">
        <p className={`truncate text-sm font-medium ${task.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
          {task.title}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <PriorityDot priority={task.priority} />
          <StatusBadge status={task.status} />
          <CourseBadge course={course} />
          <span className={`text-[11px] ${due.tone === 'overdue' ? 'text-rose-500' : 'text-ink-400'}`}>{due.label}</span>
          {est && <span className="text-[11px] text-ink-400">{est}</span>}
        </div>
      </button>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-brand-100 bg-white/80 p-4 backdrop-blur-sm">
      <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${danger ? 'bg-rose-100 text-rose-500' : 'bg-brand-100 text-brand-600'}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-lg font-bold text-ink-900">{value}</p>
        <p className="text-xs text-ink-400">{label}</p>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  onViewAll,
  viewAllLabel,
  children,
}: {
  title: string;
  onViewAll?: () => void;
  viewAllLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-brand-100 bg-white/80 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-bold text-ink-900">{title}</p>
        {onViewAll && viewAllLabel && (
          <button onClick={onViewAll} className="text-xs font-medium text-brand-500 hover:text-brand-600">
            {viewAllLabel} →
          </button>
        )}
      </div>
      {children}
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
