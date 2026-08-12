import { describe, expect, it } from 'vitest';
import schedulerSrc from './scheduler.ts?raw';
import {
  DEFAULT_MAX_BLOCK_MINUTES,
  DEFAULT_MIN_BLOCK_MINUTES,
  generateSchedule,
  intervalsMinutes,
  mergeIntervals,
  subtractIntervals,
  type ScheduleInput,
} from './scheduler';
import { emptyAvailability } from '@/types';
import type { AvailabilitySlot, ScheduleBlock, Task, WeeklyAvailability, Weekday } from '@/types';

// 2026-08-10 is a Monday. Every fixture below is anchored to it so the plan is
// fully deterministic — the scheduler never reads the system clock.
const FROM = '2026-08-10';
const MON = '2026-08-10';
const TUE = '2026-08-11';
const WED = '2026-08-12';

function makeTask(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    dueDate: WED,
    // legacy scheduling fields must never influence the scheduler
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

function makeBlock(
  taskId: string,
  date: string,
  startTime: string,
  endTime: string,
  plannedMinutes?: number,
): ScheduleBlock {
  return {
    id: `sb:${taskId}:${date}:${startTime}`,
    taskId,
    date,
    startTime,
    endTime,
    plannedMinutes: plannedMinutes ?? 0,
    source: 'manual',
    locked: false,
    status: 'planned',
    createdAt: 0,
    updatedAt: 0,
  };
}

const slot = (startTime: string, endTime: string): AvailabilitySlot => ({ startTime, endTime });

/** Availability with only the listed weekdays filled in. */
function availabilityFor(map: Partial<Record<Weekday, AvailabilitySlot[]>>): WeeklyAvailability {
  return { ...emptyAvailability(), ...map };
}

function run(over: Partial<ScheduleInput> = {}) {
  return generateSchedule({
    tasks: [],
    availability: emptyAvailability(),
    existingBlocks: [],
    from: FROM,
    ...over,
  });
}

// --------------------------------------------------------------- interval utils

describe('interval utilities', () => {
  it('mergeIntervals fuses overlapping and touching ranges, dropping invalid ones', () => {
    expect(
      mergeIntervals([
        { start: 600, end: 720 },
        { start: 540, end: 660 }, // overlaps the first
        { start: 720, end: 780 }, // touches -> fused
        { start: 900, end: 900 }, // zero length -> dropped
        { start: 1000, end: 950 }, // inverted -> dropped
      ]),
    ).toEqual([{ start: 540, end: 780 }]);
  });

  it('mergeIntervals never mutates its input', () => {
    const input = [
      { start: 600, end: 720 },
      { start: 540, end: 660 },
    ];
    const copy = structuredClone(input);
    mergeIntervals(input);
    expect(input).toEqual(copy);
  });

  it('subtractIntervals removes busy ranges and can split a free range in two', () => {
    expect(
      subtractIntervals([{ start: 540, end: 720 }], [{ start: 600, end: 630 }]),
    ).toEqual([
      { start: 540, end: 600 },
      { start: 630, end: 720 },
    ]);
    // fully covered -> nothing left
    expect(subtractIntervals([{ start: 540, end: 600 }], [{ start: 500, end: 700 }])).toEqual([]);
  });

  it('intervalsMinutes counts overlapping coverage exactly once', () => {
    expect(intervalsMinutes([])).toBe(0);
    expect(
      intervalsMinutes([
        { start: 540, end: 600 }, // 60
        { start: 570, end: 630 }, // overlaps -> union is 540..630 = 90
      ]),
    ).toBe(90);
  });
});

// --------------------------------------------------------------- task filtering

describe('generateSchedule — task filtering', () => {
  it('returns an empty plan when there are no tasks', () => {
    const res = run({ availability: availabilityFor({ monday: [slot('09:00', '12:00')] }) });
    expect(res.blocks).toEqual([]);
    expect(res.unscheduled).toEqual([]);
  });

  it('reports no-availability when the user has no free time at all', () => {
    const res = run({ tasks: [makeTask('t1', { estimatedMinutes: 60 })] });
    expect(res.blocks).toEqual([]);
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 60, reason: 'no-availability' },
    ]);
  });

  it('skips done tasks entirely (not planned, not reported)', () => {
    const res = run({
      tasks: [makeTask('done', { status: 'done' })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    });
    expect(res.blocks).toEqual([]);
    expect(res.unscheduled).toEqual([]);
  });

  it('reports no-estimate (and never guesses a duration)', () => {
    const res = run({
      tasks: [
        makeTask('t1', { estimatedMinutes: undefined }),
        makeTask('t2', { estimatedMinutes: 0 }), // normalizes to undefined
      ],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    });
    expect(res.blocks).toEqual([]);
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 0, reason: 'no-estimate' },
      { taskId: 't2', remainingMinutes: 0, reason: 'no-estimate' },
    ]);
  });

  it('reports invalid-deadline separately from deadline-passed', () => {
    const res = run({
      tasks: [
        makeTask('bad', { dueDate: '2026-02-30', estimatedMinutes: 60 }), // overflow date
        makeTask('junk', { dueDate: '', estimatedMinutes: 45 }),
        makeTask('past', { dueDate: '2026-08-09', estimatedMinutes: 30 }), // before `from`
      ],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    });
    expect(res.blocks).toEqual([]);
    expect(res.unscheduled).toEqual([
      { taskId: 'bad', remainingMinutes: 60, reason: 'invalid-deadline' },
      { taskId: 'junk', remainingMinutes: 45, reason: 'invalid-deadline' },
      { taskId: 'past', remainingMinutes: 30, reason: 'deadline-passed' },
    ]);
  });
});

// --------------------------------------------------------------- existing blocks

describe('generateSchedule — existing blocks', () => {
  it('never books over an already occupied slot', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: MON, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '11:00')] }),
      existingBlocks: [makeBlock('other', MON, '09:00', '10:00', 60)],
    });
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]).toMatchObject({ date: MON, startTime: '10:00', endTime: '11:00' });
  });

  it('D12: an orphan taskId still occupies its slot', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: MON, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '11:00')] }),
      existingBlocks: [makeBlock('deleted-task', MON, '09:00', '10:00', 60)],
    });
    expect(res.blocks.map((b) => b.startTime)).toEqual(['10:00']);
  });

  it('D8: already booked minutes are deducted from the task estimate', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: TUE, estimatedMinutes: 120 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
      existingBlocks: [makeBlock('t1', MON, '09:00', '10:00', 60)],
    });
    // 120 - 60 already booked = 60 left, placed after the existing block
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]).toMatchObject({ startTime: '10:00', endTime: '11:00', plannedMinutes: 60 });
    expect(res.unscheduled).toEqual([]);
  });

  it('D8: overlapping blocks of the same task are counted once, and plannedMinutes is ignored', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: TUE, estimatedMinutes: 120 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
      existingBlocks: [
        // Real coverage is 09:00–10:30 = 90 min, even though plannedMinutes claims 999+999.
        makeBlock('t1', MON, '09:00', '10:00', 999),
        makeBlock('t1', MON, '09:30', '10:30', 999),
      ],
    });
    // 120 - 90 = 30 minutes left (NOT 120 - 1998, and NOT 120 - 120)
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]).toMatchObject({ startTime: '10:30', endTime: '11:00', plannedMinutes: 30 });
  });

  it('a fully booked task is neither re-planned nor reported', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: TUE, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
      existingBlocks: [makeBlock('t1', MON, '09:00', '10:00', 60)],
    });
    expect(res.blocks).toEqual([]);
    expect(res.unscheduled).toEqual([]);
  });

  it('result.blocks contains only the new blocks (D11)', () => {
    const existing = [makeBlock('other', MON, '09:00', '10:00', 60)];
    const res = run({
      tasks: [makeTask('t1', { dueDate: MON, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '11:00')] }),
      existingBlocks: existing,
    });
    expect(res.blocks.map((b) => b.id)).not.toContain(existing[0].id);
    expect(res.blocks.every((b) => b.id.startsWith('sb:auto:'))).toBe(true);
  });
});

// --------------------------------------------------------------- splitting

describe('generateSchedule — splitting', () => {
  it('splits one task into several blocks when maxBlockMinutes is reached', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: MON, estimatedMinutes: 240 })],
      availability: availabilityFor({ monday: [slot('09:00', '13:00')] }),
    });
    expect(res.blocks.map((b) => [b.startTime, b.endTime])).toEqual([
      ['09:00', '11:00'],
      ['11:00', '13:00'],
    ]);
    expect(res.blocks.every((b) => b.plannedMinutes <= DEFAULT_MAX_BLOCK_MINUTES)).toBe(true);
  });

  it('splits one task across several days', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: TUE, estimatedMinutes: 180 })],
      availability: availabilityFor({
        monday: [slot('09:00', '11:00')],
        tuesday: [slot('09:00', '11:00')],
      }),
    });
    expect(res.blocks.map((b) => [b.date, b.startTime, b.endTime])).toEqual([
      [MON, '09:00', '11:00'],
      [TUE, '09:00', '10:00'],
    ]);
    expect(res.unscheduled).toEqual([]);
  });

  it('merges overlapping availability slots so a minute is never booked twice', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: MON, estimatedMinutes: 240 })],
      // 09:00–11:00 ∪ 10:00–12:00 = 180 real minutes, not 240
      availability: availabilityFor({ monday: [slot('09:00', '11:00'), slot('10:00', '12:00')] }),
    });
    expect(res.blocks.map((b) => [b.startTime, b.endTime])).toEqual([
      ['09:00', '11:00'],
      ['11:00', '12:00'],
    ]);
    expect(res.blocks.reduce((s, b) => s + b.plannedMinutes, 0)).toBe(180);
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 60, reason: 'insufficient-time' },
    ]);
  });

  it('ignores malformed availability slots and never produces NaN', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: MON, estimatedMinutes: 60 })],
      availability: availabilityFor({
        monday: [slot('25:00', '26:00'), slot('9:00', '10:00'), slot('11:00', '11:00'), slot('14:00', '15:00')],
      }),
    });
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]).toMatchObject({ startTime: '14:00', endTime: '15:00', plannedMinutes: 60 });
    expect(Number.isInteger(res.blocks[0].plannedMinutes)).toBe(true);
  });
});

// --------------------------------------------------------------- ordering (D9)

describe('generateSchedule — ordering', () => {
  it('plans the nearest deadline first', () => {
    const res = run({
      tasks: [
        makeTask('late', { dueDate: WED, estimatedMinutes: 60 }),
        makeTask('early', { dueDate: TUE, estimatedMinutes: 60 }),
      ],
      availability: availabilityFor({ monday: [slot('09:00', '11:00')] }),
    });
    expect(res.blocks.map((b) => b.taskId)).toEqual(['early', 'late']);
  });

  it('breaks a deadline tie by priority', () => {
    const res = run({
      tasks: [
        makeTask('low', { dueDate: WED, priority: 'low', estimatedMinutes: 60 }),
        makeTask('med', { dueDate: WED, priority: 'medium', estimatedMinutes: 60 }),
        makeTask('high', { dueDate: WED, priority: 'high', estimatedMinutes: 60 }),
      ],
      availability: availabilityFor({ monday: [slot('09:00', '12:00')] }),
    });
    expect(res.blocks.map((b) => b.taskId)).toEqual(['high', 'med', 'low']);
  });

  it('breaks a deadline+priority tie by createdAt, then by id (fully deterministic)', () => {
    const byCreatedAt = run({
      tasks: [
        makeTask('newer', { dueDate: WED, createdAt: 200, estimatedMinutes: 60 }),
        makeTask('older', { dueDate: WED, createdAt: 100, estimatedMinutes: 60 }),
      ],
      availability: availabilityFor({ monday: [slot('09:00', '11:00')] }),
    });
    expect(byCreatedAt.blocks.map((b) => b.taskId)).toEqual(['older', 'newer']);

    const byId = run({
      tasks: [
        makeTask('b-task', { dueDate: WED, createdAt: 100, estimatedMinutes: 60 }),
        makeTask('a-task', { dueDate: WED, createdAt: 100, estimatedMinutes: 60 }),
      ],
      availability: availabilityFor({ monday: [slot('09:00', '11:00')] }),
    });
    expect(byId.blocks.map((b) => b.taskId)).toEqual(['a-task', 'b-task']);
  });
});

// --------------------------------------------------------------- deadline limit

describe('generateSchedule — deadline limit (D10)', () => {
  it('allows planning ON the deadline day but never after it', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: MON, estimatedMinutes: 240 })],
      availability: availabilityFor({
        monday: [slot('09:00', '11:00')], // only 120 min before the deadline
        tuesday: [slot('09:00', '17:00')], // plenty, but too late
      }),
    });
    expect(res.blocks.every((b) => b.date <= MON)).toBe(true);
    expect(res.blocks.map((b) => [b.date, b.startTime])).toEqual([[MON, '09:00']]);
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 120, reason: 'insufficient-time' },
    ]);
  });

  it('reports no-availability when nothing is reachable before the deadline', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: MON, estimatedMinutes: 60 })],
      availability: availabilityFor({ tuesday: [slot('09:00', '17:00')] }), // all after the deadline
    });
    expect(res.blocks).toEqual([]);
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 60, reason: 'no-availability' },
    ]);
  });
});

// --------------------------------------------------------------- limits

describe('generateSchedule — horizon and daily cap', () => {
  it('honours horizonDays (and a zero horizon plans nothing)', () => {
    const availability = availabilityFor({
      monday: [slot('09:00', '11:00')],
      tuesday: [slot('09:00', '11:00')],
    });
    const oneDay = run({
      tasks: [makeTask('t1', { dueDate: '2026-08-20', estimatedMinutes: 240 })],
      availability,
      horizonDays: 1,
    });
    expect(oneDay.blocks.map((b) => b.date)).toEqual([MON]);
    expect(oneDay.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 120, reason: 'insufficient-time' },
    ]);

    const noDays = run({
      tasks: [makeTask('t1', { dueDate: '2026-08-20', estimatedMinutes: 60 })],
      availability,
      horizonDays: 0,
    });
    expect(noDays.blocks).toEqual([]);
    expect(noDays.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 60, reason: 'no-availability' },
    ]);
  });

  it('caps each day at dailyMaxMinutes', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: '2026-08-20', estimatedMinutes: 240 })],
      availability: availabilityFor({
        monday: [slot('09:00', '13:00')],
        tuesday: [slot('09:00', '13:00')],
      }),
      dailyMaxMinutes: 90,
      horizonDays: 2,
    });
    expect(res.blocks.map((b) => [b.date, b.startTime, b.endTime])).toEqual([
      [MON, '09:00', '10:30'],
      [TUE, '09:00', '10:30'],
    ]);
  });

  it('the daily budget subtracts MERGED busy minutes, not stored plannedMinutes', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: '2026-08-20', estimatedMinutes: 240 })],
      availability: availabilityFor({ monday: [slot('09:00', '13:00')] }),
      existingBlocks: [
        // Union is 09:00–10:30 = 90 min. plannedMinutes lies (999 each).
        makeBlock('other', MON, '09:00', '10:00', 999),
        makeBlock('other', MON, '09:30', '10:30', 999),
      ],
      dailyMaxMinutes: 120,
      horizonDays: 1,
    });
    // budget = 120 - 90 = 30 (not 120 - 1998, not 120 - 120)
    expect(res.blocks.map((b) => [b.startTime, b.endTime])).toEqual([['10:30', '11:00']]);
    expect(res.blocks[0].plannedMinutes).toBe(30);
  });
});

// --------------------------------------------------------------- fragment rule

describe('generateSchedule — minBlockMinutes and the finishing-block exemption', () => {
  it('does NOT create a sub-minimum fragment when the task cannot be finished', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: MON, estimatedMinutes: 60 })],
      availability: availabilityFor({ monday: [slot('09:00', '09:10')] }), // only 10 min
    });
    expect(res.blocks).toEqual([]); // 10 < 25 and 10 !== 60 -> pure fragment
    expect(res.unscheduled).toEqual([
      { taskId: 't1', remainingMinutes: 60, reason: 'insufficient-time' },
    ]);
  });

  it('DOES create a sub-minimum block when it finishes the task outright', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: MON, estimatedMinutes: 10 })],
      availability: availabilityFor({ monday: [slot('09:00', '09:30')] }), // 30 min free
    });
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]).toMatchObject({ startTime: '09:00', endTime: '09:10', plannedMinutes: 10 });
    expect(res.blocks[0].plannedMinutes).toBeLessThan(DEFAULT_MIN_BLOCK_MINUTES);
    expect(res.unscheduled).toEqual([]);
  });

  it('the exemption also applies to the tail of a split task', () => {
    const res = run({
      tasks: [makeTask('t1', { dueDate: TUE, estimatedMinutes: 130 })],
      availability: availabilityFor({
        monday: [slot('09:00', '11:00')], // 120 -> capped at maxBlock 120
        tuesday: [slot('09:00', '11:00')],
      }),
    });
    // 130 = 120 + a 10-minute finishing block (below minBlock, but it completes the task)
    expect(res.blocks.map((b) => [b.date, b.plannedMinutes])).toEqual([
      [MON, 120],
      [TUE, 10],
    ]);
    expect(res.unscheduled).toEqual([]);
  });
});

// --------------------------------------------------------------- purity

describe('generateSchedule — output contract and purity', () => {
  const input: ScheduleInput = {
    tasks: [
      makeTask('t1', { dueDate: TUE, estimatedMinutes: 150 }),
      makeTask('t2', { dueDate: WED, estimatedMinutes: 60, priority: 'high' }),
    ],
    availability: availabilityFor({
      monday: [slot('09:00', '12:00')],
      tuesday: [slot('14:00', '17:00')],
    }),
    existingBlocks: [makeBlock('other', MON, '10:00', '10:30', 30)],
    from: FROM,
    horizonDays: 3,
  };

  it('emits deterministic ids, strict HH:mm times and positive integer durations', () => {
    const res = generateSchedule(structuredClone(input));
    expect(res.blocks.length).toBeGreaterThan(0);
    for (const b of res.blocks) {
      expect(b.id).toBe(`sb:auto:${b.taskId}:${b.date}:${b.startTime}`);
      expect(b.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(b.startTime).toMatch(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
      expect(b.endTime).toMatch(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
      expect(Number.isInteger(b.plannedMinutes)).toBe(true);
      expect(b.plannedMinutes).toBeGreaterThan(0);
    }
  });

  it('sorts the output by date then startTime', () => {
    const res = generateSchedule(structuredClone(input));
    const keys = res.blocks.map((b) => `${b.date} ${b.startTime}`);
    expect(keys).toEqual([...keys].sort());
  });

  it('is idempotent: the same input always yields the same plan', () => {
    const a = generateSchedule(structuredClone(input));
    const b = generateSchedule(structuredClone(input));
    expect(a).toEqual(b);
  });

  it('never mutates its inputs', () => {
    const snapshot = structuredClone(input);
    generateSchedule(input);
    expect(input).toEqual(snapshot);
  });
});

// Source-level guards: the scheduler is a pure domain module. These lock the
// architecture so a later refactor cannot quietly wire it to React or storage.
describe('scheduler.ts wiring', () => {
  it('has no persistence, store or React dependency', () => {
    expect(schedulerSrc).not.toMatch(/\blocalStorage\b/);
    expect(schedulerSrc).not.toMatch(/from '@\/store'/);
    expect(schedulerSrc).not.toMatch(/from 'react'/);
  });

  it('reads no clock and no randomness (deterministic by construction)', () => {
    expect(schedulerSrc).not.toMatch(/\bMath\.random\(/);
    expect(schedulerSrc).not.toMatch(/\bDate\.now\(/);
    expect(schedulerSrc).not.toMatch(/\bnew Date\(/);
    expect(schedulerSrc).not.toMatch(/\btodayISO\b/);
  });

  it('builds on the shared domain / date helpers instead of re-implementing them', () => {
    expect(schedulerSrc).toContain("from '@/lib/domain'");
    expect(schedulerSrc).toContain("from '@/lib/date'");
    expect(schedulerSrc).toMatch(/\bweekdayForISO\b/);
    expect(schedulerSrc).toMatch(/\bparseHHMM\b/);
    expect(schedulerSrc).toMatch(/\bsafeFromISO\b/);
  });
});
