import { describe, expect, it, vi } from 'vitest';
import { createEntityIndexCache } from '../src/entity-index-cache.js';

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('entity index cache', () => {
    it('builds once across sequential gets within TTL', async () => {
        const build = vi.fn(async () => ({ index: 1 }));
        const cache = createEntityIndexCache({ build, ttlMs: 60_000 });

        const results: Array<{ index: number }> = [];
        for (let i = 0; i < 10; i++) {
            results.push(await cache.get());
        }

        expect(results).toEqual(Array.from({ length: 10 }, () => ({ index: 1 })));
        expect(build).toHaveBeenCalledTimes(1);
        expect(cache.stats()).toEqual({ builds: 1, hits: 9, invalidations: 0 });
    });

    it('shares one build across concurrent gets', async () => {
        let resolveBuild: (value: { index: number }) => void = () => {};
        const build = vi.fn(
            () => new Promise<{ index: number }>((resolve) => { resolveBuild = resolve; })
        );
        const cache = createEntityIndexCache({ build, ttlMs:60_000 });

        const first = cache.get();
        const second = cache.get();
        const third = cache.get();
        expect(build).toHaveBeenCalledTimes(1);

        resolveBuild({ index: 7 });
        await expect(Promise.all([first, second, third])).resolves.toEqual([
            { index: 7 },
            { index: 7 },
            { index: 7 }
        ]);
        expect(build).toHaveBeenCalledTimes(1);
    });

    it('rebuilds after TTL using the injected clock', async () => {
        let now = 0;
        const build = vi.fn(async () => ({ now }));
        const cache = createEntityIndexCache({ build, ttlMs: 1_000, now: () => now });

        await expect(cache.get()).resolves.toEqual({ now: 0 });
        now = 500;
        await expect(cache.get()).resolves.toEqual({ now: 0 });
        expect(build).toHaveBeenCalledTimes(1);

        now = 1_001;
        await expect(cache.get()).resolves.toEqual({ now: 1_001 });
        expect(build).toHaveBeenCalledTimes(2);
        expect(cache.stats().hits).toBe(1);
    });

    it('rebuilds after invalidate', async () => {
        const build = vi.fn(async () => ({ n: 1 }));
        const cache = createEntityIndexCache({ build, ttlMs: 60_000 });

        await cache.get();
        await cache.get();
        expect(build).toHaveBeenCalledTimes(1);

        cache.invalidate();
        await cache.get();
        expect(build).toHaveBeenCalledTimes(2);
        expect(cache.stats().invalidations).toBe(1);
    });

    it('discards an in-flight build that started before invalidate', async () => {
        const resolvers: Array<(value: string) => void> = [];
        const build = vi.fn(() => new Promise<string>((resolve) => { resolvers.push(resolve); }));
        const cache = createEntityIndexCache({ build, ttlMs: 60_000 });

        const pending = cache.get();
        expect(build).toHaveBeenCalledTimes(1);

        cache.invalidate();
        resolvers[0]('stale');
        await flush();
        expect(build).toHaveBeenCalledTimes(2);

        resolvers[1]('fresh');
        await expect(pending).resolves.toBe('fresh');
        expect(build).toHaveBeenCalledTimes(2);
    });

    it('rebuilds when revision changes and keeps a hit when it does not', async () => {
        let revision = 'v1';
        const build = vi.fn(async () => ({ revision }));
        const cache = createEntityIndexCache({
            build,
            ttlMs: 60_000,
            revision: async () => revision
        });

        await cache.get();
        await cache.get();
        expect(build).toHaveBeenCalledTimes(1);

        revision = 'v2';
        await cache.get();
        expect(build).toHaveBeenCalledTimes(2);

        await cache.get();
        expect(build).toHaveBeenCalledTimes(2);
    });

    it('rebuilds when revision lookup fails', async () => {
        let fail = false;
        const build = vi.fn(async () => ({ n: 1 }));
        const cache = createEntityIndexCache({
            build,
            ttlMs: 60_000,
            revision: async () => {
                if (fail) throw new Error('revision unavailable');
                return 'v1';
            }
        });

        await cache.get();
        await cache.get();
        expect(build).toHaveBeenCalledTimes(1);

        fail = true;
        await cache.get();
        expect(build).toHaveBeenCalledTimes(2);
    });

    it('throws on build failure and retries on the next get', async () => {
        let fail = true;
        const build = vi.fn(async () => {
            if (fail) throw new Error('build failed');
            return { n: 42 };
        });
        const cache = createEntityIndexCache({ build, ttlMs: 60_000 });

        await expect(cache.get()).rejects.toThrow('build failed');
        expect(cache.peek()).toBeNull();

        fail = false;
        await expect(cache.get()).resolves.toEqual({ n: 42 });
        expect(build).toHaveBeenCalledTimes(2);
    });

    it('does not serve the previous value after a failed rebuild', async () => {
        let now = 0;
        let fail = false;
        const build = vi.fn(async () => {
            if (fail) throw new Error('build failed');
            return { n: now };
        });
        const cache = createEntityIndexCache({ build, ttlMs: 1_000, now: () => now });

        await expect(cache.get()).resolves.toEqual({ n: 0 });
        now = 2_000;
        fail = true;
        await expect(cache.get()).rejects.toThrow('build failed');

        fail = false;
        await expect(cache.get()).resolves.toEqual({ n: 2_000 });
        expect(build).toHaveBeenCalledTimes(3);
    });

    it('throws for an invalid ttlMs', () => {
        expect(() => createEntityIndexCache({ build: async () => 1, ttlMs: Number.NaN })).toThrow();
        expect(() => createEntityIndexCache({ build: async () => 1, ttlMs: 0 })).toThrow();
        expect(() => createEntityIndexCache({ build: async () => 1, ttlMs: -1 })).toThrow();
        expect(() => createEntityIndexCache({ build: async () => 1, ttlMs: Number.POSITIVE_INFINITY })).toThrow();
    });

    it('throws when build is missing', () => {
        expect(() => createEntityIndexCache({ ttlMs: 1_000 } as never)).toThrow();
    });
});
