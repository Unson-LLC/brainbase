import fs from 'fs';
import path from 'path';

export const TERMINAL_RUNTIME_STATE = Object.freeze({
    STOPPED: 'stopped',
    STARTING: 'starting',
    SNAPSHOT_ONLY: 'snapshot_only',
    TRANSPORT_CONNECTED: 'transport_connected',
    INTERACTIVE_READY: 'interactive_ready',
    DEGRADED: 'degraded',
    RECOVERING: 'recovering',
    BLOCKED_BY_OWNER: 'blocked_by_owner'
});

function nowIso() {
    return new Date().toISOString();
}

function emptyRegistry(serverGeneration = null) {
    return {
        version: 1,
        serverGeneration,
        sessions: {}
    };
}

function mergeObserved(existing = {}, patch = {}) {
    const merged = { ...existing };
    for (const [key, value] of Object.entries(patch || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            merged[key] = {
                ...(existing?.[key] && typeof existing[key] === 'object' && !Array.isArray(existing[key]) ? existing[key] : {}),
                ...value
            };
        } else {
            merged[key] = value;
        }
    }
    return merged;
}

export class TerminalRuntimeRegistry {
    constructor({ filePath, serverGeneration = null, logger = console } = {}) {
        if (!filePath) {
            throw new Error('TerminalRuntimeRegistry filePath is required');
        }
        this.filePath = filePath;
        this.serverGeneration = serverGeneration;
        this.logger = logger;
        this._data = null;
    }

    load() {
        if (this._data) return this._data;

        try {
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            this._data = {
                ...emptyRegistry(this.serverGeneration),
                ...parsed,
                serverGeneration: this.serverGeneration || parsed.serverGeneration || null,
                sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {}
            };
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                this.logger.warn?.(`[TerminalRuntimeRegistry] Failed to load registry, starting empty: ${error.message}`);
            }
            this._data = emptyRegistry(this.serverGeneration);
        }

        return this._data;
    }

    getAll() {
        return structuredClone(this.load());
    }

    getSession(sessionId) {
        if (!sessionId) return null;
        const data = this.load();
        const entry = data.sessions?.[sessionId];
        return entry ? structuredClone(entry) : null;
    }

    updateServerGeneration(serverGeneration) {
        this.serverGeneration = serverGeneration || null;
        const data = this.load();
        data.serverGeneration = this.serverGeneration;
        this.save();
    }

    updateSession(sessionId, patch = {}) {
        if (!sessionId) {
            throw new Error('sessionId is required');
        }

        const data = this.load();
        const existing = data.sessions[sessionId] || { sessionId, observed: {} };
        data.sessions[sessionId] = {
            ...existing,
            ...patch,
            sessionId,
            observed: mergeObserved(existing.observed || {}, patch.observed || {}),
            updatedAt: nowIso()
        };
        this.save();
        return structuredClone(data.sessions[sessionId]);
    }

    setInputProbe(sessionId, probe) {
        const existing = this.getSession(sessionId) || { observed: {} };
        return this.updateSession(sessionId, {
            observed: {
                ...(existing.observed || {}),
                inputProbe: {
                    ...(existing.observed?.inputProbe || {}),
                    ...probe
                }
            },
            runtimeState: probe?.status === 'passed'
                ? TERMINAL_RUNTIME_STATE.INTERACTIVE_READY
                : TERMINAL_RUNTIME_STATE.DEGRADED
        });
    }

    setGateway(sessionId, gateway) {
        return this.updateSession(sessionId, {
            observed: {
                gateway: {
                    ...(gateway || {}),
                    lastSeenAt: gateway?.lastSeenAt || nowIso()
                }
            }
        });
    }

    setCliState(sessionId, cli) {
        return this.updateSession(sessionId, {
            observed: {
                cli: {
                    ...(cli || {}),
                    observedAt: cli?.observedAt || nowIso()
                }
            }
        });
    }

    removeSession(sessionId) {
        const data = this.load();
        delete data.sessions[sessionId];
        this.save();
    }

    save() {
        const data = this.load();
        data.version = 1;
        data.serverGeneration = this.serverGeneration || data.serverGeneration || null;

        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
        fs.renameSync(tmpPath, this.filePath);
    }
}
