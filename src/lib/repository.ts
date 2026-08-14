// Repository abstraction — the only layer that touches localStorage.
//
// UI and store actions never access localStorage directly. This interface
// allows a future SupabaseRepository to be swapped in without changing any
// page or store code.
//
// All methods return Promises so the interface is compatible with both
// synchronous (localStorage) and asynchronous (remote API) backends.

import type { AppState } from '@/types';
import { loadState, saveState, exportBackup, validateBackup } from './storage';

export interface PlannerRepository {
  loadSnapshot(): Promise<AppState>;
  saveSnapshot(state: AppState): Promise<void>;
  exportBackup(): Promise<string>;
  importBackup(json: string): Promise<{ ok: true; state: AppState } | { ok: false; message: string }>;
}

// --------------------------------------------------------------- LocalStorage

export class LocalStorageRepository implements PlannerRepository {
  async loadSnapshot(): Promise<AppState> {
    const { state } = loadState();
    return state;
  }

  async saveSnapshot(state: AppState): Promise<void> {
    saveState(state);
  }

  async exportBackup(): Promise<string> {
    // The caller must pass the current state; this is a thin passthrough.
    // The actual exportBackup is called with the state from the caller.
    throw new Error('Use storage.exportBackup(state) directly — state must be provided');
  }

  async importBackup(json: string): Promise<{ ok: true; state: AppState } | { ok: false; message: string }> {
    return validateBackup(json);
  }
}

// Proxy repository that can be swapped at runtime (default: localStorage)
class ProxyRepository implements PlannerRepository {
  private impl: PlannerRepository = new LocalStorageRepository();
  setImpl(next: PlannerRepository) { this.impl = next; }
  async loadSnapshot(): Promise<AppState> { return this.impl.loadSnapshot(); }
  async saveSnapshot(state: AppState): Promise<void> { return this.impl.saveSnapshot(state); }
  async exportBackup(): Promise<string> { return this.impl.exportBackup(); }
  async importBackup(json: string): Promise<{ ok: true; state: AppState } | { ok: false; message: string }> { return this.impl.importBackup(json); }
}

export const repository = new ProxyRepository();

export function setRepository(next: PlannerRepository) {
  // replace the underlying implementation
  (repository as ProxyRepository).setImpl(next);
}
