import type { PlannerRepository } from './repository';
import type { AppState } from '@/types';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// NOTE: This file implements a minimal SupabaseRepository that adheres to
// the PlannerRepository contract and exposes extra helpers for sync.
// It expects a configured SupabaseClient to be passed when constructed.

export interface SupabaseRepositoryOptions {
  client: SupabaseClient;
}

export class SupabaseRepository implements PlannerRepository {
  public client: SupabaseClient;

  constructor(opts: SupabaseRepositoryOptions) {
    this.client = opts.client;
  }

  // Load full canonical v3 AppState from Supabase by querying each table.
  // The exact mapping depends on the AppState shape — here we expect the
  // canonical loader to reconstruct AppState from normalized rows.
  async loadSnapshot(): Promise<AppState> {
    // Attempt RPC first
    try {
      // rpc may return a json blob representing AppState
      const res = await this.client.rpc('planner_get_snapshot') as unknown as { data: unknown; error: unknown };
      // supabase-js returns { data, error }
      if (res && res.error == null && res.data) {
        return res.data as AppState;
      }
    } catch (e) {
      // ignore and fallback
    }

    // Manual fetch: read normalized tables and assemble an AppState
    // Fetch current user id from auth
    const session = await this.client.auth.getSession();
    const userId = session?.data?.session?.user?.id;

    // If no authenticated user, return empty canonical v3 skeleton
    if (!userId) {
      return {
        version: 3,
        hasSeededDemo: false,
        courses: [],
        tasks: [],
        scheduleBlocks: [],
        availability: {
          monday: [],
          tuesday: [],
          wednesday: [],
          thursday: [],
          friday: [],
          saturday: [],
          sunday: [],
        },
        settings: {
          notificationsEnabled: false,
          reminderTime: 8 * 60,
          dueReminder: false,
          startOfWeek: 1,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          dailyStudyLimitMinutes: 180,
          minBlockMinutes: 25,
          maxBlockMinutes: 120,
          breakMinutes: 10,
        },
      } as AppState;
    }

    // Helper to convert timestamptz to ms number
    const toMs = (v: any) => (v ? new Date(v).getTime() : undefined);

    // Fetch tables
    const [{ data: courses }, { data: tasks }, { data: subtasks }, { data: scheduleBlocks }, { data: availabilityRules }, { data: userSettings }] = await Promise.all([
      this.client.from('courses').select('*').eq('user_id', userId),
      this.client.from('tasks').select('*').eq('user_id', userId),
      this.client.from('subtasks').select('*').eq('user_id', userId),
      this.client.from('schedule_blocks').select('*').eq('user_id', userId),
      this.client.from('availability_rules').select('*').eq('user_id', userId),
      this.client.from('user_settings').select('*').eq('user_id', userId),
    ] as const).catch(() => [ { data: null }, { data: null }, { data: null }, { data: null }, { data: null }, { data: null } ]);

    const coursesArr = (courses || []).map((c: any) => ({ id: c.id, name: c.name, color: c.color || '#3494fb', createdAt: toMs(c.created_at) || Date.now() }));

    const subtasksByTask = new Map<string, any[]>();
    (subtasks || []).forEach((s: any) => {
      const t = subtasksByTask.get(s.task_id) || [];
      t.push({ id: s.id, title: s.title, done: !!s.done, sortOrder: s.sort_order });
      subtasksByTask.set(s.task_id, t);
    });

    const tasksArr = (tasks || []).map((t: any) => {
      const localSubtasks = (subtasksByTask.get(t.id) || [])
        .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map((s: any) => ({ id: s.id, title: s.title, done: !!s.done }));
      return {
        id: t.id,
        title: t.title,
        description: t.description || '',
        courseId: t.course_id || undefined,
        priority: (t.priority as any) || 'medium',
        status: (t.status as any) || 'todo',
        dueDate: t.due_date || undefined,
        estimatedMinutes: t.estimated_minutes || undefined,
        createdAt: toMs(t.created_at) || Date.now(),
        updatedAt: toMs(t.updated_at) || Date.now(),
        completedAt: toMs(t.completed_at) || null,
        subtasks: localSubtasks,
      };
    });

    const blocksArr = (scheduleBlocks || []).map((b: any) => ({
      id: b.id,
      taskId: b.task_id || undefined,
      date: b.date,
      startTime: (b.start_time instanceof Date) ? b.start_time.toTimeString().slice(0,5) : (b.start_time || b.startTime || '00:00'),
      endTime: (b.end_time instanceof Date) ? b.end_time.toTimeString().slice(0,5) : (b.end_time || b.endTime || '00:00'),
      plannedMinutes: b.planned_minutes || 0,
      source: (b.source as any) || 'manual',
      locked: !!b.locked,
      status: (b.status as any) || 'planned',
      createdAt: toMs(b.created_at) || Date.now(),
      updatedAt: toMs(b.updated_at) || Date.now(),
    }));

    const availability: any = {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    };
    (availabilityRules || []).forEach((r: any) => {
      const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
      const d = days[r.weekday] || days[0];
      const startH = Math.floor((r.start_minute || 0) / 60).toString().padStart(2,'0');
      const startM = ((r.start_minute || 0) % 60).toString().padStart(2,'0');
      const endH = Math.floor((r.end_minute || 0) / 60).toString().padStart(2,'0');
      const endM = ((r.end_minute || 0) % 60).toString().padStart(2,'0');
      availability[d] = availability[d] || [];
      availability[d].push({ startTime: `${startH}:${startM}`, endTime: `${endH}:${endM}` });
    });

    const settingsRow = (userSettings && userSettings[0]) || null;
    const settings = settingsRow ? {
      notificationsEnabled: !!settingsRow.notifications_enabled,
      reminderTime: settingsRow.reminder_time || 8*60,
      dueReminder: !!settingsRow.due_reminder,
      startOfWeek: typeof settingsRow.start_of_week === 'number' ? settingsRow.start_of_week : 1,
      timezone: settingsRow.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      dailyStudyLimitMinutes: settingsRow.daily_study_limit_minutes || 180,
      minBlockMinutes: settingsRow.min_block_minutes || 25,
      maxBlockMinutes: settingsRow?.max_block_minutes || 120,
      breakMinutes: settingsRow.break_minutes || 10,
    } : {
      notificationsEnabled: false,
      reminderTime: 8*60,
      dueReminder: false,
      startOfWeek: 1,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      dailyStudyLimitMinutes: 180,
      minBlockMinutes: 25,
      maxBlockMinutes: 120,
      breakMinutes: 10,
    };

    const state: AppState = {
      version: 3,
      hasSeededDemo: false,
      courses: coursesArr,
      tasks: tasksArr,
      scheduleBlocks: blocksArr,
      availability,
      settings,
    };
    return state;
  }

  // Save entire snapshot: used during migration or backup import/export.
  // For local-first normal operations, SyncRepository will handle granular upserts.
  async saveSnapshot(state: AppState): Promise<void> {
    // Not implemented as an atomic replace — it is dangerous. Provide a simple
    // convenience RPC if server supports it (transactional replace with RLS checks).
    // For now, we call an RPC `planner_replace_snapshot(state json)` if available.
    try {
      await this.client.rpc('planner_replace_snapshot', { state }).throwOnError();
    } catch (e) {
      // If RPC not available, fall back to no-op to avoid accidental wipe.
      // Real implementation should upsert each entity with versioning and tombstones.
      console.warn('SupabaseRepository.saveSnapshot: planner_replace_snapshot RPC not available; no-op');
    }
  }

  async exportBackup(): Promise<string> {
    const s = await this.loadSnapshot();
    return JSON.stringify(s);
  }

  async importBackup(json: string): Promise<{ ok: true; state: AppState } | { ok: false; message: string }> {
    try {
      const parsed = JSON.parse(json) as AppState;
      // Basic validation could be added here
      // For safety, do NOT automatically push to server — return state for caller confirmation
      return { ok: true, state: parsed };
    } catch (e) {
      return { ok: false, message: 'Invalid JSON' };
    }
  }

  // Additional helper: fetch server timestamp / version
  async getServerTimestamp(): Promise<string | null> {
    try {
      const { data, error } = await this.client.rpc('planner_server_time').select();
      // If RPC returns { now: '...' }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((data as any)?.now) return (data as any).now as string;
    } catch (e) {
      // ignore
    }
    return null;
  }
}
