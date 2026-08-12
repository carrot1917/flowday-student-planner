import { describe, expect, it } from 'vitest';
import conflictSrc from './conflict.ts?raw';
import { detectScheduleConflicts } from './conflict';
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

function mkBlock(
  id: string,
  taskId: string,
  date: string,
  start: string,
  end: string,
  planned = 60,
): ScheduleBlock {
  return { id, taskId, date, startTime: start, endTime: end, plannedMinutes: planned, source: 'manual', locked: false, status: 'planned', createdAt: 0, updatedAt: 0 };
}

function mkTask(id: string): Task {
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
  };
}

function availAll(slots: AvailabilitySlot[]): WeeklyAvailability {
  const a = {} as WeeklyAvailability;
  for (const d of ALL_DAYS) a[d] = slots.map((s) => ({ ...s }));
  return a;
}

function availEmpty(): WeeklyAvailability {
  const a = {} as WeeklyAvailability;
  for (const d of ALL_DAYS) a[d] = [];
  return a;
}

function tasksMap(ids: string[]): Map<string, Task> {
  const m = new Map<string, Task>();
  for (const id of ids) m.set(id, mkTask(id));
  return m;
}

// ---------------------------------------------------------------- overlap

describe('time-overlap (strict overlap only)', () => {
  it('finds every pair in a nested / chained set (A-B and A-C, not B-C)', () => {
    // A 09-12, B 10-11, C 11-13  → A&B overlap, A&C overlap, B&C only touch.
    const blocks = [
      mkBlock('A', 't1', '2026-08-10', '09:00', '12:00'),
      mkBlock('B', 't1', '2026-08-10', '10:00', '11:00'),
      mkBlock('C', 't1', '2026-08-10', '11:00', '13:00'),
    ];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availAll([{ startTime: '08:00', endTime: '20:00' }]),
    });
    const overlaps = res.filter((c) => c.type === 'time-overlap');
    expect(overlaps).toHaveLength(2);
    const pairs = overlaps.map((c) => [...c.blockIds].sort().join('-')).sort();
    expect(pairs).toEqual(['A-B', 'A-C']);
  });

  it('treating touching intervals as NOT a conflict', () => {
    const blocks = [
      mkBlock('X', 't1', '2026-08-10', '09:00', '10:00'),
      mkBlock('Y', 't1', '2026-08-10', '10:00', '11:00'),
    ];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availAll([{ startTime: '08:00', endTime: '20:00' }]),
    });
    expect(res.filter((c) => c.type === 'time-overlap')).toHaveLength(0);
  });

  it('flags identical time ranges as a conflict', () => {
    const blocks = [
      mkBlock('X', 't1', '2026-08-10', '09:00', '10:00'),
      mkBlock('Y', 't1', '2026-08-10', '09:00', '10:00'),
    ];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availAll([{ startTime: '08:00', endTime: '20:00' }]),
    });
    const overlaps = res.filter((c) => c.type === 'time-overlap');
    expect(overlaps).toHaveLength(1);
    expect([...overlaps[0].blockIds].sort()).toEqual(['X', 'Y']);
  });

  it('flags overlapping blocks of the SAME task', () => {
    const blocks = [
      mkBlock('X', 't1', '2026-08-10', '09:00', '11:00'),
      mkBlock('Y', 't1', '2026-08-10', '10:00', '12:00'),
    ];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availAll([{ startTime: '08:00', endTime: '20:00' }]),
    });
    expect(res.filter((c) => c.type === 'time-overlap')).toHaveLength(1);
  });

  it('flags overlapping blocks of DIFFERENT tasks', () => {
    const blocks = [
      mkBlock('X', 't1', '2026-08-10', '09:00', '11:00'),
      mkBlock('Y', 't2', '2026-08-10', '10:00', '12:00'),
    ];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1', 't2']),
      availability: availAll([{ startTime: '08:00', endTime: '20:00' }]),
    });
    expect(res.filter((c) => c.type === 'time-overlap')).toHaveLength(1);
  });

  it('lets an orphan block still participate in overlap detection', () => {
    const blocks = [
      mkBlock('V', 't1', '2026-08-10', '09:00', '11:00'),
      mkBlock('O', 'ghost', '2026-08-10', '10:00', '12:00'),
    ];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availAll([{ startTime: '08:00', endTime: '20:00' }]),
    });
    const orphan = res.filter((c) => c.type === 'orphan-block');
    const overlaps = res.filter((c) => c.type === 'time-overlap');
    expect(orphan).toHaveLength(1);
    expect(orphan[0].blockIds).toEqual(['O']);
    expect(overlaps).toHaveLength(1);
    expect([...overlaps[0].blockIds].sort()).toEqual(['O', 'V']);
  });

  it('excludes invalid blocks from overlap math', () => {
    // X is cross-midnight (invalid) yet shares 22:00-23:00 with valid Y.
    const blocks = [
      mkBlock('X', 't1', '2026-08-10', '22:00', '02:00'),
      mkBlock('Y', 't1', '2026-08-10', '22:00', '23:00'),
    ];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availAll([{ startTime: '20:00', endTime: '23:59' }]),
    });
    expect(res.filter((c) => c.type === 'time-overlap')).toHaveLength(0);
    expect(res.filter((c) => c.type === 'availability-violation')).toHaveLength(0);
    const invalid = res.filter((c) => c.type === 'invalid-block');
    expect(invalid).toHaveLength(1);
    expect(invalid[0].blockIds).toEqual(['X']);
  });
});

// --------------------------------------------------- availability-violation

describe('availability-violation', () => {
  it('reports every exterior slice of a block (multiple intervals)', () => {
    // Availability 09-10 & 11-12; block 08:30-12:30 → outside 08:30-09:00,
    // 10:00-11:00, 12:00-12:30.
    const blocks = [mkBlock('B', 't1', '2026-08-10', '08:30', '12:30')];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availAll([
        { startTime: '09:00', endTime: '10:00' },
        { startTime: '11:00', endTime: '12:00' },
      ]),
    });
    const v = res.filter((c) => c.type === 'availability-violation');
    expect(v).toHaveLength(1);
    expect(v[0].blockIds).toEqual(['B']);
    expect(v[0].detail?.intervals).toEqual([
      { start: 510, end: 540 },
      { start: 600, end: 660 },
      { start: 720, end: 750 },
    ]);
  });

  it('merges overlapping availability before judging', () => {
    const base = availAll([
      { startTime: '09:00', endTime: '11:00' },
      { startTime: '10:00', endTime: '12:00' },
    ]);
    const inside = detectScheduleConflicts({
      blocks: [mkBlock('I', 't1', '2026-08-10', '09:00', '12:00')],
      taskById: tasksMap(['t1']),
      availability: base,
    });
    expect(inside.filter((c) => c.type === 'availability-violation')).toHaveLength(0);

    const outside = detectScheduleConflicts({
      blocks: [mkBlock('O', 't1', '2026-08-10', '09:00', '12:30')],
      taskById: tasksMap(['t1']),
      availability: base,
    });
    const v = outside.filter((c) => c.type === 'availability-violation');
    expect(v).toHaveLength(1);
    expect(v[0].detail?.intervals).toEqual([{ start: 720, end: 750 }]);
  });

  it('flags a block on a day with no availability', () => {
    const blocks = [mkBlock('A', 't1', '2026-08-10', '09:00', '10:00')];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availEmpty(),
    });
    const v = res.filter((c) => c.type === 'availability-violation');
    expect(v).toHaveLength(1);
    expect(v[0].blockIds).toEqual(['A']);
    expect(v[0].detail?.intervals).toEqual([{ start: 540, end: 600 }]);
  });

  it('no violation when the block is fully inside availability', () => {
    const blocks = [mkBlock('B', 't1', '2026-08-10', '09:00', '12:00')];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availAll([{ startTime: '08:00', endTime: '13:00' }]),
    });
    expect(res.filter((c) => c.type === 'availability-violation')).toHaveLength(0);
  });
});

// ---------------------------------------------------------- invalid / orphan

describe('invalid-block & orphan-block', () => {
  it('treats cross-midnight blocks as invalid (error)', () => {
    const blocks = [mkBlock('X', 't1', '2026-08-10', '22:00', '02:00')];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availAll([{ startTime: '20:00', endTime: '24:00' }]),
    });
    const invalid = res.filter((c) => c.type === 'invalid-block');
    expect(invalid).toHaveLength(1);
    expect(invalid[0].severity).toBe('error');
  });

  it('rejects loose HH:mm like 9:00 via the strict parser', () => {
    const blocks = [mkBlock('X', 't1', '2026-08-10', '9:00', '10:00')];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availAll([{ startTime: '08:00', endTime: '20:00' }]),
    });
    expect(res.filter((c) => c.type === 'invalid-block')).toHaveLength(1);
  });

  it('rejects 24:00 (hour out of range)', () => {
    const blocks = [mkBlock('X', 't1', '2026-08-10', '23:00', '24:00')];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availAll([{ startTime: '08:00', endTime: '23:59' }]),
    });
    expect(res.filter((c) => c.type === 'invalid-block')).toHaveLength(1);
  });

  it('rejects a malformed date', () => {
    const blocks = [mkBlock('X', 't1', '2026-13-40', '09:00', '10:00')];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availAll([{ startTime: '08:00', endTime: '20:00' }]),
    });
    expect(res.filter((c) => c.type === 'invalid-block')).toHaveLength(1);
  });

  it('flags an orphan block (warning)', () => {
    const blocks = [mkBlock('O', 'ghost', '2026-08-10', '09:00', '10:00')];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availAll([{ startTime: '08:00', endTime: '20:00' }]),
    });
    const orphan = res.filter((c) => c.type === 'orphan-block');
    expect(orphan).toHaveLength(1);
    expect(orphan[0].blockIds).toEqual(['O']);
    expect(orphan[0].severity).toBe('warning');
  });
});

// ------------------------------------------------------------- properties

describe('contract & properties', () => {
  it('reports no conflicts for a clean schedule', () => {
    const blocks = [
      mkBlock('A', 't1', '2026-08-10', '09:00', '10:00'),
      mkBlock('B', 't1', '2026-08-10', '10:00', '11:00'),
      mkBlock('C', 't2', '2026-08-10', '14:00', '15:00'),
    ];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1', 't2']),
      availability: availAll([{ startTime: '08:00', endTime: '20:00' }]),
    });
    expect(res).toHaveLength(0);
  });

  it('assigns the locked severity mapping', () => {
    const blocks = [
      mkBlock('A', 't1', '2026-08-10', '09:00', '11:00'),
      mkBlock('B', 't1', '2026-08-10', '10:00', '12:00'),
      mkBlock('O', 'ghost', '2026-08-10', '14:00', '15:00'),
    ];
    const res = detectScheduleConflicts({
      blocks,
      taskById: tasksMap(['t1']),
      availability: availAll([{ startTime: '08:00', endTime: '20:00' }]),
    });
    for (const c of res) {
      if (c.type === 'time-overlap' || c.type === 'invalid-block') {
        expect(c.severity).toBe('error');
      } else {
        expect(c.severity).toBe('warning');
      }
    }
  });

  it('is deterministic across calls', () => {
    const input = {
      blocks: [
        mkBlock('A', 't1', '2026-08-10', '09:00', '12:00'),
        mkBlock('B', 't1', '2026-08-10', '10:00', '11:00'),
        mkBlock('C', 't1', '2026-08-10', '11:00', '13:00'),
      ],
      taskById: tasksMap(['t1']),
      availability: availAll([{ startTime: '08:00', endTime: '20:00' }]),
    };
    expect(detectScheduleConflicts(input)).toEqual(detectScheduleConflicts(input));
  });

  it('does not mutate its inputs', () => {
    const blocks = [
      mkBlock('A', 't1', '2026-08-10', '09:00', '12:00'),
      mkBlock('B', 't1', '2026-08-10', '10:00', '11:00'),
    ];
    const avail = availAll([{ startTime: '08:00', endTime: '20:00' }]);
    const taskById = tasksMap(['t1']);
    const blocksCopy = structuredClone(blocks);
    const availCopy = structuredClone(avail);

    detectScheduleConflicts({ blocks, taskById, availability: avail });

    expect(blocks).toEqual(blocksCopy);
    expect(avail).toEqual(availCopy);
    expect(taskById.size).toBe(1);
  });
});

// --------------------------------------------------------------- wiring

describe('conflict.ts wiring', () => {
  it('has no persistence, store or React dependency', () => {
    expect(conflictSrc).not.toMatch(/\blocalStorage\b/);
    expect(conflictSrc).not.toMatch(/from 'react'/);
    expect(conflictSrc).not.toMatch(/from '@\/store'/);
  });

  it('reads no clock and no randomness (deterministic by construction)', () => {
    expect(conflictSrc).not.toMatch(/\bMath\.random\(/);
    expect(conflictSrc).not.toMatch(/\bDate\.now\(/);
    expect(conflictSrc).not.toMatch(/\bnew Date\(/);
    expect(conflictSrc).not.toMatch(/\btodayISO\b/);
  });

  it('builds on the shared domain / schedule / scheduler helpers', () => {
    expect(conflictSrc).toContain("from '@/lib/scheduler'");
    expect(conflictSrc).toContain("from '@/lib/domain'");
    expect(conflictSrc).toContain("from '@/lib/schedule'");
    expect(conflictSrc).toMatch(/\bweekdayForISO\b/);
    expect(conflictSrc).toMatch(/\bparseHHMM\b/);
    expect(conflictSrc).toMatch(/\bmergeIntervals\b/);
    expect(conflictSrc).toMatch(/\bsubtractIntervals\b/);
    expect(conflictSrc).toMatch(/\bintervalsMinutes\b/);
    expect(conflictSrc).toMatch(/\bgroupBlocksByDate\b/);
    expect(conflictSrc).toMatch(/\bfindTaskForBlock\b/);
  });
});
