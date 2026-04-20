// @ts-check
import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import { logger } from '../server/utils/logger.js';

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
        this.defaultSessions = this._generateDefaultSessions();
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

    _generateDefaultSessions() {
        return [{ id: 'brainbase', name: 'brainbase', icon: 'brain', path: this.brainbaseRoot }];
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
        // Normalize sessions (remove computed fields, add intendedState)
        if (state.sessions) {
            state.sessions = state.sessions.map((session) => {
                const s = { ...session };
                if (!s.intendedState) {
                    s.intendedState = s.archived ? 'archived' : 'stopped';
                }
                delete s.archived;
                delete s.ttydRunning;
                delete s.runtimeStatus;
                if (!Object.prototype.hasOwnProperty.call(s, 'hookStatus')) {
                    s.hookStatus = null;
                }
                const defaultSession = this.defaultSessions.find((ds) => ds.id === s.id);
                if (defaultSession && !s.path) {
                    s.path = defaultSession.path;
                }
                return s;
            });
        }

        // v2 migration: add lastAccessedAt, pausedAt, tmuxCleanedAt
        if (!state.schemaVersion || state.schemaVersion < 2) {
            state.schemaVersion = 2;
            state.sessions = (state.sessions || []).map(session => ({
                ...session,
                lastAccessedAt: session.lastAccessedAt || session.createdAt || new Date().toISOString(),
                pausedAt: session.intendedState === 'paused'
                    ? (session.pausedAt || session.createdAt || new Date().toISOString())
                    : null,
                tmuxCleanedAt: null
            }));
        }

        // v3 migration: add ttydProcess
        if (state.schemaVersion < 3) {
            state.schemaVersion = 3;
            state.sessions = (state.sessions || []).map(session => ({
                ...session,
                ttydProcess: session.ttydProcess || null
            }));
        }

        // Ensure default sessions exist
        const sessionIds = new Set((state.sessions || []).map(s => s.id));
        for (const ds of this.defaultSessions) {
            if (!sessionIds.has(ds.id)) {
                state.sessions = [...(state.sessions || []), ds];
            }
        }

        return state;
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

    _isEphemeralWorkspacePath(candidate) {
        if (!candidate || typeof candidate !== 'string') return false;
        return candidate === '/tmp'
            || candidate.startsWith('/tmp/')
            || candidate === '/private/tmp'
            || candidate.startsWith('/private/tmp/');
    }

    /**
     * @param {StoredSession | null | undefined} nextSession
     * @param {StoredSession | null | undefined} previousSession
     * @returns {StoredSession | null}
     */
    _normalizeSession(nextSession, previousSession = null) {
        if (!nextSession?.id || typeof nextSession.id !== 'string') return null;

        /** @type {StoredSession} */
        const normalized = { ...(previousSession || {}), ...nextSession };

        const nextPath = typeof normalized.path === 'string' ? normalized.path : null;
        const nextWorktreePath = typeof normalized.worktree?.path === 'string' ? normalized.worktree.path : null;
        const nextKnownGood = typeof normalized.lastKnownGoodPath === 'string' ? normalized.lastKnownGoodPath : null;
        const previousPath = typeof previousSession?.path === 'string' ? previousSession.path : null;
        const previousWorktreePath = typeof previousSession?.worktree?.path === 'string' ? previousSession.worktree.path : null;
        const previousKnownGood = typeof previousSession?.lastKnownGoodPath === 'string' ? previousSession.lastKnownGoodPath : null;

        const durablePath = [
            nextPath, nextWorktreePath, nextKnownGood,
            previousPath, previousWorktreePath, previousKnownGood
        ].find((c) => c && !this._isEphemeralWorkspacePath(c)) || null;

        if (nextPath && this._isEphemeralWorkspacePath(nextPath)) {
            if (durablePath) normalized.path = durablePath;
            else delete normalized.path;
        }

        if (normalized.worktree) {
            const nextWorktree = { ...normalized.worktree };
            if (nextWorktree.path && this._isEphemeralWorkspacePath(nextWorktree.path)) {
                if (durablePath) nextWorktree.path = durablePath;
                else delete nextWorktree.path;
            }
            normalized.worktree = nextWorktree;
        }

        if (nextKnownGood && this._isEphemeralWorkspacePath(nextKnownGood)) {
            if (durablePath) normalized.lastKnownGoodPath = durablePath;
            else delete normalized.lastKnownGoodPath;
        } else if (durablePath) {
            normalized.lastKnownGoodPath = durablePath;
        }

        return normalized;
    }

    /**
     * @param {StoredSession[]} sessions
     * @param {StoredSession[]} [previousSessions=[]]
     * @returns {StoredSession[]}
     */
    _normalizeSessions(sessions, previousSessions = []) {
        const previousMap = new Map((previousSessions || []).map((s) => [s.id, s]));
        return (sessions || [])
            .map((s) => this._normalizeSession(s, previousMap.get(s.id) || null))
            .filter(Boolean);
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
                nextState.sessions = this._normalizeSessions(partial.sessions, this.state.sessions || []);
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
            const existingIndex = sessions.findIndex((item) => item.id === session.id);
            if (existingIndex >= 0) {
                const updated = [...sessions];
                updated[existingIndex] = { ...updated[existingIndex], ...session };
                return updated;
            }
            return insertAtStart ? [session, ...sessions] : [...sessions, session];
        });
    }

    /**
     * @param {string} sessionId
     * @param {Partial<StoredSession> | ((session: StoredSession) => Partial<StoredSession> | StoredSession | null)} patch
     * @returns {Promise<StoreState>}
     */
    async patchSession(sessionId, patch) {
        return this.mutateSessions((sessions) => sessions.map((session) => {
            if (session.id !== sessionId) return session;
            const computedPatch = typeof patch === 'function' ? patch(session) : patch;
            if (!computedPatch) return session;
            const nextSession = { ...session, ...computedPatch };
            for (const [key, value] of Object.entries(computedPatch)) {
                if (value === undefined) delete nextSession[key];
            }
            return nextSession;
        }));
    }

    /**
     * @param {string} sessionId
     * @returns {Promise<StoreState>}
     */
    async deleteSession(sessionId) {
        return this.mutateSessions((sessions) => sessions.filter((s) => s.id !== sessionId));
    }

    /**
     * @param {string[]} orderedIds
     * @returns {Promise<StoreState>}
     */
    async reorderSessions(orderedIds) {
        return this.mutateSessions((sessions) => {
            const sessionMap = new Map(sessions.map((s) => [s.id, s]));
            const reordered = [];
            for (const id of orderedIds || []) {
                const session = sessionMap.get(id);
                if (!session) continue;
                reordered.push(session);
                sessionMap.delete(id);
            }
            for (const session of sessionMap.values()) {
                reordered.push(session);
            }
            return reordered;
        });
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
