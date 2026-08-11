// Phase 4D — smart scheduling UI (thin React layer).
//
// This component owns NO business logic. It only:
//   1. reads state from the store,
//   2. injects the current date and calls the pure 4B scheduler,
//   3. runs the pure 4C conflict detector over existing + suggested blocks,
//   4. renders the result and, on confirm, hands the blocks to the store.
//
// Suggestions live in component memory only — nothing is persisted until the
// user confirms, and a page refresh drops them.

import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Info, Sparkles, X } from 'lucide-react';
import { useTasks, useScheduleBlocks, useAvailability, useActions } from '@/store';
import { buildScheduleInput } from '@/lib/scheduleRun';
import { generateSchedule, type ScheduleResult, type UnscheduledReason } from '@/lib/scheduler';
import { detectScheduleConflicts, type ScheduleConflict } from '@/lib/conflict';
import { groupBlocksByDate, sortScheduleBlocks } from '@/lib/schedule';
import { formatShort, todayISO } from '@/lib/date';
import { EmptyState } from '@/components/ui';

const UNSCHEDULED_REASON_TEXT: Record<UnscheduledReason, string> = {
  'no-estimate': '任务没有预估时长',
  'invalid-deadline': '任务截止日期非法',
  'deadline-passed': '任务截止日期已过',
  'no-availability': '截止日期前没有可用时间',
  'insufficient-time': '可用时间不足',
};

export function ScheduleSuggestions() {
  const { tasks, taskById } = useTasks();
  const { scheduleBlocks } = useScheduleBlocks();
  const { availability } = useAvailability();
  const { addScheduleBlocks } = useActions();
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [confirmedCount, setConfirmedCount] = useState(0);

  // The clock lives here, in the UI — the helpers stay pure.
  const generate = () => {
    const input = buildScheduleInput({
      tasks,
      availability,
      existingBlocks: scheduleBlocks,
      from: todayISO(),
    });
    setResult(generateSchedule(input));
    setConfirmedCount(0);
  };

  const suggestedIds = useMemo(
    () => new Set((result?.blocks ?? []).map((b) => b.id)),
    [result],
  );

  // Conflicts are always computed over existing + suggested, then split: only
  // suggestion-related ones can gate the confirm button.
  const { existingOnly, suggestionRelated, blockingErrors } = useMemo(() => {
    if (!result) {
      return { existingOnly: [] as ScheduleConflict[], suggestionRelated: [] as ScheduleConflict[], blockingErrors: [] as ScheduleConflict[] };
    }
    const all = detectScheduleConflicts({
      blocks: [...scheduleBlocks, ...result.blocks],
      taskById,
      availability,
    });
    const related = all.filter((c) => c.blockIds.some((id) => suggestedIds.has(id)));
    const existing = all.filter((c) => !c.blockIds.some((id) => suggestedIds.has(id)));
    return {
      existingOnly: existing,
      suggestionRelated: related,
      blockingErrors: related.filter((c) => c.severity === 'error'),
    };
  }, [result, scheduleBlocks, taskById, availability, suggestedIds]);

  const grouped = useMemo(() => {
    if (!result) return [];
    const map = groupBlocksByDate(result.blocks);
    return Object.keys(map)
      .sort((a, b) => a.localeCompare(b))
      .map((date) => [date, sortScheduleBlocks(map[date])] as const);
  }, [result]);

  const confirm = () => {
    if (!result || blockingErrors.length > 0) return;
    addScheduleBlocks(result.blocks);
    setConfirmedCount(result.blocks.length);
    setResult(null);
  };

  const cancel = () => {
    setResult(null);
    setConfirmedCount(0);
  };

  const totalMinutes = (result?.blocks ?? []).reduce((s, b) => s + (b.plannedMinutes || 0), 0);

  return (
    <div className="space-y-4">
      {/* Header / action bar */}
      <div className="rounded-[24px] border border-brand-100 bg-white/80 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-500">
              <CalendarClock className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink-900">智能排期</p>
              <p className="text-[11px] text-ink-400">
                按任务优先级与截止日期，在你设置的可用时间里自动安排学习时段（未来 14 天）
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {result && (
              <button
                onClick={cancel}
                className="flex items-center gap-1.5 rounded-2xl bg-white/70 px-3.5 py-2 text-sm font-semibold text-ink-500 ring-1 ring-brand-100 transition hover:bg-brand-50"
              >
                <X className="h-4 w-4" /> 取消
              </button>
            )}
            <button
              onClick={generate}
              className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-300/40 transition hover:shadow-xl"
            >
              <Sparkles className="h-4 w-4" /> {result ? '重新生成' : '生成排期建议'}
            </button>
          </div>
        </div>
      </div>

      {/* Confirmed feedback */}
      {!result && confirmedCount > 0 && (
        <div className="animate-pop-in flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          已确认并写入 {confirmedCount} 个学习时段，可在日历中查看。
        </div>
      )}

      {/* Idle */}
      {!result && confirmedCount === 0 && (
        <div className="rounded-[24px] border border-brand-100 bg-white/70 py-4">
          <EmptyState
            icon={CalendarClock}
            title="还没有生成排期建议"
            hint="点击「生成排期建议」，AI 会结合你的可用时间自动安排"
          />
        </div>
      )}

      {result && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <SummaryCard value={result.blocks.length} label="建议时段" tone="brand" />
            <SummaryCard value={Math.round(totalMinutes / 6) / 10} label="总时长（小时）" tone="emerald" />
            <SummaryCard value={result.unscheduled.length} label="未能安排" tone="amber" />
          </div>

          {/* Conflicts on suggestions */}
          {suggestionRelated.length > 0 && (
            <ConflictBox
              tone={blockingErrors.length > 0 ? 'error' : 'warning'}
              title={
                blockingErrors.length > 0
                  ? `建议时段存在 ${blockingErrors.length} 个严重冲突，需先重新生成`
                  : `建议时段有 ${suggestionRelated.length} 条提醒（不影响确认）`
              }
              conflicts={suggestionRelated}
            />
          )}

          {/* Conflicts that already exist in the user's own blocks */}
          {existingOnly.length > 0 && (
            <ConflictBox
              tone="info"
              title={`你已有的学习时段中检测到 ${existingOnly.length} 条冲突（与本次建议无关）`}
              conflicts={existingOnly}
            />
          )}

          {/* Suggested blocks */}
          {result.blocks.length === 0 ? (
            <div className="rounded-2xl border border-brand-100 bg-white/70 py-10 text-center text-sm text-ink-400">
              没有生成任何学习时段
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {grouped.map(([date, blocks]) => (
                <div key={date} className="animate-pop-in rounded-2xl border border-brand-100 bg-white/70 p-4">
                  <div className="mb-2 flex items-baseline justify-between">
                    <p className="text-sm font-bold text-brand-600">{formatShort(date)}</p>
                    <p className="text-[11px] text-ink-400">{blocks.length} 段</p>
                  </div>
                  <div className="space-y-2">
                    {blocks.map((b) => (
                      <div key={b.id} className="flex items-center gap-2 rounded-lg bg-sand-50 px-3 py-2">
                        <span className="text-xs font-bold text-ink-500">
                          {b.startTime}–{b.endTime}
                        </span>
                        <span className="flex-1 truncate text-xs text-ink-700">
                          {taskById.get(b.taskId)?.title ?? '未知任务'}
                        </span>
                        <span className="text-[11px] text-ink-400">{b.plannedMinutes}′</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Unscheduled */}
          {result.unscheduled.length > 0 && (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50/70 p-5">
              <div className="mb-2 flex items-center gap-2 text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                <p className="text-sm font-bold">以下任务未能完全安排</p>
              </div>
              <div className="space-y-1.5">
                {result.unscheduled.map((u) => (
                  <div key={u.taskId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-600">
                    <span className="font-semibold text-ink-700">
                      {taskById.get(u.taskId)?.title ?? '未知任务'}
                    </span>
                    <span className="text-ink-400">·</span>
                    <span>{UNSCHEDULED_REASON_TEXT[u.reason]}</span>
                    {u.remainingMinutes > 0 && (
                      <>
                        <span className="text-ink-400">·</span>
                        <span>还差 {u.remainingMinutes} 分钟</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confirm */}
          <div className="flex flex-wrap items-center justify-end gap-3">
            {blockingErrors.length > 0 && (
              <p className="text-xs text-rose-500">存在严重冲突，无法确认，请调整可用时间或重新生成</p>
            )}
            <button
              onClick={confirm}
              disabled={result.blocks.length === 0 || blockingErrors.length > 0}
              className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-400 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-300/40 transition hover:shadow-xl disabled:opacity-40 disabled:shadow-none"
            >
              <CheckCircle2 className="h-4 w-4" /> 确认并写入日历
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ value, label, tone }: { value: number; label: string; tone: 'brand' | 'emerald' | 'amber' }) {
  const color = { brand: 'text-brand-500', emerald: 'text-emerald-500', amber: 'text-amber-500' }[tone];
  return (
    <div className="rounded-2xl border border-brand-100 bg-white/70 p-4 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-ink-400">{label}</p>
    </div>
  );
}

function ConflictBox({
  tone,
  title,
  conflicts,
}: {
  tone: 'error' | 'warning' | 'info';
  title: string;
  conflicts: ScheduleConflict[];
}) {
  const style = {
    error: { box: 'border-rose-200 bg-rose-50/70', head: 'text-rose-600', Icon: AlertTriangle },
    warning: { box: 'border-amber-200 bg-amber-50/70', head: 'text-amber-700', Icon: AlertTriangle },
    info: { box: 'border-brand-100 bg-white/70', head: 'text-ink-500', Icon: Info },
  }[tone];
  const Icon = style.Icon;

  return (
    <div className={`rounded-[24px] border p-5 ${style.box}`}>
      <div className={`mb-2 flex items-center gap-2 ${style.head}`}>
        <Icon className="h-4 w-4" />
        <p className="text-sm font-bold">{title}</p>
      </div>
      <div className="space-y-1">
        {conflicts.map((c, i) => (
          <p key={`${c.type}-${c.blockIds.join(',')}-${i}`} className="text-xs text-ink-600">
            <span className="text-ink-400">{c.date ? `${c.date} · ` : ''}</span>
            {c.message}
          </p>
        ))}
      </div>
    </div>
  );
}
