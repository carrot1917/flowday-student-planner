// Phase 4B — study scheduler.
//
// The one job of this module: turn "what has to be done" (Task) plus "when the
// user can study" (WeeklyAvailability) plus "what is already booked"
// (ScheduleBlock) into NEW `ScheduleBlock` suggestions.
//
// Hard boundaries (locked by source-level assertions in scheduler.test.ts):
//   - pure functions only: no React, no store, no persistence;
//   - it never reads the system clock — the caller injects `from`, so the same
//     input always produces the same output and tests stay deterministic;
//   - inputs are never mutated, and existing blocks are never edited or removed.
//
// Everything here is minute-of-day arithmetic (0..1439); HH:mm strings only
// appear at the boundaries.

import { addDays, minutesToHHMM, safeFromISO, toISO } from '@/lib/date';
import { normalizeEstimatedMinutes, parseHHMM, weekdayForISO } from '@/lib/domain';
import type { ScheduleBlock, Task, WeeklyAvailability } from '@/types';

// ------------------------------------------------------------------ Intervals
//
// Exported because Phase 4C (conflict detection) needs exactly the same
// union / difference semantics the scheduler uses.

/** Half-open minute range [start, end) measured from midnight. */
export interface Interval {
  start: number;
  end: number;
}

/**
 * Union of a set of intervals: sorted, overlapping AND touching ranges fused.
 * Degenerate/invalid ranges (non-finite, end <= start) are dropped.
 * Returns fresh objects — the input array and its members stay untouched.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const valid = intervals
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end));

  const out: Interval[] = [];
  for (const i of valid) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      if (i.end > last.end) last.end = i.end;
    } else {
      out.push({ start: i.start, end: i.end });
    }
  }
  return out;
}

/** `base` minus `cut` (both are merged first). Result is sorted and disjoint. */
export function subtractIntervals(base: Interval[], cut: Interval[]): Interval[] {
  const merged = mergeIntervals(base);
  const holes = mergeIntervals(cut);
  const out: Interval[] = [];

  for (const b of merged) {
    let start = b.start;
    for (const h of holes) {
      if (h.end <= start) continue; // hole already behind us
      if (h.start >= b.end) break; // holes are sorted → the rest is past this block
      if (h.start > start) out.push({ start, end: Math.min(h.start, b.end) });
      start = Math.max(start, h.end);
      if (start >= b.end) break;
    }
    if (start < b.end) out.push({ start, end: b.end });
  }
  return out;
}

/** Total covered minutes. Merges first, so overlaps are counted exactly once. */
export function intervalsMinutes(intervals: Interval[]): number {
  return mergeIntervals(intervals).reduce((sum, i) => sum + (i.end - i.start), 0);
}

/** Strict HH:mm pair → interval. Anything malformed or non-positive → null. */
function toInterval(startTime: string, endTime: string): Interval | null {
  const start = parseHHMM(startTime);
  const end = parseHHMM(endTime);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

// ------------------------------------------------------------------ Contracts

export type UnscheduledReason =
  | 'no-estimate'
  | 'invalid-deadline'
  | 'deadline-passed'
  | 'no-availability'
  | 'insufficient-time';

export interface UnscheduledTask {
  taskId: string;
  /** Minutes that still could not be placed (0 when the estimate is missing). */
  remainingMinutes: number;
  reason: UnscheduledReason;
}

export interface ScheduleResult {
  /** ONLY the newly generated blocks — `existingBlocks` are never echoed back. */
  blocks: ScheduleBlock[];
  unscheduled: UnscheduledTask[];
}

export interface ScheduleInput {
  tasks: Task[];
  /** Phase 4A output. Slots are assumed validated, but re-checked defensively. */
  availability: WeeklyAvailability;
  /** Already booked sessions. Treated as immovable, never modified. */
  existingBlocks: ScheduleBlock[];
  /** First planning day (YYYY-MM-DD). REQUIRED — the scheduler owns no clock. */
  from: string;
  /** How many days to plan, starting at `from`. Default 14. */
  horizonDays?: number;
  /** Optional per-day ceiling on study minutes. Default: only availability limits. */
  dailyMaxMinutes?: number;
  /** Shortest block worth creating (tail blocks that finish a task are exempt). */
  minBlockMinutes?: number;
  /** Longest single sitting; longer work is split across blocks. */
  maxBlockMinutes?: number;
}

export const DEFAULT_HORIZON_DAYS = 14;
export const DEFAULT_MIN_BLOCK_MINUTES = 25;
export const DEFAULT_MAX_BLOCK_MINUTES = 120;
/** Upper bound on the horizon, so a junk input can never spin the loop. */
export const HORIZON_DAYS_MAX = 365;

const PRIORITY_RANK: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 };

interface Candidate {
  /** Position in the input array — used only to keep `unscheduled` deterministic. */
  index: number;
  id: string;
  dueDate: string;
  remaining: number;
}

interface DayPlan {
  date: string;
  /** Availability minus everything already booked that day. */
  free: Interval[];
  /** Minutes still allowed today after `dailyMaxMinutes` meets existing bookings. */
  budget: number;
  /** min(free, budget) — the theoretical ceiling used to explain failures. */
  capacity: number;
}

// ------------------------------------------------------------------ Scheduler

/**
 * Greedy earliest-fit planner.
 *
 * Task selection order: dueDate → priority → createdAt → id (fully
 * deterministic, no ties left to array order).
 *
 * Placement walks the horizon day by day, and inside each day walks the free
 * intervals left to right, always filling with the most urgent task that is
 * still allowed on that day (`block.date <= task.dueDate`).
 */
export function generateSchedule(input: ScheduleInput): ScheduleResult {
  const {
    tasks,
    availability,
    existingBlocks,
    from,
    horizonDays = DEFAULT_HORIZON_DAYS,
    dailyMaxMinutes,
  } = input;

  const minBlock = sanitizeBlockBound(input.minBlockMinutes, DEFAULT_MIN_BLOCK_MINUTES);
  const maxBlock = Math.max(minBlock, sanitizeBlockBound(input.maxBlockMinutes, DEFAULT_MAX_BLOCK_MINUTES));

  const days = buildDays(availability, existingBlocks, from, horizonDays, dailyMaxMinutes);
  const scheduledByTask = scheduledMinutesByTask(existingBlocks);

  // ---- 1. filter tasks into candidates / early rejections -------------------
  const candidates: Candidate[] = [];
  const rejected: { index: number; entry: UnscheduledTask }[] = [];
  const reject = (index: number, entry: UnscheduledTask) => rejected.push({ index, entry });

  // When `from` itself is unusable there is no horizon at all, so nothing can be
  // "past its deadline" — every candidate simply has nowhere to go.
  const horizonUsable = safeFromISO(from) !== null;

  tasks.forEach((task, index) => {
    if (task.status === 'done') return; // finished work is not planned, not reported

    const estimate = normalizeEstimatedMinutes(task.estimatedMinutes);
    if (estimate === undefined) {
      reject(index, { taskId: task.id, remainingMinutes: 0, reason: 'no-estimate' });
      return;
    }
    if (safeFromISO(task.dueDate) === null) {
      reject(index, { taskId: task.id, remainingMinutes: estimate, reason: 'invalid-deadline' });
      return;
    }

    // D8: subtract what is already booked for this task, measured as real
    // interval coverage (never `plannedMinutes`, which may be stale or double
    // counted across overlapping blocks). Clamped so it can never go negative.
    const remaining = Math.max(0, estimate - (scheduledByTask.get(task.id) ?? 0));
    if (remaining === 0) return; // already fully planned — nothing to add, nothing to report

    if (horizonUsable && task.dueDate < from) {
      reject(index, { taskId: task.id, remainingMinutes: remaining, reason: 'deadline-passed' });
      return;
    }

    candidates.push({ index, id: task.id, dueDate: task.dueDate, remaining });
  });

  // ---- 2. urgency order (D9) ------------------------------------------------
  const rankById = new Map(tasks.map((t) => [t.id, t]));
  candidates.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    const ta = rankById.get(a.id);
    const tb = rankById.get(b.id);
    const pa = ta ? PRIORITY_RANK[ta.priority] : 99;
    const pb = tb ? PRIORITY_RANK[tb.priority] : 99;
    if (pa !== pb) return pa - pb;
    const ca = ta?.createdAt ?? 0;
    const cb = tb?.createdAt ?? 0;
    if (ca !== cb) return ca - cb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // ---- 3. greedy placement --------------------------------------------------
  const blocks: ScheduleBlock[] = [];

  for (const day of days) {
    if (day.budget <= 0 || day.free.length === 0) continue;
    let budget = day.budget;
    let noEligibleTaskLeft = false;

    for (const interval of day.free) {
      if (noEligibleTaskLeft || budget <= 0) break;
      let cursor = interval.start;

      while (cursor < interval.end && budget > 0) {
        const target = candidates.find((c) => c.remaining > 0 && c.dueDate >= day.date);
        if (!target) {
          noEligibleTaskLeft = true;
          break;
        }

        const space = interval.end - cursor;
        const len = Math.min(space, target.remaining, budget, maxBlock);
        if (len <= 0) break;
        // Fragment guard with the finishing-block exemption: a sub-minimum block
        // is only worth creating when it completes the task outright.
        if (len < minBlock && len !== target.remaining) break;

        const startTime = minutesToHHMM(cursor);
        blocks.push({
          id: `sb:auto:${target.id}:${day.date}:${startTime}`,
          taskId: target.id,
          date: day.date,
          startTime,
          endTime: minutesToHHMM(cursor + len),
          plannedMinutes: len,
        });

        cursor += len;
        budget -= len;
        target.remaining -= len;
      }
    }
  }

  // ---- 4. explain whatever is left ------------------------------------------
  for (const c of candidates) {
    if (c.remaining <= 0) continue;
    const reachable = days
      .filter((d) => d.date <= c.dueDate)
      .reduce((sum, d) => sum + d.capacity, 0);
    rejected.push({
      index: c.index,
      entry: {
        taskId: c.id,
        remainingMinutes: c.remaining,
        reason: reachable === 0 ? 'no-availability' : 'insufficient-time',
      },
    });
  }

  return {
    blocks: blocks.sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.startTime.localeCompare(b.startTime),
    ),
    unscheduled: rejected.sort((a, b) => a.index - b.index).map((r) => r.entry),
  };
}

// ------------------------------------------------------------------ Internals

function sanitizeBlockBound(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

/**
 * Build the planning horizon.
 *
 * Per day: availability → strict parse → merge; existing blocks → strict parse
 * → merge; free = availability − busy. The daily budget subtracts the MERGED
 * busy minutes (real coverage), never the stored `plannedMinutes`, so
 * overlapping or corrupted blocks can never eat the budget twice.
 */
function buildDays(
  availability: WeeklyAvailability,
  existingBlocks: ScheduleBlock[],
  from: string,
  horizonDays: number,
  dailyMaxMinutes: number | undefined,
): DayPlan[] {
  const start = safeFromISO(from);
  if (!start) return [];

  const span = Number.isFinite(horizonDays)
    ? Math.min(HORIZON_DAYS_MAX, Math.max(0, Math.floor(horizonDays)))
    : DEFAULT_HORIZON_DAYS;

  const busyByDate = new Map<string, Interval[]>();
  for (const b of existingBlocks) {
    const iv = toInterval(b.startTime, b.endTime);
    // D12: an orphan taskId still occupies the slot — the time really is taken.
    if (!iv || typeof b.date !== 'string') continue;
    const list = busyByDate.get(b.date);
    if (list) list.push(iv);
    else busyByDate.set(b.date, [iv]);
  }

  const cap = typeof dailyMaxMinutes === 'number' && Number.isFinite(dailyMaxMinutes)
    ? Math.max(0, Math.floor(dailyMaxMinutes))
    : undefined;

  const days: DayPlan[] = [];
  for (let i = 0; i < span; i++) {
    const date = toISO(addDays(start, i));
    const weekday = weekdayForISO(date);
    const slots = weekday ? availability[weekday] ?? [] : [];

    const avail = mergeIntervals(
      slots.map((s) => toInterval(s.startTime, s.endTime)).filter((iv): iv is Interval => iv !== null),
    );
    const busy = mergeIntervals(busyByDate.get(date) ?? []);
    const free = subtractIntervals(avail, busy);
    const budget = cap === undefined ? Number.POSITIVE_INFINITY : Math.max(0, cap - intervalsMinutes(busy));

    days.push({ date, free, budget, capacity: Math.min(intervalsMinutes(free), budget) });
  }
  return days;
}

/**
 * Minutes already booked per task, counted as real interval coverage: blocks are
 * grouped by task AND day, then merged, so two overlapping blocks for the same
 * task on the same day are counted once. Blocks with unusable times are ignored.
 */
function scheduledMinutesByTask(existingBlocks: ScheduleBlock[]): Map<string, number> {
  const perTaskDay = new Map<string, Map<string, Interval[]>>();
  for (const b of existingBlocks) {
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
