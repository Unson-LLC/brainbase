// @ts-check
import fs from 'fs/promises';
import path from 'path';
import chokidar from 'chokidar';

/** @typedef {{ schemaVersion?: number, sessions?: unknown[], [key: string]: any }} StateLike */

export class StateFileRepository {
    /**
     * @param {string} stateFilePath
     * @param {{ info: Function, warn: Function, error: Function }} logger
     */
    constructor(stateFilePath, logger) {
        this.stateFilePath = stateFilePath;
        this.logger = logger;
        this.watcher = null;
    }

    async cleanupOrphanedTmpFiles() {
        try {
            const dir = path.dirname(this.stateFilePath);
            const base = path.basename(this.stateFilePath);
            const entries = await fs.readdir(dir);
            const tmpFiles = entries.filter((entry) => entry.startsWith(base + '.tmp-'));
            if (tmpFiles.length > 0) {
                this.logger.info(`[StateStore] Cleaning up ${tmpFiles.length} orphaned tmp files`);
                await Promise.all(tmpFiles.map((file) => fs.unlink(path.join(dir, file)).catch(() => {})));
            }
        } catch (err) {
            this.logger.warn('[StateStore] Failed to clean up tmp files', { error: err instanceof Error ? err : String(err) });
        }
    }

    startWatcher(onChange) {
        this.watcher = chokidar.watch(this.stateFilePath, {
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 100,
                pollInterval: 50
            }
        });
        this.watcher.on('change', onChange);
        return this.watcher;
    }

    async readMtime() {
        try {
            const stat = await fs.stat(this.stateFilePath);
            return stat.mtimeMs;
        } catch {
            return null;
        }
    }

    async loadStateWithRecovery() {
        this.logger.info(`[StateStore] Loading state from: ${this.stateFilePath}`);

        const backupChain = [
            { path: this.stateFilePath, label: 'primary' },
            { path: this.stateFilePath + '.bak', label: 'backup (.bak)' },
            { path: this.stateFilePath + '.clean', label: 'clean backup (.clean)' },
            { path: this.stateFilePath + '.before-name-restore', label: 'restore backup' },
            { path: this.stateFilePath + '.before-name-fix', label: 'fix backup' }
        ];

        for (const { path: filePath, label } of backupChain) {
            const state = await this.tryLoadState(filePath);
            if (state && this.isValidState(state)) {
                const sessionCount = state.sessions?.length || 0;
                if (label === 'primary') {
                    this.logger.info(`[StateStore] Primary load result: ${sessionCount} sessions`);
                } else {
                    this.logger.warn(`[StateStore] ⚠️ FALLBACK RECOVERY from ${label}: ${sessionCount} sessions — recent changes (renames, archives) may be lost!`);
                }
                return state;
            }
        }

        this.logger.error('[StateStore] No valid state found in backup chain, using defaults');
        this.logger.info('[StateStore] Primary load result: null');
        return null;
    }

    async tryLoadState(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return /** @type {StateLike} */ (JSON.parse(content));
        } catch (error) {
            const err = /** @type {NodeJS.ErrnoException} */ (error);
            this.logger.warn(`[StateStore] Failed to load ${filePath}: ${err.code || err.message}`);
            return null;
        }
    }

    isValidState(state) {
        return Boolean(state && Array.isArray(state.sessions) && state.sessions.length > 0);
    }

    /**
     * @param {StateLike} state
     * @param {number | null} knownMtime
     * @param {() => Promise<void>} reloadForConflict
     * @returns {Promise<number | null>}
     */
    async writeAtomic(state, knownMtime, reloadForConflict) {
        const tmpPath = `${this.stateFilePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        try {
            const currentMtime = await this.readMtime();
            if (knownMtime !== null && currentMtime !== null && currentMtime > knownMtime) {
                this.logger.warn('[StateStore] Conflict detected (external edit), reloading...');
                await reloadForConflict();
                throw new Error('State conflict detected, please retry');
            }

            const data = JSON.stringify(state, null, 2);
            const bakPath = this.stateFilePath + '.bak';

            await fs.writeFile(tmpPath, data);
            try {
                await fs.copyFile(this.stateFilePath, bakPath);
            } catch {
                // state.json may not exist yet.
            }
            await fs.rename(tmpPath, this.stateFilePath);
            return this.readMtime();
        } catch (error) {
            try { await fs.unlink(tmpPath); } catch { /* ignore */ }
            this.logger.error('Error writing state file:', { error });
            throw error;
        }
    }
}
