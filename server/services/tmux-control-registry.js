// @ts-check
import { TmuxControlClient } from './tmux-control-client.js';

/**
 * @typedef {object} RegistryOptions
 * @property {number} [idleTimeoutMs]
 * @property {typeof import('child_process').spawn} [spawnFn]
 */

/**
 * @typedef {object} RegistryEntry
 * @property {TmuxControlClient} client
 * @property {number} refCount
 * @property {ReturnType<typeof setTimeout>|null} releaseTimer
 */

export class TmuxControlRegistry {
    /**
     * @param {RegistryOptions} [options]
     */
    constructor(options = {}) {
        this.options = options;
        /** @type {Map<string, RegistryEntry>} */
        this.entries = new Map();
    }

    /**
     * @param {string} sessionId
     * @returns {TmuxControlClient}
     */
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

    /**
     * @param {string} sessionId
     * @param {TmuxControlClient} [client]
     * @returns {void}
     */
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
