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

const PENDING_KEY = 'flowday:sync:pending_v1';

export class SyncRepository implements PlannerRepoType {
  private local: PlannerRepoType;
  private remote: _SupabaseRepository | null;
  private queue: PendingMutation[];
  private flushing = false;
  private realtimeSubscriptions: any[] = [];

  constructor(remote: _SupabaseRepository | null = null) {
    this.local = new LocalStorageRepository();
    this.remote = remote;
    this.queue = this.loadQueue();
    if (this.remote) this.startRealtime().catch(() => {});
  }

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
    localStorage.setItem(PENDING_KEY, JSON.stringify(this.queue));
  }

  enqueue(m: PendingMutation) {
    this.queue.push(m);
    this.saveQueue();
    // attempt background flush
    this.flushQueue().catch(() => {});
  }

  async flushQueue(): Promise<void> {
    if (this.flushing) return;
    if (!this.remote) return;
    if (this.queue.length === 0) return;
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue[0];
        try {
          await this.remote.client.rpc('planner_apply_mutation', { mutation: item }).throwOnError();
          this.queue.shift();
          this.saveQueue();
        } catch (e) {
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  // PlannerRepository interface
  async loadSnapshot(): Promise<AppState> {
    return this.local.loadSnapshot();
  }

  async saveSnapshot(state: AppState): Promise<void> {
    await this.local.saveSnapshot(state);
    if (this.remote) {
      this.enqueue({ id: `snapshot:${Date.now()}`, op: 'upsert', entity: 'settings', payload: { snapshot: state }, createdAt: Date.now() });
    }
  }

  async exportBackup(): Promise<string> {
    return this.local.exportBackup();
  }

  async importBackup(json: string): Promise<{ ok: true; state: AppState } | { ok: false; message: string }> {
    return this.local.importBackup(json);
  }

  setRemote(remote: _SupabaseRepository | null) {
    this.remote = remote;
    if (remote) {
      this.flushQueue().catch(() => {});
      this.startRealtime().catch(() => {});
    } else {
      this.stopRealtime();
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
            .on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` }, (payload: any) => { this.handleRemoteChange().catch(() => {}); })
            .subscribe();
          this.realtimeSubscriptions.push(chan);
        } catch (e) {
          // ignore
        }
      });
    } catch (e) { /* ignore */ }
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
    } catch (e) { /* ignore */ }
  }
}
