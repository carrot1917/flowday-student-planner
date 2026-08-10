import { beforeEach, describe, expect, it } from 'vitest';
import {
  STORAGE_KEY_V1,
  STORAGE_KEY_V2,
  STORAGE_KEY_V2_CORRUPT,
  createPersistGate,
  loadState,
  migrateV1ToV2,
  saveState,
  seedDemoState,
} from './storage';
import type { AppState, Task, WeeklyAvailability } from '@/types';

function clearStorage() {
  localStorage.clear();
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

function v1State(tasks: Task[], settings?: Partial<AppState['settings']>) {
  return {
    tasks,
    settings: {
      notificationsEnabled: false,
      reminderTime: 480,
      dueReminder: true,
      startOfWeek: 1,
      ...settings,
    },
  };
}

function legacyTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: '旧任务',
    description: '',
    dueDate: '2026-08-10',
    startTime: '19:00',
    endTime: '20:30',
    priority: 'high',
    tag: 'math',
    status: 'todo',
    createdAt: 1,
    completedAt: null,
    subtasks: [],
    ...over,
  };
}

describe('storage migration (Phase 1)', () => {
  beforeEach(() => clearStorage());

  it('reads v2 directly and ignores v1 when both exist', () => {
    const v1 = v1State([legacyTask()]);
    localStorage.setItem(STORAGE_KEY_V1, JSON.stringify(v1));

    const v2: AppState = {
      version: 2,
      hasSeededDemo: true,
      courses: [],
      tasks: [{ ...legacyTask({ id: 'fromV2', title: '来自v2' }) }],
      scheduleBlocks: [],
      availability: EMPTY_AVAILABILITY,
      settings: { notificationsEnabled: false, reminderTime: 480, dueReminder: true, startOfWeek: 1 },
    };
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(v2));

    const { state } = loadState();
    expect(state.tasks[0]?.id).toBe('fromV2');
    // v1 must remain byte-identical
    expect(localStorage.getItem(STORAGE_KEY_V1)).toBe(JSON.stringify(v1));
  });

  it('migrates v1 -> v2, writes v2, and keeps v1 byte-identical', () => {
    const v1 = v1State([legacyTask(), legacyTask({ id: 't2', tag: 'english' })]);
    const raw = JSON.stringify(v1);
    localStorage.setItem(STORAGE_KEY_V1, raw);

    const { state } = loadState();
    expect(state.version).toBe(2);
    expect(state.tasks).toHaveLength(2);
    expect(localStorage.getItem(STORAGE_KEY_V1)).toBe(raw); // untouched
    expect(localStorage.getItem(STORAGE_KEY_V2)).not.toBeNull(); // written
  });

  it('migrates each distinct tag to exactly one stable Course', () => {
    const v1 = v1State([
      legacyTask(),
      legacyTask({ id: 't2', tag: 'english' }),
      legacyTask({ id: 't3', tag: 'math' }),
    ]);
    const a = migrateV1ToV2(v1);
    const b = migrateV1ToV2(v1);
    expect(a.courses.map((c) => c.id).sort()).toEqual(['course:english', 'course:math']);
    expect(a.courses.map((c) => c.id)).toEqual(b.courses.map((c) => c.id));
    expect(new Set(a.courses.map((c) => c.id)).size).toBe(a.courses.length); // no duplicates
  });

  it('produces deterministic ScheduleBlock ids across migrations', () => {
    const v1 = v1State([legacyTask()]);
    const a = migrateV1ToV2(v1);
    const b = migrateV1ToV2(v1);
    expect(a.scheduleBlocks.map((s) => s.id)).toEqual(b.scheduleBlocks.map((s) => s.id));
    expect(a.scheduleBlocks[0]?.id).toBe('sb:t1:2026-08-10:19:00');
    expect(a.scheduleBlocks[0]?.plannedMinutes).toBe(90);
    expect(a.scheduleBlocks[0]?.date).toBe('2026-08-10');
  });

  it('does NOT overwrite dueDate during migration', () => {
    const v1 = v1State([legacyTask({ dueDate: '2026-08-10' })]);
    localStorage.setItem(STORAGE_KEY_V1, JSON.stringify(v1));
    const { state } = loadState();
    expect(state.tasks[0]?.dueDate).toBe('2026-08-10');
  });

  it('keeps existing user data (v1 tasks=[]) without seeding demo', () => {
    const v1 = v1State([]);
    localStorage.setItem(STORAGE_KEY_V1, JSON.stringify(v1));
    const { state } = loadState();
    expect(state.tasks).toHaveLength(0);
    expect(state.hasSeededDemo).toBe(true);
  });

  it('does not re-seed demo after user deletes all tasks in v2', () => {
    const v2: AppState = {
      version: 2,
      hasSeededDemo: true,
      courses: [],
      tasks: [],
      scheduleBlocks: [],
      availability: EMPTY_AVAILABILITY,
      settings: { notificationsEnabled: false, reminderTime: 480, dueReminder: true, startOfWeek: 1 },
    };
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(v2));
    const { state } = loadState();
    expect(state.tasks).toHaveLength(0);
    expect(state.hasSeededDemo).toBe(true);
  });

  it('seeds demo only on genuine first use (no v1, no v2)', () => {
    const { state, dirty } = loadState();
    expect(state.tasks.length).toBeGreaterThan(0);
    expect(state.hasSeededDemo).toBe(true);
    expect(dirty).toBe(true);
    // loadState returns dirty:true; the store persists it. Simulate that here.
    saveState(state);
    expect(localStorage.getItem(STORAGE_KEY_V2)).not.toBeNull();
  });

  it('does not overwrite a corrupt v2 with an empty state', () => {
    const corrupt = '{ this is not valid json';
    localStorage.setItem(STORAGE_KEY_V2, corrupt);
    const { state } = loadState();
    expect(state.tasks).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY_V2)).toBe(corrupt); // bytes preserved
  });

  it('does not crash on unknown / corrupt storage', () => {
    localStorage.setItem(STORAGE_KEY_V2, '###');
    expect(() => loadState()).not.toThrow();
    localStorage.setItem(STORAGE_KEY_V1, '###');
    expect(() => loadState()).not.toThrow();
  });

  it('seedDemoState produces a valid v2 with courses, tasks and schedule blocks', () => {
    const demo = seedDemoState();
    expect(demo.version).toBe(2);
    expect(demo.courses).toHaveLength(5);
    expect(demo.tasks).toHaveLength(5);
    expect(demo.scheduleBlocks.length).toBeGreaterThan(0); // timed tasks → blocks
    expect(demo.tasks.every((t) => typeof t.estimatedMinutes === 'number')).toBe(true);
    expect(demo.tasks.every((t) => typeof t.courseId === 'string')).toBe(true);
  });
});

// ----------------------------------------------------------- Phase 2: persistence
describe('persistence gate & corrupt-backup (Phase 2)', () => {
  beforeEach(() => clearStorage());

  function validV2(over: Partial<AppState> = {}): AppState {
    return {
      version: 2,
      hasSeededDemo: true,
      courses: [],
      tasks: [],
      scheduleBlocks: [],
      availability: EMPTY_AVAILABILITY,
      settings: { notificationsEnabled: false, reminderTime: 480, dueReminder: true, startOfWeek: 1 },
      ...over,
    };
  }

  it('backs up a corrupt v2 payload exactly once (a later valid save must NOT clobber the backup)', () => {
    const corrupt = '{ this is not valid json';
    localStorage.setItem(STORAGE_KEY_V2, corrupt);
    loadState(); // detects corruption, snapshots raw bytes
    expect(localStorage.getItem(STORAGE_KEY_V2_CORRUPT)).toBe(corrupt);

    saveState(validV2()); // user starts editing normally — rewrites v2
    expect(localStorage.getItem(STORAGE_KEY_V2_CORRUPT)).toBe(corrupt); // backup untouched
    expect(localStorage.getItem(STORAGE_KEY_V2)).not.toBe(corrupt); // v2 now valid
  });

  it('does not write a corrupt backup when v2 is already valid', () => {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(validV2()));
    loadState();
    expect(localStorage.getItem(STORAGE_KEY_V2_CORRUPT)).toBeNull();
  });

  it('createPersistGate: skips the boot write when state is already on disk', () => {
    const boot = validV2();
    const gate = createPersistGate({ state: boot, dirty: false });
    expect(gate(boot)).toBe(false); // same reference → never written
    expect(gate(boot)).toBe(false); // idempotent
  });

  it('createPersistGate: lets a mutated (new reference) state through exactly once', () => {
    const boot = validV2();
    const gate = createPersistGate({ state: boot, dirty: false });
    const next = { ...boot, tasks: [{ ...boot.tasks[0]!, id: 'x' }] as AppState['tasks'] };
    expect(gate(next)).toBe(true);
    expect(gate(next)).toBe(false); // same ref again → no duplicate write
  });

  it('createPersistGate: first-run (dirty) writes once even under a StrictMode double-invoke', () => {
    const boot = validV2();
    const gate = createPersistGate({ state: boot, dirty: true });
    expect(gate(boot)).toBe(true); // first effect run persists
    expect(gate(boot)).toBe(false); // second StrictMode effect run is suppressed
  });

  it('createPersistGate: a corrupt v2 boot state is never clobbered by StrictMode double-invoke', () => {
    const corrupt = '{ oops';
    localStorage.setItem(STORAGE_KEY_V2, corrupt);
    const { state: boot, dirty } = loadState();
    expect(dirty).toBe(false); // corrupt v2 → not dirty → must NOT be written back
    const gate = createPersistGate({ state: boot, dirty });
    expect(gate(boot)).toBe(false);
    expect(gate(boot)).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY_V2)).toBe(corrupt); // original bytes preserved
  });
});
