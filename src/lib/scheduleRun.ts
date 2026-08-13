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
import {
  DEFAULT_V2_SETTINGS,
  generateProposal,
  type ProposalInput,
  type ReplanScope,
  type ScheduleProposal,
  type SchedulerV2Settings,
} from '@/lib/proposal';
import type { ScheduleBlock, Task, WeeklyAvailability } from '@/types';

export interface BuildScheduleInputArgs {
  tasks: Task[];
  availability: WeeklyAvailability;
  existingBlocks: ScheduleBlock[];
  /** Injected by the caller (e.g. the current date). Never read here. */
  from: string;
  /** Injected timestamp used by generated ScheduleBlocks. */
  generatedAt?: number;
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
    generatedAt: args.generatedAt,
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

// ------------------------------------------------------------------ Phase 2
//
// The v2 proposal path. Unlike `buildScheduleInput` (which intentionally hides
// every tunable behind a v1 default for backwards compatibility), the proposal
// builder takes ALL user-configurable parameters explicitly. Nothing is
// silently hard-coded here: `from` and `generatedAt` are injected, and the
// caller owns every setting. This keeps the glue layer honest about what the
// user can configure.

export interface BuildProposalInputArgs {
  tasks: Task[];
  availability: WeeklyAvailability;
  existingBlocks: ScheduleBlock[];
  /** Injected by the caller (the current date). Never read here. */
  from: string;
  /** Injected timestamp used for block createdAt/updatedAt + runId. */
  generatedAt: number;
  /** Every user-configurable scheduler parameter. No hidden defaults. */
  settings: SchedulerV2Settings;
  /** Tasks to skip entirely (UX override). */
  excludedTaskIds?: string[];
  /** Limits which existing scheduler blocks may be replaced. */
  replanScope?: ReplanScope;
}

/**
 * Build the proposal input. References are passed through unchanged — no
 * cloning, no mutation. The settings object is used verbatim so the proposal's
 * `settingsSnapshot` reflects exactly what the caller supplied.
 */
export function buildProposalInput(args: BuildProposalInputArgs): ProposalInput {
  return {
    tasks: args.tasks,
    availability: args.availability,
    existingBlocks: args.existingBlocks,
    from: args.from,
    generatedAt: args.generatedAt,
    settings: args.settings,
    excludedTaskIds: args.excludedTaskIds,
    replanScope: args.replanScope,
  };
}

/** Convenience: build the input and run the proposal in one call. */
export function runProposal(args: BuildProposalInputArgs): ScheduleProposal {
  return generateProposal(buildProposalInput(args));
}

/**
 * Default v2 settings derived from a Phase 1 `Settings` object. Used by the UI
 * to seed the proposal controls from the user's stored preferences.
 */
export function defaultV2SettingsFromSettings(s: {
  dailyStudyLimitMinutes: number;
  minBlockMinutes: number;
  maxBlockMinutes: number;
  breakMinutes: number;
}): SchedulerV2Settings {
  return {
    ...DEFAULT_V2_SETTINGS,
    dailyStudyLimitMinutes: s.dailyStudyLimitMinutes,
    minBlockMinutes: s.minBlockMinutes,
    maxBlockMinutes: s.maxBlockMinutes,
    breakMinutes: s.breakMinutes,
  };
}
