import { AsyncLocalStorage } from 'node:async_hooks';
import { buildIndex, createEmptyIndex } from './entity-indexer.js';
import type { EntityIndex } from './entity-types.js';
import type { EntitySource } from './entity-source.js';

export interface EntityIndexState {
  index: EntityIndex;
  refreshPromise: Promise<void> | null;
  source: EntitySource;
  lastAccessedAt: number;
  builtAt: number | null;
  generation: number;
}
export interface EntityIndexCacheOptions {
  /** Called within the host's authentication context. Scope must identify its authority. */
  graphSourceFactory: (scope: string) => EntitySource;
  ttlMs?: number;
  maxScopes?: number;
  now?: () => number;
}

/** Reusable, authority-scoped projections. Hosts must choose trusted scope keys. */
export class EntityIndexCache {
  private readonly scope = new AsyncLocalStorage<string>();
  private readonly states = new Map<string, EntityIndexState>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxScopes: number;

  constructor(private readonly options: EntityIndexCacheOptions) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 60_000;
    this.maxScopes = options.maxScopes ?? 64;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs < 0) throw new Error('ttlMs must be nonnegative and finite');
    if (!Number.isInteger(this.maxScopes) || this.maxScopes < 1) throw new Error('maxScopes must be a positive integer');
  }

  run<T>(scope: string, callback: () => T): T {
    if (!scope.trim()) throw new Error('Entity index scope must be nonempty');
    return this.scope.run(scope, callback);
  }

  getState(): EntityIndexState {
    const key = this.scope.getStore() ?? 'default';
    let state = this.states.get(key);
    if (!state) {
      if (this.states.size >= this.maxScopes) {
        const candidate = [...this.states.entries()]
          .filter(([scope, value]) => scope !== 'default' && value.refreshPromise === null)
          .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)[0];
        // Never evict an in-flight build or silently exceed the authority cache bound.
        if (!candidate) throw new Error('Entity index scope capacity exhausted');
        this.states.delete(candidate[0]);
      }
      state = { index: createEmptyIndex(), refreshPromise: null,
        source: this.options.graphSourceFactory(key), lastAccessedAt: this.now(), builtAt: null, generation: 0 };
      this.states.set(key, state);
    }
    state.lastAccessedAt = this.now();
    return state;
  }

  async refresh(): Promise<EntityIndex> {
    const state = this.getState();
    if (state.builtAt !== null && this.now() - state.builtAt < this.ttlMs) return state.index;
    if (!state.refreshPromise) {
      state.refreshPromise = (async () => {
        let generation = state.generation;
        for (;;) {
          const nextIndex = await buildIndex(state.source);
          if (generation === state.generation) {
            state.index = nextIndex;
            state.builtAt = this.now();
            return;
          }
          generation = state.generation;
        }
      })().catch(error => { state.builtAt = null; throw error; })
        .finally(() => { state.refreshPromise = null; });
    }
    await state.refreshPromise;
    return state.index;
  }

  invalidate(): void {
    for (const state of this.states.values()) {
      state.builtAt = null;
      state.generation += 1;
    }
  }
}
