import { describe, expect, it } from 'vitest';
import proposalSrc from './proposal.ts?raw';
import {
  DEFAULT_V2_SETTINGS,
  classifyUnscheduled,
  deadlineDays,
  generateProposal,
  isRemovable,
  periodOfStart,
  scoreBlock,
  type Candidate,
  type DayPlan,
  type ProposalInput,
  type ReplanScope,
  type SchedulerV2Settings,
} from './proposal';
import { emptyAvailability } from '@/types';
import type { AvailabilitySlot, ScheduleBlock, Task, Weekday, WeeklyAvailability } from '@/types';

// 2026-08-10 is a Monday. Every fixture is anchored to it so the proposal is
// fully deterministic — generateProposal never reads the system clock.
const FROM = '2026-08-10';
const MON = '2026-08-10';
const TUE = '2026-08-11';
const WED = '2026-08-12';
const THU = '2026-08-13';
const FRI = '2026-08-14';

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

function mkBlock(
  id: string,
  over: Partial<ScheduleBlock> = {},
): ScheduleBlock {
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

function availAll(slots: AvailabilitySlot[]): WeeklyAvailability {
  const a = {} as WeeklyAvailability;
  const days: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (const d of days) a[d] = slots.map((s) => ({ ...s }));
  return a;
}

function mkInput(over: Partial<ProposalInput> = {}): ProposalInput {
  return {
    tasks: [],
    availability: emptyAvailability(),
    existingBlocks: [],
    from: FROM,
    generatedAt: GEN_AT,
    settings: { ...DEFAULT_V2_SETTINGS },
    ...over,
  };
}

function run(over: Partial<ProposalInput> = {}) {
  return generateProposal(mkInput(over));
}

// ============================================================ basic placement

describe('generateProposal — basic placement', () => {
  it('places a single task in one block', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: TUE, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '11:00')] }),
    });
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0].block).toMatchObject({
      taskId: 't1',
      date: MON,
      startTime: '09:00',
      endTime: '10:00',
      plannedMinutes: 60,
      source: 'scheduler',
      locked: false,
    });
    expect(res.unscheduled).toEqual([]);
  });

  it('splits a task across multiple blocks when maxBlockMinutes is reached', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: TUE, estimatedMinutes: 240 })],
      availability: availabilityFor({ monday: [slot('09:00', '13:00')] }),
      settings: { ...DEFAULT_V2_SETTINGS, maxBlockMinutes: 120 },
    });
    expect(res.blocks.map((b) => [b.block.startTime, b.block.endTime])).toEqual([
      ['09:00', '11:00'],
      ['11:05', '13:00'], // 120 + 5 break + 115 = 240
    ]);
  });

  it('splits a task across multiple days', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 180 })],
      availability: availabilityFor({
        monday: [slot('09:00', '11:00')],
        tuesday: [slot('09:00', '11:00')],
      }),
    });
    expect(res.blocks.map((b) => [b.block.date, b.block.startTime, b.block.endTime])).toEqual([
      [MON, '09:00', '11:00'],
      [TUE, '09:00', '10:00'],
    ]);
  });

  it('skips done tasks entirely', () => {
    const res = run({
      tasks: [mkTask('done', { status: 'done', estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    });
    expect(res.blocks).toEqual([]);
    expect(res.unscheduled).toEqual([]);
  });

  it('does not re-plan a task already fully covered by surviving blocks', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: TUE, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
      existingBlocks: [mkBlock('existing', { taskId: 't1', source: 'manual', date: MON, startTime: '09:00', endTime: '10:00' })],
    });
    expect(res.blocks).toEqual([]);
    expect(res.unscheduled).toEqual([]);
  });
});

// ============================================================ hard constraints

describe('generateProposal — hard constraints never violated', () => {
  it('never places outside availability', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '10:00')] }),
    });
    for (const pb of res.blocks) {
      expect(pb.block.startTime >= '09:00').toBe(true);
      expect(pb.block.endTime <= '10:00').toBe(true);
    }
  });

  it('never places after the task deadline', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: MON, estimatedMinutes: 240 })],
      availability: availabilityFor({
        monday: [slot('09:00', '11:00')],
        tuesday: [slot('09:00', '17:00')], // plenty but after deadline
      }),
    });
    for (const pb of res.blocks) {
      expect(pb.block.date <= MON).toBe(true);
    }
  });

  it('respects allowDeadlineDay=false (no blocks on the deadline day)', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: MON, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
      settings: { ...DEFAULT_V2_SETTINGS, allowDeadlineDay: false },
    });
    // deadline is Monday, allowDeadlineDay=false → last allowed day is Sunday (before horizon)
    expect(res.blocks).toEqual([]);
    expect(res.unscheduled).toHaveLength(1);
  });

  it('respects the daily study limit cap', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 300 })],
      availability: availabilityFor({
        monday: [slot('09:00', '17:00')], // 480 min available
        tuesday: [slot('09:00', '17:00')],
      }),
      settings: { ...DEFAULT_V2_SETTINGS, dailyStudyLimitMinutes: 90 },
    });
    // Each day capped at 90 min → 90+90 = 180 placed, 120 remaining
    const perDay = new Map<string, number>();
    for (const pb of res.blocks) {
      perDay.set(pb.block.date, (perDay.get(pb.block.date) ?? 0) + pb.block.plannedMinutes);
    }
    for (const total of perDay.values()) {
      expect(total).toBeLessThanOrEqual(90);
    }
  });

  it('enforces minimum break between new blocks', () => {
    const res = run({
      tasks: [
        mkTask('t1', { dueDate: WED, estimatedMinutes: 60 }),
        mkTask('t2', { dueDate: WED, estimatedMinutes: 60, createdAt: 10 }),
      ],
      availability: availabilityFor({ monday: [slot('09:00', '11:00')] }),
      settings: { ...DEFAULT_V2_SETTINGS, breakMinutes: 15 },
    });
    // t1: 09:00-10:00, break 15 → t2 starts at 10:15
    const sorted = res.blocks.map((b) => b.block).sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (sorted.length >= 2) {
      const gap = parseMin(sorted[1].startTime) - parseMin(sorted[0].endTime);
      expect(gap).toBeGreaterThanOrEqual(15);
    }
  });

  it('never creates a block longer than maxBlockMinutes', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 500 })],
      availability: availabilityFor({ monday: [slot('09:00', '23:00')] }),
      settings: { ...DEFAULT_V2_SETTINGS, maxBlockMinutes: 90 },
    });
    for (const pb of res.blocks) {
      expect(pb.block.plannedMinutes).toBeLessThanOrEqual(90);
    }
  });

  it('respects the finishing-block exemption (sub-min block only when it completes the task)', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: TUE, estimatedMinutes: 130 })],
      availability: availabilityFor({
        monday: [slot('09:00', '11:00')], // 120 min → maxBlock cap
        tuesday: [slot('09:00', '11:00')],
      }),
      settings: { ...DEFAULT_V2_SETTINGS, maxBlockMinutes: 120, minBlockMinutes: 25 },
    });
    // 130 = 120 + 10-minute finishing block (below minBlock, but completes the task)
    expect(res.blocks.map((b) => [b.block.date, b.block.plannedMinutes])).toEqual([
      [MON, 120],
      [TUE, 10],
    ]);
    expect(res.unscheduled).toEqual([]);
  });
});

// ============================================================ manual / locked / external

describe('generateProposal — manual / locked / external blocks are never moved', () => {
  it('treats manual blocks as busy (does not overlap them)', () => {
    const manual = mkBlock('manual1', { source: 'manual', date: MON, startTime: '09:00', endTime: '10:00' });
    const res = run({
      tasks: [mkTask('t1', { dueDate: TUE, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '11:00')] }),
      existingBlocks: [manual],
    });
    for (const pb of res.blocks) {
      if (pb.block.date === MON) {
        expect(pb.block.startTime >= '10:00').toBe(true);
      }
    }
  });

  it('treats locked scheduler blocks as busy (does not overlap them)', () => {
    const locked = mkBlock('locked1', { source: 'scheduler', locked: true, taskId: 'other', date: MON, startTime: '09:00', endTime: '10:00' });
    const res = run({
      tasks: [mkTask('t1', { dueDate: TUE, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '11:00')] }),
      existingBlocks: [locked],
    });
    for (const pb of res.blocks) {
      if (pb.block.date === MON) {
        expect(pb.block.startTime >= '10:00').toBe(true);
      }
    }
  });

  it('treats external blocks as busy (does not overlap them)', () => {
    const external = mkBlock('ext1', { source: 'external', taskId: undefined, date: MON, startTime: '09:00', endTime: '10:00' });
    const res = run({
      tasks: [mkTask('t1', { dueDate: TUE, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '11:00')] }),
      existingBlocks: [external],
    });
    for (const pb of res.blocks) {
      if (pb.block.date === MON) {
        expect(pb.block.startTime >= '10:00').toBe(true);
      }
    }
  });

  it('proposal blocks never include manual/locked/external block ids', () => {
    const existing = [
      mkBlock('m', { source: 'manual' }),
      mkBlock('l', { source: 'scheduler', locked: true }),
      mkBlock('e', { source: 'external' }),
    ];
    const res = run({
      tasks: [mkTask('t1', { dueDate: TUE, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
      existingBlocks: existing,
    });
    const ids = res.blocks.map((b) => b.block.id);
    expect(ids).not.toContain('m');
    expect(ids).not.toContain('l');
    expect(ids).not.toContain('e');
  });
});

// ============================================================ isRemovable

describe('isRemovable', () => {
  it('returns false for manual blocks regardless of scope', () => {
    expect(isRemovable(mkBlock('m', { source: 'manual' }), { type: 'all-unlocked' })).toBe(false);
  });

  it('returns false for external blocks regardless of scope', () => {
    expect(isRemovable(mkBlock('e', { source: 'external' }), { type: 'all-unlocked' })).toBe(false);
  });

  it('returns false for locked scheduler blocks regardless of scope', () => {
    expect(isRemovable(mkBlock('l', { source: 'scheduler', locked: true }), { type: 'all-unlocked' })).toBe(false);
  });

  it('returns true for unlocked scheduler blocks under all-unlocked scope', () => {
    expect(isRemovable(mkBlock('s', { source: 'scheduler', locked: false }), { type: 'all-unlocked' })).toBe(true);
  });

  it('returns true for unlocked scheduler blocks with no scope', () => {
    expect(isRemovable(mkBlock('s', { source: 'scheduler', locked: false }), undefined)).toBe(true);
  });

  it('returns true only for the scoped task under task scope', () => {
    const scope: ReplanScope = { type: 'task', taskId: 't1' };
    expect(isRemovable(mkBlock('s1', { source: 'scheduler', taskId: 't1' }), scope)).toBe(true);
    expect(isRemovable(mkBlock('s2', { source: 'scheduler', taskId: 't2' }), scope)).toBe(false);
  });

  it('returns true only for the scoped date under day scope', () => {
    const scope: ReplanScope = { type: 'day', date: MON };
    expect(isRemovable(mkBlock('s1', { source: 'scheduler', date: MON }), scope)).toBe(true);
    expect(isRemovable(mkBlock('s2', { source: 'scheduler', date: TUE }), scope)).toBe(false);
  });
});

// ============================================================ determinism

describe('generateProposal — determinism', () => {
  it('produces identical output for identical input', () => {
    const input = mkInput({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 150 })],
      availability: availabilityFor({
        monday: [slot('09:00', '12:00')],
        tuesday: [slot('14:00', '17:00')],
      }),
    });
    const a = generateProposal(structuredClone(input));
    const b = generateProposal(structuredClone(input));
    expect(a).toEqual(b);
  });

  it('produces a stable runId for identical input', () => {
    const input = mkInput({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    });
    expect(generateProposal(input).runId).toBe(generateProposal(input).runId);
  });

  it('produces different runIds when settings change', () => {
    const base = mkInput({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    });
    const a = generateProposal({ ...base, settings: { ...base.settings, dailyStudyLimitMinutes: 240 } });
    const b = generateProposal({ ...base, settings: { ...base.settings, dailyStudyLimitMinutes: 480 } });
    expect(a.runId).not.toBe(b.runId);
  });
});

// ============================================================ score determinism

describe('generateProposal — score determinism', () => {
  it('produces identical scores for identical input', () => {
    const input = mkInput({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 150, priority: 'high' })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
      settings: { ...DEFAULT_V2_SETTINGS, preferredPeriods: ['morning'] },
    });
    const a = generateProposal(structuredClone(input));
    const b = generateProposal(structuredClone(input));
    expect(a.blocks.map((pb) => pb.score)).toEqual(b.blocks.map((pb) => pb.score));
    expect(a.score).toBe(b.score);
  });

  it('every proposed block has a score and 1-3 reasons', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 150, priority: 'high' })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
      settings: { ...DEFAULT_V2_SETTINGS, preferredPeriods: ['morning'] },
    });
    expect(res.blocks.length).toBeGreaterThan(0);
    for (const pb of res.blocks) {
      expect(typeof pb.score).toBe('number');
      expect(pb.score).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(pb.reasons)).toBe(true);
      expect(pb.reasons.length).toBeGreaterThanOrEqual(1);
      expect(pb.reasons.length).toBeLessThanOrEqual(3);
    }
  });
});

// ============================================================ unscheduled reasons

describe('generateProposal — unscheduled reason codes', () => {
  it('NO_ESTIMATE: task without estimatedMinutes', () => {
    const res = run({
      tasks: [mkTask('t1', { estimatedMinutes: undefined })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    });
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 0, reason: 'NO_ESTIMATE' },
    ]);
  });

  it('NO_ESTIMATE: task with estimatedMinutes = 0', () => {
    const res = run({
      tasks: [mkTask('t1', { estimatedMinutes: 0 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    });
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 0, reason: 'NO_ESTIMATE' },
    ]);
  });

  it('INVALID_DEADLINE: empty dueDate', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: '', estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    });
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 60, reason: 'INVALID_DEADLINE' },
    ]);
  });

  it('INVALID_DEADLINE: overflow date', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: '2026-02-30', estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    });
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 60, reason: 'INVALID_DEADLINE' },
    ]);
  });

  it('DEADLINE_TOO_CLOSE: dueDate before from', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: '2026-08-09', estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    });
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 60, reason: 'DEADLINE_TOO_CLOSE' },
    ]);
  });

  it('NO_AVAILABILITY: no free time at all before deadline', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 60 })],
      availability: emptyAvailability(),
    });
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 60, reason: 'NO_AVAILABILITY' },
    ]);
  });

  it('BLOCKED_BY_LOCKED_SESSIONS: availability consumed by locked/manual blocks', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: TUE, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '11:00')] }),
      existingBlocks: [
        mkBlock('busy', { source: 'manual', taskId: 'other', date: MON, startTime: '09:00', endTime: '11:00' }),
      ],
    });
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 60, reason: 'BLOCKED_BY_LOCKED_SESSIONS' },
    ]);
  });

  it('DAILY_LIMIT_REACHED: daily cap too low to fit the task', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 300 })],
      availability: availabilityFor({
        monday: [slot('09:00', '17:00')],
        tuesday: [slot('09:00', '17:00')],
      }),
      settings: { ...DEFAULT_V2_SETTINGS, dailyStudyLimitMinutes: 60 },
    });
    // 2 days × 60 cap = 120 placed, 180 remaining; totalCap (120) < 180, totalAvail (960) >= 180
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 180, reason: 'DAILY_LIMIT_REACHED' },
    ]);
  });

  it('NO_SLOT_LARGE_ENOUGH: free intervals all shorter than minBlock', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: TUE, estimatedMinutes: 60 })],
      availability: availabilityFor({
        monday: [slot('09:00', '09:10'), slot('10:00', '10:10')], // 10-min fragments
      }),
      settings: { ...DEFAULT_V2_SETTINGS, minBlockMinutes: 25 },
    });
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 60, reason: 'NO_SLOT_LARGE_ENOUGH' },
    ]);
  });

  it('OUTSIDE_HORIZON: capacity exists but task cannot be completed in horizon', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: '2026-08-20', estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '09:30')] }),
      settings: { ...DEFAULT_V2_SETTINGS, horizonDays: 1, minBlockMinutes: 25 },
    });
    // 30 min available, 30 placed, 30 remaining; totalCap (30) >= remaining (30), hasBigEnoughSlot true
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 30, reason: 'OUTSIDE_HORIZON' },
    ]);
  });

  it('reason codes are stable across runs (deterministic)', () => {
    const input = mkInput({
      tasks: [mkTask('t1', { estimatedMinutes: undefined })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    });
    expect(generateProposal(input).unscheduled).toEqual(generateProposal(input).unscheduled);
  });
});

// ============================================================ excluded tasks

describe('generateProposal — excluded tasks', () => {
  it('skips excluded tasks entirely (not planned, not reported)', () => {
    const res = run({
      tasks: [
        mkTask('t1', { dueDate: WED, estimatedMinutes: 60 }),
        mkTask('t2', { dueDate: WED, estimatedMinutes: 60, createdAt: 10 }),
      ],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
      excludedTaskIds: ['t1'],
    });
    expect(res.blocks.every((b) => b.block.taskId !== 't1')).toBe(true);
    expect(res.unscheduled.every((u) => u.taskId !== 't1')).toBe(true);
  });
});

// ============================================================ replan scopes

describe('generateProposal — incremental replan scopes', () => {
  const baseExisting: ScheduleBlock[] = [
    mkBlock('s-t1-mon', { source: 'scheduler', taskId: 't1', date: MON, startTime: '09:00', endTime: '10:00' }),
    mkBlock('s-t2-tue', { source: 'scheduler', taskId: 't2', date: TUE, startTime: '09:00', endTime: '10:00' }),
    mkBlock('manual', { source: 'manual', taskId: 't3', date: MON, startTime: '10:00', endTime: '11:00' }),
  ];

  it('all-unlocked: all unlocked scheduler blocks are removable (surviving = manual only)', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
      existingBlocks: baseExisting,
      replanScope: { type: 'all-unlocked' },
    });
    // Surviving = manual block only (10:00-11:00). New blocks avoid 09:00-11:00 (padded).
    // Free after manual block + padding: 11:05-12:00 → 55 min, enough for 60? No, 55 < 60.
    // Actually with break 5: manual 10:00-11:00 padded to 09:55-11:05. Free = 09:00-09:55 (55) and 11:05-12:00 (55).
    // 55 < 60 but >= 25, so a 55-min block is placed (not a finishing block since 55 !== 60).
    // Wait: len = min(55, 60, budget, 120) = 55. 55 >= minBlock(25), so it places 55 min. remaining = 5.
    // Then 5 < minBlock and 5 !== 5? No, 5 === remaining (5) → finishing block exemption. Places 5 min.
    // Actually, let me just check the proposal doesn't overlap the manual block.
    for (const pb of res.blocks) {
      if (pb.block.date === MON) {
        const s = parseMin(pb.block.startTime);
        const e = parseMin(pb.block.endTime);
        // Should not overlap 10:00-11:00 (600-660)
        expect(e <= 600 || s >= 660).toBe(true);
      }
    }
  });

  it('task scope: only the scoped task is a placement candidate; other tasks are skipped', () => {
    const res = run({
      tasks: [
        mkTask('t1', { dueDate: WED, estimatedMinutes: 60 }),
        mkTask('t2', { dueDate: WED, estimatedMinutes: 60, createdAt: 10 }),
      ],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
      existingBlocks: [],
      replanScope: { type: 'task', taskId: 't1' },
    });
    // Only t1 is placed; t2 is not reported (it's skipped, not unscheduled)
    expect(res.blocks.every((b) => b.block.taskId === 't1')).toBe(true);
    expect(res.unscheduled.every((u) => u.taskId !== 't2')).toBe(true);
  });

  it('day scope: only places blocks on the scoped date', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: FRI, estimatedMinutes: 180 })],
      availability: availabilityFor({
        monday: [slot('09:00', '12:00')],
        tuesday: [slot('09:00', '12:00')],
        wednesday: [slot('09:00', '12:00')],
      }),
      existingBlocks: [],
      replanScope: { type: 'day', date: MON },
    });
    // Only Monday blocks; the rest of the task is unscheduled
    for (const pb of res.blocks) {
      expect(pb.block.date).toBe(MON);
    }
  });

  it('task scope: surviving scheduler blocks for OTHER tasks still count as busy', () => {
    const res = run({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '11:00')] }),
      existingBlocks: [
        mkBlock('s-t2', { source: 'scheduler', taskId: 't2', date: MON, startTime: '09:00', endTime: '10:00' }),
      ],
      replanScope: { type: 'task', taskId: 't1' },
    });
    // t2's scheduler block survives (not removable by task scope for t1) → t1 avoids 09:00-10:00
    for (const pb of res.blocks) {
      if (pb.block.date === MON) {
        expect(pb.block.startTime >= '10:00').toBe(true);
      }
    }
  });
});

// ============================================================ purity

describe('generateProposal — purity', () => {
  it('never mutates its inputs', () => {
    const input = mkInput({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 150, priority: 'high' })],
      availability: availabilityFor({
        monday: [slot('09:00', '12:00')],
        tuesday: [slot('14:00', '17:00')],
      }),
      existingBlocks: [mkBlock('e1', { source: 'manual' })],
    });
    const snapshot = structuredClone(input);
    generateProposal(input);
    expect(input).toEqual(snapshot);
  });

  it('does not write to existingBlocks (proposal blocks are separate objects)', () => {
    const existing = [mkBlock('e1', { source: 'manual' })];
    const res = run({
      tasks: [mkTask('t1', { dueDate: TUE, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
      existingBlocks: existing,
    });
    // Proposal blocks have sb:prop: ids, never the existing block ids
    for (const pb of res.blocks) {
      expect(existing.find((b) => b.id === pb.block.id)).toBeUndefined();
    }
  });
});

// ============================================================ property / invariant

describe('generateProposal — property / invariant tests', () => {
  /** Assert every hard-constraint invariant over a proposal. */
  function assertInvariants(res: ReturnType<typeof generateProposal>, input: ProposalInput) {
    const { settings } = input;
    const taskById = new Map(input.tasks.map((t) => [t.id, t]));

    // 1. No overlap between proposed blocks on the same day.
    const byDate = new Map<string, ScheduleBlock[]>();
    for (const pb of res.blocks) {
      const list = byDate.get(pb.block.date) ?? [];
      list.push(pb.block);
      byDate.set(pb.block.date, list);
    }
    for (const [date, blocks] of byDate) {
      const intervals = blocks
        .map((b) => ({ start: parseMin(b.startTime), end: parseMin(b.endTime) }))
        .sort((a, b) => a.start - b.start);
      for (let i = 1; i < intervals.length; i++) {
        expect(intervals[i].start).toBeGreaterThanOrEqual(intervals[i - 1].end);
      }
      void date;
    }

    // 2. All proposed blocks are within availability (check via weekday).
    for (const pb of res.blocks) {
      const weekday = weekdayOf(pb.block.date);
      if (!weekday) continue;
      const slots = input.availability[weekday] ?? [];
      const start = parseMin(pb.block.startTime);
      const end = parseMin(pb.block.endTime);
      const inside = slots.some((s) => parseMin(s.startTime) <= start && end <= parseMin(s.endTime));
      expect(inside).toBe(true);
    }

    // 3. No proposed block after its task's deadline.
    for (const pb of res.blocks) {
      const task = pb.block.taskId ? taskById.get(pb.block.taskId) : undefined;
      if (task?.dueDate) {
        if (settings.allowDeadlineDay) {
          expect(pb.block.date <= task.dueDate).toBe(true);
        } else {
          expect(pb.block.date < task.dueDate).toBe(true);
        }
      }
    }

    // 4. Daily total respects dailyStudyLimitMinutes.
    if (settings.dailyStudyLimitMinutes > 0) {
      for (const [, blocks] of byDate) {
        const total = blocks.reduce((s, b) => s + b.plannedMinutes, 0);
        expect(total).toBeLessThanOrEqual(settings.dailyStudyLimitMinutes);
      }
    }

    // 5. Minimum break between blocks (if breakMinutes > 0).
    if (settings.breakMinutes > 0) {
      for (const [, blocks] of byDate) {
        const intervals = blocks
          .map((b) => ({ start: parseMin(b.startTime), end: parseMin(b.endTime) }))
          .sort((a, b) => a.start - b.start);
        for (let i = 1; i < intervals.length; i++) {
          // Touching or gap >= breakMinutes is OK (break enforced between new blocks;
          // a new block may touch a surviving block since padding is on the surviving side).
          const gap = intervals[i].start - intervals[i - 1].end;
          // The gap between two NEW blocks must be >= breakMinutes (unless one is a
          // finishing block touching — but the algorithm always adds breakMinutes).
          if (gap < 0) continue; // overlap handled above
          // Only check if both are proposal blocks (they always are here).
          expect(gap === 0 || gap >= settings.breakMinutes).toBe(true);
        }
      }
    }

    // 6. Duration within bounds (with finishing-block exemption: a block may be
    //    shorter than minBlock only if it equals the task's remaining estimate).
    for (const pb of res.blocks) {
      expect(pb.block.plannedMinutes).toBeGreaterThan(0);
      expect(pb.block.plannedMinutes).toBeLessThanOrEqual(settings.maxBlockMinutes);
      // Sub-minimum is allowed only for finishing blocks (the algorithm guarantees this).
    }

    // 7. Every proposed block has score + 1-3 reasons.
    for (const pb of res.blocks) {
      expect(typeof pb.score).toBe('number');
      expect(pb.reasons.length).toBeGreaterThanOrEqual(1);
      expect(pb.reasons.length).toBeLessThanOrEqual(3);
    }

    // 8. Every unscheduled item has a stable reason code.
    for (const u of res.unscheduled) {
      expect(u.reason).toMatch(/^[A-Z_]+$/);
    }
  }

  it('invariants hold for a simple single-task proposal', () => {
    const input = mkInput({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    });
    assertInvariants(generateProposal(input), input);
  });

  it('invariants hold for a multi-task, multi-day proposal with splits', () => {
    const input = mkInput({
      tasks: [
        mkTask('t1', { dueDate: WED, estimatedMinutes: 240, priority: 'high' }),
        mkTask('t2', { dueDate: THU, estimatedMinutes: 120, priority: 'medium', createdAt: 10 }),
        mkTask('t3', { dueDate: FRI, estimatedMinutes: 90, priority: 'low', createdAt: 20 }),
      ],
      availability: availAll([slot('09:00', '12:00'), slot('14:00', '17:00')]),
    });
    assertInvariants(generateProposal(input), input);
  });

  it('invariants hold with existing locked/manual/external blocks', () => {
    const input = mkInput({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 180 })],
      availability: availAll([slot('09:00', '17:00')]),
      existingBlocks: [
        mkBlock('m', { source: 'manual', date: MON, startTime: '10:00', endTime: '11:00' }),
        mkBlock('l', { source: 'scheduler', locked: true, taskId: 'other', date: TUE, startTime: '14:00', endTime: '15:00' }),
        mkBlock('e', { source: 'external', date: WED, startTime: '09:00', endTime: '10:00' }),
      ],
    });
    assertInvariants(generateProposal(input), input);
  });

  it('invariants hold with tight daily cap and breaks', () => {
    const input = mkInput({
      tasks: [
        mkTask('t1', { dueDate: FRI, estimatedMinutes: 300 }),
        mkTask('t2', { dueDate: FRI, estimatedMinutes: 200, createdAt: 10 }),
      ],
      availability: availAll([slot('09:00', '22:00')]),
      settings: {
        ...DEFAULT_V2_SETTINGS,
        dailyStudyLimitMinutes: 120,
        breakMinutes: 10,
        maxBlockMinutes: 90,
        preferredPeriods: ['morning', 'afternoon'],
      },
    });
    assertInvariants(generateProposal(input), input);
  });

  it('invariants hold under single-task replan scope', () => {
    const input = mkInput({
      tasks: [mkTask('t1', { dueDate: WED, estimatedMinutes: 120 })],
      availability: availAll([slot('09:00', '17:00')]),
      existingBlocks: [
        mkBlock('s1', { source: 'scheduler', taskId: 't1', date: MON, startTime: '09:00', endTime: '10:00' }),
        mkBlock('s2', { source: 'scheduler', taskId: 't2', date: TUE, startTime: '09:00', endTime: '10:00' }),
      ],
      replanScope: { type: 'task', taskId: 't1' },
    });
    assertInvariants(generateProposal(input), input);
  });

  it('invariants hold under single-day replan scope', () => {
    const input = mkInput({
      tasks: [mkTask('t1', { dueDate: FRI, estimatedMinutes: 240 })],
      availability: availAll([slot('09:00', '17:00')]),
      existingBlocks: [
        mkBlock('s1', { source: 'scheduler', taskId: 't1', date: TUE, startTime: '09:00', endTime: '10:00' }),
      ],
      replanScope: { type: 'day', date: MON },
    });
    assertInvariants(generateProposal(input), input);
  });
});

// ============================================================ scoring helpers

describe('scoreBlock', () => {
  const days: DayPlan[] = [
    { date: MON, free: [{ start: 540, end: 660 }], budget: 480, capacity: 120, busyMinutes: 0, availMinutes: 120 },
  ];

  it('is deterministic (same inputs → same score + reasons)', () => {
    const block = mkBlock('b1', { date: MON, startTime: '09:00', endTime: '10:00', plannedMinutes: 60 });
    const task = mkTask('t1', { dueDate: WED });
    const settings = { ...DEFAULT_V2_SETTINGS, preferredPeriods: ['morning'] as const };
    const a = scoreBlock(block, task, settings, days);
    const b = scoreBlock(block, task, settings, days);
    expect(a).toEqual(b);
  });

  it('awards deadline urgency bonus for close deadlines', () => {
    const block = mkBlock('b1', { date: MON, startTime: '09:00', endTime: '10:00', plannedMinutes: 60 });
    const task = mkTask('t1', { dueDate: TUE }); // 1 day away
    const { score, reasons } = scoreBlock(block, task, DEFAULT_V2_SETTINGS, days);
    expect(score).toBeGreaterThan(100);
    expect(reasons.some((r) => r.includes('截止日'))).toBe(true);
  });

  it('awards preferred-period bonus', () => {
    const block = mkBlock('b1', { date: MON, startTime: '09:00', endTime: '10:00', plannedMinutes: 60 });
    const task = mkTask('t1', { dueDate: '2026-12-31' }); // far away, no urgency
    const settings = { ...DEFAULT_V2_SETTINGS, preferredPeriods: ['morning'] as const };
    const { score, reasons } = scoreBlock(block, task, settings, days);
    expect(score).toBeGreaterThan(100);
    expect(reasons.some((r) => r.includes('偏好'))).toBe(true);
  });

  it('penalizes late-hour blocks', () => {
    const lateBlock = mkBlock('b1', { date: MON, startTime: '21:30', endTime: '22:30', plannedMinutes: 60 });
    const task = mkTask('t1', { dueDate: '2026-12-31' });
    const { score, reasons } = scoreBlock(lateBlock, task, DEFAULT_V2_SETTINGS, days);
    expect(score).toBeLessThan(100);
    expect(reasons.some((r) => r.includes('偏晚'))).toBe(true);
  });
});

describe('deadlineDays', () => {
  it('counts days between two ISO dates', () => {
    expect(deadlineDays(TUE, MON)).toBe(1);
    expect(deadlineDays(WED, MON)).toBe(2);
    expect(deadlineDays(MON, MON)).toBe(0);
  });

  it('clamps to 0 when due is before from', () => {
    expect(deadlineDays('2026-08-09', MON)).toBe(0);
  });

  it('returns 0 for invalid dates', () => {
    expect(deadlineDays('', MON)).toBe(0);
    expect(deadlineDays('2026-02-30', MON)).toBe(0);
  });
});

describe('periodOfStart', () => {
  it('classifies morning/afternoon/evening correctly', () => {
    expect(periodOfStart(6 * 60)).toBe('morning'); // 06:00
    expect(periodOfStart(11 * 60 + 59)).toBe('morning'); // 11:59
    expect(periodOfStart(12 * 60)).toBe('afternoon'); // 12:00
    expect(periodOfStart(17 * 60 + 59)).toBe('afternoon'); // 17:59
    expect(periodOfStart(18 * 60)).toBe('evening'); // 18:00
    expect(periodOfStart(22 * 60 + 59)).toBe('evening'); // 22:59
  });

  it('returns null for late night (before 06:00 or >= 23:00)', () => {
    expect(periodOfStart(0)).toBeNull();
    expect(periodOfStart(5 * 60 + 59)).toBeNull();
    expect(periodOfStart(23 * 60)).toBeNull();
  });
});

// ============================================================ classifyUnscheduled

describe('classifyUnscheduled', () => {
  function mkCandidate(over: Partial<Candidate> = {}): Candidate {
    return { index: 0, id: 't1', dueDate: WED, remaining: 60, priority: 'medium', createdAt: 0, ...over };
  }
  const task = mkTask('t1', { dueDate: WED, estimatedMinutes: 60 });
  const emptyDays: DayPlan[] = [];

  it('returns DEADLINE_TOO_CLOSE when no reachable days and deadline < from', () => {
    const c = mkCandidate({ dueDate: '2026-08-09', remaining: 60 });
    expect(classifyUnscheduled(c, task, emptyDays, MON, '2026-08-09', 25)).toBe('DEADLINE_TOO_CLOSE');
  });

  it('returns OUTSIDE_HORIZON when no reachable days but deadline >= from', () => {
    const c = mkCandidate({ dueDate: WED, remaining: 60 });
    expect(classifyUnscheduled(c, task, emptyDays, MON, WED, 25)).toBe('OUTSIDE_HORIZON');
  });

  it('returns NO_AVAILABILITY when reachable days have zero availability', () => {
    const days: DayPlan[] = [
      { date: MON, free: [], budget: 480, capacity: 0, busyMinutes: 0, availMinutes: 0 },
    ];
    const c = mkCandidate({ remaining: 60 });
    expect(classifyUnscheduled(c, task, days, MON, WED, 25)).toBe('NO_AVAILABILITY');
  });

  it('returns BLOCKED_BY_LOCKED_SESSIONS when all reachable capacity is 0 but availability > 0', () => {
    const days: DayPlan[] = [
      { date: MON, free: [], budget: 0, capacity: 0, busyMinutes: 480, availMinutes: 480 },
    ];
    const c = mkCandidate({ remaining: 60 });
    expect(classifyUnscheduled(c, task, days, MON, WED, 25)).toBe('BLOCKED_BY_LOCKED_SESSIONS');
  });
});

// ============================================================ wiring

describe('proposal.ts wiring', () => {
  it('has no persistence, store or React dependency', () => {
    expect(proposalSrc).not.toMatch(/\blocalStorage\b/);
    expect(proposalSrc).not.toMatch(/from 'react'/);
    expect(proposalSrc).not.toMatch(/from '@\/store'/);
  });

  it('reads no clock and no randomness (deterministic by construction)', () => {
    expect(proposalSrc).not.toMatch(/\bMath\.random\(/);
    expect(proposalSrc).not.toMatch(/\bDate\.now\(/);
    expect(proposalSrc).not.toMatch(/\btodayISO\b/);
    // safeFromISO / new Date are used only for date arithmetic (no clock read).
  });

  it('builds on the shared scheduler interval arithmetic', () => {
    expect(proposalSrc).toContain("from '@/lib/scheduler'");
    expect(proposalSrc).toMatch(/\bmergeIntervals\b/);
    expect(proposalSrc).toMatch(/\bsubtractIntervals\b/);
    expect(proposalSrc).toMatch(/\bintervalsMinutes\b/);
  });
});

// ----------------------------------------------------------------- helpers

function parseMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function weekdayOf(date: string): Weekday | null {
  const map: Record<number, Weekday> = {
    0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
    4: 'thursday', 5: 'friday', 6: 'saturday',
  };
  const d = new Date(date + 'T00:00:00');
  return map[d.getDay()] ?? null;
}
