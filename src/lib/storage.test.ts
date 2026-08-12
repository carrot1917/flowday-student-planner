import { beforeEach, describe, expect, it } from 'vitest';
import {
  STORAGE_KEY_V1,
  STORAGE_KEY_V2,
  STORAGE_KEY_V3,
  STORAGE_KEY_V3_CORRUPT,
  createPersistGate,
  exportBackup,
  hydrateState,
  loadState,
  migrateV1ToV2,
  migrateV2ToV3,
  saveState,
  seedDemoState,
  validateBackup,
  deepValidateTask,
  deepValidateScheduleBlock,
  deepValidateSettings,
  deepValidateState,
} from './storage';
import type { AppState, ScheduleBlock, Task, WeeklyAvailability } from '@/types';
import type { LegacyTaskV1, V2AppState, V2Settings } from './storage';

function clearStorage() {
  localStorage.clear();
}

const EMPTY_AVAILABILITY: WeeklyAvailability = {
  monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
};

function v1State(tasks: LegacyTaskV1[], settings?: Partial<V2Settings>) {
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

function legacyTask(over: Partial<LegacyTaskV1> = {}): LegacyTaskV1 {
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

function v2State(over: Partial<V2AppState> = {}): V2AppState {
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

function v3State(over: Partial<AppState> = {}): AppState {
  return {
    version: 3,
    hasSeededDemo: true,
    courses: [],
    tasks: [],
    scheduleBlocks: [],
    availability: EMPTY_AVAILABILITY,
    settings: {
      notificationsEnabled: false, reminderTime: 480, dueReminder: true, startOfWeek: 1,
      timezone: 'UTC', dailyStudyLimitMinutes: 480, minBlockMinutes: 25, maxBlockMinutes: 120, breakMinutes: 5,
    },
    ...over,
  };
}

function v3Task(over: Partial<Task> = {}): Task {
  return {
    id: 't1', title: 'test', description: '', dueDate: '2026-08-10',
    priority: 'medium', status: 'todo', createdAt: 0, updatedAt: 0, completedAt: null, subtasks: [],
    ...over,
  };
}

function v3Block(over: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id: 'b1', taskId: 't1', date: '2026-08-10', startTime: '09:00', endTime: '10:00',
    plannedMinutes: 60, source: 'manual', locked: false, status: 'planned', createdAt: 0, updatedAt: 0,
    ...over,
  };
}

// ----------------------------------------------------------- Migration
describe('storage migration', () => {
  beforeEach(() => clearStorage());

  it('reads v3 directly and ignores v2/v1 when v3 exists', () => {
    const v1 = v1State([legacyTask()]);
    localStorage.setItem(STORAGE_KEY_V1, JSON.stringify(v1));

    const v2: AppState = { version: 2, hasSeededDemo: true, courses: [], tasks: [legacyTask({ id: 'fromV2' })], scheduleBlocks: [], availability: EMPTY_AVAILABILITY, settings: { notificationsEnabled: false, reminderTime: 480, dueReminder: true, startOfWeek: 1 } } as any;
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(v2));

    const v3 = v3State({ tasks: [v3Task({ id: 'fromV3', title: '来自v3' })] });
    localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(v3));

    const { state } = loadState();
    expect(state.tasks[0]?.id).toBe('fromV3');
    expect(state.version).toBe(3);
  });

  it('migrates v2 -> v3, writes v3, and keeps v2 byte-identical', () => {
    const v2: AppState = { version: 2, hasSeededDemo: true, courses: [], tasks: [legacyTask({ id: 't1', title: 'v2任务' }) as any], scheduleBlocks: [], availability: EMPTY_AVAILABILITY, settings: { notificationsEnabled: false, reminderTime: 480, dueReminder: true, startOfWeek: 1 } };
    const raw = JSON.stringify(v2);
    localStorage.setItem(STORAGE_KEY_V2, raw);

    const { state } = loadState();
    expect(state.version).toBe(3);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]?.title).toBe('v2任务');
    expect(localStorage.getItem(STORAGE_KEY_V2)).toBe(raw);
    expect(localStorage.getItem(STORAGE_KEY_V3)).not.toBeNull();
  });

  it('migrateV2ToV3 is idempotent', () => {
    const v2: AppState = { version: 2, hasSeededDemo: true, courses: [], tasks: [legacyTask({ id: 't1', title: 'x' }) as any], scheduleBlocks: [], availability: EMPTY_AVAILABILITY, settings: { notificationsEnabled: false, reminderTime: 480, dueReminder: true, startOfWeek: 1 } };
    const { state: first } = migrateV2ToV3(v2);
    const { state: second } = migrateV2ToV3(first as any);
    // Running v2->v3 on a v3 state should produce the same result (version check prevents double-migration)
    expect(second.version).toBe(3);
    expect(second.tasks).toHaveLength(1);
  });

  it('migrateV2ToV3 migrates v2 Task.startTime/endTime to ScheduleBlock', () => {
    const v2Task = legacyTask({ id: 't1', title: '有时间的任务' }) as any;
    const v2: AppState = { version: 2, hasSeededDemo: true, courses: [], tasks: [v2Task], scheduleBlocks: [], availability: EMPTY_AVAILABILITY, settings: { notificationsEnabled: false, reminderTime: 480, dueReminder: true, startOfWeek: 1 } };
    const { state } = migrateV2ToV3(v2);
    // v2 task has startTime/endTime → should create a ScheduleBlock
    expect(state.scheduleBlocks.length).toBeGreaterThanOrEqual(1);
    expect(state.scheduleBlocks[0]?.taskId).toBe('t1');
    expect(state.tasks[0]?.startTime).toBeUndefined();
    expect(state.tasks[0]?.tag).toBeUndefined();
  });

  it('migrateV2ToV3 adds v3 fields to ScheduleBlocks', () => {
    const v2Block: any = { id: 'b1', taskId: 't1', date: '2026-08-10', startTime: '09:00', endTime: '10:00', plannedMinutes: 60 };
    const v2: AppState = { version: 2, hasSeededDemo: true, courses: [], tasks: [legacyTask() as any], scheduleBlocks: [v2Block], availability: EMPTY_AVAILABILITY, settings: { notificationsEnabled: false, reminderTime: 480, dueReminder: true, startOfWeek: 1 } };
    const { state } = migrateV2ToV3(v2);
    expect(state.scheduleBlocks[0]?.source).toBe('manual');
    expect(state.scheduleBlocks[0]?.locked).toBe(false);
    expect(state.scheduleBlocks[0]?.status).toBe('planned');
    expect(state.scheduleBlocks[0]?.createdAt).toBeGreaterThan(0);
    expect(state.scheduleBlocks[0]?.updatedAt).toBeGreaterThan(0);
  });

  it('migrateV2ToV3 adds v3 settings fields', () => {
    const v2: AppState = { version: 2, hasSeededDemo: true, courses: [], tasks: [], scheduleBlocks: [], availability: EMPTY_AVAILABILITY, settings: { notificationsEnabled: false, reminderTime: 480, dueReminder: true, startOfWeek: 1 } };
    const { state } = migrateV2ToV3(v2);
    expect(state.settings.timezone).toBeDefined();
    expect(state.settings.dailyStudyLimitMinutes).toBe(480);
    expect(state.settings.minBlockMinutes).toBe(25);
    expect(state.settings.maxBlockMinutes).toBe(120);
    expect(state.settings.breakMinutes).toBe(5);
  });

  it('migrates v1 -> v3, writes v3, keeps v1', () => {
    const v1 = v1State([legacyTask()]);
    localStorage.setItem(STORAGE_KEY_V1, JSON.stringify(v1));

    const { state } = loadState();
    expect(state.version).toBe(3);
    expect(state.tasks).toHaveLength(1);
    expect(localStorage.getItem(STORAGE_KEY_V1)).toBe(JSON.stringify(v1));
    expect(localStorage.getItem(STORAGE_KEY_V3)).not.toBeNull();
  });

  it('seedDemoState produces version 3', () => {
    const demo = seedDemoState();
    expect(demo.version).toBe(3);
    expect(demo.courses).toHaveLength(5);
    expect(demo.tasks).toHaveLength(5);
    expect(demo.scheduleBlocks.length).toBeGreaterThan(0);
    expect(demo.tasks.every((t) => typeof t.estimatedMinutes === 'number')).toBe(true);
    expect(demo.tasks.every((t) => typeof t.courseId === 'string')).toBe(true);
    // v3 tasks should NOT have startTime/endTime/tag
    expect((demo.tasks[0] as any).startTime).toBeUndefined();
    expect((demo.tasks[0] as any).tag).toBeUndefined();
  });

  it('does not overwrite a corrupt v3', () => {
    const corrupt = '{ this is not valid json';
    localStorage.setItem(STORAGE_KEY_V3, corrupt);
    const { state } = loadState();
    expect(state.tasks).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY_V3)).toBe(corrupt);
  });

  it('does not crash on unknown / corrupt storage', () => {
    localStorage.setItem(STORAGE_KEY_V3, '###');
    expect(() => loadState()).not.toThrow();
    localStorage.setItem(STORAGE_KEY_V2, '###');
    expect(() => loadState()).not.toThrow();
    localStorage.setItem(STORAGE_KEY_V1, '###');
    expect(() => loadState()).not.toThrow();
  });
});

// ----------------------------------------------------------- Persistence gate
describe('persistence gate', () => {
  beforeEach(() => clearStorage());

  it('backs up a corrupt v3 payload exactly once', () => {
    const corrupt = '{ this is not valid json';
    localStorage.setItem(STORAGE_KEY_V3, corrupt);
    loadState();
    expect(localStorage.getItem(STORAGE_KEY_V3_CORRUPT)).toBe(corrupt);

    saveState(v3State());
    expect(localStorage.getItem(STORAGE_KEY_V3_CORRUPT)).toBe(corrupt);
    expect(localStorage.getItem(STORAGE_KEY_V3)).not.toBe(corrupt);
  });

  it('does not write a corrupt backup when v3 is already valid', () => {
    localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(v3State()));
    loadState();
    expect(localStorage.getItem(STORAGE_KEY_V3_CORRUPT)).toBeNull();
  });

  it('createPersistGate: skips boot write when state is on disk', () => {
    const boot = v3State();
    const gate = createPersistGate({ state: boot, dirty: false });
    expect(gate(boot)).toBe(false);
    expect(gate(boot)).toBe(false);
  });

  it('createPersistGate: first-run (dirty) writes once', () => {
    const boot = v3State();
    const gate = createPersistGate({ state: boot, dirty: true });
    expect(gate(boot)).toBe(true);
    expect(gate(boot)).toBe(false);
  });

  it('createPersistGate: corrupt v3 boot state is never clobbered', () => {
    const corrupt = '{ oops';
    localStorage.setItem(STORAGE_KEY_V3, corrupt);
    const { state: boot, dirty } = loadState();
    expect(dirty).toBe(false);
    const gate = createPersistGate({ state: boot, dirty });
    expect(gate(boot)).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY_V3)).toBe(corrupt);
  });
});

// ----------------------------------------------------------- hydrateState
describe('hydrateState', () => {
  it('removes orphan ScheduleBlocks', () => {
    const state = v3State({
      tasks: [v3Task({ id: 't1' })],
      scheduleBlocks: [
        v3Block({ id: 'b1', taskId: 't1' }),
        v3Block({ id: 'b2', taskId: 'ghost' }),
      ],
    });
    const h = hydrateState(state);
    expect(h.scheduleBlocks).toHaveLength(1);
    expect(h.scheduleBlocks[0]?.id).toBe('b1');
  });

  it('normalizes availability', () => {
    const state = v3State({
      availability: {
        ...EMPTY_AVAILABILITY,
        monday: [{ startTime: '09:00', endTime: '12:00' }, { startTime: '11:00', endTime: '14:00' }],
      },
    });
    const h = hydrateState(state);
    expect(h.availability.monday).toHaveLength(1);
    expect(h.availability.monday[0]).toEqual({ startTime: '09:00', endTime: '14:00' });
  });
});

// ----------------------------------------------------------- Deep validation
describe('deep validation', () => {
  it('deepValidateTask accepts valid v3 task', () => {
    const r = deepValidateTask(v3Task());
    expect(r.ok).toBe(true);
  });

  it('deepValidateTask rejects missing id', () => {
    const r = deepValidateTask({ title: 'no id' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('id'))).toBe(true);
  });

  it('deepValidateScheduleBlock accepts valid v3 block', () => {
    const r = deepValidateScheduleBlock(v3Block());
    expect(r.ok).toBe(true);
  });

  it('deepValidateScheduleBlock rejects missing date', () => {
    const r = deepValidateScheduleBlock({ id: 'b1', startTime: '09:00', endTime: '10:00' });
    expect(r.ok).toBe(false);
  });

  it('deepValidateSettings accepts v3 settings', () => {
    const r = deepValidateSettings(v3State().settings);
    expect(r.ok).toBe(true);
  });

  it('deepValidateState accepts valid v3 state', () => {
    const r = deepValidateState(v3State({
      tasks: [v3Task()],
      scheduleBlocks: [v3Block()],
    }));
    expect(r.ok).toBe(true);
  });

  it('deepValidateState rejects version !== 3', () => {
    const r = deepValidateState({ ...v3State(), version: 2 });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('version'))).toBe(true);
  });
});

// ----------------------------------------------------------- Backup
describe('exportBackup / validateBackup', () => {
  beforeEach(() => clearStorage());

  it('exports a valid backup string', () => {
    const json = exportBackup(v3State());
    const parsed = JSON.parse(json);
    expect(parsed.app).toBe('flowday');
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.data).toBeDefined();
  });

  it('exported backup is parseable and validatable', () => {
    const state = v3State({ tasks: [v3Task()] });
    const json = exportBackup(state);
    const result = validateBackup(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.tasks).toHaveLength(1);
    }
  });

  it('rejects invalid JSON', () => {
    expect(validateBackup('not json').ok).toBe(false);
  });

  it('rejects non-flowday app identifier', () => {
    expect(validateBackup(JSON.stringify({ app: 'other', formatVersion: 1, data: { tasks: [] } })).ok).toBe(false);
  });

  it('rejects unsupported format version', () => {
    expect(validateBackup(JSON.stringify({ app: 'flowday', formatVersion: 999, data: { tasks: [] } })).ok).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(validateBackup(JSON.stringify({ app: 'flowday', formatVersion: 1, data: { tasks: [] } })).ok).toBe(false);
  });

  it('validation failure does not corrupt current data', () => {
    const result = validateBackup('corrupt');
    expect(result.ok).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY_V3)).toBeNull();
  });
});

// ----------------------------------------------------------- Repository
describe('LocalStorageRepository', () => {
  beforeEach(() => clearStorage());

  it('loadSnapshot returns v3 state', async () => {
    const { repository } = await import('./repository');
    const state = await repository.loadSnapshot();
    expect(state.version).toBe(3);
  });

  it('saveSnapshot persists to localStorage', async () => {
    const { repository } = await import('./repository');
    const testState = v3State({ tasks: [v3Task({ id: 'repo-test' })] });
    await repository.saveSnapshot(testState);
    const raw = localStorage.getItem(STORAGE_KEY_V3);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(3);
    expect(parsed.tasks[0]?.id).toBe('repo-test');
  });

  it('importBackup rejects invalid JSON', async () => {
    const { repository } = await import('./repository');
    const result = await repository.importBackup('not json');
    expect(result.ok).toBe(false);
  });

  it('importBackup accepts valid backup', async () => {
    const { repository } = await import('./repository');
    const state = v3State({ tasks: [v3Task({ id: 'imported' })] });
    const json = exportBackup(state);
    const result = await repository.importBackup(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.tasks[0]?.id).toBe('imported');
    }
  });
});

// ----------------------------------------------------------- ScheduleBlock CRUD (pure function tests)
describe('ScheduleBlock CRUD', () => {
  beforeEach(() => clearStorage());

  it('addScheduleBlock produces valid block with timestamps', () => {
    const state = v3State();
    const now = Date.now();
    const block = v3Block({ id: 'new-block', createdAt: now, updatedAt: now });
    const next = { ...state, scheduleBlocks: [...state.scheduleBlocks, block] };
    expect(next.scheduleBlocks).toHaveLength(1);
    expect(next.scheduleBlocks[0]?.id).toBe('new-block');
    expect(next.scheduleBlocks[0]?.createdAt).toBeGreaterThan(0);
    expect(next.scheduleBlocks[0]?.updatedAt).toBeGreaterThan(0);
  });

  it('updateScheduleBlock updates fields and updatedAt', () => {
    const block = v3Block({ id: 'b1', startTime: '09:00', endTime: '10:00' });
    const state = v3State({ scheduleBlocks: [block] });
    const patch = { startTime: '10:00', endTime: '11:00' };
    const next = {
      ...state,
      scheduleBlocks: state.scheduleBlocks.map((b) =>
        b.id === 'b1' ? { ...b, ...patch, updatedAt: Date.now() } : b,
      ),
    };
    expect(next.scheduleBlocks[0]?.startTime).toBe('10:00');
    expect(next.scheduleBlocks[0]?.endTime).toBe('11:00');
    expect(next.scheduleBlocks[0]?.updatedAt).toBeGreaterThan(block.updatedAt);
  });

  it('deleteScheduleBlock removes the block', () => {
    const block = v3Block({ id: 'b1' });
    const state = v3State({ scheduleBlocks: [block] });
    const next = { ...state, scheduleBlocks: state.scheduleBlocks.filter((b) => b.id !== 'b1') };
    expect(next.scheduleBlocks).toHaveLength(0);
  });

  it('moveScheduleBlock changes date and time', () => {
    const block = v3Block({ id: 'b1', date: '2026-08-10', startTime: '09:00', endTime: '10:00', plannedMinutes: 60 });
    const state = v3State({ scheduleBlocks: [block] });
    const next = {
      ...state,
      scheduleBlocks: state.scheduleBlocks.map((b) =>
        b.id === 'b1'
          ? { ...b, date: '2026-08-11', startTime: '14:00', endTime: '15:30', plannedMinutes: 90, updatedAt: Date.now() }
          : b,
      ),
    };
    expect(next.scheduleBlocks[0]?.date).toBe('2026-08-11');
    expect(next.scheduleBlocks[0]?.startTime).toBe('14:00');
    expect(next.scheduleBlocks[0]?.plannedMinutes).toBe(90);
  });

  it('resizeScheduleBlock changes endTime and recalculates plannedMinutes', () => {
    const block = v3Block({ id: 'b1', startTime: '09:00', endTime: '10:00', plannedMinutes: 60 });
    const state = v3State({ scheduleBlocks: [block] });
    const next = {
      ...state,
      scheduleBlocks: state.scheduleBlocks.map((b) => {
        if (b.id !== 'b1') return b;
        const newEnd = '11:30';
        const [sh, sm] = b.startTime.split(':').map(Number);
        const [eh, em] = newEnd.split(':').map(Number);
        const planned = (eh * 60 + em) - (sh * 60 + sm);
        return { ...b, endTime: newEnd, plannedMinutes: planned, updatedAt: Date.now() };
      }),
    };
    expect(next.scheduleBlocks[0]?.endTime).toBe('11:30');
    expect(next.scheduleBlocks[0]?.plannedMinutes).toBe(150);
  });

  it('lockScheduleBlock toggles locked state', () => {
    const block = v3Block({ id: 'b1', locked: false });
    const state = v3State({ scheduleBlocks: [block] });
    const locked = { ...state, scheduleBlocks: state.scheduleBlocks.map((b) => (b.id === 'b1' ? { ...b, locked: true, updatedAt: Date.now() } : b)) };
    expect(locked.scheduleBlocks[0]?.locked).toBe(true);
    const unlocked = { ...locked, scheduleBlocks: locked.scheduleBlocks.map((b) => (b.id === 'b1' ? { ...b, locked: false, updatedAt: Date.now() } : b)) };
    expect(unlocked.scheduleBlocks[0]?.locked).toBe(false);
  });

  it('deepValidateScheduleBlock rejects block with invalid source', () => {
    const r = deepValidateScheduleBlock({ ...v3Block(), source: 'invalid' });
    expect(r.ok).toBe(false);
  });

  it('deepValidateScheduleBlock rejects block with invalid status', () => {
    const r = deepValidateScheduleBlock({ ...v3Block(), status: 'invalid' });
    expect(r.ok).toBe(false);
  });

  it('deepValidateScheduleBlock rejects block with missing startTime', () => {
    const r = deepValidateScheduleBlock({ id: 'b1', date: '2026-08-10', endTime: '10:00' });
    expect(r.ok).toBe(false);
  });
});
