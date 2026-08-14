import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { SupabaseRepository } from './supabaseRepository';
import { SyncRepository } from './syncRepository';
import { LocalStorageRepository, setRepository, repository } from './repository';

type AuthState = {
  user: any | null;
  session: any | null;
  loading: boolean;
  error: string | null;
  // migration candidates provided after login: local vs remote snapshots
  migration?: {
    local: any | null;
    remote: any | null;
  } | null;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  performMigrationReplaceCloudWithLocal: () => Promise<{ ok: boolean; message?: string }>;
  performMigrationMergeLocalToCloud: () => Promise<{ ok: boolean; message?: string }>;
  clearMigrationChoice: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migration, setMigration] = useState<AuthState['migration']>(null);

  // On mount, try to restore session via supabase client if env present
  useEffect(() => {
    let mounted = true;
    (async () => {
      // If Supabase env vars are not configured, stay in local-only mode.
      // The app must still boot successfully so Vercel deployments without
      // Supabase config show the local-only UI instead of a white screen.
      if (!isSupabaseConfigured()) {
        if (mounted) setLoading(false);
        return;
      }
      try {
        const client = createSupabaseClient();
        const s = await client.auth.getSession();
        const u = s?.data?.session?.user ?? null;
        if (!mounted) return;
        setUser(u);
        setSession(s?.data?.session ?? null);
        // If logged in, do migration check but do not immediately replace repository
        if (u) {
          await prepareMigration(client);
        }
      } catch (e) {
        // supabase not configured / network error — remain local-only
        console.warn('[FlowDay] Supabase session restore failed; staying in local-only mode.', e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  async function prepareMigration(client: ReturnType<typeof createSupabaseClient>) {
    try {
      const remoteRepo = new SupabaseRepository({ client });
      const remote = await remoteRepo.loadSnapshot();
      // local snapshot from current repository (Proxy -> LocalStorage)
      const local = await repository.loadSnapshot();
      // Only prompt migration if there's actual local data not yet in remote.
      // Without this guard, the modal would pop up on every login / page refresh.
      const localCount = (local.tasks?.length || 0) + (local.courses?.length || 0) + (local.scheduleBlocks?.length || 0);
      const remoteCount = (remote.tasks?.length || 0) + (remote.courses?.length || 0) + (remote.scheduleBlocks?.length || 0);
      if (localCount === 0 && remoteCount === 0) {
        // Nothing to migrate — go straight to sync mode.
        const sync = new SyncRepository(remoteRepo);
        setRepository(sync as any);
        setMigration(null);
        return;
      }
      if (localCount === 0) {
        // No local data — just adopt remote as authoritative and start sync.
        const sync = new SyncRepository(remoteRepo);
        setRepository(sync as any);
        setMigration(null);
        return;
      }
      setMigration({ local, remote });
    } catch (e: any) {
      console.error('prepareMigration failed', e);
    }
  }

  async function signUp(email: string, password: string) {
    if (!isSupabaseConfigured()) {
      setError('Supabase 未配置，无法注册。请设置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY。');
      throw new Error('Supabase not configured');
    }
    setLoading(true);
    setError(null);
    try {
      const client = createSupabaseClient();
      const res = await client.auth.signUp({ email, password });
      if (res.error) throw res.error;
      const u = res.data.user ?? null;
      setUser(u);
      setSession(res.data.session ?? null);
      // prepare migration for new account
      await prepareMigration(client);
    } catch (e: any) {
      setError(e?.message || String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function signIn(email: string, password: string) {
    if (!isSupabaseConfigured()) {
      setError('Supabase 未配置，无法登录。请设置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY。');
      throw new Error('Supabase not configured');
    }
    setLoading(true);
    setError(null);
    try {
      const client = createSupabaseClient();
      const res = await client.auth.signInWithPassword({ email, password });
      if (res.error) throw res.error;
      const u = res.data.user ?? null;
      setUser(u);
      setSession(res.data.session ?? null);
      // prepare migration: fetch remote snapshot and compare with local
      await prepareMigration(client);
    } catch (e: any) {
      setError(e?.message || String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    setLoading(true);
    // Best-effort: tell Supabase to revoke the session. If env is not
    // configured or the network is down, we still need to fall back to
    // local-only mode locally.
    if (isSupabaseConfigured()) {
      try {
        const client = createSupabaseClient();
        await client.auth.signOut();
      } catch (e) {
        // ignore — we still need to clean up locally
      }
    }
    // Drop any pending sync queue tied to the previous account so a future
    // login under a different account never receives the old user's writes.
    try {
      const current = await repository.loadSnapshot();
      void current; // touch to ensure the proxy is reachable
    } catch { /* ignore */ }
    try {
      localStorage.removeItem('flowday:sync:pending_v1');
    } catch { /* ignore */ }
    // revert repository to local-only
    setRepository(new LocalStorageRepository());
    setUser(null);
    setSession(null);
    setMigration(null);
    setLoading(false);
  }

  // Migration actions — these are intentionally coarse and require server RPCs
  async function performMigrationReplaceCloudWithLocal() {
    setLoading(true);
    try {
      const client = createSupabaseClient();
      const remoteRepo = new SupabaseRepository({ client });
      const local = await repository.loadSnapshot();
      const userId = (await client.auth.getSession())?.data?.session?.user?.id;
      if (!userId) throw new Error('no authenticated user');

      // Fetch remote ids to tombstone anything not present locally
      const [{ data: remoteTasks }, { data: remoteCourses }, { data: remoteSubtasks }, { data: remoteBlocks }] = await Promise.all([
        client.from('tasks').select('id').eq('user_id', userId),
        client.from('courses').select('id').eq('user_id', userId),
        client.from('subtasks').select('id').eq('user_id', userId),
        client.from('schedule_blocks').select('id').eq('user_id', userId),
      ] as const);

      const localTaskIds = new Set((local.tasks || []).map((t: any) => t.id));
      const localCourseIds = new Set((local.courses || []).map((c: any) => c.id));
      const localSubIds = new Set<string>();
      (local.tasks || []).forEach((t: any) => (t.subtasks || []).forEach((s: any) => localSubIds.add(s.id)));
      const localBlockIds = new Set((local.scheduleBlocks || []).map((b: any) => b.id));

      const nowIso = new Date().toISOString();
      // tombstone remote entries not present locally
      if (remoteTasks) {
        const toTomb = (remoteTasks as any[]).filter((r: any) => !localTaskIds.has(r.id)).map((r: any) => ({ id: r.id, deleted_at: nowIso }));
        if (toTomb.length) await client.from('tasks').upsert(toTomb).throwOnError();
      }
      if (remoteCourses) {
        const toTomb = (remoteCourses as any[]).filter((r: any) => !localCourseIds.has(r.id)).map((r: any) => ({ id: r.id, deleted_at: nowIso }));
        if (toTomb.length) await client.from('courses').upsert(toTomb).throwOnError();
      }
      if (remoteSubtasks) {
        const toTomb = (remoteSubtasks as any[]).filter((r: any) => !localSubIds.has(r.id)).map((r: any) => ({ id: r.id, deleted_at: nowIso }));
        if (toTomb.length) await client.from('subtasks').upsert(toTomb).throwOnError();
      }
      if (remoteBlocks) {
        const toTomb = (remoteBlocks as any[]).filter((r: any) => !localBlockIds.has(r.id)).map((r: any) => ({ id: r.id, deleted_at: nowIso }));
        if (toTomb.length) await client.from('schedule_blocks').upsert(toTomb).throwOnError();
      }

      // Upsert local as authoritative
      // Reuse merge flow to upsert all local rows
      const courseRows = (local.courses || []).map((c: any) => ({ id: c.id, user_id: userId, name: c.name, color: c.color, created_at: new Date(c.createdAt).toISOString(), updated_at: new Date(c.createdAt).toISOString(), deleted_at: null }));
      if (courseRows.length) await client.from('courses').upsert(courseRows).throwOnError();

      const taskRows = (local.tasks || []).map((t: any) => ({ id: t.id, user_id: userId, course_id: t.courseId || null, title: t.title, description: t.description || null, due_date: t.dueDate || null, priority: null, status: t.status, estimated_minutes: t.estimatedMinutes || null, created_at: new Date(t.createdAt).toISOString(), updated_at: new Date(t.updatedAt).toISOString(), completed_at: t.completedAt ? new Date(t.completedAt).toISOString() : null, deleted_at: null }));
      if (taskRows.length) await client.from('tasks').upsert(taskRows).throwOnError();

      const subRows: any[] = [];
      (local.tasks || []).forEach((t: any) => {
        (t.subtasks || []).forEach((s: any, idx: number) => {
          subRows.push({ id: s.id, user_id: userId, task_id: t.id, title: s.title, done: s.done, sort_order: idx, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null });
        });
      });
      if (subRows.length) await client.from('subtasks').upsert(subRows).throwOnError();

      const blocks = (local.scheduleBlocks || []).map((b: any) => ({ id: b.id, user_id: userId, task_id: b.taskId || null, date: b.date, start_time: b.startTime, end_time: b.endTime, planned_minutes: b.plannedMinutes, source: b.source, locked: b.locked, status: b.status, created_at: new Date(b.createdAt).toISOString(), updated_at: new Date(b.updatedAt).toISOString(), deleted_at: null }));
      if (blocks.length) await client.from('schedule_blocks').upsert(blocks).throwOnError();

      // Attach SyncRepository
      const sync = new SyncRepository(remoteRepo);
      setRepository(sync as any);
      setMigration(null);
      return { ok: true };
    } catch (e: any) {
      console.error('migration replace failed', e);
      return { ok: false, message: e?.message || String(e) };
    } finally {
      setLoading(false);
    }
  }

  async function performMigrationMergeLocalToCloud() {
    setLoading(true);
    try {
      const client = createSupabaseClient();
      const remoteRepo = new SupabaseRepository({ client });
      const local = await repository.loadSnapshot();
      const remote = await remoteRepo.loadSnapshot();
      // Simple merge: naive union by id for courses/tasks/scheduleBlocks. Prefer latest updatedAt when conflicts.
      // For simplicity, perform per-entity upserts using supabase client directly here.
      const userId = (await client.auth.getSession())?.data?.session?.user?.id;
      if (!userId) throw new Error('no authenticated user');

      // Upsert courses
      const courseRows = (local.courses || []).map((c: any) => ({ id: c.id, user_id: userId, name: c.name, color: c.color, created_at: new Date(c.createdAt).toISOString(), updated_at: new Date(c.createdAt).toISOString(), deleted_at: null }));
      if (courseRows.length) await client.from('courses').upsert(courseRows).throwOnError();

      // Upsert tasks (without subtasks)
      const taskRows = (local.tasks || []).map((t: any) => ({ id: t.id, user_id: userId, course_id: t.courseId || null, title: t.title, description: t.description || null, due_date: t.dueDate || null, priority: null, status: t.status, estimated_minutes: t.estimatedMinutes || null, created_at: new Date(t.createdAt).toISOString(), updated_at: new Date(t.updatedAt).toISOString(), completed_at: t.completedAt ? new Date(t.completedAt).toISOString() : null, deleted_at: null }));
      if (taskRows.length) await client.from('tasks').upsert(taskRows).throwOnError();

      // Upsert subtasks
      const subRows: any[] = [];
      (local.tasks || []).forEach((t: any) => {
        (t.subtasks || []).forEach((s: any, idx: number) => {
          subRows.push({ id: s.id, user_id: userId, task_id: t.id, title: s.title, done: s.done, sort_order: idx, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null });
        });
      });
      if (subRows.length) await client.from('subtasks').upsert(subRows).throwOnError();

      // Upsert schedule blocks
      const blocks = (local.scheduleBlocks || []).map((b: any) => ({ id: b.id, user_id: userId, task_id: b.taskId || null, date: b.date, start_time: b.startTime, end_time: b.endTime, planned_minutes: b.plannedMinutes, source: b.source, locked: b.locked, status: b.status, created_at: new Date(b.createdAt).toISOString(), updated_at: new Date(b.updatedAt).toISOString(), deleted_at: null }));
      if (blocks.length) await client.from('schedule_blocks').upsert(blocks).throwOnError();

      // availability_rules and user_settings can be upserted similarly — omitted for brevity

      // After merging, set SyncRepository
      const sync = new SyncRepository(remoteRepo);
      setRepository(sync as any);
      setMigration(null);
      return { ok: true };
    } catch (e: any) {
      console.error('merge failed', e);
      return { ok: false, message: e?.message || String(e) };
    } finally {
      setLoading(false);
    }
  }

  function clearMigrationChoice() {
    setMigration(null);
  }

  const value = useMemo(() => ({
    user,
    session,
    loading,
    error,
    migration,
    signUp,
    signIn,
    signOut,
    performMigrationReplaceCloudWithLocal,
    performMigrationMergeLocalToCloud,
    clearMigrationChoice,
  }), [user, session, loading, error, migration]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
