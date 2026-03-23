import { TmuxControlClient } from './tmux-control-client.js';

export class TmuxControlRegistry {
    constructor(options = {}) {
        this.options = options;
        this.entries = new Map();
    }

    acquire(sessionId) {
        const existing = this.entries.get(sessionId);
        if (existing) {
            existing.refCount += 1;
            if (existing.releaseTimer) {
                clearTimeout(existing.releaseTimer);
                existing.releaseTimer = null;
            }
            existing.client.touch();
            return existing.client;
        }

        const client = new TmuxControlClient({
            sessionId,
            idleTimeoutMs: this.options.idleTimeoutMs,
            spawnFn: this.options.spawnFn
        });
        client.start();
        client.on('exit', () => {
            const entry = this.entries.get(sessionId);
            if (entry?.client === client) {
                this.entries.delete(sessionId);
            }
        });

        this.entries.set(sessionId, {
            client,
            refCount: 1,
            releaseTimer: null
        });
        return client;
    }

    release(sessionId, client) {
        const entry = this.entries.get(sessionId);
        if (!entry || (client && entry.client !== client)) return;

        entry.refCount = Math.max(0, entry.refCount - 1);
        if (entry.refCount > 0) return;

        entry.releaseTimer = setTimeout(() => {
            const current = this.entries.get(sessionId);
            if (!current || current.client !== entry.client || current.refCount > 0) return;
            current.client.close();
            this.entries.delete(sessionId);
        }, this.options.idleTimeoutMs || 60_000);
    }
}
