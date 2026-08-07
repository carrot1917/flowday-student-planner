// Domain types for FlowDay. Kept framework-agnostic so the data layer
// can be reused if the project later migrates to React/Vue.

export type Priority = 'high' | 'medium' | 'low';
export type Status = 'todo' | 'doing' | 'done';

export type Tag = 'math' | 'english' | 'coding' | 'reading' | 'other';

export interface Task {
  id: string;
  title: string;
  description: string;
  dueDate: string; // ISO date (YYYY-MM-DD)
  startTime: string; // HH:mm, optional schedule slot
  endTime: string; // HH:mm
  priority: Priority;
  tag: Tag;
  status: Status;
  createdAt: number;
  completedAt: number | null;
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
}

export interface AppState {
  tasks: Task[];
  settings: Settings;
}

export const TAG_LABELS: Record<Tag, string> = {
  math: '数学',
  english: '英语',
  coding: '编程',
  reading: '阅读',
  other: '其他',
};

export const TAG_COLORS: Record<Tag, string> = {
  math: 'bg-rose-100 text-rose-600 ring-rose-200',
  english: 'bg-amber-100 text-amber-600 ring-amber-200',
  coding: 'bg-sky-100 text-sky-600 ring-sky-200',
  reading: 'bg-violet-100 text-violet-600 ring-violet-200',
  other: 'bg-slate-100 text-slate-600 ring-slate-200',
};

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
