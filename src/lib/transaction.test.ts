import { describe, expect, it } from 'vitest';
import transactionSrc from './transaction.ts?raw';
import { applyProposal, undoTransaction, canUndo, type ConfirmTransaction } from './transaction';
import { DEFAULT_V2_SETTINGS, generateProposal, type ScheduleProposal } from './proposal';
import { emptyAvailability } from '@/types';
import type { AvailabilitySlot, ScheduleBlock, Task, Weekday, WeeklyAvailability } from '@/types';

// 2026-08-10 is a Monday.
const FROM = '2026-08-10';
const MON = '2026-08-10';
const TUE = '2026-08-11';
const WED = '2026-08-12';
const GEN_AT = 1000000;

// ----------------------------------------------------------------- fixtures

function mkTask(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    dueDate: WED,
    priority: 'medium',
    status: 'todo',
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    subtasks: [],
    estimatedMinutes: 60,
    ...over,
  };
}

function mkBlock(id: string, over: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id,
    taskId: 't1',
    date: MON,
    startTime: '09:00',
    endTime: '10:00',
    plannedMinutes: 60,
    source: 'manual',
    locked: false,
    status: 'planned',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const slot = (startTime: string, endTime: string): AvailabilitySlot => ({ startTime, endTime });

function availabilityFor(map: Partial<Record<Weekday, AvailabilitySlot[]>>): WeeklyAvailability {
  return { ...emptyAvailability(), ...map };
}

/** Build a real proposal to feed into applyProposal. */
function mkProposal(
  over: Partial<ScheduleProposal> = {},
  existingBlocks: ScheduleBlock[] = [],
  tasks: Task[] = [],
): ScheduleProposal {
  const base = generateProposal({
    tasks: tasks.length > 0 ? tasks : [mkTask('t1', { dueDate: WED, estimatedMinutes: 60 })],
    availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    existingBlocks,
    from: FROM,
    generatedAt: GEN_AT,
    settings: { ...DEFAULT_V2_SETTINGS },
  });
  return { ...base, ...over };
}

// ============================================================ applyProposal

describe('applyProposal', () => {
  it('replaces in-scope removable scheduler blocks with proposal blocks', () => {
    const existing = [
      mkBlock('s1', { source: 'scheduler', taskId: 't1', locked: false }),
    ];
    const proposal = mkProposal({}, existing);
    const { blocks, transaction } = applyProposal(existing, proposal, GEN_AT);

    // The old scheduler block is gone; the proposal block is added.
    expect(blocks.find((b) => b.id === 's1')).toBeUndefined();
    expect(transaction.replacedBlockSnapshots).toHaveLength(1);
    expect(transaction.replacedBlockSnapshots[0].id).toBe('s1');
    expect(transaction.addedBlockIds.length).toBe(proposal.blocks.length);
  });

  it('keeps manual blocks untouched', () => {
    const manual = mkBlock('m1', { source: 'manual', taskId: 'other' });
    const proposal = mkProposal({}, [manual]);
    const { blocks } = applyProposal([manual], proposal, GEN_AT);
    expect(blocks.find((b) => b.id === 'm1')).toEqual(manual);
  });

  it('keeps locked scheduler blocks untouched', () => {
    const locked = mkBlock('l1', { source: 'scheduler', locked: true, taskId: 'other' });
    const proposal = mkProposal({}, [locked]);
    const { blocks } = applyProposal([locked], proposal, GEN_AT);
    expect(blocks.find((b) => b.id === 'l1')).toEqual(locked);
  });

  it('keeps external blocks untouched', () => {
    const external = mkBlock('e1', { source: 'external', taskId: undefined });
    const proposal = mkProposal({}, [external]);
    const { blocks } = applyProposal([external], proposal, GEN_AT);
    expect(blocks.find((b) => b.id === 'e1')).toEqual(external);
  });

  it('keeps scheduler blocks outside the replan scope', () => {
    const inScope = mkBlock('s-in', { source: 'scheduler', taskId: 't1', date: MON });
    const outOfScope = mkBlock('s-out', { source: 'scheduler', taskId: 't2', date: TUE });
    const proposal = mkProposal(
      { replanScope: { type: 'task', taskId: 't1' } },
      [inScope, outOfScope],
      [mkTask('t1', { dueDate: WED, estimatedMinutes: 60 })],
    );
    const { blocks, transaction } = applyProposal([inScope, outOfScope], proposal, GEN_AT);
    // s-out survives because it's for a different task (outside task scope)
    expect(blocks.find((b) => b.id === 's-out')).toEqual(outOfScope);
    expect(transaction.replacedBlockSnapshots.find((b) => b.id === 's-out')).toBeUndefined();
  });

  it('does not mutate its inputs', () => {
    const existing = [
      mkBlock('s1', { source: 'scheduler', taskId: 't1' }),
      mkBlock('m1', { source: 'manual' }),
    ];
    const proposal = mkProposal({}, existing);
    const existingCopy = structuredClone(existing);
    const proposalCopy = structuredClone(proposal);

    applyProposal(existing, proposal, GEN_AT);

    expect(existing).toEqual(existingCopy);
    expect(proposal).toEqual(proposalCopy);
  });

  it('skips duplicate proposal block ids (idempotent against re-confirm)', () => {
    const existing = [
      mkBlock('s1', { source: 'scheduler', taskId: 't1' }),
    ];
    const proposal = mkProposal({}, existing);
    // First confirm
    const first = applyProposal(existing, proposal, GEN_AT);
    // Second confirm on the result (simulates a double-confirm)
    const second = applyProposal(first.blocks, proposal, GEN_AT);
    // The proposal blocks should not be duplicated
    const propIds = proposal.blocks.map((pb) => pb.block.id);
    for (const id of propIds) {
      const count = second.blocks.filter((b) => b.id === id).length;
      expect(count).toBe(1);
    }
  });

  it('records the transaction with runId, confirmedAt, and scope', () => {
    const proposal = mkProposal();
    const { transaction } = applyProposal([], proposal, GEN_AT);
    expect(transaction.runId).toBe(proposal.runId);
    expect(transaction.confirmedAt).toBe(GEN_AT);
    expect(transaction.replanScope).toEqual(proposal.replanScope);
  });

  it('stamps confirmed blocks with updatedAt = now', () => {
    const proposal = mkProposal();
    const { blocks } = applyProposal([], proposal, GEN_AT);
    for (const pb of proposal.blocks) {
      const b = blocks.find((x) => x.id === pb.block.id);
      expect(b?.updatedAt).toBe(GEN_AT);
    }
  });
});

// ============================================================ undoTransaction

describe('undoTransaction', () => {
  it('restores the exact pre-confirm state (added blocks removed, replaced blocks restored)', () => {
    const existing = [
      mkBlock('s1', { source: 'scheduler', taskId: 't1', startTime: '09:00', endTime: '10:00' }),
      mkBlock('m1', { source: 'manual', taskId: 'other', startTime: '10:00', endTime: '11:00' }),
    ];
    const proposal = mkProposal({}, existing);
    const { blocks: confirmed, transaction } = applyProposal(existing, proposal, GEN_AT);

    // Undo
    const restored = undoTransaction(confirmed, transaction);

    // The restored state should match the original existing blocks (by id set).
    expect(new Set(restored.map((b) => b.id))).toEqual(new Set(existing.map((b) => b.id)));
    // The replaced snapshot should be restored with its original data.
    const restoredS1 = restored.find((b) => b.id === 's1');
    expect(restoredS1).toEqual(existing[0]);
  });

  it('removes all added blocks on undo', () => {
    const proposal = mkProposal();
    const { blocks: confirmed, transaction } = applyProposal([], proposal, GEN_AT);
    const restored = undoTransaction(confirmed, transaction);
    for (const id of transaction.addedBlockIds) {
      expect(restored.find((b) => b.id === id)).toBeUndefined();
    }
  });

  it('does not mutate its input', () => {
    const existing = [mkBlock('s1', { source: 'scheduler', taskId: 't1' })];
    const proposal = mkProposal({}, existing);
    const { blocks: confirmed, transaction } = applyProposal(existing, proposal, GEN_AT);
    const confirmedCopy = structuredClone(confirmed);
    const txCopy = structuredClone(transaction);

    undoTransaction(confirmed, transaction);

    expect(confirmed).toEqual(confirmedCopy);
    expect(transaction).toEqual(txCopy);
  });

  it('survives a confirm → undo → confirm cycle (round-trip)', () => {
    const existing = [
      mkBlock('s1', { source: 'scheduler', taskId: 't1' }),
      mkBlock('m1', { source: 'manual' }),
    ];
    const proposal = mkProposal({}, existing);

    // First confirm
    const c1 = applyProposal(existing, proposal, GEN_AT);
    // Undo
    const u1 = undoTransaction(c1.blocks, c1.transaction);
    // Second confirm (from the undone state)
    const c2 = applyProposal(u1, proposal, GEN_AT);

    // The second confirm should produce the same block set as the first.
    expect(new Set(c2.blocks.map((b) => b.id))).toEqual(new Set(c1.blocks.map((b) => b.id)));
  });

  it('handles undo when the user modified a block between confirm and undo', () => {
    const existing = [
      mkBlock('s1', { source: 'scheduler', taskId: 't1', startTime: '09:00', endTime: '10:00' }),
    ];
    const proposal = mkProposal({}, existing);
    const { blocks: confirmed, transaction } = applyProposal(existing, proposal, GEN_AT);

    // User manually adds a block between confirm and undo.
    const userAdded = mkBlock('user', { source: 'manual', startTime: '14:00', endTime: '15:00' });
    const modified = [...confirmed, userAdded];

    const restored = undoTransaction(modified, transaction);

    // The user-added block survives; the confirmed proposal blocks are removed;
    // the replaced snapshot is restored.
    expect(restored.find((b) => b.id === 'user')).toEqual(userAdded);
    expect(restored.find((b) => b.id === 's1')).toEqual(existing[0]);
    for (const id of transaction.addedBlockIds) {
      expect(restored.find((b) => b.id === id)).toBeUndefined();
    }
  });
});

// ============================================================ canUndo

describe('canUndo', () => {
  it('returns true when a transaction exists', () => {
    const tx: ConfirmTransaction = {
      runId: 'r1',
      confirmedAt: 1,
      addedBlockIds: ['a'],
      replacedBlockSnapshots: [],
      replanScope: { type: 'all-unlocked' },
    };
    expect(canUndo(tx)).toBe(true);
  });

  it('returns false when transaction is null', () => {
    expect(canUndo(null)).toBe(false);
  });
});

// ============================================================ integration

describe('confirm + undo integration', () => {
  it('full proposal lifecycle: generate → confirm → undo restores original', () => {
    const tasks = [mkTask('t1', { dueDate: WED, estimatedMinutes: 120 })];
    const availability = availabilityFor({
      monday: [slot('09:00', '12:00')],
      tuesday: [slot('09:00', '12:00')],
    });
    const existing = [
      mkBlock('m1', { source: 'manual', taskId: 'other', startTime: '10:00', endTime: '11:00' }),
      mkBlock('s-old', { source: 'scheduler', taskId: 't1', startTime: '09:00', endTime: '10:00' }),
    ];

    const proposal = generateProposal({
      tasks,
      availability,
      existingBlocks: existing,
      from: FROM,
      generatedAt: GEN_AT,
      settings: { ...DEFAULT_V2_SETTINGS },
    });
    expect(proposal.blocks.length).toBeGreaterThan(0);

    const { blocks: confirmed, transaction } = applyProposal(existing, proposal, GEN_AT);

    // The old scheduler block is replaced; the manual block survives.
    expect(confirmed.find((b) => b.id === 's-old')).toBeUndefined();
    expect(confirmed.find((b) => b.id === 'm1')).toBeDefined();
    expect(confirmed.length).toBeGreaterThanOrEqual(proposal.blocks.length);

    // Undo restores the exact original state.
    const restored = undoTransaction(confirmed, transaction);
    const restoredIds = new Set(restored.map((b) => b.id));
    const originalIds = new Set(existing.map((b) => b.id));
    expect(restoredIds).toEqual(originalIds);
    // The restored s-old block has its original time.
    expect(restored.find((b) => b.id === 's-old')?.startTime).toBe('09:00');
  });

  it('locked block survives confirm and undo', () => {
    const locked = mkBlock('l1', { source: 'scheduler', locked: true, taskId: 'other', startTime: '09:00', endTime: '10:00' });
    const proposal = mkProposal({}, [locked]);
    const { blocks: confirmed, transaction } = applyProposal([locked], proposal, GEN_AT);

    // Locked block survives confirm.
    expect(confirmed.find((b) => b.id === 'l1')).toEqual(locked);

    // Undo does not touch the locked block.
    const restored = undoTransaction(confirmed, transaction);
    expect(restored.find((b) => b.id === 'l1')).toEqual(locked);
  });
});

// ============================================================ wiring

describe('transaction.ts wiring', () => {
  it('has no persistence, store or React dependency', () => {
    expect(transactionSrc).not.toMatch(/\blocalStorage\b/);
    expect(transactionSrc).not.toMatch(/from 'react'/);
    expect(transactionSrc).not.toMatch(/from '@\/store'/);
  });

  it('reads no clock and no randomness', () => {
    expect(transactionSrc).not.toMatch(/\bMath\.random\(/);
    expect(transactionSrc).not.toMatch(/\bDate\.now\(/);
    expect(transactionSrc).not.toMatch(/\bnew Date\(/);
    expect(transactionSrc).not.toMatch(/\btodayISO\b/);
  });

  it('is a pure function over ScheduleBlock[]', () => {
    expect(transactionSrc).toContain('export function applyProposal');
    expect(transactionSrc).toContain('export function undoTransaction');
  });
});
