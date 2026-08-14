import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncRepository } from './syncRepository';

function createMockRemote() {
  let calls: any[] = [];
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

describe('SyncRepository pending queue', () => {
  beforeEach(() => {
    // clear localStorage key used by SyncRepository
    localStorage.removeItem('flowday:sync:pending_v1');
  });

  it('enqueue persists and flushQueue sends RPC then clears queue', async () => {
    const { client, calls } = createMockRemote();
    // @ts-ignore
    const repo = new SyncRepository(undefined);
    // attach remote
    // @ts-ignore
    repo.setRemote({ client });

    // enqueue mutation
    // @ts-ignore
    repo.enqueue({ id: 'm1', op: 'upsert', entity: 'task', payload: { foo: 'bar' }, createdAt: Date.now() });

    const raw = localStorage.getItem('flowday:sync:pending_v1');
    expect(raw).not.toBeNull();
    const arr = JSON.parse(raw!);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(1);

    // flush queue
    // @ts-ignore
    await repo.flushQueue();

    const after = localStorage.getItem('flowday:sync:pending_v1');
    const arr2 = JSON.parse(after || '[]');
    expect(arr2.length).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].name).toBe('planner_apply_mutation');
  });
});
