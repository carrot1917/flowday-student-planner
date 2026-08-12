import type { AppState, Course, ScheduleBlock, Settings, Subtask, Task, Tag, Weekday, WeeklyAvailability } from '@/types';
import { TAG_LABELS, TAG_HEX, emptyAvailability } from '@/types';
import { todayISO, toISO, addDays, hhmmToMinutes } from './date';
import { normalizeAvailability, sanitizeScheduleBlocks } from './domain';

// ----- Storage keys -----
// v1 = original legacy schema. Kept as a local backup and NEVER overwritten
//     or deleted by the migration step.
// v2 = previous versioned schema.
// v3 = current versioned schema. The only file we read/write going forward.
export const STORAGE_KEY_V1 = 'flowday.state.v1';
export const STORAGE_KEY_V2 = 'flowday.state.v2';
export const STORAGE_KEY_V3 = 'flowday.state.v3';
// One-shot snapshot of a corrupt v2/v3 payload. Written at most once so the user's
// original bytes survive even after they start editing again (which legitimately
// rewrites v3). Never read by the app — purely a rescue copy.
export const STORAGE_KEY_V3_CORRUPT = 'flowday.state.v3.corrupt';
export const STORAGE_VERSION = 3;

export interface LegacyTaskV1 {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  startTime?: string;
  endTime?: string;
  tag?: Tag;
  priority?: Task['priority'];
  status?: Task['status'];
  createdAt?: number;
  completedAt?: number | null;
  subtasks?: Subtask[];
  estimatedMinutes?: number;
}

export interface V2Task extends LegacyTaskV1 {
  courseId?: string;
  updatedAt?: number;
}

export interface V2ScheduleBlock {
  id: string;
  taskId?: string;
  date: string;
  startTime: string;
  endTime: string;
  plannedMinutes: number;
}

export interface V2Settings {
  notificationsEnabled?: boolean;
  reminderTime?: number;
  dueReminder?: boolean;
  startOfWeek?: 0 | 1;
}

export interface V2AppState {
  version: 2;
  hasSeededDemo?: boolean;
  courses: Course[];
  tasks: V2Task[];
  scheduleBlocks: V2ScheduleBlock[];
  availability: WeeklyAvailability;
  settings: V2Settings;
}

const DEFAULT_SETTINGS: Settings = {
  notificationsEnabled: false,
  reminderTime: 8 * 60, // 08:00
  dueReminder: true,
  startOfWeek: 1, // Monday
  timezone: Intl.DateTimeFormat?.().resolvedOptions?.()?.timeZone ?? 'UTC',
  dailyStudyLimitMinutes: 480,
  minBlockMinutes: 25,
  maxBlockMinutes: 120,
  breakMinutes: 5,
};

const TAG_ORDER: Tag[] = ['math', 'english', 'coding', 'reading', 'other'];

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function createSubtask(title: string): Subtask {
  return { id: uid(), title, done: false };
}

export function createTask(partial: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: uid(),
    title: '',
    description: '',
    dueDate: todayISO(),
    priority: 'medium',
    status: 'todo',
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    subtasks: [],
    estimatedMinutes: undefined,
    ...partial,
  };
}

// Deep runtime validators — every layer that reads from localStorage must pass
// through these. TypeScript `as` casts are never enough.

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function parseIntOrUndefined(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v > 0) return v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return undefined;
}

export function deepValidateTask(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['Task 不是对象'] };
  if (!isString(raw.id)) errors.push('Task.id 缺失或非字符串');
  if (!isString(raw.title)) errors.push('Task.title 缺失或非字符串');
  if (raw.description !== undefined && !isString(raw.description)) errors.push('Task.description 类型错误');
  if (raw.dueDate !== undefined && raw.dueDate !== null && !isString(raw.dueDate)) errors.push('Task.dueDate 类型错误');
  if (raw.priority !== undefined && !['high', 'medium', 'low'].includes(raw.priority as string)) errors.push('Task.priority 无效');
  if (raw.status !== undefined && !['todo', 'doing', 'done'].includes(raw.status as string)) errors.push('Task.status 无效');
  if (raw.estimatedMinutes !== undefined && raw.estimatedMinutes !== null) {
    const v = parseIntOrUndefined(raw.estimatedMinutes);
    if (v === undefined) errors.push('Task.estimatedMinutes 无效');
  }
  if (!isString(raw.description)) errors.push('Task.description is required');
  if (!['high', 'medium', 'low'].includes(raw.priority as string)) errors.push('Task.priority is required');
  if (!['todo', 'doing', 'done'].includes(raw.status as string)) errors.push('Task.status is required');
  if (!isNumber(raw.createdAt)) errors.push('Task.createdAt is required');
  if (!isNumber(raw.updatedAt)) errors.push('Task.updatedAt is required');
  if (!Array.isArray(raw.subtasks)) errors.push('Task.subtasks is required');
  return { ok: errors.length === 0, errors };
}

export function deepValidateScheduleBlock(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['ScheduleBlock 不是对象'] };
  if (!isString(raw.id)) errors.push('ScheduleBlock.id 缺失或非字符串');
  if (!isString(raw.date)) errors.push('ScheduleBlock.date 缺失或非字符串');
  if (!isString(raw.startTime)) errors.push('ScheduleBlock.startTime 缺失或非字符串');
  if (!isString(raw.endTime)) errors.push('ScheduleBlock.endTime 缺失或非字符串');
  if (raw.taskId !== undefined && raw.taskId !== null && !isString(raw.taskId)) errors.push('ScheduleBlock.taskId 类型错误');
  if (raw.source !== undefined && !['manual', 'scheduler', 'external'].includes(raw.source as string)) errors.push('ScheduleBlock.source 无效');
  if (raw.locked !== undefined && !isBoolean(raw.locked)) errors.push('ScheduleBlock.locked 类型错误');
  if (raw.status !== undefined && !['planned', 'done', 'skipped'].includes(raw.status as string)) errors.push('ScheduleBlock.status 无效');
  if (!isNumber(raw.plannedMinutes)) errors.push('ScheduleBlock.plannedMinutes is required');
  if (raw.source === undefined) errors.push('ScheduleBlock.source is required');
  if (raw.locked === undefined) errors.push('ScheduleBlock.locked is required');
  if (raw.status === undefined) errors.push('ScheduleBlock.status is required');
  if (!isNumber(raw.createdAt)) errors.push('ScheduleBlock.createdAt is required');
  if (!isNumber(raw.updatedAt)) errors.push('ScheduleBlock.updatedAt is required');
  return { ok: errors.length === 0, errors };
}

export function deepValidateSettings(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['Settings 不是对象'] };
  if (raw.notificationsEnabled !== undefined && !isBoolean(raw.notificationsEnabled)) errors.push('Settings.notificationsEnabled 类型错误');
  if (raw.reminderTime !== undefined && !isNumber(raw.reminderTime)) errors.push('Settings.reminderTime 类型错误');
  if (raw.dueReminder !== undefined && !isBoolean(raw.dueReminder)) errors.push('Settings.dueReminder 类型错误');
  if (raw.startOfWeek !== undefined && ![0, 1].includes(raw.startOfWeek as number)) errors.push('Settings.startOfWeek 无效');
  if (raw.timezone !== undefined && !isString(raw.timezone)) errors.push('Settings.timezone 类型错误');
  if (raw.dailyStudyLimitMinutes !== undefined && !isNumber(raw.dailyStudyLimitMinutes)) errors.push('Settings.dailyStudyLimitMinutes 类型错误');
  if (raw.minBlockMinutes !== undefined && !isNumber(raw.minBlockMinutes)) errors.push('Settings.minBlockMinutes 类型错误');
  if (raw.maxBlockMinutes !== undefined && !isNumber(raw.maxBlockMinutes)) errors.push('Settings.maxBlockMinutes 类型错误');
  if (raw.breakMinutes !== undefined && !isNumber(raw.breakMinutes)) errors.push('Settings.breakMinutes 类型错误');
  if (!isBoolean(raw.notificationsEnabled)) errors.push('Settings.notificationsEnabled is required');
  if (!isNumber(raw.reminderTime)) errors.push('Settings.reminderTime is required');
  if (!isBoolean(raw.dueReminder)) errors.push('Settings.dueReminder is required');
  if (![0, 1].includes(raw.startOfWeek as number)) errors.push('Settings.startOfWeek is required');
  if (!isString(raw.timezone)) errors.push('Settings.timezone is required');
  if (!isNumber(raw.dailyStudyLimitMinutes)) errors.push('Settings.dailyStudyLimitMinutes is required');
  if (!isNumber(raw.minBlockMinutes)) errors.push('Settings.minBlockMinutes is required');
  if (!isNumber(raw.maxBlockMinutes)) errors.push('Settings.maxBlockMinutes is required');
  if (!isNumber(raw.breakMinutes)) errors.push('Settings.breakMinutes is required');
  return { ok: errors.length === 0, errors };
}

export function deepValidateState(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (isObject(raw) && !isBoolean(raw.hasSeededDemo)) errors.push('AppState.hasSeededDemo is required');
  if (!isObject(raw)) return { ok: false, errors: ['AppState 不是对象'] };
  if (raw.version !== 3) errors.push(`AppState.version 不是 3（实际=${raw.version}）`);
  if (raw.hasSeededDemo !== undefined && !isBoolean(raw.hasSeededDemo)) errors.push('AppState.hasSeededDemo 类型错误');
  if (!Array.isArray(raw.tasks)) errors.push('AppState.tasks 缺失或非数组');
  else for (const t of raw.tasks) errors.push(...deepValidateTask(t).errors);
  if (!Array.isArray(raw.courses)) errors.push('AppState.courses 缺失或非数组');
  if (!Array.isArray(raw.scheduleBlocks)) errors.push('AppState.scheduleBlocks 缺失或非数组');
  else for (const b of raw.scheduleBlocks) errors.push(...deepValidateScheduleBlock(b).errors);
  if (!isObject(raw.availability)) errors.push('AppState.availability 缺失或非对象');
  if (!isObject(raw.settings)) errors.push('AppState.settings 缺失或非对象');
  else errors.push(...deepValidateSettings(raw.settings).errors);
  return { ok: errors.length === 0, errors };
}

// ---------- Load / migrate ----------

export interface LoadResult {
  state: AppState;
  dirty: boolean;
}

export interface MigrationReport {
  migrationApplied: boolean;
  fromVersion?: number;
  invalidRecords: { taskIds: string[]; blockIds: string[] };
}

function tryParse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidV3(v: unknown): v is AppState {
  return deepValidateState(v).ok;
}

function isValidV2(v: unknown): v is V2AppState {
  if (!isPlainObject(v)) return false;
  if (v.version !== 2) return false;
  return (
    Array.isArray(v.tasks) &&
    Array.isArray(v.courses) &&
    Array.isArray(v.scheduleBlocks) &&
    isPlainObject(v.availability) &&
    isPlainObject(v.settings)
  );
}

function isValidV1(v: unknown): v is { tasks?: unknown; settings?: unknown } {
  if (!isPlainObject(v)) return false;
  return Array.isArray(v.tasks);
}

function normalizeV3(v: AppState): AppState {
  const a = (v.availability ?? emptyAvailability()) as Partial<WeeklyAvailability>;
  const weekdays: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const availability = { ...emptyAvailability() };
  for (const day of weekdays) {
    availability[day] = Array.isArray(a[day]) ? a[day] : [];
  }
  return {
    version: 3,
    hasSeededDemo: v.hasSeededDemo ?? true,
    courses: Array.isArray(v.courses) ? (v.courses as Course[]) : [],
    tasks: Array.isArray(v.tasks) ? (v.tasks as Task[]) : [],
    scheduleBlocks: Array.isArray(v.scheduleBlocks) ? (v.scheduleBlocks as ScheduleBlock[]) : [],
    availability,
    settings: { ...DEFAULT_SETTINGS, ...(v.settings ?? {}) },
  };
}

function emptyState(): AppState {
  return {
    version: 3,
    hasSeededDemo: true,
    courses: [],
    tasks: [],
    scheduleBlocks: [],
    availability: emptyAvailability(),
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * Migrate a v2 state into the v3 schema.
 *
 * What changes:
 *  - Task: remove startTime, endTime, tag fields; add updatedAt
 *  - ScheduleBlock: add source, locked, status, createdAt, updatedAt; make taskId optional
 *  - Settings: add timezone, dailyStudyLimitMinutes, minBlockMinutes, maxBlockMinutes, breakMinutes
 *
 * If a v2 Task has startTime/endTime and they don't already have a corresponding
 * ScheduleBlock, migrate them into one (idempotent via deterministic block ID).
 */
export function migrateV2ToV3(v2: V2AppState): { state: AppState; report: MigrationReport } {
  const now = Date.now();
  const existingBlockIds = new Set(v2.scheduleBlocks.map((b) => b.id));
  const migratedBlocks: ScheduleBlock[] = v2.scheduleBlocks.map((b) => ({
    ...b,
    source: 'manual',
    locked: false,
    status: 'planned',
    createdAt: now,
    updatedAt: now,
  }));

  // Collect legacy Task startTime/endTime that haven't been migrated yet
  const newBlocks: ScheduleBlock[] = [];
  for (const t of v2.tasks) {
    if (t.startTime && t.endTime && t.dueDate) {
      const blockId = `sb:v2migrate:${t.id}:${t.dueDate}:${t.startTime}`;
      if (!existingBlockIds.has(blockId) && !migratedBlocks.some((b) => b.id === blockId)) {
        const start = hhmmToMinutes(t.startTime);
        const end = hhmmToMinutes(t.endTime);
        if (end > start) {
          newBlocks.push({
            id: blockId,
            taskId: t.id,
            date: t.dueDate,
            startTime: t.startTime,
            endTime: t.endTime,
            plannedMinutes: end - start,
            source: 'manual' as const,
            locked: false,
            status: 'planned' as const,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }
  }

  const tasks: Task[] = v2.tasks.map((t) => {
    return {
      id: t.id,
      title: t.title,
      description: t.description ?? '',
      courseId: t.courseId,
      priority: t.priority ?? 'medium',
      status: t.status ?? 'todo',
      dueDate: t.dueDate,
      estimatedMinutes: t.estimatedMinutes,
      createdAt: t.createdAt ?? now,
      updatedAt: t.updatedAt ?? now,
      completedAt: t.completedAt,
      subtasks: t.subtasks ?? [],
    };
  });

  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...v2.settings,
  };

  const state: AppState = {
    version: 3,
    hasSeededDemo: v2.hasSeededDemo ?? true,
    courses: v2.courses,
    tasks,
    scheduleBlocks: [...migratedBlocks, ...newBlocks],
    availability: v2.availability,
    settings,
  };

  return { state, report: { migrationApplied: true, fromVersion: 2, invalidRecords: { taskIds: [], blockIds: [] } } };
}

/**
 * Migrate a legacy v1 state into the v2 schema, then v2→v3.
 */
export function migrateV1ToV2(v1: { tasks?: unknown; settings?: unknown }): AppState {
  const rawTasks = Array.isArray(v1.tasks) ? (v1.tasks as LegacyTaskV1[]) : [];
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...(isPlainObject(v1.settings) ? (v1.settings as Partial<Settings>) : {}),
  };

  const present = new Set<Tag>();
  for (const t of rawTasks) if (t.tag) present.add(t.tag);

  const courses: Course[] = [];
  const tagToCourseId = new Map<Tag, string>();
  for (const tag of TAG_ORDER) {
    if (!present.has(tag)) continue;
    const id = `course:${tag}`;
    tagToCourseId.set(tag, id);
    courses.push({ id, name: TAG_LABELS[tag], color: TAG_HEX[tag], createdAt: 0 });
  }

  const scheduleBlocks: ScheduleBlock[] = [];
  const now = Date.now();
  const tasks: Task[] = rawTasks.map((t) => {
    const courseId = t.tag ? tagToCourseId.get(t.tag) : undefined;

    if (t.startTime && t.endTime && t.dueDate) {
      const start = hhmmToMinutes(t.startTime);
      const end = hhmmToMinutes(t.endTime);
      if (end > start) {
        scheduleBlocks.push({
          id: `sb:${t.id}:${t.dueDate}:${t.startTime}`,
          taskId: t.id,
          date: t.dueDate,
          startTime: t.startTime,
          endTime: t.endTime,
          plannedMinutes: end - start,
          source: 'manual' as const,
          locked: false,
          status: 'planned' as const,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return {
      id: t.id,
      title: t.title,
      description: t.description ?? '',
      courseId,
      priority: t.priority ?? 'medium',
      status: t.status ?? 'todo',
      dueDate: t.dueDate,
      estimatedMinutes: t.estimatedMinutes,
      createdAt: t.createdAt ?? now,
      updatedAt: now,
      completedAt: t.completedAt ?? null,
      subtasks: t.subtasks ?? [],
    };
  });

  return {
    version: 3,
    hasSeededDemo: true,
    courses,
    tasks,
    scheduleBlocks,
    availability: emptyAvailability(),
    settings,
  };
}

export function loadState(): LoadResult {
  // Try v3 first
  const v3Raw = localStorage.getItem(STORAGE_KEY_V3);
  if (v3Raw !== null) {
    const parsed = tryParse(v3Raw);
    if (parsed !== null && parsed !== undefined && isValidV3(parsed)) {
      return { state: hydrateState(normalizeV3(parsed)), dirty: false };
    }
    // v3 corrupt: backup
    try {
      if (localStorage.getItem(STORAGE_KEY_V3_CORRUPT) === null) {
        localStorage.setItem(STORAGE_KEY_V3_CORRUPT, v3Raw);
      }
    } catch { /* ignore */ }
    console.warn(
      '[FlowDay] 检测到 flowday.state.v3 数据已损坏。已保留原始内容，未自动覆盖。' +
        '应用以空状态安全启动，请检查数据或重新导入备份。',
    );
    return { state: emptyState(), dirty: false };
  }

  // Try v2 → migrate to v3
  const v2Raw = localStorage.getItem(STORAGE_KEY_V2);
  if (v2Raw !== null) {
    const parsed = tryParse(v2Raw);
    if (parsed !== null && parsed !== undefined && isValidV2(parsed)) {
      const { state: migrated } = migrateV2ToV3(parsed);
      // Write v3, keep v2 as rollback backup
      try {
        localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(migrated));
      } catch { /* ignore */ }
      return { state: hydrateState(migrated), dirty: false };
    }
    // v2 corrupt: still an existing user → no demo
    console.warn('[FlowDay] 检测到 flowday.state.v2 数据已损坏。未生成 Demo。');
    return { state: emptyState(), dirty: false };
  }

  // Try v1 → migrate to v3
  const v1Raw = localStorage.getItem(STORAGE_KEY_V1);
  if (v1Raw !== null) {
    const parsed = tryParse(v1Raw);
    if (parsed !== null && parsed !== undefined && isValidV1(parsed)) {
      const migrated = migrateV1ToV2(parsed);
      try {
        localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(migrated));
      } catch { /* ignore */ }
      return { state: hydrateState(migrated), dirty: false };
    }
    console.warn('[FlowDay] 检测到 flowday.state.v1 数据已损坏。未生成 Demo。');
    return { state: emptyState(), dirty: false };
  }

  // Neither exists → genuine first use → seed demo
  return { state: hydrateState(seedDemoState()), dirty: true };
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(state));
  } catch {
    // storage may be full or unavailable; fail silently
  }
}

export function createPersistGate(initial: LoadResult): (next: AppState) => boolean {
  let lastPersisted: AppState | null = initial.dirty ? null : initial.state;
  return (next: AppState): boolean => {
    if (lastPersisted === next) return false;
    lastPersisted = next;
    return true;
  };
}

// ----------------------------------------------------------------- Data pipeline

export function hydrateState(state: AppState): AppState {
  const weekdays: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const availability = { ...state.availability };
  for (const day of weekdays) {
    availability[day] = normalizeAvailability(availability[day] ?? []);
  }
  return {
    ...state,
    scheduleBlocks: sanitizeScheduleBlocks(state.tasks, state.scheduleBlocks),
    availability,
  };
}

// ----------------------------------------------------------- Backup / Restore

export const BACKUP_APP_NAME = 'flowday';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupData {
  tasks: Task[];
  scheduleBlocks: ScheduleBlock[];
  availability: WeeklyAvailability;
  courses: Course[];
  settings: Settings;
}

export interface BackupEnvelope {
  app: string;
  formatVersion: number;
  exportedAt: string;
  data: BackupData;
}

export function exportBackup(state: AppState): string {
  const envelope: BackupEnvelope = {
    app: BACKUP_APP_NAME,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      tasks: state.tasks,
      scheduleBlocks: state.scheduleBlocks,
      availability: state.availability,
      courses: state.courses,
      settings: state.settings,
    },
  };
  return JSON.stringify(envelope, null, 2);
}

export type BackupResult =
  | { ok: true; state: AppState }
  | { ok: false; message: string };

export function validateBackup(json: string): BackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, message: '无法解析备份文件：JSON 格式无效' };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, message: '备份文件格式无效：根节点不是对象' };
  }

  const env = parsed as Record<string, unknown>;

  if (env.app !== BACKUP_APP_NAME) {
    return { ok: false, message: `不是 FlowDay 备份文件（app="${env.app}"）` };
  }

  if (typeof env.formatVersion !== 'number' || env.formatVersion !== BACKUP_FORMAT_VERSION) {
    return { ok: false, message: `不支持的备份版本（formatVersion=${env.formatVersion}），仅支持版本 ${BACKUP_FORMAT_VERSION}` };
  }

  if (!isPlainObject(env.data)) {
    return { ok: false, message: '备份文件缺少 data 字段' };
  }

  const data = env.data as Record<string, unknown>;

  const requiredFields: [string, string][] = [
    ['tasks', 'array'],
    ['scheduleBlocks', 'array'],
    ['availability', 'object'],
    ['courses', 'array'],
    ['settings', 'object'],
  ];

  for (const [field, type] of requiredFields) {
    if (!(field in data)) {
      return { ok: false, message: `备份文件缺少「${field}」字段` };
    }
    const val = data[field];
    if (type === 'array' && !Array.isArray(val)) {
      return { ok: false, message: `备份文件「${field}」字段类型错误，期望数组` };
    }
    if (type === 'object' && !isPlainObject(val)) {
      return { ok: false, message: `备份文件「${field}」字段类型错误，期望对象` };
    }
  }

  const availability = { ...emptyAvailability() };
  const availRaw = data.availability as Partial<WeeklyAvailability>;
  const weekdays: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (const day of weekdays) {
    availability[day] = Array.isArray(availRaw[day]) ? availRaw[day] : [];
  }

  const state: AppState = {
    version: 3,
    hasSeededDemo: true,
    courses: Array.isArray(data.courses) ? (data.courses as Course[]) : [],
    tasks: Array.isArray(data.tasks) ? (data.tasks as Task[]) : [],
    scheduleBlocks: Array.isArray(data.scheduleBlocks) ? (data.scheduleBlocks as ScheduleBlock[]) : [],
    availability,
    settings: { ...DEFAULT_SETTINGS, ...(isPlainObject(data.settings) ? (data.settings as Partial<Settings>) : {}) },
  };

  const hydrated = hydrateState(state);

  return { ok: true, state: hydrated };
}

// ---------- Demo seed ----------

export function seedDemoState(): AppState {
  const now = Date.now();
  const courses: Course[] = TAG_ORDER.map((tag) => ({
    id: `course:${tag}`,
    name: TAG_LABELS[tag],
    color: TAG_HEX[tag],
    createdAt: now,
  }));

  const today = new Date();
  const iso = (d: Date): string => toISO(d);
  const daysFromNow = (n: number): string => iso(addDays(today, n));

  const scheduleBlocks: ScheduleBlock[] = [];

  const mk = (
    title: string,
    description: string,
    dueDate: string,
    priority: Task['priority'],
    tag: Tag,
    status: Task['status'],
    estimatedMinutes: number,
    opts: { startTime?: string; endTime?: string; subtasks?: string[]; completedAt?: number } = {},
  ): Task => {
    const id = uid();
    if (opts.startTime && opts.endTime) {
      const start = hhmmToMinutes(opts.startTime);
      const end = hhmmToMinutes(opts.endTime);
      if (end > start) {
        scheduleBlocks.push({
          id: `sb:${id}:${dueDate}:${opts.startTime}`,
          taskId: id,
          date: dueDate,
          startTime: opts.startTime,
          endTime: opts.endTime,
          plannedMinutes: end - start,
          source: 'manual' as const,
          locked: false,
          status: 'planned' as const,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return {
      id,
      title,
      description,
      dueDate,
      priority,
      status,
      courseId: `course:${tag}`,
      createdAt: now,
      updatedAt: now,
      completedAt: opts.completedAt ?? null,
      subtasks: (opts.subtasks ?? []).map(createSubtask),
      estimatedMinutes,
    };
  };

  const tasks: Task[] = [
    mk('数学复习 — 函数与导数', '复习课本第3章，整理公式卡片', iso(today), 'high', 'math', 'doing', 90, {
      startTime: '08:00',
      endTime: '09:30',
      subtasks: ['复习公式', '完成练习题', '整理错题'],
    }),
    mk('英语背单词 (Unit 7)', '背诵 40 个新单词并复习昨日单词', iso(today), 'medium', 'english', 'todo', 60, {
      startTime: '10:00',
      endTime: '11:00',
    }),
    mk('完成编程作业', '实现链表反转并提交到课程平台', daysFromNow(1), 'high', 'coding', 'todo', 120, {
      startTime: '14:00',
      endTime: '16:00',
    }),
    mk('阅读《深度工作》第2章', '', daysFromNow(2), 'low', 'reading', 'todo', 60),
    mk('整理本周错题本', '', daysFromNow(-1), 'medium', 'other', 'done', 45, {
      completedAt: now - 86400000,
    }),
  ];

  return {
    version: 3,
    hasSeededDemo: true,
    courses,
    tasks,
    scheduleBlocks,
    availability: emptyAvailability(),
    settings: { ...DEFAULT_SETTINGS },
  };
}
