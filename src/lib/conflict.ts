// Conflict detection (Phase 4C) — pure functions over ScheduleBlock / Task.
//
// This module ONLY detects and reports conflicts. It does not fix them, does
// not reschedule, does not write to the store, and renders nothing. The
// returned list is consumed by a future UI phase (4D); 4C itself is read-only.
//
// It reuses the exact interval arithmetic the scheduler owns
// (scheduler.ts: mergeIntervals / subtractIntervals / intervalsMinutes), so a
// minute is never double-counted and overlap / containment semantics match the
// generator 1:1.

import {
  intervalsMinutes,
  mergeIntervals,
  subtractIntervals,
  type Interval,
} from '@/lib/scheduler';
import { parseHHMM, weekdayForISO } from '@/lib/domain';
import { findTaskForBlock, groupBlocksByDate } from '@/lib/schedule';
import type { AvailabilitySlot, ScheduleBlock, Task, Weekday, WeeklyAvailability } from '@/types';

// ----------------------------------------------------------------- Conflicts

export type ConflictType =
  | 'time-overlap' // two study sessions share minutes on the same day
  | 'availability-violation' // a session falls outside that day's available window
  | 'invalid-block' // malformed time, cross-midnight, or malformed date
  | 'orphan-block'; // block.taskId points at a Task that no longer exists

export type ConflictSeverity = 'error' | 'warning';

export interface ScheduleConflict {
  type: ConflictType;
  /** Blocks involved: 2 for overlap, 1 for the rest. */
  blockIds: string[];
  /** The day the conflict occurs on (absent only for fully malformed dates). */
  date?: string;
  severity: ConflictSeverity;
  /** zh-CN, ready to surface in a UI. */
  message: string;
  detail?: {
    /** For time-overlap: the shared interval. For availability-violation: every
     *  slice of the block that falls outside the available window (may be >1). */
    intervals?: Interval[];
    expectedWeekday?: Weekday;
    taskId?: string;
  };
}

export interface ConflictInput {
  blocks: ScheduleBlock[];
  /** Resolved tasks, used for orphan detection and (later) context. */
  taskById: Map<string, Task>;
  /** Per-weekday available windows. */
  availability: WeeklyAvailability;
}

// --------------------------------------------------------------- internals

/** Strict HH:mm → interval. null for malformed time OR cross-midnight (end<=start). */
function toBlockInterval(b: ScheduleBlock): Interval | null {
  const start = parseHHMM(b.startTime);
  const end = parseHHMM(b.endTime);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

function toSlotInterval(s: AvailabilitySlot): Interval | null {
  const start = parseHHMM(s.startTime);
  const end = parseHHMM(s.endTime);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

// ------------------------------------------------------------- detector

/**
 * Scan the given blocks for the four conflict types. Pure: no clock, no
 * randomness, no store, no React. Returns a flat list; the caller decides what
 * to render. Input objects are never mutated.
 *
 * Rules (locked for 4C v1):
 *  - time-overlap: strict overlap only — `a.start < b.end && b.start < a.end`.
 *    Touching intervals (A.end === B.start) are NOT a conflict. Detected by an
 *    O(n²) pairwise scan over the *valid* blocks of each day — simple, complete,
 *    deterministic, and fine for the small per-day counts this app has.
 *  - availability-violation: the block must be fully contained in the merged
 *    availability of its weekday. Any exterior slice is reported in detail.intervals.
 *  - invalid-block: malformed time, cross-midnight, or malformed date. Such a
 *    block is excluded from overlap / availability math, but its orphan status
 *    is still checked independently.
 *  - orphan-block: dangling taskId. Independent of validity; a block may carry
 *    both orphan-block and overlap / availability conflicts.
 */
export function detectScheduleConflicts(input: ConflictInput): ScheduleConflict[] {
  const { blocks, taskById, availability } = input;
  const conflicts: ScheduleConflict[] = [];

  const byDate = groupBlocksByDate(blocks);

  for (const date of Object.keys(byDate)) {
    const dayBlocks = byDate[date];
    const weekday = weekdayForISO(date);

    // Merge the day's availability into one window set (multi-slot / overlapping
    // slots are fused so a minute is covered once — same semantics as the scheduler).
    const mergedAvail = mergeIntervals(
      (weekday ? (availability[weekday] ?? []) : [])
        .map(toSlotInterval)
        .filter((x): x is Interval => x !== null),
    );

    // Blocks eligible for pairwise overlap detection (valid time + valid date).
    const valid: { b: ScheduleBlock; interval: Interval }[] = [];

    for (const b of dayBlocks) {
      const interval = toBlockInterval(b);
      const task = findTaskForBlock(taskById, b);

      // orphan-block: independent, checked for EVERY block (valid or invalid).
      if (!task) {
        conflicts.push({
          type: 'orphan-block',
          blockIds: [b.id],
          date,
          severity: 'warning',
          message: `学习时段引用了不存在的任务（taskId=${b.taskId}）`,
          detail: { taskId: b.taskId },
        });
      }

      // invalid-block: malformed time, cross-midnight, or malformed date.
      // Excluded from overlap / availability math below.
      if (interval === null || weekday === null) {
        conflicts.push({
          type: 'invalid-block',
          blockIds: [b.id],
          date,
          severity: 'error',
          message:
            weekday === null
              ? `学习时段日期非法（${date}），无法映射到星期`
              : `学习时段「${b.startTime}–${b.endTime}」时间非法（格式错误、结束不晚于开始或跨午夜）`,
          detail: { taskId: b.taskId },
        });
        continue;
      }

      // availability-violation: block must be fully inside merged availability.
      const outside = subtractIntervals([interval], mergedAvail);
      if (intervalsMinutes(outside) > 0) {
        conflicts.push({
          type: 'availability-violation',
          blockIds: [b.id],
          date,
          severity: 'warning',
          message: `学习时段「${b.startTime}–${b.endTime}」超出当日可用时间范围`,
          detail: { expectedWeekday: weekday, intervals: outside },
        });
      }

      valid.push({ b, interval });
    }

    // O(n²) pairwise strict-overlap scan over the valid blocks of this day.
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const a = valid[i].interval;
        const c = valid[j].interval;
        if (a.start < c.end && c.start < a.end) {
          conflicts.push({
            type: 'time-overlap',
            blockIds: [valid[i].b.id, valid[j].b.id],
            date,
            severity: 'error',
            message: `学习时段「${valid[i].b.startTime}–${valid[i].b.endTime}」与「${valid[j].b.startTime}–${valid[j].b.endTime}」时间重叠`,
            detail: {
              intervals: [{ start: Math.max(a.start, c.start), end: Math.min(a.end, c.end) }],
            },
          });
        }
      }
    }
  }

  // Deterministic, stable ordering so callers can compare / snapshot output.
  conflicts.sort((x, y) => {
    const d = (x.date ?? '').localeCompare(y.date ?? '');
    if (d !== 0) return d;
    if (x.type !== y.type) return x.type.localeCompare(y.type);
    return x.blockIds.join(',').localeCompare(y.blockIds.join(','));
  });

  return conflicts;
}
