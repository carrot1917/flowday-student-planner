import type { PlannerRepository as PlannerRepoType } from './repository';
import type { AppState } from '@/types';
import { LocalStorageRepository } from './repository';
import type { SupabaseRepository as _SupabaseRepository } from './supabaseRepository';

export type PendingMutation = {
  id: string; // local op id
  op: 'upsert' | 'delete';
  entity: 'task' | 'course' | 'subtask' | 'scheduleBlock' | 'availability' | 'settings';
  payload: any;
  createdAt: number;
};

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error';

const PENDING_KEY = 'flowday:sync:pending_v1';

/**
 * SyncRepository wraps a local LocalStorageRepository and a (possibly null)
 * remote SupabaseRepository. It is the single persistence entry point used
 * by the store, so it MUST always persist locally first.
 *
 * Phase 3 fixes:
 *   - Snapshot mutations are coalesced: rapid successive saves replace the
 *     pending snapshot instead of stacking, so input/drag/resize loops do
 *     not grow an unbounded queue.
 *   - A debounced flush prevents bursting RPC calls on every keystroke.
 *   - Sync status is tracked and exposed via `getStatus()` / `subscribe()`
 *     so the UI can show local/syncing/synced/offline/error without polling.
 *   - `setRemote(null)` (used by signOut) clears the pending queue and all
 *     realtime subscriptions so a different account never inherits the
 *     previous user's writes.
 *   - Flush failures keep the queue and flip status to 'error' / 'offline'
 *     instead of being silently dropped.
 */
export class SyncRepository implements PlannerRepoType {
  private local: PlannerRepoType;
  private remote: _SupabaseRepository | null;
  private queue: PendingMutation[];
  private flushing = false;
  private realtimeSubscriptions: any[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private status: SyncStatus = 'local';
  private listeners = new Set<(s: SyncStatus) => void>();

  constructor(remote: _SupabaseRepository | null = null) {
    this.local = new LocalStorageRepository();
    this.remote = remote;
    this.queue = this.loadQueue();
    if (this.remote) {
      this.status = this.queue.length > 0 ? 'syncing' : 'synced';
      this.startRealtime().catch(() => {});
      this.scheduleFlush();
    }
  }

  // ------------------------------------------------------------- status API
  getStatus(): SyncStatus { return this.status; }
  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => { this.listeners.delete(fn); };
  }
  private setStatus(next: SyncStatus) {
    if (this.status === next) return;
    this.status = next;
    for (const fn of this.listeners) {
      try { fn(next); } catch { /* listener error must not break sync */ }
    }
  }

  // ------------------------------------------------------------- queue store
  private loadQueue(): PendingMutation[] {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as PendingMutation[];
    } catch (e) {
      return [];
    }
  }

  private saveQueue() {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(this.queue));
    } catch (e) {
      // localStorage may be unavailable (private mode / quota). The in-memory
      // queue is still authoritative for the current session.
    }
  }

  /**
   * Coalescing enqueue: if a pending snapshot mutation already exists,
   * replace it in place with the new payload instead of pushing another.
   * This is what keeps typing / drag / resize from flooding the queue.
   */
  enqueue(m: PendingMutation) {
    if (m.entity === 'settings' && m.payload && typeof m.payload === 'object' && 'snapshot' in m.payload) {
      const idx = this.queue.findIndex((q) => q.entity === 'settings' && q.payload && 'snapshot' in q.payload);
      if (idx >= 0) this.queue[idx] = m;
      else this.queue.push(m);
    } else {
      this.queue.push(m);
    }
    this.saveQueue();
    this.setStatus(this.remote ? 'syncing' : 'local');
    this.scheduleFlush();
  }

  /** Debounced flush — collapses a burst of saves into a single RPC attempt. */
  private scheduleFlush() {
    if (!this.remote) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushQueue().catch(() => { /* status already set inside */ });
    }, 400);
  }

  async flushQueue(): Promise<void> {
    if (this.flushing) return;
    if (!this.remote) return;
    if (this.queue.length === 0) {
      this.setStatus(navigator.onLine === false ? 'offline' : 'synced');
      return;
    }
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue[0];
        try {
          await this.remote.client.rpc('planner_apply_mutation', { mutation: item }).throwOnError();
          this.queue.shift();
          this.saveQueue();
        } catch (e: any) {
          // Network failure / RPC error: keep the item at the head and stop.
          // Status flips to 'offline' so the UI can show a retry indicator;
          // the queue is persisted so a future flush (online event / next
          // save) will retry.
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            this.setStatus('offline');
          } else {
            this.setStatus('error');
            console.warn('[FlowDay] sync flush failed; keeping mutation in queue.', e);
          }
          break;
        }
      }
      if (this.queue.length === 0) {
        this.setStatus(navigator.onLine === false ? 'offline' : 'synced');
      }
    } finally {
      this.flushing = false;
    }
  }

  // ----------------------------------------------------------- PlannerRepository
  async loadSnapshot(): Promise<AppState> {
    return this.local.loadSnapshot();
  }

  async saveSnapshot(state: AppState): Promise<void> {
    // Always write through local first — local-first is the contract.
    await this.local.saveSnapshot(state);
    if (this.remote) {
      this.enqueue({
        id: `snapshot:${Date.now()}`,
        op: 'upsert',
        entity: 'settings',
        payload: { snapshot: state },
        createdAt: Date.now(),
      });
    }
  }

  async exportBackup(): Promise<string> {
    return this.local.exportBackup();
  }

  async importBackup(json: string): Promise<{ ok: true; state: AppState } | { ok: false; message: string }> {
    return this.local.importBackup(json);
  }

  // ----------------------------------------------------------- remote lifecycle
  setRemote(remote: _SupabaseRepository | null) {
    this.remote = remote;
    if (remote) {
      this.setStatus(this.queue.length > 0 ? 'syncing' : 'synced');
      this.startRealtime().catch(() => {});
      this.scheduleFlush();
    } else {
      // Detaching remote (typically on signOut): drop everything so a future
      // login under a different account never inherits this user's queue.
      this.stopRealtime();
      this.queue = [];
      this.saveQueue();
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.setStatus('local');
    }
  }

  private stopRealtime() {
    try {
      this.realtimeSubscriptions.forEach((sub) => { try { sub.unsubscribe?.(); } catch (e) { /* ignore */ } });
    } finally { this.realtimeSubscriptions = []; }
  }

  private async startRealtime() {
    if (!this.remote) return;
    try {
      const session = await this.remote.client.auth.getSession();
      const userId = session?.data?.session?.user?.id;
      if (!userId) return;
      const tables = ['tasks','courses','subtasks','schedule_blocks','availability_rules','user_settings'];
      tables.forEach((table) => {
        try {
          const chan = this.remote!.client.channel(`public:${table}:user:${userId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` }, () => { this.handleRemoteChange().catch(() => {}); })
            .subscribe();
          this.realtimeSubscriptions.push(chan);
        } catch (e) {
          // ignore single channel failures
        }
      });
    } catch (e) { /* ignore realtime setup failure */ }
  }

  private async handleRemoteChange() {
    if (!this.remote) return;
    try {
      const remoteState = await this.remote.loadSnapshot();
      const localState = await this.local.loadSnapshot();
      const merged: any = { ...localState };
      const mergeByIdInline = (localArr: any[] = [], remoteArr: any[] = []) => {
        const map = new Map<string, any>();
        localArr.forEach((it:any) => map.set(it.id, it));
        remoteArr.forEach((it:any) => {
          const existing = map.get(it.id);
          if (!existing) map.set(it.id, it);
          else {
            const lts = Number(existing.updatedAt || existing.updated_at || 0) || 0;
            const rts = Number(it.updatedAt || it.updated_at || 0) || 0;
            if (rts >= lts) map.set(it.id, it);
          }
        });
        return Array.from(map.values());
      };
      merged.courses = mergeByIdInline(localState.courses || [], remoteState.courses || []);
      merged.tasks = mergeByIdInline(localState.tasks || [], remoteState.tasks || []);
      merged.scheduleBlocks = mergeByIdInline(localState.scheduleBlocks || [], remoteState.scheduleBlocks || []);
      merged.availability = remoteState.availability || localState.availability;
      merged.settings = { ...(localState.settings || {}), ...(remoteState.settings || {}) };
      await this.local.saveSnapshot(merged);
    } catch (e) {
      console.warn('[FlowDay] remote change merge failed; keeping local state.', e);
    }
  }
}
