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

export class EntityIndexUnstableError extends Error {
  readonly code = 'entity_index_unstable';

  constructor(message: string) {
    super(message);
    this.name = 'EntityIndexUnstableError';
  }
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

  const MAX_STABLE_BUILD_ATTEMPTS = 3;
  const MAX_RESOLVE_ATTEMPTS = 3;

  let entry: EntityIndexCacheEntry<T> | null = null;
  let inflightGet: Promise<T> | null = null;
  let generation = 0;
  let builds = 0;
  let hits = 0;
  let invalidations = 0;

  interface RevisionRead {
    ok: boolean;
    value: string | null | undefined;
  }

  async function readRevision(): Promise<RevisionRead> {
    if (!revisionFn) {
      return { ok: true, value: undefined };
    }
    try {
      return { ok: true, value: await revisionFn() };
    } catch {
      return { ok: false, value: undefined };
    }
  }

  interface StableBuild<T> {
    value: T;
    revision: string | null | undefined;
    commit: boolean;
  }

  async function buildStable(): Promise<StableBuild<T>> {
    for (let attempt = 1; ; attempt++) {
      let before: RevisionRead = { ok: true, value: undefined };
      if (revisionFn) {
        before = await readRevision();
      }

      builds++;
      const value = await options.build();

      let after: RevisionRead = { ok: true, value: undefined };
      if (revisionFn) {
        after = await readRevision();
      }

      if (!before.ok || !after.ok) {
        // Fail-closed: when the revision cannot be read before or after the
        // build we cannot prove the index is current, so it is never cached.
        // The freshly built value is still returned to this caller (matching
        // the serve path, which rebuilds rather than rejects on a revision
        // read failure), but the next get() rebuilds instead of serving an
        // unverified index within the TTL.
        return { value, revision: undefined, commit: false };
      }
      if (before.value === after.value) {
        return { value, revision: after.value, commit: true };
      }
      if (attempt >= MAX_STABLE_BUILD_ATTEMPTS) {
        throw new EntityIndexUnstableError(
          `entity index did not stabilize after ${MAX_STABLE_BUILD_ATTEMPTS} builds: revision kept changing`
        );
      }
    }
  }

  async function resolve(): Promise<T> {
    for (let attempt = 1; ; attempt++) {
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

      let built: StableBuild<T>;
      try {
        built = await buildStable();
      } catch (error) {
        entry = null;
        throw error;
      }

      if (startedGeneration !== generation) {
        if (attempt >= MAX_RESOLVE_ATTEMPTS) {
          throw new EntityIndexUnstableError(
            `entity index was invalidated ${MAX_RESOLVE_ATTEMPTS} times while resolving; giving up`
          );
        }
        continue;
      }

      if (built.commit) {
        entry = { value: built.value, builtAt: now(), revision: built.revision };
      }
      return built.value;
    }
  }

  function get(): Promise<T> {
    if (inflightGet) {
      return inflightGet;
    }
    const promise = resolve().finally(() => {
      inflightGet = null;
    });
    inflightGet = promise;
    return promise;
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
