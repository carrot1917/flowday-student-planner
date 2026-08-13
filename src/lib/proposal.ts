// Phase 2 — Smart Scheduling v2 (the "proposal" scheduler).
//
// A pure, deterministic two-stage heuristic that upgrades the Phase 4B greedy
// scheduler into an explainable, previewable, editable planner.
//
// Hard boundaries (same as scheduler.ts):
//   - pure functions only: no React, no store, no persistence, no clock;
//   - `from` and `generatedAt` are injected by the caller;
//   - inputs are never mutated;
//   - manual / locked / external blocks are NEVER moved or removed;
//   - identical input + settings always produce identical output.
//
// It does NOT replace scheduler.ts. The shared interval arithmetic
// (mergeIntervals / subtractIntervals / intervalsMinutes) is imported from
// scheduler.ts so the conflict detector and this generator share one interval
// semantics. Scoring is split into small, independently testable functions.

import { addDays, minutesToHHMM, safeFromISO, toISO } from '@/lib/date';
import { normalizeEstimatedMinutes, parseHHMM, weekdayForISO } from '@/lib/domain';
import {
  HORIZON_DAYS_MAX,
  intervalsMinutes,
  mergeIntervals,
  subtractIntervals,
  type Interval,
} from '@/lib/scheduler';
import type { ScheduleBlock, Task, WeeklyAvailability } from '@/types';

// ------------------------------------------------------------------ Settings

export type PreferredPeriod = 'morning' | 'afternoon' | 'evening';

/** Minute-of-day windows for each preferred period (half-open). */
export const PERIOD_BOUNDS: Record<PreferredPeriod, Interval> = {
  morning: { start: 6 * 60, end: 12 * 60 }, // 06:00–12:00
  afternoon: { start: 12 * 60, end: 18 * 60 }, // 12:00–18:00
  evening: { start: 18 * 60, end: 23 * 60 }, // 18:00–23:00
};

export interface SchedulerV2Settings {
  horizonDays: number;
  dailyStudyLimitMinutes: number;
  minBlockMinutes: number;
  maxBlockMinutes: number;
  breakMinutes: number;
  preferredPeriods: PreferredPeriod[];
  allowDeadlineDay: boolean;
  /** When true, manual/locked/external blocks are always preserved (the only
   *  supported mode — kept as an explicit setting for the UI). */
  protectManual: boolean;
}

export const DEFAULT_V2_SETTINGS: SchedulerV2Settings = {
  horizonDays: 14,
  dailyStudyLimitMinutes: 480,
  minBlockMinutes: 25,
  maxBlockMinutes: 120,
  breakMinutes: 5,
  preferredPeriods: [],
  allowDeadlineDay: true,
  protectManual: true,
};

// ------------------------------------------------------------------ Proposal

/** Stable, machine-readable reason codes (UI maps these to copy). */
export type UnscheduledReasonCode =
  | 'NO_ESTIMATE'
  | 'INVALID_DEADLINE'
  | 'DEADLINE_TOO_CLOSE'
  | 'NO_AVAILABILITY'
  | 'BLOCKED_BY_LOCKED_SESSIONS'
  | 'DAILY_LIMIT_REACHED'
  | 'NO_SLOT_LARGE_ENOUGH'
  | 'OUTSIDE_HORIZON';

export interface UnscheduledItem {
  taskId: string;
  remainingMinutes: number;
  reason: UnscheduledReasonCode;
}

export interface ProposedBlock {
  block: ScheduleBlock;
  score: number;
  reasons: string[];
  lockedByUser?: boolean;
}

export interface ScheduleProposal {
  runId: string;
  generatedAt: number;
  from: string;
  horizonDays: number;
  settingsSnapshot: SchedulerV2Settings;
  /** Scope used to generate this proposal; confirm replaces exactly the
   *  removable scheduler blocks inside this scope. */
  replanScope: ReplanScope;
  blocks: ProposedBlock[];
  unscheduled: UnscheduledItem[];
  score: number;
  warnings: string[];
}

// ------------------------------------------------------------------ Replan

export type ReplanScope =
  | { type: 'all-unlocked' }
  | { type: 'task'; taskId: string }
  | { type: 'day'; date: string };

// ------------------------------------------------------------------ Input

export interface ProposalInput {
  tasks: Task[];
  availability: WeeklyAvailability;
  existingBlocks: ScheduleBlock[];
  /** First planning day (YYYY-MM-DD). Injected by the caller. */
  from: string;
  /** Injected timestamp used for block createdAt/updatedAt + runId. */
  generatedAt: number;
  settings: SchedulerV2Settings;
  /** Tasks to skip entirely. */
  excludedTaskIds?: string[];
  /** Limits which existing scheduler blocks may be replaced. */
  replanScope?: ReplanScope;
}

// ------------------------------------------------------------------ Internals

const PRIORITY_RANK: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 };
const LATE_HOUR_START = 21 * 60; // 21:00 — "avoid too late" soft factor

/** A block is removable by the replan ONLY when it is an unlocked scheduler
 *  block AND it falls inside the requested scope. manual/locked/external never. */
export function isRemovable(block: ScheduleBlock, scope: ReplanScope | undefined): boolean {
  if (block.source !== 'scheduler' || block.locked) return false;
  if (!scope || scope.type === 'all-unlocked') return true;
  if (scope.type === 'task') return block.taskId === scope.taskId;
  if (scope.type === 'day') return block.date === scope.date;
  return false;
}

export interface DayPlan {
  date: string;
  /** Availability minus surviving busy, with break padding around surviving
   *  blocks so the minimum-break hard constraint holds for new placements. */
  free: Interval[];
  /** Minutes still allowed today (dailyStudyLimit - surviving busy coverage). */
  budget: number;
  /** Theoretical ceiling: min(freeMinutes, budget). Used to explain failures. */
  capacity: number;
  /** Surviving busy coverage (merged, unpadded) for diagnostics. */
  busyMinutes: number;
  /** Total availability minutes (merged) for diagnostics. */
  availMinutes: number;
}

function toInterval(startTime: string, endTime: string): Interval | null {
  const start = parseHHMM(startTime);
  const end = parseHHMM(endTime);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

/** Expand a surviving busy interval by `break` minutes on each side. */
function padInterval(iv: Interval, pad: number): Interval {
  return { start: iv.start - pad, end: iv.end + pad };
}

function buildDays(
  availability: WeeklyAvailability,
  surviving: ScheduleBlock[],
  from: string,
  horizonDays: number,
  dailyLimit: number,
  breakMinutes: number,
): DayPlan[] {
  const start = safeFromISO(from);
  if (!start) return [];

  const span = Number.isFinite(horizonDays)
    ? Math.min(HORIZON_DAYS_MAX, Math.max(0, Math.floor(horizonDays)))
    : DEFAULT_V2_SETTINGS.horizonDays;

  // Group surviving busy by date.
  const busyByDate = new Map<string, Interval[]>();
  for (const b of surviving) {
    const iv = toInterval(b.startTime, b.endTime);
    if (!iv || typeof b.date !== 'string') continue;
    const list = busyByDate.get(b.date);
    if (list) list.push(iv);
    else busyByDate.set(b.date, [iv]);
  }

  const days: DayPlan[] = [];
  for (let i = 0; i < span; i++) {
    const date = toISO(addDays(start, i));
    const weekday = weekdayForISO(date);
    const slots = weekday ? availability[weekday] ?? [] : [];

    const avail = mergeIntervals(
      slots.map((s) => toInterval(s.startTime, s.endTime)).filter((iv): iv is Interval => iv !== null),
    );
    const availMinutes = intervalsMinutes(avail);

    const rawBusy = mergeIntervals(busyByDate.get(date) ?? []);
    const busyMinutes = intervalsMinutes(rawBusy);

    // Pad surviving busy by break on both sides, then clip to availability so
    // the padding never eats time outside the user's available window in a way
    // that would create bogus free intervals. Free = avail ∩ (avail - padded).
    const padded = breakMinutes > 0 ? rawBusy.map((iv) => padInterval(iv, breakMinutes)) : rawBusy;
    const free = subtractIntervals(avail, mergeIntervals(padded));

    const budget = Math.max(0, dailyLimit - busyMinutes);
    days.push({
      date,
      free,
      budget,
      capacity: Math.min(intervalsMinutes(free), budget),
      busyMinutes,
      availMinutes,
    });
  }
  return days;
}

/** Minutes of surviving blocks for a task (real interval coverage, deduped). */
function survivingMinutesByTask(surviving: ScheduleBlock[]): Map<string, number> {
  const perTaskDay = new Map<string, Map<string, Interval[]>>();
  for (const b of surviving) {
    const iv = toInterval(b.startTime, b.endTime);
    if (!iv || typeof b.taskId !== 'string' || typeof b.date !== 'string') continue;
    let byDate = perTaskDay.get(b.taskId);
    if (!byDate) {
      byDate = new Map<string, Interval[]>();
      perTaskDay.set(b.taskId, byDate);
    }
    const list = byDate.get(b.date);
    if (list) list.push(iv);
    else byDate.set(b.date, [iv]);
  }
  const totals = new Map<string, number>();
  for (const [taskId, byDate] of perTaskDay) {
    let sum = 0;
    for (const intervals of byDate.values()) sum += intervalsMinutes(intervals);
    totals.set(taskId, sum);
  }
  return totals;
}

export interface Candidate {
  index: number;
  id: string;
  dueDate: string;
  remaining: number;
  priority: Task['priority'];
  createdAt: number;
}

function sanitizeBound(v: number, fallback: number, min = 1): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.floor(v));
}

// ------------------------------------------------------------------ Generator

/**
 * Two-stage heuristic:
 *   Stage A — order tasks (deadline → priority → createdAt → id) and place
 *             blocks across the horizon respecting every hard constraint.
 *   Stage B — score each placed block deterministically and attach 1–3
 *             human-readable reasons.
 *
 * The result is a ScheduleProposal — it is NEVER written to the store by this
 * function. The caller confirms it via a transaction (see transaction.ts).
 */
export function generateProposal(input: ProposalInput): ScheduleProposal {
  const {
    tasks,
    availability,
    existingBlocks,
    from,
    generatedAt,
    settings,
    excludedTaskIds,
    replanScope,
  } = input;

  const warnings: string[] = [];
  const start = safeFromISO(from);
  if (!start) {
    warnings.push('起始日期非法，已生成空建议');
    return emptyProposal(input, warnings);
  }

  const horizonDays = sanitizeBound(settings.horizonDays, DEFAULT_V2_SETTINGS.horizonDays, 0);
  const dailyLimit = sanitizeBound(settings.dailyStudyLimitMinutes, DEFAULT_V2_SETTINGS.dailyStudyLimitMinutes, 0);
  const minBlock = sanitizeBound(settings.minBlockMinutes, DEFAULT_V2_SETTINGS.minBlockMinutes);
  const maxBlock = Math.max(minBlock, sanitizeBound(settings.maxBlockMinutes, DEFAULT_V2_SETTINGS.maxBlockMinutes));
  const breakMinutes = Math.max(0, Math.floor(Number.isFinite(settings.breakMinutes) ? settings.breakMinutes : 0));

  // Surviving = blocks NOT removable by the replan scope.
  const surviving = existingBlocks.filter((b) => !isRemovable(b, replanScope));
  const days = buildDays(availability, surviving, from, horizonDays, dailyLimit, breakMinutes);
  const bookedByTask = survivingMinutesByTask(surviving);

  const excluded = new Set(excludedTaskIds ?? []);
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // ---- Stage A: filter + order candidates --------------------------------
  const candidates: Candidate[] = [];
  const rejected: { index: number; entry: UnscheduledItem }[] = [];
  const reject = (index: number, entry: UnscheduledItem) => rejected.push({ index, entry });

  tasks.forEach((task, index) => {
    if (task.status === 'done') return; // finished work is neither planned nor reported
    if (excluded.has(task.id)) return; // user excluded this task
    // Single-task replan: only the scoped task is a placement candidate. Other
    // tasks are skipped entirely (not placed, not reported) — their surviving
    // blocks still count as busy above.
    if (replanScope?.type === 'task' && task.id !== replanScope.taskId) return;

    const estimate = normalizeEstimatedMinutes(task.estimatedMinutes);
    if (estimate === undefined) {
      reject(index, { taskId: task.id, remainingMinutes: 0, reason: 'NO_ESTIMATE' });
      return;
    }
    const dueDate = task.dueDate;
    if (!dueDate || safeFromISO(dueDate) === null) {
      reject(index, { taskId: task.id, remainingMinutes: estimate, reason: 'INVALID_DEADLINE' });
      return;
    }
    if (dueDate < from) {
      reject(index, { taskId: task.id, remainingMinutes: estimate, reason: 'DEADLINE_TOO_CLOSE' });
      return;
    }

    const remaining = Math.max(0, estimate - (bookedByTask.get(task.id) ?? 0));
    if (remaining === 0) return; // already fully planned by surviving blocks

    candidates.push({
      index,
      id: task.id,
      dueDate,
      remaining,
      priority: task.priority,
      createdAt: task.createdAt,
    });
  });

  // Deterministic urgency order (identical to scheduler.ts).
  candidates.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.priority !== b.priority) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Last allowed planning day for a task, honoring allowDeadlineDay.
  const lastAllowedDay = (dueDate: string): string => {
    if (settings.allowDeadlineDay) return dueDate;
    const d = safeFromISO(dueDate);
    return d ? toISO(addDays(d, -1)) : dueDate;
  };

  // ---- Stage A: greedy placement with breaks -----------------------------
  const placed: ScheduleBlock[] = [];
  // Per-day mutable budget + last-placed-end (for minimum break between new blocks).
  const dayBudget = new Map(days.map((d) => [d.date, d.budget]));

  for (const day of days) {
    // Single-day replan: only place blocks on the scoped date. Other days keep
    // their surviving scheduler blocks untouched.
    if (replanScope?.type === 'day' && day.date !== replanScope.date) continue;
    let budget = dayBudget.get(day.date) ?? 0;
    if (budget <= 0 || day.free.length === 0) continue;

    for (const interval of day.free) {
      if (budget <= 0) break;
      let cursor = interval.start;

      while (cursor < interval.end && budget > 0) {
        const target = candidates.find(
          (c) => c.remaining > 0 && day.date <= lastAllowedDay(c.dueDate),
        );
        if (!target) break; // nothing eligible on this day

        const space = interval.end - cursor;
        const len = Math.min(space, target.remaining, budget, maxBlock);
        if (len <= 0) break;
        // Fragment guard: a sub-minimum block is only worth creating when it
        // completes the task outright (matches scheduler.ts semantics).
        if (len < minBlock && len !== target.remaining) {
          // Skip the rest of this interval — advancing cursor would just churn.
          break;
        }

        const startTime = minutesToHHMM(cursor);
        placed.push({
          id: `sb:prop:${target.id}:${day.date}:${startTime}`,
          taskId: target.id,
          date: day.date,
          startTime,
          endTime: minutesToHHMM(cursor + len),
          plannedMinutes: len,
          source: 'scheduler',
          locked: false,
          status: 'planned',
          createdAt: generatedAt,
          updatedAt: generatedAt,
        });

        cursor += len + breakMinutes; // enforce minimum break between new blocks
        budget -= len;
        target.remaining -= len;
      }
    }
    dayBudget.set(day.date, budget);
  }

  // ---- Stage B: classify remaining + score --------------------------------
  for (const c of candidates) {
    if (c.remaining <= 0) continue;
    rejected.push({
      index: c.index,
      entry: {
        taskId: c.id,
        remainingMinutes: c.remaining,
        reason: classifyUnscheduled(c, taskById.get(c.id), days, from, lastAllowedDay(c.dueDate), minBlock),
      },
    });
  }

  // Score every placed block (Stage B).
  const proposedBlocks: ProposedBlock[] = placed.map((block) => {
    const task = block.taskId ? taskById.get(block.taskId) : undefined;
    const { score, reasons } = scoreBlock(block, task, settings, days);
    return { block, score, reasons };
  });

  const overallScore = proposedBlocks.length > 0
    ? Math.round((proposedBlocks.reduce((s, b) => s + b.score, 0) / proposedBlocks.length) * 10) / 10
    : 0;

  const unscheduled = rejected.sort((a, b) => a.index - b.index).map((r) => r.entry);

  return {
    runId: deriveRunId(input),
    generatedAt,
    from,
    horizonDays,
    settingsSnapshot: settings,
    replanScope: replanScope ?? { type: 'all-unlocked' },
    blocks: proposedBlocks.sort((a, b) =>
      a.block.date !== b.block.date
        ? a.block.date < b.block.date
          ? -1
          : 1
        : a.block.startTime.localeCompare(b.block.startTime),
    ),
    unscheduled,
    score: overallScore,
    warnings,
  };
}

function emptyProposal(input: ProposalInput, warnings: string[]): ScheduleProposal {
  return {
    runId: deriveRunId(input),
    generatedAt: input.generatedAt,
    from: input.from,
    horizonDays: input.settings.horizonDays,
    settingsSnapshot: input.settings,
    replanScope: input.replanScope ?? { type: 'all-unlocked' },
    blocks: [],
    unscheduled: [],
    score: 0,
    warnings,
  };
}

/**
 * Assign a stable, explainable reason code for a task that could not be fully
 * placed. The classification is deterministic: it inspects the day plans in a
 * fixed priority order so the same situation always yields the same code.
 */
export function classifyUnscheduled(
  c: Candidate,
  task: Task | undefined,
  days: DayPlan[],
  from: string,
  lastAllowed: string,
  minBlock: number,
): UnscheduledReasonCode {
  void task; // reserved for future per-task diagnostics; not needed for the codes today
  // Days that may legally host this task.
  const reachable = days.filter((d) => d.date >= from && d.date <= lastAllowed);

  if (reachable.length === 0) {
    // No legal day inside the horizon before the deadline.
    return lastAllowed < from ? 'DEADLINE_TOO_CLOSE' : 'OUTSIDE_HORIZON';
  }

  const totalAvail = reachable.reduce((s, d) => s + d.availMinutes, 0);
  if (totalAvail === 0) return 'NO_AVAILABILITY';

  // Capacity consumed entirely by surviving (locked/manual/external) busy time.
  if (reachable.every((d) => d.capacity === 0)) {
    return 'BLOCKED_BY_LOCKED_SESSIONS';
  }

  const totalCap = reachable.reduce((s, d) => s + d.capacity, 0);
  const hasBigEnoughSlot = reachable.some((d) =>
    d.free.some((iv) => iv.end - iv.start >= minBlock),
  );

  // Daily cap is the binding constraint: raw availability would be enough, but
  // the per-day limit leaves too little total capacity.
  if (totalCap < c.remaining) {
    if (totalAvail >= c.remaining) return 'DAILY_LIMIT_REACHED';
    if (!hasBigEnoughSlot) return 'NO_SLOT_LARGE_ENOUGH';
    return 'OUTSIDE_HORIZON';
  }

  // Free intervals exist but none can fit a minimum block.
  if (!hasBigEnoughSlot) return 'NO_SLOT_LARGE_ENOUGH';

  // Capacity exists in principle but the placement loop could not consume it
  // (e.g. scattered fragments below minBlock). Report as horizon/budget bound.
  return 'OUTSIDE_HORIZON';
}

// ------------------------------------------------------------------ Scoring

/** Days from `from` to a deadline (>= 0; clamped). */
export function deadlineDays(dueDate: string, from: string): number {
  const due = safeFromISO(dueDate);
  const base = safeFromISO(from);
  if (!due || !base) return 0;
  const ms = 1000 * 60 * 60 * 24;
  const aMid = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const bMid = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  return Math.max(0, Math.round((aMid.getTime() - bMid.getTime()) / ms));
}

/** Which preferred period does a block's start fall into (if any)? */
export function periodOfStart(startMin: number): PreferredPeriod | null {
  for (const p of ['morning', 'afternoon', 'evening'] as PreferredPeriod[]) {
    const b = PERIOD_BOUNDS[p];
    if (startMin >= b.start && startMin < b.end) return p;
  }
  return null;
}

export interface BlockScore {
  score: number;
  reasons: string[];
}

// Deterministic soft-factor weights (no randomness, no time-of-day clock).
const W_DEADLINE_URGENCY = 30;
const W_PREFERRED_PERIOD = 20;
const W_LATE_HOUR = -15;
const W_FRAGMENT = -8;
const W_BALANCE_HIGH = -10;
const W_PRIORITY = 8;

/**
 * Score a single placed block. Pure & deterministic: the same block + task +
 * settings + day plans always yields the same score and reason set.
 *
 * Score is a "goodness" value (higher is better). Reasons are 1–3 zh-CN
 * strings explaining the dominant factors.
 */
export function scoreBlock(
  block: ScheduleBlock,
  task: Task | undefined,
  settings: SchedulerV2Settings,
  days: DayPlan[],
): BlockScore {
  const startMin = parseHHMM(block.startTime) ?? 0;
  const endMin = parseHHMM(block.endTime) ?? startMin;
  const duration = endMin - startMin;

  let score = 100;
  const factors: { delta: number; reason: string }[] = [];

  // Deadline urgency (closer deadline → the placement matters more → bonus).
  if (task?.dueDate) {
    const dDays = deadlineDays(task.dueDate, findFrom(days, block.date));
    const urgency = Math.max(0, W_DEADLINE_URGENCY - 5 * dDays);
    if (urgency > 0) {
      score += urgency;
      if (dDays <= 2) factors.push({ delta: urgency, reason: `距离截止日仅 ${dDays} 天` });
    }
  }

  // Priority.
  if (task) {
    const pr = task.priority === 'high' ? W_PRIORITY : task.priority === 'medium' ? Math.floor(W_PRIORITY / 2) : 0;
    if (pr > 0) {
      score += pr;
      if (task.priority === 'high') factors.push({ delta: pr, reason: '高优先级任务优先安排' });
    }
  }

  // Preferred study period.
  const period = periodOfStart(startMin);
  if (period && settings.preferredPeriods.includes(period)) {
    score += W_PREFERRED_PERIOD;
    const label = period === 'morning' ? '上午' : period === 'afternoon' ? '下午' : '晚上';
    factors.push({ delta: W_PREFERRED_PERIOD, reason: `这是你的偏好学习时段（${label}）` });
  }

  // Avoid too late.
  if (startMin >= LATE_HOUR_START) {
    score += W_LATE_HOUR;
    factors.push({ delta: W_LATE_HOUR, reason: '时段偏晚，建议尽量安排在更早的时间' });
  }

  // Fragmentation (finishing-block exemption: tiny blocks are slightly penalized).
  if (duration < settings.minBlockMinutes) {
    score += W_FRAGMENT;
    factors.push({ delta: W_FRAGMENT, reason: '时段较短，用于收尾任务' });
  }

  // Daily load balance: penalize filling a day past 80% of its limit.
  const dayPlan = days.find((d) => d.date === block.date);
  if (dayPlan && settings.dailyStudyLimitMinutes > 0) {
    const load = dayPlan.busyMinutes + duration;
    if (load > settings.dailyStudyLimitMinutes * 0.8) {
      score += W_BALANCE_HIGH;
      factors.push({
        delta: W_BALANCE_HIGH,
        reason: `当日学习量接近上限（${settings.dailyStudyLimitMinutes} 分钟）`,
      });
    }
  }

  // Keep the 1–3 most impactful reasons (by absolute delta, stable order).
  const reasons = factors
    .slice()
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)
    .map((f) => f.reason);

  if (reasons.length === 0) reasons.push('符合可用时间与截止日约束');

  return { score: Math.max(0, Math.round(score)), reasons };
}

/** Find the proposal `from` by scanning day plans for the block's date. */
function findFrom(days: DayPlan[], date: string): string {
  // The block.date is always >= from; the earliest day in the horizon is `from`.
  // For scoring we only need "days until deadline relative to from"; using the
  // first day as the reference keeps it deterministic when block.date is given.
  if (days.length === 0) return date;
  // Use the block's own date when it predates the horizon start (defensive).
  return days[0].date <= date ? days[0].date : date;
}

// ------------------------------------------------------------------ runId

/** Deterministic run id derived from the canonical input signature. */
function deriveRunId(input: ProposalInput): string {
  const sig = JSON.stringify({
    from: input.from,
    generatedAt: input.generatedAt,
    settings: input.settings,
    excludedTaskIds: [...(input.excludedTaskIds ?? [])].sort(),
    replanScope: input.replanScope ?? null,
    taskIds: input.tasks.map((t) => t.id).sort(),
    blockIds: input.existingBlocks.map((b) => b.id).sort(),
  });
  // djb2 — deterministic, dependency-free.
  let h = 5381;
  for (let i = 0; i < sig.length; i++) {
    h = ((h << 5) + h + sig.charCodeAt(i)) | 0;
  }
  return `run:${(h >>> 0).toString(36)}`;
}
