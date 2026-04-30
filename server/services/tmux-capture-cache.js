// @ts-check
const DEFAULT_CAPTURE_TTL_MS = 3000;

/**
 * @typedef {object} TmuxCaptureOptions
 * @property {number|string} [lines]
 * @property {boolean} [includeColors]
 * @property {boolean} [includeCopyMode]
 * @property {boolean} [visibleOnly]
 */

/**
 * @typedef {object} TmuxCapturePayload
 * @property {string} text
 * @property {string|null} colorText
 * @property {boolean} copyMode
 * @property {{x: number, y: number}|null} [cursor]
 * @property {string} capturedAt
 */

/**
 * @typedef {object} TmuxCaptureCacheEntry
 * @property {number} cachedAt
 * @property {TmuxCapturePayload} payload
 */

/**
 * @typedef {object} TmuxSnapshotService
 * @property {(sessionId: string, lines: number) => Promise<string>} getContent
 * @property {(sessionId: string) => Promise<string>} [getVisibleContent]
 * @property {(sessionId: string, lines: number) => Promise<string>} getContentWithColors
 * @property {(sessionId: string) => Promise<string>} [getVisibleContentWithColors]
 * @property {(sessionId: string) => Promise<boolean>} getPaneMode
 * @property {(sessionId: string) => Promise<{x: number, y: number}|null>} [getCursorPosition]
 */

/**
 * @param {string} sessionId
 * @param {TmuxCaptureOptions} options
 * @returns {string}
 */
function buildCacheKey(sessionId, options) {
    const { lines, includeColors, includeCopyMode, visibleOnly } = options;
    return `${sessionId}|${lines}|${includeColors ? 1 : 0}|${includeCopyMode ? 1 : 0}|${visibleOnly ? 1 : 0}`;
}

export class TmuxCaptureCache {
    /**
     * @param {{ snapshotService?: TmuxSnapshotService, sessionManager?: TmuxSnapshotService, ttlMs?: number }} param0
     */
    constructor({ snapshotService = null, sessionManager = null, ttlMs = DEFAULT_CAPTURE_TTL_MS }) {
        this.snapshotService = snapshotService || sessionManager;
        this.ttlMs = ttlMs;
        /** @type {Map<string, TmuxCaptureCacheEntry>} */
        this.cache = new Map();
        /** @type {Map<string, Promise<TmuxCapturePayload>>} */
        this.pending = new Map();
        // session -> epoch: invalidate で increment、in-flight capture が
        // 完了時に自分の epoch と現 epoch を比較し、古ければ cache.set を skip する。
        // これにより「invalidate 直後に in-flight な capture が古い payload で cache を上書きする」
        // race condition を防ぐ。
        /** @type {Map<string, number>} */
        this.sessionEpoch = new Map();
    }

    _getEpoch(sessionId) {
        return this.sessionEpoch.get(sessionId) || 0;
    }

    _bumpEpoch(sessionId) {
        const next = this._getEpoch(sessionId) + 1;
        this.sessionEpoch.set(sessionId, next);
        return next;
    }

    /**
     * @param {string|null} [sessionId]
     * @returns {void}
     */
    invalidate(sessionId = null) {
        if (!sessionId) {
            this.cache.clear();
            this.pending.clear();
            // 全セッションの epoch を bump
            for (const sid of this.sessionEpoch.keys()) {
                this._bumpEpoch(sid);
            }
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
        // 該当 session の epoch を bump → in-flight な capture は cache.set を skip する
        this._bumpEpoch(sessionId);
    }

    /**
     * @param {string} sessionId
     * @param {TmuxCaptureOptions} [options]
     * @returns {Promise<TmuxCapturePayload>}
     */
    async getSnapshot(sessionId, options = {}) {
        const normalized = {
            lines: Math.max(50, Math.min(400, Number.parseInt(options.lines, 10) || 200)),
            includeColors: options.includeColors !== false,
            includeCopyMode: options.includeCopyMode !== false,
            visibleOnly: options.visibleOnly === true
        };
        const key = buildCacheKey(sessionId, normalized);

        // epoch が変わったときは最大3回まで retry して fresh payload を取り直す。
        // これにより「invalidate と capture の race」で stale payload が返るのを防ぐ。
        const MAX_ATTEMPTS = 3;
        let lastPayload = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
            const cached = this.cache.get(key);
            if (cached && (Date.now() - cached.cachedAt) < this.ttlMs) {
                return cached.payload;
            }

            if (this.pending.has(key)) {
                lastPayload = await this.pending.get(key);
                // pending は別 caller が走らせたものなので epoch チェックを再実行する
                const epochAfter = this._getEpoch(sessionId);
                // この pending を取得した時点では startEpoch は不明なので、
                // 単純に cache.has(key) で判定する: cache にちゃんと set されていれば fresh、
                // skip されていれば epoch ずれが起きたので retry。
                if (this.cache.has(key)) {
                    return lastPayload;
                }
                continue; // retry
            }

            const startEpoch = this._getEpoch(sessionId);
            const pendingPromise = (async () => {
                const getText = normalized.visibleOnly && typeof this.snapshotService.getVisibleContent === 'function'
                    ? () => this.snapshotService.getVisibleContent(sessionId)
                    : () => this.snapshotService.getContent(sessionId, normalized.lines);
                const getColorText = normalized.visibleOnly && typeof this.snapshotService.getVisibleContentWithColors === 'function'
                    ? () => this.snapshotService.getVisibleContentWithColors(sessionId)
                    : () => this.snapshotService.getContentWithColors(sessionId, normalized.lines);
                const [text, colorText, copyMode, cursor] = await Promise.all([
                    getText(),
                    normalized.includeColors ? getColorText().catch(() => null) : Promise.resolve(null),
                    normalized.includeCopyMode
                        ? this.snapshotService.getPaneMode(sessionId).catch(() => false)
                        : Promise.resolve(false),
                    typeof this.snapshotService.getCursorPosition === 'function'
                        ? this.snapshotService.getCursorPosition(sessionId).catch(() => null)
                        : Promise.resolve(null)
                ]);

                /** @type {TmuxCapturePayload} */
                const payload = {
                    text,
                    colorText,
                    copyMode,
                    cursor,
                    capturedAt: new Date().toISOString()
                };
                // この capture が走り始めた後で invalidate が呼ばれた場合は cache.set しない。
                const currentEpoch = this._getEpoch(sessionId);
                if (currentEpoch === startEpoch) {
                    this.cache.set(key, {
                        cachedAt: Date.now(),
                        payload
                    });
                }
                return payload;
            })();

            this.pending.set(key, pendingPromise);
            try {
                lastPayload = await pendingPromise;
            } finally {
                if (this.pending.get(key) === pendingPromise) {
                    this.pending.delete(key);
                }
            }

            // capture 後に epoch が変わっていれば retry。最終 attempt なら諦めて lastPayload を返す。
            const endEpoch = this._getEpoch(sessionId);
            if (endEpoch === startEpoch) {
                return lastPayload;
            }
            // epoch が変わったので cache に入っていない → ループして retry
        }

        return lastPayload;
    }
}

export { DEFAULT_CAPTURE_TTL_MS };
