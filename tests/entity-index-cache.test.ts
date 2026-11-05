import { describe, it, expect, vi } from 'vitest';
import { EntityIndexCache } from '../src/entity-index-cache.js';
import type { EntitySource } from '../src/entity-source.js';

function source(initialize = async () => {}): EntitySource {
  return { initialize, getProjects: async () => [], getPeople: async () => [],
    getOrganizations: async () => [], getBrands: async () => [], getRACIs: async () => [],
    getApps: async () => [], getCustomers: async () => [], getPartners: async () => [],
    getDecisions: async () => [], getGlossaryTerms: async () => [], getDocuments: async () => [],
    getExtensionTypeRegistrations: async () => [], getExtensionEntities: async () => [] };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('EntityIndexCache', () => {
  it('reuses a snapshot within TTL and rebuilds at expiry', async () => {
    let now = 0;
    const initialize = vi.fn(async () => {});
    const cache = new EntityIndexCache({ graphSourceFactory: () => source(initialize), now: () => now, ttlMs: 10 });
    const first = await cache.refresh();
    now = 9;
    expect(await cache.refresh()).toBe(first);
    now = 10;
    expect(await cache.refresh()).not.toBe(first);
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent requests and discards a generation invalidated in flight', async () => {
    const gate = deferred();
    let attempts = 0;
    const cache = new EntityIndexCache({ graphSourceFactory: () => source(async () => {
      if (++attempts === 1) await gate.promise;
    }) });
    const initial = cache.getState().index;
    const first = cache.refresh();
    const second = cache.refresh();
    cache.invalidate();
    expect(cache.getState().index).toBe(initial);
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(attempts).toBe(2);
    expect(cache.getState().generation).toBe(1);
  });

  it('keeps async authority scopes independent and evicts the least recently used idle scope', async () => {
    let now = 0;
    const factory = vi.fn(() => source());
    const cache = new EntityIndexCache({ graphSourceFactory: factory, maxScopes: 2, now: () => ++now });
    const a = await cache.run('a', () => cache.refresh());
    const b = await cache.run('b', () => cache.refresh());
    expect(a).not.toBe(b);
    expect(await cache.run('a', async () => { await Promise.resolve(); return cache.refresh(); })).toBe(a);
    await cache.run('c', () => cache.refresh());
    expect(await cache.run('a', () => cache.refresh())).toBe(a);
    expect(await cache.run('b', () => cache.refresh())).not.toBe(b);
    expect(factory).toHaveBeenCalledTimes(4);
  });

  it('protects in-flight scopes at capacity and allows retry after failure', async () => {
    const gate = deferred();
    let fail = true;
    const cache = new EntityIndexCache({ maxScopes: 1, graphSourceFactory: () => source(async () => {
      await gate.promise;
      if (fail) throw new Error('offline');
    }) });
    const pending = cache.run('a', () => cache.refresh());
    expect(() => cache.run('b', () => cache.getState())).toThrow(/capacity/);
    gate.resolve();
    await expect(pending).rejects.toThrow('offline');
    expect(cache.run('a', () => cache.getState().builtAt)).toBeNull();
    fail = false;
    await cache.run('a', () => cache.refresh());
    expect(cache.run('a', () => cache.getState().builtAt)).not.toBeNull();
  });

  it('invalidates every cached authority scope', async () => {
    const cache = new EntityIndexCache({ graphSourceFactory: () => source() });
    const a = await cache.run('a', () => cache.refresh());
    const b = await cache.run('b', () => cache.refresh());
    cache.invalidate();
    expect(await cache.run('a', () => cache.refresh())).not.toBe(a);
    expect(await cache.run('b', () => cache.refresh())).not.toBe(b);
  });
});
