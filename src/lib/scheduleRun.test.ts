import { describe, expect, it } from 'vitest';
import scheduleRunSrc from './scheduleRun.ts?raw';
import { buildScheduleInput, mergeScheduleBlocks } from './scheduleRun';
import { generateSchedule } from './scheduler';
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
});
