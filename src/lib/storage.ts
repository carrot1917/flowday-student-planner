import type { AppState, Settings, Task, Subtask } from '@/types';

const STORAGE_KEY = 'flowday.state.v1';

const DEFAULT_SETTINGS: Settings = {
  notificationsEnabled: false,
  reminderTime: 8 * 60, // 08:00
  dueReminder: true,
  startOfWeek: 1, // Monday
};

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
    dueDate: new Date().toISOString().slice(0, 10),
    startTime: '',
    endTime: '',
    priority: 'medium',
    tag: 'other',
    status: 'todo',
    createdAt: now,
    completedAt: null,
    subtasks: [],
    ...partial,
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tasks: [], settings: { ...DEFAULT_SETTINGS } };
    const parsed = JSON.parse(raw) as AppState;
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
    };
  } catch {
    return { tasks: [], settings: { ...DEFAULT_SETTINGS } };
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage may be full or unavailable; fail silently
  }
}

export function seedDemoTasks(): Task[] {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const addDays = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return iso(d);
  };
  return [
    createTask({
      title: '数学复习 — 函数与导数',
      description: '复习课本第3章，整理公式卡片',
      dueDate: iso(today),
      startTime: '08:00',
      endTime: '09:30',
      priority: 'high',
      tag: 'math',
      status: 'doing',
      subtasks: [
        createSubtask('复习公式'),
        createSubtask('完成练习题'),
        createSubtask('整理错题'),
      ],
    }),
    createTask({
      title: '英语背单词 (Unit 7)',
      description: '背诵 40 个新单词并复习昨日单词',
      dueDate: iso(today),
      startTime: '10:00',
      endTime: '11:00',
      priority: 'medium',
      tag: 'english',
      status: 'todo',
    }),
    createTask({
      title: '完成编程作业',
      description: '实现链表反转并提交到课程平台',
      dueDate: addDays(1),
      startTime: '14:00',
      endTime: '16:00',
      priority: 'high',
      tag: 'coding',
      status: 'todo',
    }),
    createTask({
      title: '阅读《深度工作》第2章',
      dueDate: addDays(2),
      priority: 'low',
      tag: 'reading',
      status: 'todo',
    }),
    createTask({
      title: '整理本周错题本',
      dueDate: addDays(-1),
      priority: 'medium',
      tag: 'other',
      status: 'done',
      completedAt: Date.now() - 86400000,
    }),
  ];
}
