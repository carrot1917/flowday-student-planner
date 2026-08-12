// Domain types for FlowDay. Kept framework-agnostic so the data layer
// can be reused if the project later migrates to React/Vue.

export type Priority = 'high' | 'medium' | 'low';
export type Status = 'todo' | 'doing' | 'done';

export type Tag = 'math' | 'english' | 'coding' | 'reading' | 'other';

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

// A real course the user studies. Replaces the old fixed `tag` categories.
export interface Course {
  id: string;
  name: string;
  color: string; // hex, e.g. '#3494fb' — Supabase / UI friendly
  createdAt: number;
}

// A concrete study session: WHEN the user plans to study a Task.
// Distinct from `dueDate` (the deadline) and from `Availability` (free time).
export interface ScheduleBlock {
  id: string;
  taskId?: string; // optional in v3 — blocks can be placeholder/unscheduled
  date: string; // YYYY-MM-DD — the day the study session happens
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  plannedMinutes: number;
  source: 'manual' | 'scheduler' | 'external';
  locked: boolean;
  status: 'planned' | 'done' | 'skipped';
  createdAt: number;
  updatedAt: number;
}

// One free-study interval on a given weekday.
export interface AvailabilitySlot {
  startTime: string; // HH:mm
  endTime: string; // HH:mm
}

export type WeeklyAvailability = Record<Weekday, AvailabilitySlot[]>;

export interface Task {
  id: string;
  title: string;
  description: string;
  courseId?: string; // links to Course
  priority: Priority;
  status: Status;
  dueDate?: string; // ISO date (YYYY-MM-DD) — the DEADLINE
  estimatedMinutes?: number; // total expected study time
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
  subtasks: Subtask[];
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Settings {
  notificationsEnabled: boolean;
  reminderTime: number; // minutes after midnight for daily summary reminder
  dueReminder: boolean; // remind on due date
  startOfWeek: 0 | 1; // 0 = Sunday, 1 = Monday
  timezone: string; // IANA timezone, e.g. 'Asia/Shanghai'
  dailyStudyLimitMinutes: number; // max study minutes per day
  minBlockMinutes: number; // minimum scheduler block duration
  maxBlockMinutes: number; // maximum scheduler block duration
  breakMinutes: number; // break minutes between blocks
}

// Unified, versioned application state (localStorage versioned schema).
// v2: initial versioned schema (Phase 1 migration target)
// v3: current schema with extended ScheduleBlock, cleaned Task, expanded Settings
export interface AppState {
  version: number;
  hasSeededDemo: boolean; // once true, demo is never auto-generated again
  courses: Course[];
  tasks: Task[];
  scheduleBlocks: ScheduleBlock[];
  availability: WeeklyAvailability;
  settings: Settings;
}

export const TAG_LABELS: Record<Tag, string> = {
  math: '数学',
  english: '英语',
  coding: '编程',
  reading: '阅读',
  other: '其他',
};

// Hex colors for courses (Supabase-friendly, unlike the Tailwind class strings).
export const TAG_HEX: Record<Tag, string> = {
  math: '#f43f5e',
  english: '#f59e0b',
  coding: '#0ea5e9',
  reading: '#8b5cf6',
  other: '#64748b',
};

// Shown whenever a Task has no courseId, or points at a Course that no longer
// exists (e.g. the Course was deleted — tasks are NEVER deleted with it).
export const UNCATEGORIZED_LABEL = '未分类';
export const UNCATEGORIZED_COLOR = '#94a3b8';

// A small fixed palette keeps colors on-brand without a color-picker dependency.
export const COURSE_PALETTE: string[] = [
  '#f43f5e', // rose
  '#f97316', // orange
  '#f59e0b', // amber
  '#10b981', // emerald
  '#0ea5e9', // sky
  '#3494fb', // brand
  '#8b5cf6', // violet
  '#64748b', // slate
];

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  high: 'bg-rose-500',
  medium: 'bg-amber-500',
  low: 'bg-emerald-500',
};

export const STATUS_LABELS: Record<Status, string> = {
  todo: '待开始',
  doing: '进行中',
  done: '已完成',
};

export function emptyAvailability(): WeeklyAvailability {
  return {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };
}