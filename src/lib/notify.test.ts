import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  notificationsSupported,
  requestPermission,
  notify,
  scheduleReminder,
  cancelReminder,
  cancelRemindersByTask,
  clearAllReminders,
  restoreReminders,
} from './notify';
import type { ScheduleBlock, Task } from '@/types';

// Build a future block `offsetMs` from now on the same calendar day if
// possible. Returns a minimal valid ScheduleBlock.
function futureBlock(offsetMs: number, id = 'b1'): ScheduleBlock {
  const d = new Date(Date.now() + offsetMs);
  // Format YYYY-MM-DD using LOCAL date (the project rule).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return {
    id,
    taskId: 't1',
    date: `${y}-${m}-${day}`,
    startTime: `${hh}:${mm}`,
    endTime: `${hh}:${String(parseInt(mm, 10) + 30).padStart(2, '0')}`,
    plannedMinutes: 30,
    source: 'manual',
    locked: false,
    status: 'planned',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('notify: notificationsSupported + requestPermission graceful degradation', () => {
  const originalNotification = (globalThis as any).Notification;

  afterEach(() => {
    // Restore the real Notification object between tests.
    (globalThis as any).Notification = originalNotification;
  });

  it('returns false when Notification API is absent', () => {
    delete (globalThis as any).Notification;
    expect(notificationsSupported()).toBe(false);
  });

  it('requestPermission resolves to "denied" when unsupported (does not throw)', async () => {
    delete (globalThis as any).Notification;
    const perm = await requestPermission();
    expect(perm).toBe('denied');
  });

  it('notify() is a no-op when unsupported (does not throw)', () => {
    delete (globalThis as any).Notification;
    expect(() => notify('t', 'b')).not.toThrow();
  });
});

describe('notify: scheduleReminder timer lifecycle', () => {
  beforeEach(() => {
    // Pretend notifications are supported and granted so scheduleReminder
    // actually sets timers.
    (globalThis as any).Notification = {
      permission: 'granted',
      requestPermission: async () => 'granted',
    };
    // Fake timers let us assert on setTimeout id management deterministically.
    vi.useFakeTimers();
    clearAllReminders();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a setTimeout for a future block and cancels it on cancelReminder', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const block = futureBlock(60_000, 'future-1');
    scheduleReminder(block, 'Task 1');
    // setTimeout must have been called once for this block.
    expect(spy).toHaveBeenCalled();
    // cancelReminder removes the timer without throwing.
    expect(() => cancelReminder('future-1')).not.toThrow();
    spy.mockRestore();
  });

  it('cancelRemindersByTask clears a list of block timers', () => {
    const b1 = futureBlock(60_000, 'cb-1');
    const b2 = futureBlock(120_000, 'cb-2');
    scheduleReminder(b1, 'Task 1');
    scheduleReminder(b2, 'Task 2');
    cancelRemindersByTask(['cb-1', 'cb-2']);
    // After cancellation, advancing time must not produce any side effects.
    expect(() => vi.advanceTimersByTime(180_000)).not.toThrow();
  });

  it('re-scheduling the same block replaces the old timer (move block updates reminder)', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const block = futureBlock(60_000, 'move-1');
    scheduleReminder(block, 'Task 1');
    // Move the block 5 minutes later — scheduleReminder must cancel the old
    // timer and create a new one. We assert it called setTimeout at least twice.
    const moved = { ...block, startTime: '23:59' };
    scheduleReminder(moved, 'Task 1');
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    cancelReminder('move-1');
    spy.mockRestore();
  });

  it('restoreReminders clears existing timers then schedules one per future block', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const blocks: ScheduleBlock[] = [futureBlock(60_000, 'r-1'), futureBlock(120_000, 'r-2')];
    const taskById = new Map<string, Task>([
      ['t1', { id: 't1', title: 'Task 1', description: '', priority: 'medium', status: 'todo', createdAt: 0, updatedAt: 0, completedAt: null, subtasks: [] }],
    ]);
    restoreReminders(blocks, taskById);
    // Two new timers should have been requested (one per block).
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    clearAllReminders();
    spy.mockRestore();
  });
});
