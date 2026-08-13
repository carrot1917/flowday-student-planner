// Phase 2 — smart scheduling UI (proposal workflow).
//
// Thin React layer over the pure proposal/transaction/conflict modules. It:
//   1. lets the user tune SchedulerV2Settings (horizon, caps, breaks, periods…),
//   2. generates a ScheduleProposal (preview only — nothing is persisted),
//   3. lets the user edit the preview (remove / lock / move / regenerate / exclude),
//   4. shows real-time conflicts over existing + proposed blocks,
//   5. confirms via a transaction (undoable) or regenerates with a scope.
//
// The component owns NO scheduling logic — every rule lives in the pure layer.

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Info,
  Lock,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
  Unlock,
  Wand2,
  X,
} from 'lucide-react';
import {
  useTasks,
  useScheduleBlocks,
  useAvailability,
  useSettings,
  useProposal,
  useActions,
} from '@/store';
import { detectScheduleConflicts, type ScheduleConflict } from '@/lib/conflict';
import { defaultV2SettingsFromSettings } from '@/lib/scheduleRun';
import {
  DEFAULT_V2_SETTINGS,
  type PreferredPeriod,
  type ReplanScope,
  type SchedulerV2Settings,
  type UnscheduledReasonCode,
} from '@/lib/proposal';
import { groupBlocksByDate, sortScheduleBlocks } from '@/lib/schedule';
import { formatShort, todayISO } from '@/lib/date';
import { EmptyState } from '@/components/ui';

const REASON_TEXT: Record<UnscheduledReasonCode, string> = {
  NO_ESTIMATE: '任务没有预估时长',
  INVALID_DEADLINE: '任务截止日期非法',
  DEADLINE_TOO_CLOSE: '截止日期已过或太近，无法排期',
  NO_AVAILABILITY: '截止日期前没有可用时间',
  BLOCKED_BY_LOCKED_SESSIONS: '可用时间被锁定/手动时段占满',
  DAILY_LIMIT_REACHED: '每日学习上限限制了可排时长',
  NO_SLOT_LARGE_ENOUGH: '没有足够长的连续空闲时段',
  OUTSIDE_HORIZON: '在排期范围内无法安排完整时长',
};

const HORIZON_OPTIONS = [7, 14, 30];
const PERIOD_LABELS: Record<PreferredPeriod, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
};

export function ScheduleSuggestions() {
  const { tasks, taskById } = useTasks();
  const { scheduleBlocks } = useScheduleBlocks();
  const { availability } = useAvailability();
  const { settings } = useSettings();
  const { proposal, lastTransaction } = useProposal();
  const {
    generateProposal,
    confirmProposal,
    undoLastConfirm,
    dismissProposal,
    removeProposedBlock,
    updateProposedBlock,
    toggleProposedBlockLock,
    regenerateTaskInProposal,
  } = useActions();

  const [v2, setV2] = useState<SchedulerV2Settings>(() => defaultV2SettingsFromSettings(settings));
  const [showSettings, setShowSettings] = useState(false);
  const [excludedTaskIds, setExcludedTaskIds] = useState<string[]>([]);
  const [replanScope, setReplanScope] = useState<ReplanScope>({ type: 'all-unlocked' });

  const from = todayISO();

  const handleGenerate = () => {
    generateProposal(v2, from, { excludedTaskIds, replanScope });
  };

  const proposedIds = useMemo(
    () => new Set((proposal?.blocks ?? []).map((b) => b.block.id)),
    [proposal],
  );

  // Real-time conflicts over existing + proposed, split by whether they involve
  // a proposed block. The v2 settings are passed so the new constraint checks
  // (daily cap, break, duration, deadline) are active.
  const { existingOnly, suggestionRelated, blockingErrors } = useMemo(() => {
    if (!proposal) {
      return {
        existingOnly: [] as ScheduleConflict[],
        suggestionRelated: [] as ScheduleConflict[],
        blockingErrors: [] as ScheduleConflict[],
      };
    }
    const proposedBlocks = proposal.blocks.map((pb) => pb.block);
    const all = detectScheduleConflicts({
      blocks: [...scheduleBlocks, ...proposedBlocks],
      taskById,
      availability,
      dailyMaxMinutes: v2.dailyStudyLimitMinutes,
      breakMinutes: v2.breakMinutes,
      minBlockMinutes: v2.minBlockMinutes,
      maxBlockMinutes: v2.maxBlockMinutes,
      allowDeadlineDay: v2.allowDeadlineDay,
    });
    const related = all.filter((c) => c.blockIds.some((id) => proposedIds.has(id)));
    const existing = all.filter((c) => !c.blockIds.some((id) => proposedIds.has(id)));
    return {
      existingOnly: existing,
      suggestionRelated: related,
      blockingErrors: related.filter(
        (c) => c.severity === 'error' && c.type !== 'minimum-break',
      ),
    };
  }, [proposal, scheduleBlocks, taskById, availability, proposedIds, v2]);

  const grouped = useMemo(() => {
    if (!proposal) return [];
    const map = groupBlocksByDate(proposal.blocks.map((pb) => pb.block));
    return Object.keys(map)
      .sort((a, b) => a.localeCompare(b))
      .map((date) => [date, sortScheduleBlocks(map[date])] as const);
  }, [proposal]);

  const totalMinutes = (proposal?.blocks ?? []).reduce(
    (s, b) => s + (b.block.plannedMinutes || 0),
    0,
  );

  const toggleExclude = (taskId: string) => {
    setExcludedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );
  };

  const canConfirm = !!proposal && proposal.blocks.length > 0 && blockingErrors.length === 0;

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
                生成可预览、可编辑的学习排期建议，确认前不会写入日历，确认后可撤销
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowSettings((v) => !v)}
              className={`flex items-center gap-1.5 rounded-2xl px-3 py-2 text-sm font-semibold ring-1 transition ${
                showSettings
                  ? 'bg-brand-500 text-white ring-brand-500'
                  : 'bg-white/70 text-ink-500 ring-brand-100 hover:bg-brand-50'
              }`}
            >
              <Settings2 className="h-4 w-4" /> 排期设置
            </button>
            {proposal && (
              <button
                onClick={dismissProposal}
                className="flex items-center gap-1.5 rounded-2xl bg-white/70 px-3 py-2 text-sm font-semibold text-ink-500 ring-1 ring-brand-100 transition hover:bg-brand-50"
              >
                <X className="h-4 w-4" /> 取消
              </button>
            )}
            <button
              onClick={handleGenerate}
              className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-300/40 transition hover:shadow-xl"
            >
              <Sparkles className="h-4 w-4" /> {proposal ? '重新生成' : '生成排期建议'}
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="mt-4 grid gap-3 border-t border-brand-50 pt-4 sm:grid-cols-2">
            <Field label="排期范围">
              <div className="flex rounded-xl border border-brand-100 bg-white p-0.5">
                {HORIZON_OPTIONS.map((h) => (
                  <button
                    key={h}
                    onClick={() => setV2((s) => ({ ...s, horizonDays: h }))}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      v2.horizonDays === h ? 'bg-brand-500 text-white' : 'text-ink-500 hover:bg-brand-50'
                    }`}
                  >
                    {h} 天
                  </button>
                ))}
              </div>
            </Field>
            <Field label="每日学习上限（分钟）">
              <NumInput value={v2.dailyStudyLimitMinutes} min={60} max={1440} step={30}
                onChange={(n) => setV2((s) => ({ ...s, dailyStudyLimitMinutes: n }))} />
            </Field>
            <Field label="最短专注时段（分钟）">
              <NumInput value={v2.minBlockMinutes} min={5} max={120} step={5}
                onChange={(n) => setV2((s) => ({ ...s, minBlockMinutes: n }))} />
            </Field>
            <Field label="最长专注时段（分钟）">
              <NumInput value={v2.maxBlockMinutes} min={30} max={480} step={15}
                onChange={(n) => setV2((s) => ({ ...s, maxBlockMinutes: n }))} />
            </Field>
            <Field label="块间休息（分钟）">
              <NumInput value={v2.breakMinutes} min={0} max={60} step={5}
                onChange={(n) => setV2((s) => ({ ...s, breakMinutes: n }))} />
            </Field>
            <Field label="偏好学习时段">
              <div className="flex gap-1.5">
                {(['morning', 'afternoon', 'evening'] as PreferredPeriod[]).map((p) => {
                  const active = v2.preferredPeriods.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() =>
                        setV2((s) => ({
                          ...s,
                          preferredPeriods: active
                            ? s.preferredPeriods.filter((x) => x !== p)
                            : [...s.preferredPeriods, p],
                        }))
                      }
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                        active ? 'bg-brand-500 text-white' : 'bg-white text-ink-500 ring-1 ring-brand-100'
                      }`}
                    >
                      {PERIOD_LABELS[p]}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="截止日当天排期">
              <Toggle checked={v2.allowDeadlineDay} onChange={(c) => setV2((s) => ({ ...s, allowDeadlineDay: c }))} />
            </Field>
            <Field label="重排范围">
              <div className="flex flex-wrap gap-1.5">
                <ScopeChip active={replanScope.type === 'all-unlocked'} onClick={() => setReplanScope({ type: 'all-unlocked' })}>
                  全部未锁定
                </ScopeChip>
                <ScopeChip active={replanScope.type === 'day'} onClick={() => setReplanScope({ type: 'day', date: from })}>
                  仅今天
                </ScopeChip>
              </div>
            </Field>
            <div className="sm:col-span-2 flex items-start gap-1.5 rounded-xl bg-sand-50 px-3 py-2 text-[11px] text-ink-400">
              <Lock className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>手动安排、锁定时段与外部忙碌时段始终受到保护，自动排期不会移动它们。</span>
            </div>
          </div>
        )}
      </div>

      {/* Undo feedback */}
      {lastTransaction && !proposal && (
        <div className="animate-pop-in flex items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            已确认并写入 {lastTransaction.addedBlockIds.length} 个学习时段（替换 {lastTransaction.replacedBlockSnapshots.length} 个旧时段）。
          </div>
          <button
            onClick={undoLastConfirm}
            className="flex items-center gap-1.5 rounded-xl bg-white/70 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
          >
            <RotateCcw className="h-3.5 w-3.5" /> 撤销
          </button>
        </div>
      )}

      {/* Idle */}
      {!proposal && !lastTransaction && (
        <div className="rounded-[24px] border border-brand-100 bg-white/70 py-4">
          <EmptyState
            icon={CalendarClock}
            title="还没有生成排期建议"
            hint="调整排期设置后点击「生成排期建议」，确认前可自由编辑"
          />
        </div>
      )}

      {proposal && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            <SummaryCard value={proposal.blocks.length} label="建议时段" tone="brand" />
            <SummaryCard value={Math.round(totalMinutes / 6) / 10} label="总时长（小时）" tone="emerald" />
            <SummaryCard value={proposal.score} label="综合评分" tone="brand" />
            <SummaryCard value={proposal.unscheduled.length} label="未能安排" tone="amber" />
          </div>

          {proposal.warnings.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-700">
              {proposal.warnings.map((w, i) => (
                <p key={i} className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3" /> {w}
                </p>
              ))}
            </div>
          )}

          {/* Conflicts on suggestions */}
          {suggestionRelated.length > 0 && (
            <ConflictBox
              tone={blockingErrors.length > 0 ? 'error' : 'warning'}
              title={
                blockingErrors.length > 0
                  ? `建议时段存在 ${blockingErrors.length} 个严重冲突，需先调整或重新生成`
                  : `建议时段有 ${suggestionRelated.length} 条提醒（不影响确认）`
              }
              conflicts={suggestionRelated}
            />
          )}

          {existingOnly.length > 0 && (
            <ConflictBox
              tone="info"
              title={`你已有的学习时段中检测到 ${existingOnly.length} 条冲突（与本次建议无关）`}
              conflicts={existingOnly}
            />
          )}

          {/* Proposed blocks */}
          {proposal.blocks.length === 0 ? (
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
                    {blocks.map((b) => {
                      const pb = proposal.blocks.find((x) => x.block.id === b.id)!;
                      const locked = pb.lockedByUser ?? pb.block.locked;
                      return (
                        <div key={b.id} className="rounded-lg bg-sand-50 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-ink-500">
                              {b.startTime}–{b.endTime}
                            </span>
                            <span className="flex-1 truncate text-xs text-ink-700">
                              {b.taskId ? taskById.get(b.taskId)?.title ?? '未知任务' : '未关联任务'}
                            </span>
                            <span className="text-[10px] text-brand-500">评分 {pb.score}</span>
                          </div>
                          {pb.reasons.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {pb.reasons.map((r, i) => (
                                <li key={i} className="flex items-start gap-1 text-[10px] text-ink-400">
                                  <Info className="mt-0.5 h-2.5 w-2.5 flex-shrink-0" /> {r}
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="mt-1.5 flex items-center gap-1">
                            <IconBtn
                              onClick={() => toggleProposedBlockLock(b.id)}
                              title={locked ? '解锁' : '锁定'}
                              tone={locked ? 'brand' : 'muted'}
                            >
                              {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                            </IconBtn>
                            {b.taskId && (
                              <IconBtn
                                onClick={() => regenerateTaskInProposal(b.taskId!)}
                                title="重新生成该任务"
                                tone="muted"
                              >
                                <RotateCcw className="h-3 w-3" />
                              </IconBtn>
                            )}
                            <IconBtn
                              onClick={() => removeProposedBlock(b.id)}
                              title="删除该建议"
                              tone="danger"
                            >
                              <Trash2 className="h-3 w-3" />
                            </IconBtn>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Unscheduled */}
          {proposal.unscheduled.length > 0 && (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50/70 p-5">
              <div className="mb-2 flex items-center gap-2 text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                <p className="text-sm font-bold">以下任务未能完全安排</p>
              </div>
              <div className="space-y-1.5">
                {proposal.unscheduled.map((u) => {
                  const task = taskById.get(u.taskId);
                  return (
                    <div key={u.taskId} className="rounded-xl bg-white/60 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-600">
                        <span className="font-semibold text-ink-700">
                          {task?.title ?? '未知任务'}
                        </span>
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          {u.reason}
                        </span>
                        <span className="text-ink-400">·</span>
                        <span>{REASON_TEXT[u.reason]}</span>
                        {u.remainingMinutes > 0 && (
                          <>
                            <span className="text-ink-400">·</span>
                            <span>还差 {u.remainingMinutes} 分钟</span>
                          </>
                        )}
                      </div>
                      {task && (
                        <button
                          onClick={() => toggleExclude(task.id)}
                          className="mt-1.5 text-[10px] font-medium text-brand-500 hover:underline"
                        >
                          {excludedTaskIds.includes(task.id) ? '恢复该任务' : '排除该任务并重排'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Confirm */}
          <div className="flex flex-wrap items-center justify-end gap-3">
            {blockingErrors.length > 0 && (
              <p className="text-xs text-rose-500">存在严重冲突，无法确认，请调整或重新生成</p>
            )}
            <button
              onClick={confirmProposal}
              disabled={!canConfirm}
              className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-400 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-300/40 transition hover:shadow-xl disabled:opacity-40 disabled:shadow-none"
            >
              <CheckCircle2 className="h-4 w-4" /> 确认并写入日历（可撤销）
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- small UI

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-ink-500">{label}</span>
      {children}
    </label>
  );
}

function NumInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (!isNaN(n) && n >= 0) onChange(n);
      }}
      className="w-full rounded-xl border border-brand-100 bg-white/70 px-3 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
    />
  );
}

function ScopeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
        active ? 'bg-brand-500 text-white' : 'bg-white text-ink-500 ring-1 ring-brand-100'
      }`}
    >
      {children}
    </button>
  );
}

function IconBtn({
  onClick,
  title,
  tone,
  children,
}: {
  onClick: () => void;
  title: string;
  tone: 'brand' | 'muted' | 'danger';
  children: React.ReactNode;
}) {
  const cls = {
    brand: 'text-brand-500 hover:bg-brand-50',
    muted: 'text-ink-400 hover:bg-brand-50 hover:text-brand-600',
    danger: 'text-ink-400 hover:bg-rose-50 hover:text-rose-500',
  }[tone];
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`rounded-md p-1 transition ${cls}`}
    >
      {children}
    </button>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-brand-500' : 'bg-slate-200'}`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function SummaryCard({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: 'brand' | 'emerald' | 'amber';
}) {
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
