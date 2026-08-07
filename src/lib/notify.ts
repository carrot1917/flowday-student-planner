import type { Settings, Task } from '@/types';
import { fromISO, diffDays, todayISO } from './date';

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

// Check tasks + settings once per minute and fire reminders.
let lastDueFired: Record<string, boolean> = {};
let lastDailyFiredKey = '';

export function startReminderEngine(getTasks: () => Task[], getSettings: () => Settings): () => void {
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

  return () => clearInterval(interval);
}
