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

// Singleton for the app
export const repository = new LocalStorageRepository();