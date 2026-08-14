import { describe, it, expect, beforeEach } from 'vitest';
import { SyncRepository, type PendingMutation } from './syncRepository';
import type { SupabaseRepository } from './supabaseRepository';

function createMockRemote(): { client: any; calls: any[] } {
  const calls: any[] = [];
  const client = {
    rpc: (name: string, params: any) => {
      calls.push({ name, params });
      return {
        throwOnError: async () => ({ ok: true }),
      };
    },
  };
  return { client, calls };
}

// The real SupabaseRepository exposes `client` as a public field. The mock
// remote mirrors that shape so SyncRepository can read `remote.client.rpc`.
function asRemote(client: any): SupabaseRepository {
  return { client } as unknown as SupabaseRepository;
}

describe('SyncRepository pending queue', () => {
  beforeEach(() => {
    // clear localStorage key used by SyncRepository
    localStorage.removeItem('flowday:sync:pending_v1');
  });

  it('enqueue persists and flushQueue sends RPC then clears queue', async () => {
    const { client, calls } = createMockRemote();
    // Construct without a remote so we can attach the mock afterwards.
    const repo = new SyncRepository(null);
    // Attach mock remote.
    repo.setRemote(asRemote(client));

    const m: PendingMutation = { id: 'm1', op: 'upsert', entity: 'task', payload: { foo: 'bar' }, createdAt: Date.now() };
    repo.enqueue(m);

    const raw = localStorage.getItem('flowday:sync:pending_v1');
    expect(raw).not.toBeNull();
    const arr = JSON.parse(raw!);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(1);

    await repo.flushQueue();

    const after = localStorage.getItem('flowday:sync:pending_v1');
    const arr2 = JSON.parse(after || '[]');
    expect(arr2.length).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].name).toBe('planner_apply_mutation');
  });

  it('coalesces snapshot mutations so rapid saves do not grow the queue', async () => {
    const { client } = createMockRemote();
    const repo = new SyncRepository(null);
    repo.setRemote(asRemote(client));

    // Simulate three rapid saveSnapshot calls (typing / drag / resize).
    const snap = (): PendingMutation => ({
      id: `snapshot:${Date.now()}`,
      op: 'upsert',
      entity: 'settings',
      payload: { snapshot: { ts: Date.now() } },
      createdAt: Date.now(),
    });
    repo.enqueue(snap());
    repo.enqueue(snap());
    repo.enqueue(snap());

    const raw = localStorage.getItem('flowday:sync:pending_v1');
    const arr = JSON.parse(raw || '[]');
    // Three snapshot mutations must collapse into ONE pending entry.
    expect(arr.length).toBe(1);
    expect(arr[0].entity).toBe('settings');
  });

  it('setRemote(null) clears the queue and resets status to local', async () => {
    const { client } = createMockRemote();
    const repo = new SyncRepository(asRemote(client));
    repo.enqueue({ id: 'm1', op: 'upsert', entity: 'task', payload: {}, createdAt: Date.now() });
    expect(localStorage.getItem('flowday:sync:pending_v1')).not.toBeNull();

    repo.setRemote(null);

    // Queue must be cleared so a different account never inherits it.
    expect(JSON.parse(localStorage.getItem('flowday:sync:pending_v1') || '[]').length).toBe(0);
    expect(repo.getStatus()).toBe('local');
  });
});
