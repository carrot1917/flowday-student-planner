// Phase 4D glue — pure helpers between the UI and the 4B scheduler / 4C conflict
// detector. No React, no store, no clock, no randomness: everything testable
// without a component.
//
// `from` is ALWAYS injected by the caller (the UI layer supplies the current
// date and passes it in). These helpers must never read the clock themselves —
// that keeps them deterministic and fully unit-testable with a fixed `from`.

import {
  DEFAULT_HORIZON_DAYS,
  DEFAULT_MAX_BLOCK_MINUTES,
  DEFAULT_MIN_BLOCK_MINUTES,
  type ScheduleInput,
} from '@/lib/scheduler';
import type { ScheduleBlock, Task, WeeklyAvailability } from '@/types';

export interface BuildScheduleInputArgs {
  tasks: Task[];
  availability: WeeklyAvailability;
  existingBlocks: ScheduleBlock[];
  /** Injected by the caller (e.g. the current date). Never read here. */
  from: string;
}

/**
 * Build the scheduler input for Phase 4D v1 with all parameters hidden behind
 * defaults. `dailyMaxMinutes` is intentionally omitted (undefined) in v1.
 *
 * The FULL task list is passed through unchanged — `status === 'done'` filtering
 * is the scheduler's responsibility (scheduler.ts), so we must NOT duplicate that
 * rule here. Business logic stays in one place (the domain layer).
 */
export function buildScheduleInput(args: BuildScheduleInputArgs): ScheduleInput {
  return {
    tasks: args.tasks,
    availability: args.availability,
    existingBlocks: args.existingBlocks,
    from: args.from,
    horizonDays: DEFAULT_HORIZON_DAYS,
    // dailyMaxMinutes: undefined — not exposed in v1
    minBlockMinutes: DEFAULT_MIN_BLOCK_MINUTES,
    maxBlockMinutes: DEFAULT_MAX_BLOCK_MINUTES,
  };
}

/**
 * Append `incoming` blocks to `existing`, skipping any id already present
 * (whether it came from `existing` or from a duplicate inside `incoming`).
 * Existing order is preserved, then `incoming` is appended in its own order.
 * Idempotent: re-merging the same `incoming` against the result is a no-op.
 *
 * Used by the store action so a double-confirm can never write a block twice.
 */
export function mergeScheduleBlocks(
  existing: ScheduleBlock[],
  incoming: ScheduleBlock[],
): ScheduleBlock[] {
  const out = [...existing];
  const seen = new Set(existing.map((b) => b.id));
  for (const b of incoming) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(b);
  }
  return out;
}
