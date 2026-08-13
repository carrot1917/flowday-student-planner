import { describe, expect, it } from 'vitest';
import scheduleRunSrc from './scheduleRun.ts?raw';
import { buildScheduleInput, buildProposalInput, defaultV2SettingsFromSettings, mergeScheduleBlocks, runProposal } from './scheduleRun';
import { generateSchedule } from './scheduler';
import { DEFAULT_V2_SETTINGS, type SchedulerV2Settings } from './proposal';
import type { AvailabilitySlot, ScheduleBlock, Task, Weekday, WeeklyAvailability } from '@/types';

// ----------------------------------------------------------------- fixtures

const ALL_DAYS: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

function mkTask(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    dueDate: '2026-12-31',
    priority: 'medium',
    status: 'todo',
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    subtasks: [],
    ...over,
  };
}

function b(id: string): ScheduleBlock {
  return { id, taskId: id, date: '2026-08-10', startTime: '09:00', endTime: '10:00', plannedMinutes: 60, source: 'manual', locked: false, status: 'planned', createdAt: 0, updatedAt: 0 };
}

function availAll(slots: AvailabilitySlot[]): WeeklyAvailability {
  const a = {} as WeeklyAvailability;
  for (const d of ALL_DAYS) a[d] = slots.map((s) => ({ ...s }));
  return a;
}

const ids = (blocks: ScheduleBlock[]) => blocks.map((x) => x.id);

// ------------------------------------------------------- buildScheduleInput

describe('buildScheduleInput', () => {
  const tasks = [mkTask('t1')];
  const availability = availAll([{ startTime: '09:00', endTime: '12:00' }]);
  const existingBlocks: ScheduleBlock[] = [b('existing')];

  it('passes the injected `from` straight through (no clock read)', () => {
    const input = buildScheduleInput({ tasks, availability, existingBlocks, from: '2026-08-10' });
    expect(input.from).toBe('2026-08-10');
  });

  it('passes the FULL task list — done filtering stays in the scheduler', () => {
    const withDone: Task[] = [mkTask('a'), { ...mkTask('b'), status: 'done' }];
    const input = buildScheduleInput({ tasks: withDone, availability, existingBlocks, from: '2026-08-10' });
    expect(input.tasks).toHaveLength(2);
    expect(input.tasks.find((t) => t.id === 'b')?.status).toBe('done');
  });

  it('hides parameters behind v1 defaults', () => {
    const input = buildScheduleInput({ tasks, availability, existingBlocks, from: '2026-08-10' });
    expect(input.horizonDays).toBe(14);
    expect(input.minBlockMinutes).toBe(25);
    expect(input.maxBlockMinutes).toBe(120);
  });

  it('does NOT pass dailyMaxMinutes in v1', () => {
    const input = buildScheduleInput({ tasks, availability, existingBlocks, from: '2026-08-10' });
    expect(input.dailyMaxMinutes).toBeUndefined();
    expect('dailyMaxMinutes' in input).toBe(false);
  });

  it('does not mutate its inputs', () => {
    const tasks2 = [mkTask('t1')];
    const avail2 = availAll([{ startTime: '09:00', endTime: '12:00' }]);
    const existing2: ScheduleBlock[] = [b('e')];
    const input = buildScheduleInput({ tasks: tasks2, availability: avail2, existingBlocks: existing2, from: '2026-08-10' });
    // References are passed through unchanged (no clone, no mutation).
    expect(input.tasks).toBe(tasks2);
    expect(input.availability).toBe(avail2);
    expect(input.existingBlocks).toBe(existing2);
  });

  it('builds a valid input that the scheduler can run (integration)', () => {
    const schedulable = [{ ...mkTask('t1'), estimatedMinutes: 60, dueDate: '2026-08-20' }];
    const input = buildScheduleInput({
      tasks: schedulable,
      availability: availAll([{ startTime: '09:00', endTime: '12:00' }]),
      existingBlocks: [],
      from: '2026-08-10',
    });
    const res = generateSchedule(input);
    expect(res.blocks.length).toBeGreaterThan(0);
    // Determinism: identical fixed inputs → identical output.
    const res2 = generateSchedule(
      buildScheduleInput({
        tasks: schedulable,
        availability: availAll([{ startTime: '09:00', endTime: '12:00' }]),
        existingBlocks: [],
        from: '2026-08-10',
      }),
    );
    expect(res2).toEqual(res);
  });
});

// ------------------------------------------------------- mergeScheduleBlocks

describe('mergeScheduleBlocks', () => {
  it('preserves existing order then appends new blocks', () => {
    expect(ids(mergeScheduleBlocks([b('a'), b('c')], [b('b'), b('d')]))).toEqual(['a', 'c', 'b', 'd']);
  });

  it('appends incoming normally', () => {
    expect(ids(mergeScheduleBlocks([b('x'), b('y')], [b('z')]))).toEqual(['x', 'y', 'z']);
  });

  it('skips ids already present in existing', () => {
    expect(ids(mergeScheduleBlocks([b('x')], [b('x'), b('y')]))).toEqual(['x', 'y']);
  });

  it('dedupes duplicate ids within incoming itself', () => {
    expect(ids(mergeScheduleBlocks([], [b('a'), b('a')]))).toEqual(['a']);
  });

  it('is idempotent when the same incoming is merged again', () => {
    const once = mergeScheduleBlocks([b('x')], [b('y'), b('z')]);
    const twice = mergeScheduleBlocks(once, [b('y'), b('z')]);
    expect(ids(twice)).toEqual(['x', 'y', 'z']);
    expect(twice).toEqual(once);
  });

  it('is deterministic for identical inputs', () => {
    const e = [b('x'), b('y')];
    const inc = [b('z'), b('w')];
    expect(mergeScheduleBlocks(e, inc)).toEqual(mergeScheduleBlocks(e, inc));
  });

  it('returns existing (as a copy) when incoming is empty', () => {
    const e = [b('x')];
    const out = mergeScheduleBlocks(e, []);
    expect(ids(out)).toEqual(['x']);
    expect(out).not.toBe(e); // fresh array, but content preserved
  });

  it('returns incoming (as a copy) when existing is empty', () => {
    const inc = [b('x')];
    const out = mergeScheduleBlocks([], inc);
    expect(ids(out)).toEqual(['x']);
    expect(out).not.toBe(inc);
  });
});

// ------------------------------------------------------- Phase 2: proposal

describe('buildProposalInput', () => {
  const tasks = [mkTask('t1', { estimatedMinutes: 60, dueDate: '2026-08-20' })];
  const availability = availAll([{ startTime: '09:00', endTime: '12:00' }]);
  const existingBlocks: ScheduleBlock[] = [b('existing')];
  const settings: SchedulerV2Settings = { ...DEFAULT_V2_SETTINGS, horizonDays: 7 };

  it('passes the injected `from` straight through (no clock read)', () => {
    const input = buildProposalInput({
      tasks, availability, existingBlocks, from: '2026-08-10', generatedAt: 1000, settings,
    });
    expect(input.from).toBe('2026-08-10');
  });

  it('passes the injected `generatedAt` straight through', () => {
    const input = buildProposalInput({
      tasks, availability, existingBlocks, from: '2026-08-10', generatedAt: 9999, settings,
    });
    expect(input.generatedAt).toBe(9999);
  });

  it('passes ALL user-configurable settings explicitly (no hidden defaults)', () => {
    const custom: SchedulerV2Settings = {
      horizonDays: 30,
      dailyStudyLimitMinutes: 300,
      minBlockMinutes: 15,
      maxBlockMinutes: 90,
      breakMinutes: 10,
      preferredPeriods: ['morning', 'evening'],
      allowDeadlineDay: false,
      protectManual: true,
    };
    const input = buildProposalInput({
      tasks, availability, existingBlocks, from: '2026-08-10', generatedAt: 1000, settings: custom,
    });
    expect(input.settings).toEqual(custom);
    // No field is silently overridden.
    expect(input.settings.horizonDays).toBe(30);
    expect(input.settings.dailyStudyLimitMinutes).toBe(300);
    expect(input.settings.allowDeadlineDay).toBe(false);
  });

  it('passes excludedTaskIds and replanScope through', () => {
    const input = buildProposalInput({
      tasks, availability, existingBlocks, from: '2026-08-10', generatedAt: 1000, settings,
      excludedTaskIds: ['t1'],
      replanScope: { type: 'task', taskId: 't1' },
    });
    expect(input.excludedTaskIds).toEqual(['t1']);
    expect(input.replanScope).toEqual({ type: 'task', taskId: 't1' });
  });

  it('does not mutate its inputs (references pass through)', () => {
    const tasksRef = [mkTask('t1')];
    const availRef = availAll([{ startTime: '09:00', endTime: '12:00' }]);
    const blocksRef: ScheduleBlock[] = [b('e')];
    const input = buildProposalInput({
      tasks: tasksRef, availability: availRef, existingBlocks: blocksRef,
      from: '2026-08-10', generatedAt: 1000, settings,
    });
    expect(input.tasks).toBe(tasksRef);
    expect(input.availability).toBe(availRef);
    expect(input.existingBlocks).toBe(blocksRef);
  });
});

describe('runProposal', () => {
  it('builds the input and runs the proposal in one call', () => {
    const proposal = runProposal({
      tasks: [mkTask('t1', { estimatedMinutes: 60, dueDate: '2026-08-20' })],
      availability: availAll([{ startTime: '09:00', endTime: '12:00' }]),
      existingBlocks: [],
      from: '2026-08-10',
      generatedAt: 1000,
      settings: { ...DEFAULT_V2_SETTINGS },
    });
    expect(proposal).toBeDefined();
    expect(proposal.runId).toMatch(/^run:/);
    expect(proposal.from).toBe('2026-08-10');
    expect(proposal.generatedAt).toBe(1000);
    expect(proposal.blocks.length).toBeGreaterThan(0);
  });

  it('is deterministic: identical inputs → identical proposal', () => {
    const args = {
      tasks: [mkTask('t1', { estimatedMinutes: 120, dueDate: '2026-08-20' })],
      availability: availAll([{ startTime: '09:00', endTime: '12:00' }]),
      existingBlocks: [] as ScheduleBlock[],
      from: '2026-08-10',
      generatedAt: 1000,
      settings: { ...DEFAULT_V2_SETTINGS },
    };
    const a = runProposal(args);
    const b = runProposal(args);
    expect(a).toEqual(b);
  });

  it('respects replanScope (single-task scope only places that task)', () => {
    const proposal = runProposal({
      tasks: [
        mkTask('t1', { estimatedMinutes: 60, dueDate: '2026-08-20' }),
        mkTask('t2', { estimatedMinutes: 60, dueDate: '2026-08-20', createdAt: 10 }),
      ],
      availability: availAll([{ startTime: '09:00', endTime: '12:00' }]),
      existingBlocks: [],
      from: '2026-08-10',
      generatedAt: 1000,
      settings: { ...DEFAULT_V2_SETTINGS },
      replanScope: { type: 'task', taskId: 't1' },
    });
    expect(proposal.blocks.every((pb) => pb.block.taskId === 't1')).toBe(true);
  });

  it('does not write to existingBlocks (proposal is separate from formal schedule)', () => {
    const existing: ScheduleBlock[] = [b('formal')];
    const proposal = runProposal({
      tasks: [mkTask('t1', { estimatedMinutes: 60, dueDate: '2026-08-20' })],
      availability: availAll([{ startTime: '09:00', endTime: '12:00' }]),
      existingBlocks: existing,
      from: '2026-08-10',
      generatedAt: 1000,
      settings: { ...DEFAULT_V2_SETTINGS },
    });
    // Proposal blocks never share ids with the formal schedule.
    for (const pb of proposal.blocks) {
      expect(existing.find((b) => b.id === pb.block.id)).toBeUndefined();
    }
  });
});

describe('defaultV2SettingsFromSettings', () => {
  it('derives v2 settings from Phase 1 Settings, keeping v2 defaults for the rest', () => {
    const s = {
      dailyStudyLimitMinutes: 300,
      minBlockMinutes: 20,
      maxBlockMinutes: 100,
      breakMinutes: 10,
    };
    const v2 = defaultV2SettingsFromSettings(s);
    expect(v2.dailyStudyLimitMinutes).toBe(300);
    expect(v2.minBlockMinutes).toBe(20);
    expect(v2.maxBlockMinutes).toBe(100);
    expect(v2.breakMinutes).toBe(10);
    // v2-only fields keep their defaults.
    expect(v2.horizonDays).toBe(DEFAULT_V2_SETTINGS.horizonDays);
    expect(v2.preferredPeriods).toEqual(DEFAULT_V2_SETTINGS.preferredPeriods);
    expect(v2.allowDeadlineDay).toBe(DEFAULT_V2_SETTINGS.allowDeadlineDay);
    expect(v2.protectManual).toBe(DEFAULT_V2_SETTINGS.protectManual);
  });
});

// --------------------------------------------------------------- wiring

describe('scheduleRun.ts wiring', () => {
  it('has no clock, randomness, store or React dependency', () => {
    expect(scheduleRunSrc).not.toMatch(/\bDate\.now\(/);
    expect(scheduleRunSrc).not.toMatch(/\bnew Date\(/);
    expect(scheduleRunSrc).not.toMatch(/\btodayISO\b/);
    expect(scheduleRunSrc).not.toMatch(/\bMath\.random\(/);
    expect(scheduleRunSrc).not.toMatch(/\blocalStorage\b/);
    expect(scheduleRunSrc).not.toMatch(/from 'react'/);
    expect(scheduleRunSrc).not.toMatch(/from '@\/store'/);
  });

  it('builds on the scheduler defaults, not re-implementing them', () => {
    expect(scheduleRunSrc).toContain("from '@/lib/scheduler'");
    expect(scheduleRunSrc).toMatch(/\bDEFAULT_HORIZON_DAYS\b/);
    expect(scheduleRunSrc).toMatch(/\bDEFAULT_MIN_BLOCK_MINUTES\b/);
    expect(scheduleRunSrc).toMatch(/\bDEFAULT_MAX_BLOCK_MINUTES\b/);
  });

  it('imports the proposal module for the v2 path', () => {
    expect(scheduleRunSrc).toContain("from '@/lib/proposal'");
    expect(scheduleRunSrc).toMatch(/\bgenerateProposal\b/);
    expect(scheduleRunSrc).toMatch(/\bDEFAULT_V2_SETTINGS\b/);
  });
});
