import calendarSrc from '../pages/CalendarPage.tsx?raw';
import dashboardSrc from '../pages/Dashboard.tsx?raw';
import timelineSrc from '../pages/TimelinePage.tsx?raw';
import tasksSrc from '../pages/TasksPage.tsx?raw';
import taskModalSrc from '../components/TaskModal.tsx?raw';
import { describe, expect, it } from 'vitest';
import {
  deadlineBucket,
  findTaskForBlock,
  groupBlocksByDate,
  groupTasksByDeadline,
  overdueTasks,
  sortScheduleBlocks,
  sumPlannedMinutes,
  todayDueTasks,
} from './schedule';
import type { ScheduleBlock, Task } from '@/types';

const makeTask = (id: string, dueDate: string): Task => ({
  id,
  title: `Task ${id}`,
  description: '',
  dueDate,
  // legacy scheduling fields are intentionally present (kept for migration)
  // but must NOT drive the calendar — only dueDate is used for deadlines.
  priority: 'medium',
  status: 'todo',
  createdAt: 0,
  updatedAt: 0,
  completedAt: null,
  subtasks: [],
  estimatedMinutes: 30,
});

const makeBlock = (
  id: string,
  taskId: string,
  date: string,
  start = '09:00',
  end = '10:00',
): ScheduleBlock => ({
  id,
  taskId,
  date,
  startTime: start,
  endTime: end,
  plannedMinutes: 60,
  source: 'manual',
  locked: false,
  status: 'planned',
  createdAt: 0,
  updatedAt: 0,
});

describe('schedule domain', () => {
  it('groupBlocksByDate keys on block.date (the study day)', () => {
    const blocks = [
      makeBlock('b1', 't1', '2026-08-10'),
      makeBlock('b2', 't2', '2026-08-10'),
      makeBlock('b3', 't3', '2026-08-11'),
    ];
    const grouped = groupBlocksByDate(blocks);
    expect(Object.keys(grouped).sort()).toEqual(['2026-08-10', '2026-08-11']);
    expect(grouped['2026-08-10']).toHaveLength(2);
    expect(grouped['2026-08-11']).toHaveLength(1);
  });

  it('groupBlocksByDate returns an empty object for no blocks', () => {
    expect(groupBlocksByDate([])).toEqual({});
  });

  it('groupTasksByDeadline keys on task.dueDate (the deadline day)', () => {
    const tasks = [
      makeTask('t1', '2026-08-10'),
      makeTask('t2', '2026-08-10'),
      makeTask('t3', '2026-08-12'),
    ];
    const grouped = groupTasksByDeadline(tasks);
    expect(Object.keys(grouped).sort()).toEqual(['2026-08-10', '2026-08-12']);
    expect(grouped['2026-08-10']).toHaveLength(2);
    expect(grouped['2026-08-12']).toHaveLength(1);
  });

  it('sortScheduleBlocks orders by startTime then endTime', () => {
    const blocks = [
      makeBlock('b1', 't1', '2026-08-10', '11:00', '12:00'),
      makeBlock('b2', 't2', '2026-08-10', '09:00', '10:00'),
      makeBlock('b3', 't3', '2026-08-10', '09:00', '11:00'),
    ];
    const sorted = sortScheduleBlocks(blocks);
    expect(sorted.map((b) => b.id)).toEqual(['b2', 'b3', 'b1']);
  });

  it('findTaskForBlock returns undefined for a dangling taskId (orphan block)', () => {
    const taskById = new Map<string, Task>([['t1', makeTask('t1', '2026-08-10')]]);
    expect(findTaskForBlock(taskById, makeBlock('b1', 't1', '2026-08-10'))).toBeDefined();
    // After the task is deleted, the block still exists but resolves to nothing.
    expect(findTaskForBlock(taskById, makeBlock('bx', 'deleted', '2026-08-10'))).toBeUndefined();
  });
});

describe('deadlineBucket', () => {
  // Use a fixed "today" so the bucketing is deterministic in tests.
  const TODAY = '2026-08-12'; // a Wednesday

  it('classifies overdue deadlines', () => {
    expect(deadlineBucket('2026-08-10', TODAY)).toBe('overdue');
    expect(deadlineBucket('2026-01-01', TODAY)).toBe('overdue');
  });

  it('classifies today', () => {
    expect(deadlineBucket(TODAY, TODAY)).toBe('today');
  });

  it('classifies tomorrow', () => {
    expect(deadlineBucket('2026-08-13', TODAY)).toBe('tomorrow');
  });

  it('classifies thisWeek (same week, >= 2 days away)', () => {
    // 2026-08-12 is Wednesday; the week (Mon-start) ends Sunday 2026-08-16.
    expect(deadlineBucket('2026-08-14', TODAY)).toBe('thisWeek'); // Friday
    expect(deadlineBucket('2026-08-16', TODAY)).toBe('thisWeek'); // Sunday (week end)
  });

  it('classifies later (past the current week)', () => {
    // Monday of next week is outside the current week.
    expect(deadlineBucket('2026-08-17', TODAY)).toBe('later'); // next Monday
    expect(deadlineBucket('2026-09-01', TODAY)).toBe('later');
  });

  it('respects weekStartsOn = 0 (Sunday) for the week boundary', () => {
    const sunday = '2026-08-09'; // a Sunday
    // With Sunday as week start, the week ends Saturday 2026-08-15.
    expect(deadlineBucket('2026-08-15', sunday, 0)).toBe('thisWeek');
    expect(deadlineBucket('2026-08-16', sunday, 0)).toBe('later');
  });

  it('handles cross-week boundary: day before week end stays thisWeek', () => {
    // Wednesday 2026-08-12; Saturday 2026-08-15 is within the Mon-start week.
    expect(deadlineBucket('2026-08-15', TODAY)).toBe('thisWeek');
  });

  it('falls back to "later" for empty / malformed / overflow dates (never throws)', () => {
    expect(deadlineBucket('', TODAY)).toBe('later');
    expect(deadlineBucket('not-a-date', TODAY)).toBe('later');
    expect(deadlineBucket('2026-13-40', TODAY)).toBe('later'); // month overflow
    expect(deadlineBucket('2026-02-30', TODAY)).toBe('later'); // day overflow
    expect(deadlineBucket('2026-8-1', TODAY)).toBe('later'); // wrong padding
  });
});

// Source-level guards: the Calendar must consume ScheduleBlock, never Task.startTime/endTime.
// `calendarSrc` is loaded as a raw string via Vite's `?raw` (no Node types needed).
describe('CalendarPage wiring', () => {
  it('does not read Task.startTime / Task.endTime (uses ScheduleBlock instead)', () => {
    expect(calendarSrc.includes('t.startTime')).toBe(false);
    expect(calendarSrc.includes('t.endTime')).toBe(false);
    // the old dueDate-based bucketing variable must be gone
    expect(calendarSrc.includes('tasksByDate')).toBe(false);
  });

  it('buckets study sessions by ScheduleBlock and deadlines by dueDate via schedule helpers', () => {
    expect(calendarSrc).toContain("from '@/lib/schedule'");
    expect(calendarSrc).toContain('groupBlocksByDate');
    expect(calendarSrc).toContain('groupTasksByDeadline');
  });
});

// Source-level guards: Timeline must be a deadline view, not a startTime timeline.
describe('TimelinePage wiring', () => {
  it('does not read Task.startTime / Task.endTime (no startTime axis anymore)', () => {
    expect(timelineSrc.includes('t.startTime')).toBe(false);
    expect(timelineSrc.includes('t.endTime')).toBe(false);
  });

  it('does not use the old periodFor / scheduled / unscheduled time-of-day grouping', () => {
    expect(timelineSrc.includes('periodFor')).toBe(false);
    expect(timelineSrc.includes('scheduled')).toBe(false);
    expect(timelineSrc.includes('unscheduled')).toBe(false);
  });

  it('drives the view from deadlineBucket (deadline grouping)', () => {
    expect(timelineSrc).toContain("from '@/lib/schedule'");
    expect(timelineSrc).toContain('deadlineBucket');
  });
});

describe('Dashboard selectors', () => {
  const TODAY = '2026-08-12';

  it('todayDueTasks returns only tasks whose dueDate === today', () => {
    const tasks: Task[] = [
      { ...makeTask('t1', TODAY), status: 'todo' },
      { ...makeTask('t2', TODAY), status: 'done' },
      { ...makeTask('t3', '2026-08-11') },
      { ...makeTask('t4', '2026-08-13') },
    ];
    const res = todayDueTasks(tasks, TODAY);
    expect(res.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('overdueTasks returns only not-done tasks past their deadline', () => {
    const tasks: Task[] = [
      { ...makeTask('t1', '2026-08-10'), status: 'todo' }, // overdue, not done
      { ...makeTask('t2', '2026-08-10'), status: 'done' }, // done -> excluded even if past
      { ...makeTask('t3', TODAY), status: 'todo' }, // today -> excluded
      { ...makeTask('t4', '2026-08-13'), status: 'todo' }, // future -> excluded
    ];
    const res = overdueTasks(tasks, TODAY);
    expect(res.map((t) => t.id)).toEqual(['t1']);
  });

  it('sumPlannedMinutes adds plannedMinutes and is empty/zero safe', () => {
    expect(sumPlannedMinutes([])).toBe(0);
    const blocks = [
      makeBlock('b1', 't1', TODAY), // 60
      makeBlock('b2', 't2', TODAY), // 60
      { ...makeBlock('b3', 't3', TODAY), plannedMinutes: 0 }, // 0 must not break the sum
    ];
    expect(sumPlannedMinutes(blocks)).toBe(120);
  });
});

// Source-level guards: Dashboard must align with the new architecture —
// study sessions come from ScheduleBlock, deadlines from dueDate; no old startTime/endTime.
describe('DashboardPage wiring', () => {
  it('does not read Task.startTime / Task.endTime (ScheduleBlock is the study source)', () => {
    expect(dashboardSrc.includes('t.startTime')).toBe(false);
    expect(dashboardSrc.includes('t.endTime')).toBe(false);
  });

  it('drives study sessions from ScheduleBlock via schedule helpers', () => {
    expect(dashboardSrc).toContain('scheduleBlocks');
    expect(dashboardSrc).toContain('findTaskForBlock');
    expect(dashboardSrc).toContain("from '@/lib/schedule'");
  });

  it('renders the three architecture-aligned sections', () => {
    expect(dashboardSrc).toContain('今日学习');
    expect(dashboardSrc).toContain('今日截止');
    expect(dashboardSrc).toContain('逾期');
  });
});

// Source-level guards: TasksPage list must no longer show the legacy Task.startTime/endTime.
describe('TasksPage wiring', () => {
  it('does not show Task.startTime / Task.endTime in the task list', () => {
    expect(tasksSrc.includes('t.startTime')).toBe(false);
    expect(tasksSrc.includes('t.endTime')).toBe(false);
  });
});

// Source-level guards: TaskModal must not bind user input to Task.startTime/endTime anymore.
describe('TaskModal wiring', () => {
  it('does not bind draft.startTime / draft.endTime as user-input fields', () => {
    expect(taskModalSrc.includes('draft.startTime')).toBe(false);
    expect(taskModalSrc.includes('draft.endTime')).toBe(false);
  });
});
