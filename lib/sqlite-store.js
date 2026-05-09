// @ts-check
import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import { logger } from '../server/utils/logger.js';
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

const META_FIELDS = ['schemaVersion', 'lastOpenTaskId', 'filters', 'readNotifications', 'focusSession'];

export class SqliteStore {
    /**
     * @param {string} stateFilePath - Path to state.json (used for migration; DB lives alongside as state.db)
     * @param {string} [brainbaseRoot]
     */
    constructor(stateFilePath, brainbaseRoot = process.env.WORKSPACE_ROOT || '/path/to/workspace') {
        this.stateFilePath = stateFilePath;
        this.dbPath = stateFilePath.replace(/\.json$/, '.db');
        this.brainbaseRoot = brainbaseRoot;
        /** @type {Database.Database | null} */
        this.db = null;
        this._mutationLock = null;
        this.defaultSessions = createDefaultSessions(this.brainbaseRoot);
        /** @type {StoreState} */
        this.state = {
            schemaVersion: 3,
            lastOpenTaskId: null,
            filters: {},
            readNotifications: [],
            focusSession: null,
            sessions: this.defaultSessions
        };
    }

    async init() {
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS state_meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id       TEXT PRIMARY KEY,
                data     TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
            );
        `);

        const { cnt } = /** @type {{ cnt: number }} */ (
            this.db.prepare('SELECT COUNT(*) as cnt FROM sessions').get()
        );

        if (cnt === 0) {
            await this._migrateFromJson();
        } else {
            this._loadFromDb();
        }

        logger.info(`[SqliteStore] Loaded ${this.state.sessions?.length || 0} sessions (schemaVersion=${this.state.schemaVersion})`);
    }

    async _migrateFromJson() {
        const candidates = [
            this.stateFilePath,
            this.stateFilePath + '.bak',
            this.stateFilePath + '.clean',
            this.stateFilePath + '.before-name-restore',
            this.stateFilePath + '.before-name-fix'
        ];

        let jsonState = null;
        let sourcePath = null;
        for (const filePath of candidates) {
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                const parsed = /** @type {StoreState} */ (JSON.parse(content));
                if (parsed && Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
                    jsonState = parsed;
                    sourcePath = filePath;
                    break;
                }
            } catch {
                // ignore
            }
        }

        if (jsonState) {
            logger.info(`[SqliteStore] Migrating from ${sourcePath} (${jsonState.sessions.length} sessions)`);
            jsonState = this._applyMigrations(jsonState);

            const saveTx = this.db.transaction(() => {
                this._saveStateToDb(jsonState);
            });
            saveTx();

            this.state = jsonState;

            // Backup state.json before SQLite takes over
            try {
                await fs.copyFile(this.stateFilePath, this.stateFilePath + '.bak-before-sqlite');
                logger.info('[SqliteStore] Backed up state.json → state.json.bak-before-sqlite');
            } catch {
                // ignore if doesn't exist
            }

            const { cnt } = /** @type {{ cnt: number }} */ (
                this.db.prepare('SELECT COUNT(*) as cnt FROM sessions').get()
            );
            if (cnt !== jsonState.sessions.length) {
                throw new Error(`[SqliteStore] Migration verification failed: expected ${jsonState.sessions.length}, got ${cnt}`);
            }
            logger.info(`[SqliteStore] Migration complete: ${jsonState.sessions.length} sessions`);
        } else {
            logger.warn('[SqliteStore] No existing state.json found, starting with defaults');
            this.state.sessions = this.defaultSessions;
            const saveTx = this.db.transaction(() => {
                this._saveStateToDb(this.state);
            });
            saveTx();
        }
    }

    /**
     * @param {StoreState} state
     * @returns {StoreState}
     */
    _applyMigrations(state) {
        return applyStateSchemaMigrations(state, this.defaultSessions).state;
    }

    _loadFromDb() {
        const metaRows = /** @type {{ key: string, value: string }[]} */ (
            this.db.prepare('SELECT key, value FROM state_meta').all()
        );
        const meta = /** @type {Record<string, any>} */ ({});
        for (const row of metaRows) {
            try { meta[row.key] = JSON.parse(row.value); } catch { meta[row.key] = null; }
        }

        const sessionRows = /** @type {{ data: string }[]} */ (
            this.db.prepare('SELECT data FROM sessions ORDER BY position ASC').all()
        );
        const sessions = sessionRows.map(row => {
            try { return JSON.parse(row.data); } catch { return null; }
        }).filter(Boolean);

        this.state = {
            schemaVersion: meta.schemaVersion ?? 3,
            lastOpenTaskId: meta.lastOpenTaskId ?? null,
            filters: meta.filters ?? {},
            readNotifications: meta.readNotifications ?? [],
            focusSession: meta.focusSession ?? null,
            sessions
        };
    }

    /**
     * @param {StoreState} state
     */
    _saveStateToDb(state) {
        const upsertMeta = this.db.prepare('INSERT OR REPLACE INTO state_meta (key, value) VALUES (?, ?)');
        for (const key of META_FIELDS) {
            upsertMeta.run(key, JSON.stringify(state[key] ?? null));
        }

        this.db.prepare('DELETE FROM sessions').run();
        const insertSession = this.db.prepare('INSERT INTO sessions (id, data, position) VALUES (?, ?, ?)');
        (state.sessions || []).forEach((session, idx) => {
            insertSession.run(session.id, JSON.stringify(session), idx);
        });
    }

    /** @returns {StoreState} */
    get() {
        return this.state;
    }

    /**
     * @param {(currentState: StoreState) => (Partial<StoreState> | Promise<Partial<StoreState>>)} mutator
     * @returns {Promise<StoreState>}
     */
    async _runMutation(mutator) {
        while (this._mutationLock) {
            await this._mutationLock;
        }

        let resolve = () => {};
        this._mutationLock = new Promise((r) => { resolve = r; });

        try {
            // Execute async mutator OUTSIDE the DB transaction
            const partial = await mutator(this.state);
            if (!partial || typeof partial !== 'object') {
                return this.state;
            }

            const nextState = { ...this.state, ...partial };
            if (Array.isArray(partial.sessions)) {
                nextState.sessions = normalizeSessions(partial.sessions, this.state.sessions || []);
            }

            // Write to DB in synchronous transaction (atomic)
            const saveTx = this.db.transaction(() => {
                this._saveStateToDb(nextState);
            });
            saveTx();

            this.state = nextState;
            return this.state;
        } finally {
            this._mutationLock = null;
            resolve();
        }
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
     * No-op: kept for API compatibility. SQLite writes are immediately durable.
     * @returns {Promise<void>}
     */
    async persist() {
        // SQLite transactions are synchronous and immediately durable — no-op here.
    }

    /**
     * No-op: kept for API compatibility. In-memory state is always fresh.
     * @returns {Promise<StoreState>}
     */
    async reloadFromDisk() {
        return this.state;
    }

    async cleanup() {
        logger.info('[SqliteStore] Cleanup: closing SQLite DB...');
        if (this.db) {
            this.db.close();
            this.db = null;
            logger.info('[SqliteStore] Cleanup: DB closed');
        }
    }
}
