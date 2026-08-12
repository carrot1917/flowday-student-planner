import { describe, expect, it } from 'vitest';
import {
  COURSE_NAME_MAX,
  ESTIMATED_MINUTES_MAX,
  ESTIMATED_MINUTES_PRESETS,
  WEEKDAY_LABELS,
  addCourseToState,
  courseLabel,
  createCourse,
  deleteCourseFromState,
  findCourse,
  getWeekStartsOn,
  isUncategorized,
  isValidHHMM,
  legacyTagForCourseName,
  normalizeAvailability,
  normalizeEstimatedMinutes,
  parseEstimatedMinutes,
  parseHHMM,
  sanitizeScheduleBlocks,
  slotMinutes,
  suggestCourseColor,
  totalAvailableMinutes,
  updateCourseInState,
  validateAvailabilitySlot,
  validateCourseName,
  weekdayForISO,
  weekdaysOrdered,
} from './domain';
import type { AppState, Course, ScheduleBlock, Task, Weekday, WeeklyAvailability } from '@/types';
import storeSrc from '../store.tsx?raw';
import availabilityPageSrc from '../pages/AvailabilityPage.tsx?raw';

function makeCourse(id: string, name: string, color = '#3494fb'): Course {
  return { id, name, color, createdAt: 0 };
}

function makeTask(id: string, courseId?: string): Task {
  return {
    id,
    title: 't',
    description: '',
    dueDate: '2026-08-10',
    startTime: '',
    endTime: '',
    priority: 'medium',
    tag: 'other',
    courseId,
    status: 'todo',
    createdAt: 0,
    completedAt: null,
    subtasks: [],
  };
}

const EMPTY_AVAILABILITY: WeeklyAvailability = {
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

function makeState(courses: Course[], tasks: Task[]): AppState {
  return {
    version: 2,
    hasSeededDemo: true,
    courses,
    tasks,
    scheduleBlocks: [],
    availability: { ...EMPTY_AVAILABILITY },
    settings: { notificationsEnabled: false, reminderTime: 480, dueReminder: true, startOfWeek: 1 },
  };
}

describe('Course validation (validateCourseName)', () => {
  it('rejects empty and whitespace-only names', () => {
    expect(validateCourseName('', []).ok).toBe(false);
    expect(validateCourseName('   ', []).ok).toBe(false);
    const r = validateCourseName('   ', []);
    if (!r.ok) expect(r.error).toBe('empty');
  });

  it('rejects names longer than COURSE_NAME_MAX', () => {
    const long = 'x'.repeat(COURSE_NAME_MAX + 1);
    const r = validateCourseName(long, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('too-long');
  });

  it('rejects duplicate names (case-insensitive, trimmed)', () => {
    const courses = [makeCourse('c1', 'Math')];
    expect(validateCourseName('Math', courses).ok).toBe(false);
    expect(validateCourseName('math', courses).ok).toBe(false); // case-insensitive
    expect(validateCourseName(' MATH ', courses).ok).toBe(false); // trimmed
  });

  it('allows a name when it matches only the course being renamed (selfId)', () => {
    const courses = [makeCourse('c1', '数学')];
    expect(validateCourseName('数学', courses, 'c1').ok).toBe(true);
  });

  it('accepts a valid new name and normalizes it', () => {
    const r = validateCourseName('  高等  数学 ', []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.name).toBe('高等 数学');
  });
});

describe('createCourse / suggestCourseColor', () => {
  it('creates a course with a course: id, normalized name and valid color', () => {
    const c = createCourse('  高数 ', '#bad-hex');
    expect(c.id.startsWith('course:')).toBe(true);
    expect(c.name).toBe('高数');
    expect(c.color).toMatch(/^#[0-9a-fA-F]{6}$/); // bad hex -> palette[0]
  });

  it('suggests the first unused palette color, cycling when exhausted', () => {
    expect(suggestCourseColor([])).toBe('#f43f5e');
    const used = ['#f43f5e', '#f97316', '#f59e0b', '#10b981', '#0ea5e9', '#3494fb', '#8b5cf6', '#64748b'];
    const all = used.map((hex, i) => makeCourse(`c${i}`, `k${i}`, hex));
    expect(suggestCourseColor(all)).toBe('#f43f5e'); // wraps around
  });
});

describe('Course lookup / 未分类 fallback', () => {
  const courses = [makeCourse('c1', '数学'), makeCourse('c2', '英语')];

  it('findCourse returns undefined for missing / undefined / dangling id', () => {
    expect(findCourse(courses, undefined)).toBeUndefined();
    expect(findCourse(courses, 'nope')).toBeUndefined();
  });

  it('courseLabel falls back to 未分类 when no course or course deleted', () => {
    expect(courseLabel(courses, 'c1')).toBe('数学');
    expect(courseLabel(courses, undefined)).toBe('未分类');
    expect(courseLabel(courses, 'deleted')).toBe('未分类');
  });

  it('isUncategorized is true for unset or dangling courseId', () => {
    expect(isUncategorized(courses, makeTask('t1'))).toBe(true);
    expect(isUncategorized(courses, makeTask('t2', 'ghost'))).toBe(true);
    expect(isUncategorized(courses, makeTask('t3', 'c2'))).toBe(false);
  });
});

describe('deleteCourseFromState (no cascade delete)', () => {
  const courses = [makeCourse('c1', '数学'), makeCourse('c2', '英语')];
  const tasks = [
    makeTask('t1', 'c1'),
    makeTask('t2', 'c2'),
    makeTask('t3'), // already uncategorized
  ];
  const state = makeState(courses, tasks);

  it('removes the course but keeps every task and clears only its courseId', () => {
    const next = deleteCourseFromState(state, 'c1');
    expect(next.courses.find((c) => c.id === 'c1')).toBeUndefined();
    expect(next.tasks).toHaveLength(3);
    expect(next.tasks.find((t) => t.id === 't1')?.courseId).toBeUndefined();
    expect(next.tasks.find((t) => t.id === 't2')?.courseId).toBe('c2'); // untouched
    expect(next.tasks.find((t) => t.id === 't3')?.courseId).toBeUndefined();
  });

  it('leaves ScheduleBlocks untouched (they reference taskId, not courseId)', () => {
    const withBlocks: AppState = { ...state, scheduleBlocks: [{ id: 'sb1', taskId: 't1', date: '2026-08-10', startTime: '08:00', endTime: '09:00', plannedMinutes: 60 }] };
    const next = deleteCourseFromState(withBlocks, 'c1');
    expect(next.scheduleBlocks).toHaveLength(1);
  });

  it('preserves the legacy tag on tasks (not overwritten on delete)', () => {
    const withTag = makeState(courses, [{ ...makeTask('t1', 'c1'), tag: 'math' }]);
    const next = deleteCourseFromState(withTag, 'c1');
    expect(next.tasks[0]?.tag).toBe('math');
  });
});

describe('updateCourseInState / addCourseToState', () => {
  it('updates only the targeted course', () => {
    const courses = [makeCourse('c1', '数学'), makeCourse('c2', '英语')];
    const next = updateCourseInState(makeState(courses, []), 'c1', { name: '高等数学', color: '#10b981' });
    expect(next.courses.find((c) => c.id === 'c1')).toMatchObject({ name: '高等数学', color: '#10b981' });
    expect(next.courses.find((c) => c.id === 'c2')?.name).toBe('英语');
  });

  it('appends a course without mutating the original list', () => {
    const courses = [makeCourse('c1', '数学')];
    const next = addCourseToState(makeState(courses, []), makeCourse('c2', '英语'));
    expect(courses).toHaveLength(1); // original unchanged
    expect(next.courses).toHaveLength(2);
  });
});

describe('estimatedMinutes parsing', () => {
  it('parseEstimatedMinutes: empty string is valid and means "no estimate"', () => {
    const r = parseEstimatedMinutes('');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeUndefined();
  });

  it('parseEstimatedMinutes: accepts positive integers up to the max', () => {
    expect(parseEstimatedMinutes('60')).toEqual({ ok: true, value: 60 });
    expect(parseEstimatedMinutes(String(ESTIMATED_MINUTES_MAX))).toEqual({ ok: true, value: ESTIMATED_MINUTES_MAX });
  });

  it('parseEstimatedMinutes: rejects 0, negatives, non-integers, and junk', () => {
    expect(parseEstimatedMinutes('0').ok).toBe(false);
    expect(parseEstimatedMinutes('-5').ok).toBe(false);
    expect(parseEstimatedMinutes('abc').ok).toBe(false);
    expect(parseEstimatedMinutes('1.5').ok).toBe(false);
    expect(parseEstimatedMinutes('1441').ok).toBe(false);
  });

  it('every preset is a legal value', () => {
    for (const m of ESTIMATED_MINUTES_PRESETS) {
      expect(parseEstimatedMinutes(String(m))).toEqual({ ok: true, value: m });
    }
  });

  it('normalizeEstimatedMinutes: last line of defence keeps only clean positive ints', () => {
    expect(normalizeEstimatedMinutes(90)).toBe(90);
    expect(normalizeEstimatedMinutes('90')).toBe(90);
    expect(normalizeEstimatedMinutes(0)).toBeUndefined();
    expect(normalizeEstimatedMinutes(-5)).toBeUndefined();
    expect(normalizeEstimatedMinutes(NaN)).toBeUndefined();
    expect(normalizeEstimatedMinutes(Infinity)).toBeUndefined();
    expect(normalizeEstimatedMinutes(1.5)).toBeUndefined();
    expect(normalizeEstimatedMinutes('xyz')).toBeUndefined();
    expect(normalizeEstimatedMinutes('0')).toBeUndefined();
  });
});

// ---------------------------------------------------- Phase 4A: Availability

describe('WEEKDAY_LABELS', () => {
  it('has all 7 weekdays with Chinese labels', () => {
    const keys = Object.keys(WEEKDAY_LABELS) as Weekday[];
    expect(keys).toHaveLength(7);
    expect(WEEKDAY_LABELS.monday).toBe('周一');
    expect(WEEKDAY_LABELS.sunday).toBe('周日');
    for (const k of keys) expect(WEEKDAY_LABELS[k]).toMatch(/^周[一二三四五六日]$/);
  });
});

describe('weekdaysOrdered', () => {
  it('startOfWeek=1 puts Monday first and Sunday last', () => {
    expect(weekdaysOrdered(1)).toEqual([
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    ]);
  });

  it('startOfWeek=0 puts Sunday first and Saturday last', () => {
    expect(weekdaysOrdered(0)).toEqual([
      'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
    ]);
  });

  it('always returns all 7 unique days and a fresh array', () => {
    const a = weekdaysOrdered(1);
    const b = weekdaysOrdered(1);
    expect(new Set(a).size).toBe(7);
    expect(a).not.toBe(b); // callers may sort/mutate safely
    expect(weekdaysOrdered()).toEqual(a); // defaults to Monday-first
  });
});

describe('weekdayForISO', () => {
  it('maps a full week of dates onto the right Weekday key', () => {
    // 2026-08-10 is a Monday (matches the fixtures used across the test suite).
    expect(weekdayForISO('2026-08-10')).toBe('monday');
    expect(weekdayForISO('2026-08-11')).toBe('tuesday');
    expect(weekdayForISO('2026-08-12')).toBe('wednesday');
    expect(weekdayForISO('2026-08-13')).toBe('thursday');
    expect(weekdayForISO('2026-08-14')).toBe('friday');
    expect(weekdayForISO('2026-08-15')).toBe('saturday');
    expect(weekdayForISO('2026-08-16')).toBe('sunday');
  });

  it('is independent of Settings.startOfWeek (that only affects display order)', () => {
    expect(weekdayForISO('2026-08-16')).toBe('sunday');
    expect(weekdaysOrdered(0)[0]).toBe('sunday'); // display rotation, not the mapping
  });

  it('returns null for malformed / overflow / unpadded dates', () => {
    for (const bad of ['', 'not-a-date', '2026-13-40', '2026-02-30', '2026-8-1']) {
      expect(weekdayForISO(bad)).toBeNull();
    }
  });
});

describe('isValidHHMM / parseHHMM', () => {
  it('accepts strict HH:mm inside a day', () => {
    expect(isValidHHMM('00:00')).toBe(true);
    expect(isValidHHMM('23:59')).toBe(true);
    expect(parseHHMM('09:30')).toBe(570);
  });

  it('rejects out-of-range, unpadded and junk values', () => {
    for (const bad of ['24:00', '9:00', '09:60', '', '--:--', 'abc', '0900']) {
      expect(isValidHHMM(bad)).toBe(false);
      expect(parseHHMM(bad)).toBeNull();
    }
  });
});

describe('validateAvailabilitySlot (Phase 4A: format + ordering only)', () => {
  it('accepts a normal slot', () => {
    expect(validateAvailabilitySlot('09:00', '10:00')).toEqual({ ok: true });
    expect(validateAvailabilitySlot('00:00', '23:59').ok).toBe(true);
  });

  it('rejects start === end (zero-length slot)', () => {
    const r = validateAvailabilitySlot('09:00', '09:00');
    expect(r.ok).toBe(false);
    expect(r.message).toBe('结束时间必须晚于开始时间');
  });

  it('rejects start > end', () => {
    const r = validateAvailabilitySlot('18:00', '09:00');
    expect(r.ok).toBe(false);
    expect(r.message).toBeTruthy();
  });

  it('rejects malformed / empty times on either side', () => {
    expect(validateAvailabilitySlot('', '10:00').ok).toBe(false);
    expect(validateAvailabilitySlot('09:00', '').ok).toBe(false);
    expect(validateAvailabilitySlot('25:00', '26:00').ok).toBe(false);
    expect(validateAvailabilitySlot('9:00', '10:00').ok).toBe(false);
  });

  it('does NOT enforce max slot length or daily totals (that is Phase 4C)', () => {
    expect(validateAvailabilitySlot('00:00', '23:59').ok).toBe(true);
  });
});

describe('slotMinutes / totalAvailableMinutes', () => {
  it('measures a valid slot and never returns NaN for a broken one', () => {
    expect(slotMinutes({ startTime: '09:00', endTime: '10:30' })).toBe(90);
    expect(slotMinutes({ startTime: '10:00', endTime: '09:00' })).toBe(0);
    expect(slotMinutes({ startTime: '', endTime: '' })).toBe(0);
  });

  it('sums a day and is safe for empty / missing lists', () => {
    expect(totalAvailableMinutes([
      { startTime: '08:00', endTime: '09:00' },
      { startTime: '14:00', endTime: '15:30' },
    ])).toBe(150);
    expect(totalAvailableMinutes([])).toBe(0);
    expect(totalAvailableMinutes(undefined)).toBe(0);
  });
});

describe('store exposes availability (source-level)', () => {
  it('publishes availability and a per-day updateAvailability action', () => {
    expect(storeSrc).toContain('availability: WeeklyAvailability');
    expect(storeSrc).toContain('updateAvailability');
    expect(storeSrc).toContain('availability: state.availability');
  });

  it('writes immutably and normalizes the edited weekday', () => {
    expect(storeSrc).toContain('availability: { ...s.availability, [day]: normalizeAvailability(slots) }');
  });
});

describe('AvailabilityPage wiring (source-level)', () => {
  it('reads and writes availability through the store', () => {
    expect(availabilityPageSrc).toContain('useAvailability()');
    expect(availabilityPageSrc).toContain('useActions()');
    expect(availabilityPageSrc).toContain('availability[day]');
    expect(availabilityPageSrc).toContain('updateAvailability(day, slots)');
  });

  it('orders days by the user setting and validates before committing', () => {
    expect(availabilityPageSrc).toContain('weekdaysOrdered(settings.startOfWeek)');
    expect(availabilityPageSrc).toContain('validateAvailabilitySlot');
    expect(availabilityPageSrc).toContain('WEEKDAY_LABELS');
  });

  it('is availability-only — no scheduler preview and no Task coupling', () => {
    // The page consumes exactly three store slices via split hooks.
    expect(availabilityPageSrc).toContain(
      'const { availability } = useAvailability();',
    );
    expect(availabilityPageSrc).toContain('const { settings } = useSettings();');
    expect(availabilityPageSrc).toContain(
      'const { updateAvailability } = useActions();',
    );
    expect(availabilityPageSrc).not.toMatch(/\bscheduleBlocks\b/);
    expect(availabilityPageSrc).not.toMatch(/\btasks\b/);
    expect(availabilityPageSrc).not.toMatch(/\btaskById\b/);
  });
});

// ---------------------------------------------------------------- Phase 0

describe('sanitizeScheduleBlocks', () => {
  const tasks: Task[] = [
    { id: 't1', title: 'a', description: '', dueDate: '2026-08-10', startTime: '', endTime: '', priority: 'medium', tag: 'other', status: 'todo', createdAt: 0, completedAt: null, subtasks: [] },
    { id: 't2', title: 'b', description: '', dueDate: '2026-08-11', startTime: '', endTime: '', priority: 'medium', tag: 'other', status: 'todo', createdAt: 0, completedAt: null, subtasks: [] },
  ];
  const blocks: ScheduleBlock[] = [
    { id: 'b1', taskId: 't1', date: '2026-08-10', startTime: '09:00', endTime: '10:00', plannedMinutes: 60 },
    { id: 'b2', taskId: 't2', date: '2026-08-10', startTime: '10:00', endTime: '11:00', plannedMinutes: 60 },
    { id: 'b3', taskId: 'ghost', date: '2026-08-10', startTime: '11:00', endTime: '12:00', plannedMinutes: 60 },
  ];

  it('keeps blocks whose taskId exists', () => {
    const result = sanitizeScheduleBlocks(tasks, blocks);
    expect(result.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('removes orphan blocks (dangling taskId)', () => {
    const result = sanitizeScheduleBlocks(tasks, blocks);
    expect(result.find((b) => b.id === 'b3')).toBeUndefined();
  });

  it('returns empty array when all blocks are orphaned', () => {
    const result = sanitizeScheduleBlocks(tasks, [blocks[2]!]);
    expect(result).toHaveLength(0);
  });

  it('does not mutate the input array', () => {
    const copy = [...blocks];
    sanitizeScheduleBlocks(tasks, blocks);
    expect(blocks).toEqual(copy);
  });
});

describe('normalizeAvailability', () => {
  it('passes through a single valid slot unchanged', () => {
    const result = normalizeAvailability([{ startTime: '09:00', endTime: '10:00' }]);
    expect(result).toEqual([{ startTime: '09:00', endTime: '10:00' }]);
  });

  it('rejects start === end (zero-length)', () => {
    const result = normalizeAvailability([{ startTime: '09:00', endTime: '09:00' }]);
    expect(result).toHaveLength(0);
  });

  it('rejects start > end', () => {
    const result = normalizeAvailability([{ startTime: '10:00', endTime: '09:00' }]);
    expect(result).toHaveLength(0);
  });

  it('rejects malformed time strings', () => {
    const result = normalizeAvailability([{ startTime: '', endTime: '10:00' }, { startTime: '25:00', endTime: '26:00' }]);
    expect(result).toHaveLength(0);
  });

  it('merges overlapping intervals', () => {
    const result = normalizeAvailability([
      { startTime: '09:00', endTime: '12:00' },
      { startTime: '11:00', endTime: '14:00' },
    ]);
    expect(result).toEqual([{ startTime: '09:00', endTime: '14:00' }]);
  });

  it('merges adjacent intervals (end === next start)', () => {
    const result = normalizeAvailability([
      { startTime: '09:00', endTime: '12:00' },
      { startTime: '12:00', endTime: '14:00' },
    ]);
    expect(result).toEqual([{ startTime: '09:00', endTime: '14:00' }]);
  });

  it('deduplicates identical intervals', () => {
    const result = normalizeAvailability([
      { startTime: '09:00', endTime: '10:00' },
      { startTime: '09:00', endTime: '10:00' },
    ]);
    expect(result).toEqual([{ startTime: '09:00', endTime: '10:00' }]);
  });

  it('sorts unsorted intervals', () => {
    const result = normalizeAvailability([
      { startTime: '14:00', endTime: '15:00' },
      { startTime: '09:00', endTime: '10:00' },
    ]);
    expect(result).toEqual([
      { startTime: '09:00', endTime: '10:00' },
      { startTime: '14:00', endTime: '15:00' },
    ]);
  });

  it('handles multiple non-overlapping intervals', () => {
    const result = normalizeAvailability([
      { startTime: '09:00', endTime: '10:00' },
      { startTime: '14:00', endTime: '15:00' },
      { startTime: '19:00', endTime: '20:00' },
    ]);
    expect(result).toHaveLength(3);
  });

  it('does not mutate the input array', () => {
    const input = [{ startTime: '09:00', endTime: '10:00' }];
    const copy = [...input];
    normalizeAvailability(input);
    expect(input).toEqual(copy);
  });
});

describe('getWeekStartsOn', () => {
  it('returns 1 for Monday start', () => {
    expect(getWeekStartsOn({ startOfWeek: 1 })).toBe(1);
  });

  it('returns 0 for Sunday start', () => {
    expect(getWeekStartsOn({ startOfWeek: 0 })).toBe(0);
  });
});

describe('legacy compatibility shim (legacyTagForCourseName)', () => {
  it('maps a known course name 1:1 onto a legacy tag', () => {
    expect(legacyTagForCourseName('数学')).toBe('math');
    expect(legacyTagForCourseName('英语')).toBe('english');
    expect(legacyTagForCourseName('编程')).toBe('coding');
  });

  it('falls back to other for unknown names or undefined', () => {
    expect(legacyTagForCourseName('高等数学')).toBe('other');
    expect(legacyTagForCourseName(undefined)).toBe('other');
  });
});
