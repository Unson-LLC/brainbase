// @ts-check
const DEFAULT_CAPTURE_TTL_MS = 3000;

function buildCacheKey(sessionId, options) {
    const { lines, includeColors, includeCopyMode } = options;
    return `${sessionId}|${lines}|${includeColors ? 1 : 0}|${includeCopyMode ? 1 : 0}`;
}

export class TmuxCaptureCache {
    constructor({ sessionManager, ttlMs = DEFAULT_CAPTURE_TTL_MS }) {
        this.sessionManager = sessionManager;
        this.ttlMs = ttlMs;
        this.cache = new Map();
        this.pending = new Map();
    }

    invalidate(sessionId = null) {
        if (!sessionId) {
            this.cache.clear();
            this.pending.clear();
            return;
        }

        const prefix = `${sessionId}|`;
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
            }
        }
        for (const key of this.pending.keys()) {
            if (key.startsWith(prefix)) {
                this.pending.delete(key);
            }
        }
    }

    async getSnapshot(sessionId, options = {}) {
        const normalized = {
            lines: Math.max(50, Math.min(400, Number.parseInt(options.lines, 10) || 200)),
            includeColors: options.includeColors !== false,
            includeCopyMode: options.includeCopyMode !== false
        };
        const key = buildCacheKey(sessionId, normalized);
        const cached = this.cache.get(key);

        if (cached && (Date.now() - cached.cachedAt) < this.ttlMs) {
            return cached.payload;
        }

        if (this.pending.has(key)) {
            return await this.pending.get(key);
        }

        const pendingPromise = (async () => {
            const [text, colorText, copyMode] = await Promise.all([
                this.sessionManager.getContent(sessionId, normalized.lines),
                normalized.includeColors
                    ? this.sessionManager.getContentWithColors(sessionId, normalized.lines).catch(() => null)
                    : Promise.resolve(null),
                normalized.includeCopyMode
                    ? this.sessionManager.getPaneMode(sessionId).catch(() => false)
                    : Promise.resolve(false)
            ]);

            const payload = {
                text,
                colorText,
                copyMode,
                capturedAt: new Date().toISOString()
            };
            this.cache.set(key, {
                cachedAt: Date.now(),
                payload
            });
            return payload;
        })();

        this.pending.set(key, pendingPromise);
        try {
            return await pendingPromise;
        } finally {
            this.pending.delete(key);
        }
    }
}

export { DEFAULT_CAPTURE_TTL_MS };
