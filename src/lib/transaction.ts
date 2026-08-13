// Phase 2 — confirm / undo transactions for ScheduleProposal.
//
// Pure functions over ScheduleBlock[]: no React, no store, no clock. The store
// layer calls these and supplies `now`. Confirming a proposal is a transaction:
// the in-scope removable scheduler blocks are replaced by the proposal blocks,
// and the previous snapshots are recorded so a single undo restores them.
//
// Only the LAST confirmed transaction is kept (one-level undo), matching the
// Phase 2 requirement "at least support undoing the most recent proposal
// confirm". A generic undo stack is intentionally NOT built here.

import { isRemovable, type ScheduleProposal, type ReplanScope } from '@/lib/proposal';
import type { ScheduleBlock } from '@/types';

export interface ConfirmTransaction {
  runId: string;
  confirmedAt: number;
  /** Block ids added by this confirm (removed on undo). */
  addedBlockIds: string[];
  /** Snapshots of the scheduler blocks that were replaced (restored on undo). */
  replacedBlockSnapshots: ScheduleBlock[];
  /** Scope that drove the replacement (for diagnostics). */
  replanScope: ReplanScope;
}

export interface ApplyResult {
  blocks: ScheduleBlock[];
  transaction: ConfirmTransaction;
}

/**
 * Confirm a proposal: remove the in-scope removable scheduler blocks, then add
 * the proposal blocks. Returns the new block list + the transaction record.
 *
 * - manual / locked / external blocks are never removed (isRemovable guards).
 * - blocks outside the replan scope are never removed.
 * - duplicate proposal block ids are skipped (idempotent against re-confirm).
 *
 * Pure: inputs are never mutated.
 */
export function applyProposal(
  existing: ScheduleBlock[],
  proposal: ScheduleProposal,
  now: number,
): ApplyResult {
  const scope = proposal.replanScope;

  // Partition existing into replaced (removed) vs kept.
  const replaced: ScheduleBlock[] = [];
  const kept: ScheduleBlock[] = [];
  for (const b of existing) {
    if (isRemovable(b, scope)) replaced.push(b);
    else kept.push(b);
  }

  // Append proposal blocks, skipping ids already present in `kept` (so a double
  // confirm can never write a block twice). Proposal blocks are stamped with a
  // fresh updatedAt so the store knows they were just committed.
  const seen = new Set(kept.map((b) => b.id));
  const added: ScheduleBlock[] = [];
  for (const pb of proposal.blocks) {
    const block: ScheduleBlock = {
      ...pb.block,
      source: pb.block.source === 'scheduler' ? 'scheduler' : pb.block.source,
      locked: pb.lockedByUser ?? pb.block.locked,
      createdAt: pb.block.createdAt || now,
      updatedAt: now,
    };
    if (seen.has(block.id)) continue;
    seen.add(block.id);
    added.push(block);
  }

  const blocks = [...kept, ...added];

  const transaction: ConfirmTransaction = {
    runId: proposal.runId,
    confirmedAt: now,
    addedBlockIds: added.map((b) => b.id),
    replacedBlockSnapshots: replaced.map((b) => ({ ...b })),
    replanScope: scope,
  };

  return { blocks, transaction };
}

/**
 * Undo the most recent confirm: remove the added blocks and restore the
 * replaced snapshots. If a block id present in the transaction was later
 * modified by the user (e.g. edited then the id matches), it is still removed —
 * undo restores the pre-confirm state wholesale, which is the documented
 * contract ("Undo 后必须恢复确认前状态").
 *
 * Pure: inputs are never mutated.
 */
export function undoTransaction(
  current: ScheduleBlock[],
  transaction: ConfirmTransaction,
): ScheduleBlock[] {
  const addedIds = new Set(transaction.addedBlockIds);
  // Drop the added blocks.
  const withoutAdded = current.filter((b) => !addedIds.has(b.id));
  // Restore replaced snapshots (skip any whose id somehow still exists, to
  // avoid duplicates — defensive, since added ids and replaced ids never
  // overlap by construction).
  const existingIds = new Set(withoutAdded.map((b) => b.id));
  const restored = transaction.replacedBlockSnapshots.filter((b) => !existingIds.has(b.id));
  return [...withoutAdded, ...restored];
}

/** True when there is something to undo. */
export function canUndo(transaction: ConfirmTransaction | null): transaction is ConfirmTransaction {
  return !!transaction;
}
