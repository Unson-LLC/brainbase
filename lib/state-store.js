// @ts-check
import { logger } from '../server/utils/logger.js';
import { StateFileRepository } from './state-file-repository.js';
import {
    applyStateSchemaMigrations,
    createDefaultSessions,
    deleteSessionFromList,
    normalizeSessions,
    patchSessionInList,
    reorderSessionsList,
    upsertSessionInList
} from './session-state-utils.js';

/** @typedef {Record<string, any>} AnyRecord */
/** @typedef {{ id: string, name?: string, icon?: string, path?: string, intendedState?: string, archived?: boolean, hookStatus?: string | null, ttydRunning?: boolean, runtimeStatus?: string, createdAt?: string, lastAccessedAt?: string, pausedAt?: string | null, tmuxCleanedAt?: string | null, ttydProcess?: AnyRecord | null, [key: string]: any }} StoredSession */
/** @typedef {{ schemaVersion: number, lastOpenTaskId: string | null, filters: AnyRecord, readNotifications: any[], focusSession: string | null, sessions: StoredSession[], [key: string]: any }} StoreState */

export class StateStore {
    /**
     * @param {string} stateFilePath
     * @param {string} [brainbaseRoot]
     */
    constructor(stateFilePath, brainbaseRoot = process.env.WORKSPACE_ROOT || '/path/to/workspace') {
        this.stateFilePath = stateFilePath;
        this.brainbaseRoot = brainbaseRoot;
        this._mtime = null; // 最終書き込み時のmtime
        this._watcher = null;
        this._isReloading = false;
        this._persistLock = null; // serialize concurrent persist() calls
        this._mutationLock = null; // serialize state mutations
        this.defaultSessions = createDefaultSessions(this.brainbaseRoot);
        this.fileRepository = new StateFileRepository(this.stateFilePath, logger);
        /** @type {StoreState} */
        this.state = {
            schemaVersion: 2,  // Phase 2: Schema version tracking
            lastOpenTaskId: null,
            filters: {},
            readNotifications: [],
            focusSession: null,
            sessions: this.defaultSessions
        };
    }

    async init() {
        try {
            // Clean up orphaned tmp files from previous crashes
            await this.cleanupOrphanedTmpFiles();

            const loadedState = await this._loadStateWithRecovery();
            if (loadedState) {
                this.state = { ...this.state, ...loadedState };
                logger.info(`[StateStore] Loaded ${this.state.sessions?.length || 0} sessions, schemaVersion=${this.state.schemaVersion}`);
            } else {
                logger.warn('[StateStore] No state loaded, using defaults');
            }

            if (this.state.sessions) {
                const previousSchemaVersion = this.state.schemaVersion || 0;
                const migration = applyStateSchemaMigrations(this.state, this.defaultSessions);
                if (previousSchemaVersion < 2 && migration.state.schemaVersion >= 2) {
                    logger.info('[StateStore Migration] Schema v2 migration completed');
                }
                if (previousSchemaVersion < 3 && migration.state.schemaVersion >= 3) {
                    logger.info('[StateStore Migration] Schema v3 migration completed');
                }
                this.state = migration.state;
                if (migration.changed) {
                    await this.persist();
                }
            } else {
                this.state.sessions = this.defaultSessions;
            }
        } catch (error) {
            if (!(error instanceof Error) || /** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
                logger.error('Error reading state file:', { error });
            }
        }

        // ファイル監視を開始
        this._startWatcher();

        // 初回のmtimeを記録
        this._mtime = await this.fileRepository.readMtime();
    }

    /**
     * ファイル変更監視を開始
     */
    _startWatcher() {
        this._watcher = this.fileRepository.startWatcher(async () => {
            if (this._isReloading) return;

            logger.info('[StateStore] External change detected, reloading...');
            this._isReloading = true;
            try {
                await this._reloadFromFile();
            } finally {
                this._isReloading = false;
            }
        });
    }

    /**
     * ファイルから状態をリロード
     */
    async _reloadFromFile() {
        try {
            const loaded = await this._loadStateWithRecovery();
            if (loaded && this._isValid(loaded)) {
                this.state = { ...this.state, ...loaded };
                logger.info('[StateStore] Reloaded from file');

                // mtimeを更新（リロード後の競合検出を防ぐ）
                this._mtime = await this.fileRepository.readMtime();
            }
        } catch (err) {
            logger.error('[StateStore] Failed to reload', { error: err instanceof Error ? err : String(err) });
        }
    }

    /**
     * Public reload hook for controllers/services that need to reconcile
     * in-memory state with the latest state.json before failing a request.
     * @returns {Promise<StoreState>}
     */
    async reloadFromDisk() {
        if (this._isReloading) {
            while (this._isReloading) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            return this.state;
        }

        this._isReloading = true;
        try {
            await this._reloadFromFile();
            return this.state;
        } finally {
            this._isReloading = false;
        }
    }

    async _loadStateWithRecovery() {
        return this.fileRepository.loadStateWithRecovery();
    }

    /**
     * @param {string} filePath
     * @returns {Promise<StoreState | null>}
     */
    async _tryLoadState(filePath) {
        return /** @type {Promise<StoreState | null>} */ (this.fileRepository.tryLoadState(filePath));
    }

    /**
     * @param {StoreState | null | undefined} state
     * @returns {state is StoreState}
     */
    _isValid(state) {
        return this.fileRepository.isValidState(state);
    }

    /** @returns {StoreState} */
    get() {
        return this.state;
    }

    async _runMutation(mutator) {
        const MAX_RETRIES = 3;
        let lastError;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            while (this._mutationLock) {
                await this._mutationLock;
            }

            /** @type {(value?: unknown) => void} */
            let resolve = () => {};
            this._mutationLock = new Promise((r) => { resolve = r; });

            try {
                const partial = await mutator(this.state);
                if (!partial || typeof partial !== 'object') {
                    return this.state;
                }
                const nextState = { ...this.state, ...partial };
                if (Array.isArray(partial.sessions)) {
                    nextState.sessions = normalizeSessions(partial.sessions, this.state.sessions || []);
                }
                this.state = nextState;
                await this.persist();
                return this.state;
            } catch (error) {
                lastError = error;
                // persist()がコンフリクト検出時に_reloadFromFileを呼び済みなので、そのままリトライ可能
                if (error?.message === 'State conflict detected, please retry' && attempt < MAX_RETRIES) {
                    // retry
                } else {
                    throw error;
                }
            } finally {
                this._mutationLock = null;
                resolve();
            }
        }
        throw lastError;
    }

    /**
     * @param {(currentState: StoreState) => (Partial<StoreState> | Promise<Partial<StoreState>>)} mutator
     * @returns {Promise<StoreState>}
     */
    async mutate(mutator) {
        return this._runMutation(mutator);
    }

    /**
     * @param {(sessions: StoredSession[], currentState: StoreState) => (StoredSession[] | Promise<StoredSession[]>)} mutator
     * @returns {Promise<StoreState>}
     */
    async mutateSessions(mutator) {
        return this._runMutation(async (currentState) => ({
            sessions: await mutator([...(currentState.sessions || [])], currentState)
        }));
    }

    /**
     * @param {StoredSession} session
     * @param {{ insertAtStart?: boolean }} [options]
     * @returns {Promise<StoreState>}
     */
    async upsertSession(session, options = {}) {
        const { insertAtStart = false } = options;
        return this.mutateSessions((sessions) => {
            return upsertSessionInList(sessions, session, { insertAtStart });
        });
    }

    /**
     * @param {string} sessionId
     * @param {Partial<StoredSession> | ((session: StoredSession) => Partial<StoredSession> | StoredSession | null)} patch
     * @returns {Promise<StoreState>}
     */
    async patchSession(sessionId, patch) {
        return this.mutateSessions((sessions) => patchSessionInList(sessions, sessionId, patch));
    }

    /**
     * @param {string} sessionId
     * @returns {Promise<StoreState>}
     */
    async deleteSession(sessionId) {
        return this.mutateSessions((sessions) => deleteSessionFromList(sessions, sessionId));
    }

    /**
     * @param {string[]} orderedIds
     * @returns {Promise<StoreState>}
     */
    async reorderSessions(orderedIds) {
        return this.mutateSessions((sessions) => reorderSessionsList(sessions, orderedIds));
    }

    /**
     * @param {Partial<StoreState>} newState
     * @returns {Promise<StoreState>}
     */
    async update(newState) {
        return this.mutate(() => newState);
    }

    /**
     * Graceful shutdown: persist current state and stop file watcher
     */
    async cleanup() {
        logger.info('[StateStore] Cleanup: persisting final state...');
        try {
            await this.persist();
            logger.info('[StateStore] Cleanup: state persisted successfully');
        } catch (err) {
            logger.error('[StateStore] Cleanup: failed to persist state', { error: err instanceof Error ? err : String(err) });
        }
        if (this._watcher) {
            await this._watcher.close();
            this._watcher = null;
            logger.info('[StateStore] Cleanup: file watcher stopped');
        }
    }

    async persist() {
        // Serialize concurrent persist() calls to prevent race conditions
        while (this._persistLock) {
            await this._persistLock;
        }

        /** @type {(value?: unknown) => void} */
        let resolve = () => {};
        this._persistLock = new Promise(r => { resolve = r; });

        try {
            this._mtime = await this.fileRepository.writeAtomic(this.state, this._mtime, async () => {
                await this._reloadFromFile();
            });
        } catch (error) {
            throw error;
        } finally {
            this._persistLock = null;
            resolve();
        }
    }

    /**
     * Clean up orphaned tmp files left by previous crashes
     */
    async cleanupOrphanedTmpFiles() {
        await this.fileRepository.cleanupOrphanedTmpFiles();
    }
}
