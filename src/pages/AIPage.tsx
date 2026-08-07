import { useMemo, useState } from 'react';
import { Sparkles, Wand2, CalendarClock, ClipboardList, ArrowRight, Lightbulb } from 'lucide-react';
import { useFlow } from '@/store';
import { aiDecompose, aiPlan, aiSummary, type PlanSlot } from '@/lib/ai';
import { formatShort } from '@/lib/date';
import type { Task } from '@/types';
import { PRIORITY_LABELS } from '@/types';

type Tab = 'decompose' | 'plan' | 'summary';

export function AIPage({ onApplySubtasks }: { onApplySubtasks: (task: Task, subs: string[]) => void }) {
  const { tasks } = useFlow();
  const [tab, setTab] = useState<Tab>('decompose');

  return (
    <div className="animate-fade-in space-y-5">
      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        <TabBtn active={tab === 'decompose'} onClick={() => setTab('decompose')} icon={Wand2}>AI 任务拆解</TabBtn>
        <TabBtn active={tab === 'plan'} onClick={() => setTab('plan')} icon={CalendarClock}>AI 计划安排</TabBtn>
        <TabBtn active={tab === 'summary'} onClick={() => setTab('summary')} icon={ClipboardList}>AI 总结</TabBtn>
      </div>

      {tab === 'decompose' && <DecomposePanel onApplySubtasks={onApplySubtasks} />}
      {tab === 'plan' && <PlanPanel tasks={tasks} />}
      {tab === 'summary' && <SummaryPanel tasks={tasks} />}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-2xl px-4 py-2 text-sm font-semibold transition ${
        active ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-300/40' : 'bg-white/70 text-ink-500 ring-1 ring-brand-100 hover:bg-brand-50'
      }`}
    >
      <Icon className="h-4 w-4" /> {children}
    </button>
  );
}

function DecomposePanel({ onApplySubtasks }: { onApplySubtasks: (task: Task, subs: string[]) => void }) {
  const { tasks, updateTask } = useFlow();
  const [input, setInput] = useState('');
  const [steps, setSteps] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  const run = () => {
    if (!input.trim()) return;
    setLoading(true);
    setSteps(null);
    setTimeout(() => {
      setSteps(aiDecompose(input));
      setLoading(false);
    }, 600);
  };

  const applyToTask = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task && steps) onApplySubtasks(task, steps);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-[24px] border border-brand-100 bg-white/80 p-5">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-500">
            <Wand2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-bold text-ink-900">任务拆解</p>
            <p className="text-[11px] text-ink-400">输入一个大任务，AI 帮你拆成可执行的小步骤</p>
          </div>
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="例如：准备数学考试"
          rows={3}
          className="w-full resize-none rounded-2xl border border-brand-100 bg-white/70 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-200"
        />
        <button
          onClick={run}
          disabled={!input.trim() || loading}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-300/40 transition hover:shadow-xl disabled:opacity-40"
        >
          <Sparkles className="h-4 w-4" /> {loading ? '思考中...' : '开始拆解'}
        </button>

        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold text-ink-400">或选择已有任务进行拆解：</p>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {tasks.filter((t) => t.status !== 'done').slice(0, 8).map((t) => (
              <button
                key={t.id}
                onClick={() => { setInput(t.title); setSteps(null); }}
                className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs text-ink-600 hover:bg-brand-50"
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-[24px] border border-brand-100 bg-white/80 p-5">
        <p className="mb-3 text-sm font-bold text-ink-900">拆解结果</p>
        {loading && (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded-2xl shimmer" />
            ))}
          </div>
        )}
        {!loading && !steps && (
          <div className="flex flex-col items-center py-12 text-center">
            <Lightbulb className="h-10 w-10 text-brand-200" />
            <p className="mt-3 text-xs text-ink-400">输入任务后点击「开始拆解」</p>
          </div>
        )}
        {!loading && steps && (
          <div className="space-y-2">
            {steps.map((s, i) => (
              <div key={i} className="animate-slide-in-right flex items-center gap-3 rounded-xl border border-brand-50 bg-sand-50 px-3.5 py-2.5" style={{ animationDelay: `${i * 0.06}s` }}>
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">{i + 1}</span>
                <span className="flex-1 text-sm text-ink-700">{s}</span>
              </div>
            ))}
            <div className="mt-3 flex flex-wrap gap-2">
              {tasks.filter((t) => t.status !== 'done').map((t) => (
                <button
                  key={t.id}
                  onClick={() => applyToTask(t.id)}
                  className="flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-100"
                >
                  应用到「{t.title.slice(0, 8)}...」 <ArrowRight className="h-3 w-3" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanPanel({ tasks }: { tasks: Task[] }) {
  const [slots, setSlots] = useState<PlanSlot[] | null>(null);
  const [loading, setLoading] = useState(false);

  const run = () => {
    setLoading(true);
    setSlots(null);
    setTimeout(() => {
      setSlots(aiPlan(tasks));
      setLoading(false);
    }, 600);
  };

  const grouped = useMemo(() => {
    if (!slots) return [];
    const map: Record<string, PlanSlot[]> = {};
    for (const s of slots) (map[s.date] ||= []).push(s);
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [slots]);

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-brand-100 bg-white/80 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-500">
              <CalendarClock className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink-900">智能计划安排</p>
              <p className="text-[11px] text-ink-400">根据任务数量、截止日期和优先级自动生成未来 7 天学习计划</p>
            </div>
          </div>
          <button
            onClick={run}
            disabled={loading || tasks.filter((t) => t.status !== 'done').length === 0}
            className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-300/40 transition hover:shadow-xl disabled:opacity-40"
          >
            <Sparkles className="h-4 w-4" /> {loading ? '生成中...' : '生成计划'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 rounded-[20px] shimmer" />
          ))}
        </div>
      )}

      {!loading && slots && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {grouped.map(([date, daySlots]) => (
            <div key={date} className="animate-pop-in rounded-2xl border border-brand-100 bg-white/70 p-4">
              <p className="mb-2 text-sm font-bold text-brand-600">{formatShort(date)}</p>
              <div className="space-y-2">
                {daySlots.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-sand-50 px-3 py-2">
                    <span className="text-xs font-bold text-ink-500">{s.time}</span>
                    <span className="flex-1 truncate text-xs text-ink-700">{s.taskTitle}</span>
                    <span className={`h-2 w-2 rounded-full ${s.priority === 'high' ? 'bg-rose-500' : s.priority === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !slots && tasks.filter((t) => t.status !== 'done').length === 0 && (
        <div className="rounded-2xl border border-brand-100 bg-white/70 py-12 text-center text-sm text-ink-400">
          没有待安排的任务，先去添加一些任务吧
        </div>
      )}
    </div>
  );
}

function SummaryPanel({ tasks }: { tasks: Task[] }) {
  const summary = useMemo(() => aiSummary(tasks), [tasks]);
  const todayTasks = tasks.filter((t) => t.dueDate === new Date().toISOString().slice(0, 10));

  const toneColor = {
    great: 'from-emerald-400 to-emerald-500',
    good: 'from-brand-400 to-brand-500',
    ok: 'from-amber-400 to-amber-500',
    low: 'from-rose-400 to-rose-500',
  }[summary.efficiency];

  return (
    <div className="space-y-4">
      <div className={`relative overflow-hidden rounded-[28px] bg-gradient-to-br ${toneColor} p-6 text-white shadow-xl`}>
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            <p className="text-sm font-semibold">今日学习总结</p>
          </div>
          <p className="text-lg font-bold leading-relaxed">{summary.text}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-brand-100 bg-white/70 p-4 text-center">
          <p className="text-2xl font-bold text-brand-500">{summary.completed}</p>
          <p className="text-xs text-ink-400">已完成</p>
        </div>
        <div className="rounded-2xl border border-brand-100 bg-white/70 p-4 text-center">
          <p className="text-2xl font-bold text-amber-500">{summary.pending}</p>
          <p className="text-xs text-ink-400">待完成</p>
        </div>
        <div className="rounded-2xl border border-brand-100 bg-white/70 p-4 text-center">
          <p className="text-2xl font-bold text-emerald-500">
            {todayTasks.length ? Math.round((summary.completed / todayTasks.length) * 100) : 0}%
          </p>
          <p className="text-xs text-ink-400">完成率</p>
        </div>
      </div>

      <div className="rounded-[24px] border border-brand-100 bg-white/80 p-5">
        <p className="mb-3 text-sm font-bold text-ink-900">今日任务回顾</p>
        {todayTasks.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-400">今天还没有任务记录</p>
        ) : (
          <div className="space-y-2">
            {todayTasks.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-xl border border-brand-50 px-3 py-2.5">
                <span className={`h-2.5 w-2.5 rounded-full ${t.status === 'done' ? 'bg-emerald-500' : t.status === 'doing' ? 'bg-brand-500' : 'bg-slate-300'}`} />
                <span className={`flex-1 text-sm ${t.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-700'}`}>{t.title}</span>
                <span className="text-xs text-ink-400">{PRIORITY_LABELS[t.priority]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
