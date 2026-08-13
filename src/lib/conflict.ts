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
  | 'orphan-block' // block.taskId points at a Task that no longer exists
  // Phase 2 extensions (only emitted when the corresponding setting is supplied):
  | 'daily-cap' // a day's total study minutes exceed dailyStudyLimitMinutes
  | 'minimum-break' // two consecutive sessions sit closer than breakMinutes
  | 'invalid-duration' // a session is shorter/longer than the configured bounds
  | 'deadline-violation' // a session is scheduled after its task's deadline
  | 'external-busy'; // a study session overlaps an external (busy) block

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
  // Phase 2 optional constraint settings. Each new check is GATED on the
  // presence of the relevant field, so callers that omit them (including every
  // pre-Phase-2 test) get exactly the original behavior.
  /** When provided, days whose total study minutes exceed this are flagged. */
  dailyMaxMinutes?: number;
  /** When > 0, consecutive sessions closer than this are flagged. */
  breakMinutes?: number;
  /** When provided, sessions shorter than this are flagged (warning). */
  minBlockMinutes?: number;
  /** When provided, sessions longer than this are flagged (error). */
  maxBlockMinutes?: number;
  /** When false, a session on its task's deadline day is a violation. */
  allowDeadlineDay?: boolean;
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
  const { blocks, taskById, availability, dailyMaxMinutes, breakMinutes, minBlockMinutes, maxBlockMinutes, allowDeadlineDay } = input;
  const conflicts: ScheduleConflict[] = [];

  const hasDailyCap = typeof dailyMaxMinutes === 'number' && Number.isFinite(dailyMaxMinutes);
  const hasBreak = typeof breakMinutes === 'number' && breakMinutes > 0;
  const hasMin = typeof minBlockMinutes === 'number' && Number.isFinite(minBlockMinutes);
  const hasMax = typeof maxBlockMinutes === 'number' && Number.isFinite(maxBlockMinutes);
  // allowDeadlineDay defaults to true (allow) when unspecified, matching the
  // pre-Phase-2 behavior where the deadline day was a legal planning day.
  const allowDeadline = allowDeadlineDay !== false;

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

      // invalid-duration (Phase 2): too long is a hard error; too short is a
      // warning (it may be a legitimate finishing block).
      const duration = interval.end - interval.start;
      if (hasMax && duration > (maxBlockMinutes as number)) {
        conflicts.push({
          type: 'invalid-duration',
          blockIds: [b.id],
          date,
          severity: 'error',
          message: `学习时段时长 ${duration} 分钟超过最长限制 ${maxBlockMinutes} 分钟`,
          detail: { taskId: b.taskId },
        });
      } else if (hasMin && duration < (minBlockMinutes as number)) {
        conflicts.push({
          type: 'invalid-duration',
          blockIds: [b.id],
          date,
          severity: 'warning',
          message: `学习时段时长 ${duration} 分钟低于最短限制 ${minBlockMinutes} 分钟`,
          detail: { taskId: b.taskId },
        });
      }

      // deadline-violation (Phase 2): a session scheduled after its task's
      // deadline, or on the deadline day when the user forbade that.
      if (task?.dueDate) {
        const afterDeadline = b.date > task.dueDate;
        const onDeadlineForbidden = !allowDeadline && b.date === task.dueDate;
        if (afterDeadline || onDeadlineForbidden) {
          conflicts.push({
            type: 'deadline-violation',
            blockIds: [b.id],
            date,
            severity: 'error',
            message: onDeadlineForbidden
              ? `学习时段落在截止日当天（${task.dueDate}），但当前设置不允许在截止日当天排期`
              : `学习时段晚于任务截止日（${task.dueDate}）`,
            detail: { taskId: b.taskId },
          });
        }
      }

      valid.push({ b, interval });
    }

    // O(n²) pairwise strict-overlap scan over the valid blocks of this day.
    // When either block is `external`, the overlap is reported as
    // `external-busy` (a more specific label than time-overlap); otherwise the
    // classic `time-overlap` is emitted. Existing fixtures use only
    // source='manual', so their time-overlap counts are unchanged.
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const a = valid[i].interval;
        const c = valid[j].interval;
        if (a.start < c.end && c.start < a.end) {
          const bi = valid[i].b;
          const bj = valid[j].b;
          const involvesExternal = bi.source === 'external' || bj.source === 'external';
          conflicts.push({
            type: involvesExternal ? 'external-busy' : 'time-overlap',
            blockIds: [bi.id, bj.id],
            date,
            severity: 'error',
            message: involvesExternal
              ? `学习时段「${bi.startTime}–${bi.endTime}」与外部忙碌时段「${bj.startTime}–${bj.endTime}」冲突`
              : `学习时段「${bi.startTime}–${bi.endTime}」与「${bj.startTime}–${bj.endTime}」时间重叠`,
            detail: {
              intervals: [{ start: Math.max(a.start, c.start), end: Math.min(a.end, c.end) }],
            },
          });
        }
      }
    }

    // daily-cap (Phase 2): total study minutes on this day exceed the limit.
    // Counted as real interval coverage so overlaps are never double-counted.
    if (hasDailyCap && valid.length > 0) {
      const total = intervalsMinutes(valid.map((v) => v.interval));
      if (total > (dailyMaxMinutes as number)) {
        conflicts.push({
          type: 'daily-cap',
          blockIds: valid.map((v) => v.b.id),
          date,
          severity: 'warning',
          message: `当日学习总时长 ${total} 分钟超过上限 ${dailyMaxMinutes} 分钟`,
        });
      }
    }

    // minimum-break (Phase 2): consecutive (non-overlapping) sessions closer
    // than breakMinutes. Overlapping pairs are already reported above.
    if (hasBreak && valid.length > 1) {
      const sorted = valid.slice().sort((x, y) => x.interval.start - y.interval.start);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        // Only non-overlapping adjacency counts (gap >= 0).
        if (cur.interval.start >= prev.interval.end) {
          const gap = cur.interval.start - prev.interval.end;
          if (gap < (breakMinutes as number)) {
            conflicts.push({
              type: 'minimum-break',
              blockIds: [prev.b.id, cur.b.id],
              date,
              severity: 'warning',
              message: `学习时段「${prev.b.startTime}–${prev.b.endTime}」与「${cur.b.startTime}–${cur.b.endTime}」之间休息仅 ${gap} 分钟（少于 ${breakMinutes}）`,
              detail: { intervals: [{ start: prev.interval.end, end: cur.interval.start }] },
            });
          }
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
