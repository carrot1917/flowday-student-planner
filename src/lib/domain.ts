// Phase 2 domain layer.
//
// Pure, framework-free rules for Courses and the Task fields introduced in
// Phase 1 (`courseId`, `estimatedMinutes`). The store is a thin wrapper around
// these functions so every rule stays unit-testable without React.

import type { AppState, AvailabilitySlot, Course, Tag, Task, Weekday } from '@/types';
import { TAG_LABELS, UNCATEGORIZED_COLOR, UNCATEGORIZED_LABEL, COURSE_PALETTE } from '@/types';
import { minutesToHHMM, safeFromISO } from './date';
import { uid } from './storage';

// ---------------------------------------------------------------- Course name

export const COURSE_NAME_MAX = 24;

export type CourseNameError = 'empty' | 'too-long' | 'duplicate';

export type CourseNameResult =
  | { ok: true; name: string }
  | { ok: false; error: CourseNameError; message: string };

/** Collapse inner whitespace and trim. '  高等  数学 ' -> '高等 数学'. */
export function normalizeCourseName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function nameKey(raw: string): string {
  return normalizeCourseName(raw).toLowerCase();
}

/**
 * Validate a course name against the existing list.
 * `selfId` excludes the course being renamed from the duplicate check.
 */
export function validateCourseName(
  raw: string,
  courses: Course[],
  selfId?: string,
): CourseNameResult {
  const name = normalizeCourseName(raw);
  if (!name) return { ok: false, error: 'empty', message: '课程名称不能为空' };
  if (name.length > COURSE_NAME_MAX) {
    return { ok: false, error: 'too-long', message: `课程名称最多 ${COURSE_NAME_MAX} 个字符` };
  }
  const key = nameKey(name);
  const clash = courses.some((c) => c.id !== selfId && nameKey(c.name) === key);
  if (clash) return { ok: false, error: 'duplicate', message: '已存在同名课程' };
  return { ok: true, name };
}

// ---------------------------------------------------------------- Course color

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeCourseColor(raw: string | undefined): string {
  return raw && HEX_RE.test(raw) ? raw : COURSE_PALETTE[0];
}

export function createCourse(name: string, color: string): Course {
  return {
    id: `course:${uid()}`,
    name: normalizeCourseName(name),
    color: normalizeCourseColor(color),
    createdAt: Date.now(),
  };
}

/** Next unused palette color, so consecutive courses look different by default. */
export function suggestCourseColor(courses: Course[]): string {
  const used = new Set(courses.map((c) => c.color));
  return COURSE_PALETTE.find((c) => !used.has(c)) ?? COURSE_PALETTE[courses.length % COURSE_PALETTE.length];
}

// ---------------------------------------------------------------- Lookup

export function courseMap(courses: Course[]): Map<string, Course> {
  return new Map(courses.map((c) => [c.id, c]));
}

/** Never throws: an unknown / dangling / missing id simply resolves to undefined. */
export function findCourse(courses: Course[], courseId: string | undefined | null): Course | undefined {
  if (!courseId) return undefined;
  return courses.find((c) => c.id === courseId);
}

/** Display name with the '未分类' fallback (no course, or course was deleted). */
export function courseLabel(courses: Course[], courseId: string | undefined | null): string {
  return findCourse(courses, courseId)?.name ?? UNCATEGORIZED_LABEL;
}

export function courseColor(courses: Course[], courseId: string | undefined | null): string {
  const c = findCourse(courses, courseId);
  return c ? normalizeCourseColor(c.color) : UNCATEGORIZED_COLOR;
}

export function tasksUsingCourse(tasks: Task[], courseId: string): Task[] {
  return tasks.filter((t) => t.courseId === courseId);
}

/** True when the task should render as '未分类' (unset OR dangling courseId). */
export function isUncategorized(courses: Course[], task: Task): boolean {
  return !findCourse(courses, task.courseId);
}

// ---------------------------------------------------------------- State moves

export function addCourseToState(state: AppState, course: Course): AppState {
  return { ...state, courses: [...state.courses, course] };
}

export function updateCourseInState(
  state: AppState,
  id: string,
  patch: Partial<Pick<Course, 'name' | 'color'>>,
): AppState {
  return {
    ...state,
    courses: state.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  };
}

/**
 * Delete a Course WITHOUT touching its tasks.
 *
 * Tasks are never cascade-deleted: they keep every other field and simply lose
 * their `courseId`, so the UI shows them as '未分类'.
 * ScheduleBlocks are untouched — they reference `taskId`, not `courseId`.
 * The legacy `tag` field is deliberately left alone (Phase 3 removes it).
 */
export function deleteCourseFromState(state: AppState, id: string): AppState {
  return {
    ...state,
    courses: state.courses.filter((c) => c.id !== id),
    tasks: state.tasks.map((t) => (t.courseId === id ? { ...t, courseId: undefined } : t)),
  };
}

// ---------------------------------------------------------- estimatedMinutes

export const ESTIMATED_MINUTES_MAX = 1440; // 24h
export const ESTIMATED_MINUTES_PRESETS = [30, 60, 90, 120];

export type EstimateResult =
  | { ok: true; value: number | undefined }
  | { ok: false; message: string };

/**
 * Parse the raw text of the estimate input.
 * Empty string is valid and means "no estimate" (undefined).
 */
export function parseEstimatedMinutes(raw: string): EstimateResult {
  const s = raw.trim();
  if (s === '') return { ok: true, value: undefined };
  if (!/^\d+$/.test(s)) return { ok: false, message: '请输入整数分钟数' };
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) return { ok: false, message: '预计时长必须大于 0' };
  if (n > ESTIMATED_MINUTES_MAX) return { ok: false, message: `预计时长不能超过 ${ESTIMATED_MINUTES_MAX} 分钟` };
  return { ok: true, value: n };
}

/**
 * Last line of defence before a value reaches the state: anything that is not a
 * positive integer <= 1440 becomes `undefined` (i.e. "no estimate"), so 0,
 * negatives, NaN, Infinity, floats and junk strings can never be stored.
 */
export function normalizeEstimatedMinutes(v: unknown): number | undefined {
  if (typeof v === 'string') {
    const r = parseEstimatedMinutes(v);
    return r.ok ? r.value : undefined;
  }
  if (typeof v !== 'number') return undefined;
  if (!Number.isFinite(v) || !Number.isInteger(v)) return undefined;
  if (v <= 0 || v > ESTIMATED_MINUTES_MAX) return undefined;
  return v;
}

export function formatEstimate(minutes: number | undefined): string {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

// -------------------------------------------------------- weekly availability
//
// Phase 4A. `WeeklyAvailability` answers "WHEN CAN the user study" — it is the
// input the Phase 4B scheduler turns into `ScheduleBlock[]` ("when the user
// WILL study"). Everything here is pure so the editor UI and the future
// scheduler share exactly the same rules.

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: '周一',
  tuesday: '周二',
  wednesday: '周三',
  thursday: '周四',
  friday: '周五',
  saturday: '周六',
  sunday: '周日',
};

/** Canonical Monday-first order; `weekdaysOrdered` rotates it for the user. */
const WEEK_FROM_MONDAY: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/** `startOfWeek` matches Settings: 0 = Sunday first, 1 = Monday first. */
export function weekdaysOrdered(startOfWeek: 0 | 1 = 1): Weekday[] {
  return startOfWeek === 0
    ? ['sunday', ...WEEK_FROM_MONDAY.slice(0, 6)]
    : [...WEEK_FROM_MONDAY];
}

/**
 * Map a calendar day (YYYY-MM-DD) onto its `Weekday` key, which is how the
 * scheduler looks up `WeeklyAvailability` for a concrete date.
 *
 * Strict: malformed / overflow dates return null so callers treat the day as
 * "no availability" instead of silently reading the wrong weekday.
 * Note this is independent of `Settings.startOfWeek` — that only affects
 * display order, never which weekday a date actually falls on.
 */
export function weekdayForISO(iso: string): Weekday | null {
  const d = safeFromISO(iso);
  if (!d) return null;
  // getDay(): 0 = Sunday .. 6 = Saturday → rotate onto the Monday-first array.
  return WEEK_FROM_MONDAY[(d.getDay() + 6) % 7];
}

const HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isValidHHMM(v: unknown): v is string {
  return typeof v === 'string' && HHMM_RE.test(v);
}

/** Minutes after midnight, or null when the string is not a strict HH:mm. */
export function parseHHMM(v: string): number | null {
  if (!isValidHHMM(v)) return null;
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
}

export interface SlotValidation {
  ok: boolean;
  message?: string;
}

/**
 * Phase 4A keeps validation deliberately light: format + ordering only.
 * Max slot length, daily totals and overlap detection belong to Phase 4C.
 */
export function validateAvailabilitySlot(startTime: string, endTime: string): SlotValidation {
  const start = parseHHMM(startTime);
  const end = parseHHMM(endTime);
  if (start === null) return { ok: false, message: '开始时间格式无效（需为 HH:mm）' };
  if (end === null) return { ok: false, message: '结束时间格式无效（需为 HH:mm）' };
  if (end <= start) return { ok: false, message: '结束时间必须晚于开始时间' };
  return { ok: true };
}

/** Length of one slot. An invalid slot contributes 0 — never NaN. */
export function slotMinutes(slot: AvailabilitySlot): number {
  const start = parseHHMM(slot.startTime);
  const end = parseHHMM(slot.endTime);
  if (start === null || end === null || end <= start) return 0;
  return end - start;
}

/** Total available minutes of one day. Missing / empty lists are safe. */
export function totalAvailableMinutes(slots: AvailabilitySlot[] | undefined): number {
  if (!slots?.length) return 0;
  return slots.reduce((sum, s) => sum + slotMinutes(s), 0);
}

// -------------------------------------------------------- ScheduleBlock integrity
//
// Phase 0: orphan ScheduleBlock cleanup. A block whose taskId points at a
// Task that no longer exists is an "orphan". These are silently removed during
// hydration so the scheduler, conflict detector and calendar never see them.

/**
 * Filter out ScheduleBlocks whose taskId does not match any existing Task.
 * Pure: returns a new array, never mutates inputs.
 */
export function sanitizeScheduleBlocks(
  tasks: Task[],
  blocks: ScheduleBlock[],
): ScheduleBlock[] {
  const active = new Set(tasks.map((t) => t.id));
  return blocks.filter((b) => active.has(b.taskId));
}

// -------------------------------------------------------- Availability normalization
//
// Phase 0: before scheduling (or at any write boundary), availability slots
// go through this pipeline so the scheduler and conflict detector see only
// clean, non-overlapping, sorted intervals.

/**
 * Normalize a day's availability slots:
 *  - reject invalid slots (malformed time, start >= end)
 *  - sort by startTime
 *  - merge overlapping AND adjacent (end === next start) intervals
 *  - deduplicate identical intervals
 *  - return a fresh, clean array
 */
export function normalizeAvailability(slots: AvailabilitySlot[]): AvailabilitySlot[] {
  // 1. Filter valid, parse to minutes for comparison
  type SlotMins = { start: number; end: number; startStr: string; endStr: string };
  const valid: SlotMins[] = [];
  for (const s of slots) {
    const start = parseHHMM(s.startTime);
    const end = parseHHMM(s.endTime);
    if (start === null || end === null || end <= start) continue;
    valid.push({ start, end, startStr: s.startTime, endStr: s.endTime });
  }

  // 2. Sort by start, then end
  valid.sort((a, b) => a.start - b.start || a.end - b.end);

  // 3. Merge overlapping and adjacent (end >= next start)
  const merged: SlotMins[] = [];
  for (const s of valid) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      // Overlap OR adjacent: extend the last interval if this one ends later
      if (s.end > last.end) {
        last.end = s.end;
        last.endStr = s.endStr;
      }
    } else {
      merged.push({ ...s });
    }
  }

  // 4. Convert back to HH:mm strings
  return merged.map((m) => ({
    startTime: minutesToHHMM(m.start),
    endTime: minutesToHHMM(m.end),
  }));
}

// -------------------------------------------------------- Week start helper

/**
 * Extract the numeric weekStartsOn from Settings.
 * 0 = Sunday, 1 = Monday.
 * Centralised so changing the Settings type never requires hunting for
 * scattered `settings.startOfWeek` accesses.
 */
export function getWeekStartsOn(settings: { startOfWeek: 0 | 1 }): 0 | 1 {
  return settings.startOfWeek;
}

// Phase 1 (v3) — Task.tag no longer exists in the schema.
// This shim is kept so migration code and tests can still map course names
// back to their legacy tag identifier (used only in v2→v3 conversion flow).
const NAME_TO_TAG: Record<string, Tag> = {
  '数学': 'math',
  '英语': 'english',
  '编程': 'coding',
  '阅读': 'reading',
  '其他': 'other',
};

export function legacyTagForCourseName(name: string | undefined): Tag {
  if (!name) return 'other';
  return NAME_TO_TAG[name] ?? 'other';
}
