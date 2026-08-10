import type { AppState, Course, ScheduleBlock, Settings, Subtask, Task, Tag, WeeklyAvailability } from '@/types';
import { TAG_LABELS, TAG_HEX, emptyAvailability } from '@/types';
import { todayISO, toISO, addDays, hhmmToMinutes } from './date';

// ----- Storage keys -----
// v1 = original legacy schema. Kept as a local backup and NEVER overwritten
//     or deleted by the migration step.
// v2 = current versioned schema. The only file we read/write going forward.
export const STORAGE_KEY_V1 = 'flowday.state.v1';
export const STORAGE_KEY_V2 = 'flowday.state.v2';
// One-shot snapshot of a corrupt v2 payload. Written at most once so the user's
// original bytes survive even after they start editing again (which legitimately
// rewrites v2). Never read by the app — purely a rescue copy.
export const STORAGE_KEY_V2_CORRUPT = 'flowday.state.v2.corrupt';
export const STORAGE_VERSION = 2;

const DEFAULT_SETTINGS: Settings = {
  notificationsEnabled: false,
  reminderTime: 8 * 60, // 08:00
  dueReminder: true,
  startOfWeek: 1, // Monday
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
    startTime: '',
    endTime: '',
    priority: 'medium',
    tag: 'other',
    courseId: undefined,
    status: 'todo',
    createdAt: now,
    completedAt: null,
    subtasks: [],
    estimatedMinutes: undefined,
    ...partial,
  };
}

// ---------- Load / migrate ----------

export interface LoadResult {
  state: AppState;
  // true => caller should persist this state (fresh demo, or just-migrated v1).
  // false => already on disk (valid v2, or a corrupt/empty case we must NOT overwrite).
  dirty: boolean;
}

function tryParse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined; // distinct from null (no data at all)
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidV2(v: unknown): v is AppState {
  if (!isPlainObject(v)) return false;
  if (v.version !== STORAGE_VERSION) return false;
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

function normalizeV2(v: AppState): AppState {
  const a = (v.availability ?? emptyAvailability()) as Partial<WeeklyAvailability>;
  return {
    version: STORAGE_VERSION,
    hasSeededDemo: v.hasSeededDemo ?? true,
    courses: Array.isArray(v.courses) ? (v.courses as Course[]) : [],
    tasks: Array.isArray(v.tasks) ? (v.tasks as Task[]) : [],
    scheduleBlocks: Array.isArray(v.scheduleBlocks) ? (v.scheduleBlocks as ScheduleBlock[]) : [],
    availability: {
      monday: a.monday ?? [],
      tuesday: a.tuesday ?? [],
      wednesday: a.wednesday ?? [],
      thursday: a.thursday ?? [],
      friday: a.friday ?? [],
      saturday: a.saturday ?? [],
      sunday: a.sunday ?? [],
    },
    settings: { ...DEFAULT_SETTINGS, ...(v.settings ?? {}) },
  };
}

function emptyState(): AppState {
  // Used for corrupt/unusable data. hasSeededDemo=true so we NEVER re-seed demo
  // over an existing (even if broken) user's data.
  return {
    version: STORAGE_VERSION,
    hasSeededDemo: true,
    courses: [],
    tasks: [],
    scheduleBlocks: [],
    availability: emptyAvailability(),
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * Migrate a legacy v1 state into the v2 schema.
 *
 * - Each distinct tag becomes exactly ONE stable Course (`course:<tag>`).
 * - A task's startTime+endTime (on its dueDate) becomes at most one
 *   deterministic ScheduleBlock. This is COMPAT migration only — it does NOT
 *   mean the deadline equals the study date; the legacy model simply could not
 *   distinguish the two, so we preserve the user's original time slot.
 * - dueDate is preserved untouched.
 * - estimatedMinutes stays undefined for legacy tasks (never guessed).
 * - IDs are derived (from tag / task id), so migration is idempotent.
 */
export function migrateV1ToV2(v1: { tasks?: unknown; settings?: unknown }): AppState {
  const rawTasks = Array.isArray(v1.tasks) ? (v1.tasks as Task[]) : [];
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...(isPlainObject(v1.settings) ? (v1.settings as Partial<Settings>) : {}),
  };

  const present = new Set<Tag>();
  for (const t of rawTasks) if (t && t.tag) present.add(t.tag as Tag);

  const courses: Course[] = [];
  const tagToCourseId = new Map<Tag, string>();
  for (const tag of TAG_ORDER) {
    if (!present.has(tag)) continue;
    const id = `course:${tag}`;
    tagToCourseId.set(tag, id);
    courses.push({ id, name: TAG_LABELS[tag], color: TAG_HEX[tag], createdAt: 0 });
  }

  const scheduleBlocks: ScheduleBlock[] = [];
  const tasks: Task[] = rawTasks.map((t) => {
    const task = t as Task;
    const courseId = task.tag ? tagToCourseId.get(task.tag as Tag) : undefined;

    if (task.startTime && task.endTime && task.dueDate) {
      const start = hhmmToMinutes(task.startTime);
      const end = hhmmToMinutes(task.endTime);
      if (end > start) {
        scheduleBlocks.push({
          id: `sb:${task.id}:${task.dueDate}:${task.startTime}`,
          taskId: task.id,
          date: task.dueDate,
          startTime: task.startTime,
          endTime: task.endTime,
          plannedMinutes: end - start,
        });
      }
    }

    return {
      ...task,
      courseId,
      estimatedMinutes: undefined,
    };
  });

  return {
    version: STORAGE_VERSION,
    hasSeededDemo: true,
    courses,
    tasks,
    scheduleBlocks,
    availability: emptyAvailability(),
    settings,
  };
}

export function loadState(): LoadResult {
  const v2Raw = localStorage.getItem(STORAGE_KEY_V2);
  if (v2Raw !== null) {
    const parsed = tryParse(v2Raw);
    if (parsed !== null && parsed !== undefined && isValidV2(parsed)) {
      return { state: normalizeV2(parsed), dirty: false };
    }
    // v2 exists but is corrupt: DO NOT overwrite. Keep the raw bytes, start
    // safely in-memory, and warn. (We never auto-fallback to v1 and re-overwrite.)
    try {
      if (localStorage.getItem(STORAGE_KEY_V2_CORRUPT) === null) {
        localStorage.setItem(STORAGE_KEY_V2_CORRUPT, v2Raw);
      }
    } catch {
      /* storage may be full or unavailable */
    }
    console.warn(
      '[FlowDay] 检测到 flowday.state.v2 数据已损坏。已保留原始内容，未自动覆盖。' +
        '应用以空状态安全启动，请检查数据或重新导入备份。',
    );
    return { state: emptyState(), dirty: false };
  }

  const v1Raw = localStorage.getItem(STORAGE_KEY_V1);
  if (v1Raw !== null) {
    const parsed = tryParse(v1Raw);
    if (parsed !== null && parsed !== undefined && isValidV1(parsed)) {
      const migrated = migrateV1ToV2(parsed);
      // Write v2, but NEVER touch / delete the original v1 (local backup).
      try {
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(migrated));
      } catch {
        /* storage may be full or unavailable */
      }
      return { state: migrated, dirty: false };
    }
    // v1 exists but corrupt: still an existing user → no demo.
    console.warn('[FlowDay] 检测到 flowday.state.v1 数据已损坏。未生成 Demo。');
    return { state: emptyState(), dirty: false };
  }

  // Neither exists → genuine first use → seed demo (caller persists it).
  return { state: seedDemoState(), dirty: true };
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(state));
  } catch {
    // storage may be full or unavailable; fail silently
  }
}

/**
 * Decides whether a given state object still needs to be written to disk.
 *
 * Why identity (===) and not a run counter: React StrictMode double-invokes
 * effects in dev, so a "first run" flag would let the SECOND invocation write
 * the boot state back — silently clobbering a corrupt v2 we promised to keep.
 * The state object reference only changes when the user actually mutates
 * something, so this gate:
 *   - skips the boot write when loadState said the data is already on disk,
 *   - performs exactly one write when loadState produced fresh data (demo seed),
 *   - lets EVERY later user edit through, unconditionally.
 */
export function createPersistGate(initial: LoadResult): (next: AppState) => boolean {
  // dirty === true  => boot state is not on disk yet => first call must write.
  let lastPersisted: AppState | null = initial.dirty ? null : initial.state;
  return (next: AppState): boolean => {
    if (lastPersisted === next) return false;
    lastPersisted = next;
    return true;
  };
}

// ---------- Demo seed ----------

export function seedDemoState(): AppState {
  const courses: Course[] = TAG_ORDER.map((tag) => ({
    id: `course:${tag}`,
    name: TAG_LABELS[tag],
    color: TAG_HEX[tag],
    createdAt: Date.now(),
  }));

  const today = new Date();
  const iso = (d: Date): string => toISO(d); // LOCAL date — avoids UTC off-by-one
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
        });
      }
    }
    return {
      id,
      title,
      description,
      dueDate,
      startTime: opts.startTime ?? '',
      endTime: opts.endTime ?? '',
      priority,
      tag,
      courseId: `course:${tag}`,
      status,
      createdAt: Date.now(),
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
      completedAt: Date.now() - 86400000,
    }),
  ];

  return {
    version: STORAGE_VERSION,
    hasSeededDemo: true,
    courses,
    tasks,
    scheduleBlocks,
    availability: emptyAvailability(),
    settings: { ...DEFAULT_SETTINGS },
  };
}
