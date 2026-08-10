// Scheduling domain — pure functions over ScheduleBlock / Task.
//
// These belong to the *scheduling* domain, not to the Calendar UI. They are
// reused by Phase 3A (Calendar rendering) and by the future Phase 4 smart
// scheduler (generating / placing ScheduleBlocks).

import { addDays, diffDays, safeFromISO, startOfWeek, todayISO } from '@/lib/date';
import type { ScheduleBlock, Task } from '@/types';

/** Group study sessions by their calendar day (ScheduleBlock.date). */
export function groupBlocksByDate(blocks: ScheduleBlock[]): Record<string, ScheduleBlock[]> {
  const map: Record<string, ScheduleBlock[]> = {};
  for (const b of blocks) {
    (map[b.date] ||= []).push(b);
  }
  return map;
}

/** Group tasks by their deadline day (Task.dueDate). */
export function groupTasksByDeadline(tasks: Task[]): Record<string, Task[]> {
  const map: Record<string, Task[]> = {};
  for (const t of tasks) {
    (map[t.dueDate] ||= []).push(t);
  }
  return map;
}

/** Sort study sessions by start time, then end time. Returns a new array. */
export function sortScheduleBlocks(blocks: ScheduleBlock[]): ScheduleBlock[] {
  return [...blocks].sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.endTime.localeCompare(b.endTime);
  });
}

/**
 * Resolve a ScheduleBlock to its owning Task.
 * Returns `undefined` when the task no longer exists — callers must treat
 * that as "do not render this block" (the data is intentionally left intact
 * so it can be recovered; we just skip the orphan on screen).
 */
export function findTaskForBlock(taskById: Map<string, Task>, block: ScheduleBlock): Task | undefined {
  return taskById.get(block.taskId);
}

// --------------------------------------------------------------- Deadline bucket

export type DeadlineBucket = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later';

/**
 * Classify a deadline into one of five buckets for the Timeline view.
 * Pure and exception-safe: an empty / malformed / unparseable `dueDate`
 * (including overflow like 2026-13-40 or 2026-02-30) falls back to 'later'.
 *
 * @param dueDate       ISO date string (YYYY-MM-DD)
 * @param today         reference "today" (defaults to todayISO()); injected in tests
 * @param weekStartsOn  0 = Sunday, 1 = Monday (matches Settings.startOfWeek)
 */
export function deadlineBucket(
  dueDate: string,
  today?: string,
  weekStartsOn: 0 | 1 = 1,
): DeadlineBucket {
  const ref = today ?? todayISO();
  const due = safeFromISO(dueDate);
  const base = safeFromISO(ref);
  if (!due || !base) return 'later';

  const diff = diffDays(due, base);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';

  // diff >= 2: still within the current week?
  const weekEnd = addDays(startOfWeek(base, weekStartsOn), 6);
  const remaining = diffDays(weekEnd, base); // whole days left until the week ends (incl. today)
  return diff <= remaining ? 'thisWeek' : 'later';
}

// --------------------------------------------------------------- Dashboard selectors

/**
 * Tasks whose deadline falls exactly on `today` (Task.dueDate === today).
 * Status is intentionally NOT filtered — today's due tasks include done ones,
 * and the Dashboard decides what to emphasise. Pure and exception-safe.
 */
export function todayDueTasks(tasks: Task[], today: string): Task[] {
  return tasks.filter((t) => t.dueDate === today);
}

/**
 * Overdue tasks: not completed and past their deadline (dueDate < today).
 * ISO date strings sort lexicographically, so a plain string compare is correct.
 */
export function overdueTasks(tasks: Task[], today: string): Task[] {
  return tasks.filter((t) => t.status !== 'done' && t.dueDate < today);
}

/**
 * Total planned minutes across a set of ScheduleBlocks (e.g. today's study
 * sessions). Missing/zero `plannedMinutes` count as 0; empty input → 0.
 */
export function sumPlannedMinutes(blocks: ScheduleBlock[]): number {
  return blocks.reduce((sum, b) => sum + (b.plannedMinutes || 0), 0);
}
