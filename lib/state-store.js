import fs from 'fs/promises';
import path from 'path';

export class StateStore {
    constructor(stateFilePath, brainbaseRoot = process.env.WORKSPACE_ROOT || '/path/to/workspace') {
        this.stateFilePath = stateFilePath;
        this.brainbaseRoot = brainbaseRoot;
        this.defaultSessions = this._generateDefaultSessions();
        this.state = {
            schemaVersion: 2,  // Phase 2: Schema version tracking
            lastOpenTaskId: null,
            filters: {},
            readNotifications: [],
            focusSession: null,
            sessions: this.defaultSessions
        };
    }

    _generateDefaultSessions() {
        const root = this.brainbaseRoot;
        return [
            { id: 'brainbase', name: 'brainbase', icon: 'brain', path: root }
        ];
    }

    async init() {
        try {
            const loadedState = await this._loadStateWithRecovery();
            if (loadedState) {
                this.state = { ...this.state, ...loadedState };
                console.log(`[StateStore] Loaded ${this.state.sessions?.length || 0} sessions, schemaVersion=${this.state.schemaVersion}`);
            } else {
                console.warn('[StateStore] No state loaded, using defaults');
            }

            let migrated = false;

            // Migration: First ensure intendedState is set (required for v2 migration)
            if (this.state.sessions) {
                this.state.sessions = this.state.sessions.map(session => {
                    const updatedSession = { ...session };

                    // Add intendedState if missing (必須: v2 migration前に実行)
                    if (!updatedSession.intendedState) {
                        if (updatedSession.archived) {
                            updatedSession.intendedState = 'archived';
                        } else {
                            // Default to stopped for existing sessions
                            updatedSession.intendedState = 'stopped';
                        }
                    }

                    // Remove old archived field after migration
                    delete updatedSession.archived;

                    // Remove computed fields (should not be persisted)
                    delete updatedSession.ttydRunning;
                    delete updatedSession.runtimeStatus;

                    // Add hookStatus if missing
                    if (!updatedSession.hookStatus) {
                        updatedSession.hookStatus = null;
                    }

                    // Update paths for default sessions
                    const defaultSession = this.defaultSessions.find(ds => ds.id === session.id);
                    if (defaultSession && !updatedSession.path) {
                        updatedSession.path = defaultSession.path;
                    }

                    return updatedSession;
                });
            }

            // Phase 2: Schema version migration (intendedState設定後に実行)
            if (!this.state.schemaVersion || this.state.schemaVersion < 2) {
                console.log('[StateStore Migration] Upgrading schema to v2...');
                this.state.schemaVersion = 2;
                this.state.sessions = this._migrateToV2(this.state.sessions || []);
                console.log('[StateStore Migration] Schema v2 migration completed');
                migrated = true;
            }

            // Phase 3: Schema version migration (ttydProcess永続化)
            if (this.state.schemaVersion < 3) {
                console.log('[StateStore Migration] Upgrading schema to v3...');
                this.state.schemaVersion = 3;
                this.state.sessions = this._migrateToV3(this.state.sessions || []);
                console.log('[StateStore Migration] Schema v3 migration completed');
                migrated = true;
            }

            // Migration: Ensure default sessions have paths and new defaults are added
            if (this.state.sessions) {

                // 2. Add missing default sessions
                this.defaultSessions.forEach(defaultSession => {
                    const exists = this.state.sessions.some(s => s.id === defaultSession.id);
                    if (!exists) {
                        this.state.sessions.push(defaultSession);
                        migrated = true;
                    }
                });

                // 3. Persist only if migration occurred
                if (migrated) {
                    await this.persist();
                }
            } else {
                this.state.sessions = this.defaultSessions;
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('Error reading state file:', error);
            }
        }
    }

    /**
     * Phase 2: Migrate sessions to schema v2
     * Adds: lastAccessedAt, pausedAt, tmuxCleanedAt fields
     */
    _migrateToV2(sessions) {
        return sessions.map(session => ({
            ...session,
            // Add lastAccessedAt (default to createdAt or now)
            lastAccessedAt: session.lastAccessedAt || session.createdAt || new Date().toISOString(),
            // Add pausedAt (default to createdAt if currently paused)
            pausedAt: session.intendedState === 'paused'
                ? (session.pausedAt || session.createdAt || new Date().toISOString())
                : null,
            // Add tmuxCleanedAt (initially null)
            tmuxCleanedAt: null
        }));
    }

    /**
     * Phase 3: Migrate sessions to schema v3
     * Adds: ttydProcess field for process persistence across server restarts
     * Structure: { port, pid, startedAt, engine }
     */
    _migrateToV3(sessions) {
        return sessions.map(session => ({
            ...session,
            // Add ttydProcess (initially null, populated when ttyd starts)
            ttydProcess: session.ttydProcess || null
        }));
    }

    async _loadStateWithRecovery() {
        console.log(`[StateStore] Loading state from: ${this.stateFilePath}`);
        // 1. state.json を読み込み試行
        const primary = await this._tryLoadState(this.stateFilePath);
        console.log(`[StateStore] Primary load result: ${primary ? `${primary.sessions?.length || 0} sessions` : 'null'}`);
        if (primary && this._isValid(primary)) {
            return primary;
        }

        // 2. state.json が壊れている → .bak から復旧
        const bakPath = this.stateFilePath + '.bak';
        if (primary !== null) {
            console.warn('[StateStore] Primary state invalid, trying backup...');
        }
        const backup = await this._tryLoadState(bakPath);
        if (backup && this._isValid(backup)) {
            console.warn(`[StateStore] Recovered from backup (${backup.sessions?.length || 0} sessions)`);
            return backup;
        }

        // 3. 両方ダメ → ローテーションバックアップを検索
        console.warn('[StateStore] Primary and .bak both invalid, searching rotated backups...');
        try {
            const dir = path.dirname(this.stateFilePath);
            const files = await fs.readdir(dir);
            const rotated = files
                .filter(f => f.startsWith('state.json.bak-') && f !== 'state.json.bak')
                .sort()
                .reverse();
            for (const f of rotated) {
                const candidate = await this._tryLoadState(path.join(dir, f));
                if (candidate && this._isValid(candidate)) {
                    console.warn(`[StateStore] Recovered from rotated backup: ${f} (${candidate.sessions.length} sessions)`);
                    return candidate;
                }
            }
        } catch (e) {
            // 無視
        }

        // 4. 全滅 → null（デフォルトstateを使う）
        console.error('[StateStore] No valid state found anywhere, using defaults');
        return null;
    }

    async _tryLoadState(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(content);
            return parsed;
        } catch (e) {
            console.warn(`[StateStore] Failed to load ${filePath}: ${e.code || e.message}`);
            return null;
        }
    }

    _isValid(state) {
        return state && Array.isArray(state.sessions) && state.sessions.length > 0;
    }

    get() {
        return this.state;
    }

    async update(newState) {
        // セッション数激減ガード: 90%以上減少したら拒否
        if (newState.sessions && this.state.sessions) {
            const oldCount = this.state.sessions.length;
            const newCount = newState.sessions.length;
            if (oldCount > 10 && newCount < oldCount * 0.1) {
                console.error(`[StateStore] BLOCKED: session count drop ${oldCount} → ${newCount} (>90% loss). Refusing to save.`);
                return this.state;
            }
        }
        this.state = { ...this.state, ...newState };
        await this.persist();
        return this.state;
    }

    async persist() {
        // 並行呼び出しガード（.tmpファイル競合防止）
        if (this._persisting) {
            this._pendingPersist = true;
            return;
        }
        this._persisting = true;

        try {
            const data = JSON.stringify(this.state, null, 2);
            const tmpPath = this.stateFilePath + '.tmp';
            const bakPath = this.stateFilePath + '.bak';
            const dir = path.dirname(this.stateFilePath);

            // 1. tmpファイルに書き込み
            await fs.writeFile(tmpPath, data);

            // 2. ローテーションバックアップ（5世代保持）
            try {
                const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const rotatedPath = path.join(dir, `state.json.bak-${ts}`);
                await fs.copyFile(this.stateFilePath, rotatedPath);
                await this._cleanupOldBackups(dir, 5);
            } catch (e) {
                // state.jsonがまだ無い場合は無視
            }

            // 3. 直近バックアップ（.bak）も維持（復旧用）
            try {
                await fs.copyFile(this.stateFilePath, bakPath);
            } catch (e) {
                // 無視
            }

            // 4. tmpをstate.jsonにrename（アトミック操作）
            await fs.rename(tmpPath, this.stateFilePath);
        } catch (error) {
            console.error('[StateStore] Error writing state file:', error);
        } finally {
            this._persisting = false;
            // キュー消化：persist中に別の呼び出しがあったら最新stateで再persist
            if (this._pendingPersist) {
                this._pendingPersist = false;
                await this.persist();
            }
        }
    }

    async _cleanupOldBackups(dir, keep) {
        try {
            const files = await fs.readdir(dir);
            const backups = files
                .filter(f => f.startsWith('state.json.bak-') && f !== 'state.json.bak')
                .sort()
                .reverse();
            for (const old of backups.slice(keep)) {
                await fs.unlink(path.join(dir, old));
            }
        } catch (e) {
            // 無視
        }
    }
}
