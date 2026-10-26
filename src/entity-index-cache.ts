/**
 * Reusable, host-independent entity index cache.
 *
 * A host that resolves entity indexes (search, list_entities, get_entity,
 * resolve_entity) rebuilds the whole index on every call today. This cache
 * keeps a single in-memory index and only rebuilds when the TTL expires, the
 * caller invalidates it, or an optional revision marker changes. It is
 * provider-agnostic and stores no tenant, member, role, approval, or audit
 * data; the caller supplies both the index builder and the optional revision
 * change detector.
 */

export interface EntityIndexCacheOptions<T> {
  build: () => Promise<T>;
  ttlMs: number;
  now?: () => number;
  revision?: () => Promise<string | null | undefined>;
}

export interface EntityIndexCachePeek<T> {
  value: T;
  builtAt: number;
  revision?: string;
}

export interface EntityIndexCacheStats {
  builds: number;
  hits: number;
  invalidations: number;
}

export interface EntityIndexCache<T> {
  get(): Promise<T>;
  invalidate(reason?: string): void;
  peek(): EntityIndexCachePeek<T> | null;
  stats(): EntityIndexCacheStats;
}

interface EntityIndexCacheEntry<T> {
  value: T;
  builtAt: number;
  revision: string | null | undefined;
}

export function createEntityIndexCache<T>(options: EntityIndexCacheOptions<T>): EntityIndexCache<T> {
  if (typeof options?.build !== 'function') {
    throw new TypeError('entity index cache requires a build function');
  }
  if (typeof options.ttlMs !== 'number' || !Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
    throw new TypeError('entity index cache ttlMs must be a positive finite number');
  }

  const now = options.now ?? Date.now;
  const revisionFn = options.revision;

  let entry: EntityIndexCacheEntry<T> | null = null;
  let inflight: Promise<EntityIndexCacheEntry<T>> | null = null;
  let inflightGeneration = -1;
  let generation = 0;
  let builds = 0;
  let hits = 0;
  let invalidations = 0;

  async function runBuild(): Promise<{ entry: EntityIndexCacheEntry<T>; generation: number }> {
    if (!inflight) {
      const startedGeneration = generation;
      const promise = (async () => {
        builds++;
        try {
          const value = await options.build();
          let revision: string | null | undefined;
          if (revisionFn) {
            try {
              revision = await revisionFn();
            } catch {
              revision = undefined;
            }
          }
          return { value, revision } as EntityIndexCacheEntry<T>;
        } catch (error) {
          entry = null;
          throw error;
        }
      })();
      inflight = promise.finally(() => {
        inflight = null;
        inflightGeneration = -1;
      });
      inflightGeneration = startedGeneration;
    }
    const startedGeneration = inflightGeneration;
    const built = await inflight;
    return { entry: built, generation: startedGeneration };
  }

  async function get(): Promise<T> {
    while (true) {
      const startedGeneration = generation;
      if (entry && now() - entry.builtAt < options.ttlMs) {
        let serve = true;
        if (revisionFn) {
          try {
            const revision = await revisionFn();
            if (revision !== entry.revision) {
              serve = false;
            }
          } catch {
            serve = false;
          }
        }
        if (serve && startedGeneration === generation) {
          hits++;
          return entry.value;
        }
      }

      const { entry: built, generation: builtGeneration } = await runBuild();
      if (builtGeneration !== generation) {
        continue;
      }
      entry = { ...built, builtAt: now() };
      return entry.value;
    }
  }

  function invalidate(_reason?: string): void {
    invalidations++;
    entry = null;
    generation++;
  }

  function peek(): EntityIndexCachePeek<T> | null {
    if (!entry) {
      return null;
    }
    const result: EntityIndexCachePeek<T> = { value: entry.value, builtAt: entry.builtAt };
    if (typeof entry.revision === 'string') {
      result.revision = entry.revision;
    }
    return result;
  }

  function stats(): EntityIndexCacheStats {
    return { builds, hits, invalidations };
  }

  return { get, invalidate, peek, stats };
}
