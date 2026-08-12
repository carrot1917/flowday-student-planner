import type { ScheduleBlock, Settings, Task } from '@/types';
import { fromISO, todayISO } from './date';

// Browser Notification helpers — graceful degradation when unsupported.

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  return await Notification.requestPermission();
}

export function notify(title: string, body: string): void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '/favicon.svg' });
  } catch {
    // some browsers throw if the notification is constructed too quickly
  }
}

// -------------------------------------------------------------- Timer lifecycle
//
// Phase 0: per-block setTimeout-based reminders. Each block with a future
// startTime gets a single timer. When the time comes, a notification fires.
// Timers are managed centrally so block create / update / delete and task
// delete can clean up without leaking.

const MAX_TIMEOUT_MS = 2147483647; // setTimeout's max signed 32-bit int (~24.8 days)
const reminderTimers = new Map<string, number>(); // blockId -> setTimeout id

/** Parse `YYYY-MM-DD` + `HH:mm` into a Date. Returns null if either is invalid. */
function parseBlockDate(date: string, startTime: string): Date | null {
  const d = fromISO(date);
  if (Number.isNaN(d.getTime())) return null;
  const parts = startTime.split(':').map(Number);
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  d.setHours(parts[0], parts[1], 0, 0);
  return d;
}

/**
 * Schedule a one-shot notification for a study block.
 * Silently skips if permissions are not granted, the block is in the past,
 * or the delay exceeds the setTimeout limit.
 */
export function scheduleReminder(block: ScheduleBlock, taskTitle: string): void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;

  // Cancel any existing timer for this block (idempotent update)
  cancelReminder(block.id);

  const fireAt = parseBlockDate(block.date, block.startTime);
  if (!fireAt) return;
  const delay = fireAt.getTime() - Date.now();
  if (delay <= 0 || delay > MAX_TIMEOUT_MS) return;

  const id = window.setTimeout(() => {
    notify('学习时段提醒', `「${taskTitle}」${block.startTime}–${block.endTime}，该开始学习了！`);
    reminderTimers.delete(block.id);
  }, delay);
  reminderTimers.set(block.id, id);
}

/** Cancel a single block's timer. Safe to call when no timer exists. */
export function cancelReminder(blockId: string): void {
  const id = reminderTimers.get(blockId);
  if (id !== undefined) {
    clearTimeout(id);
    reminderTimers.delete(blockId);
  }
}

/** Cancel all timers for the given block IDs. */
export function cancelRemindersByTask(blockIds: string[]): void {
  for (const blockId of blockIds) {
    cancelReminder(blockId);
  }
}

/** Clear all pending reminders. Used on engine shutdown. */
export function clearAllReminders(): void {
  for (const id of reminderTimers.values()) clearTimeout(id);
  reminderTimers.clear();
}

/**
 * Scan all blocks and re-schedule timers for future ones.
 * Usually called on app startup / reload to restore reminders that were lost
 * when the page was closed.
 */
export function restoreReminders(
  blocks: ScheduleBlock[],
  taskById: Map<string, Task>,
): void {
  clearAllReminders();
  for (const b of blocks) {
    if (!b.taskId) continue;
    const task = taskById.get(b.taskId);
    if (!task) continue;
    scheduleReminder(b, task.title);
  }
}

// -------------------------------------------------------------- Daily / Due engine
//
// Phase 0: keeps the existing interval-based polling for daily summary and
// due-date reminders. The interval is kept at 30 s for responsiveness.

let lastDueFired: Record<string, boolean> = {};
let lastDailyFiredKey = '';

/**
 * Start the reminder engine. Returns a cleanup function.
 *
 * On start, it restores block-based reminders for all future blocks.
 * The interval then polls every 30 s for daily + due-date reminders.
 */
export function startReminderEngine(
  getTasks: () => Task[],
  getSettings: () => Settings,
  getBlocks: () => ScheduleBlock[],
  getTaskById: () => Map<string, Task>,
): () => void {
  // Restore block reminders on startup
  restoreReminders(getBlocks(), getTaskById());

  const interval = setInterval(() => {
    const settings = getSettings();
    if (!settings.notificationsEnabled || Notification.permission !== 'granted') return;
    const tasks = getTasks();
    const today = todayISO();

    // Daily study reminder at configured time
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const dailyKey = `${today}-${settings.reminderTime}`;
    if (settings.reminderTime === nowMins && lastDailyFiredKey !== dailyKey) {
      lastDailyFiredKey = dailyKey;
      const pending = tasks.filter((t) => t.dueDate === today && t.status !== 'done');
      if (pending.length) {
        notify('FlowDay 今日提醒', `今天还有 ${pending.length} 项学习任务等待完成，加油！`);
      }
    }

    // Due-date reminders (fires once per task per day)
    if (settings.dueReminder) {
      for (const t of tasks) {
        if (t.status === 'done') continue;
        if (t.dueDate !== today) continue;
        const key = `${t.id}-${today}`;
        if (lastDueFired[key]) continue;
        lastDueFired[key] = true;
        notify('任务截止提醒', `「${t.title}」今天到期，别忘了完成哦`);
      }
    }
  }, 30_000);

  return () => {
    clearInterval(interval);
    clearAllReminders();
  };
}
