import fs from 'fs/promises';
import path from 'path';
import chokidar from 'chokidar';

export class StateStore {
    constructor(stateFilePath, brainbaseRoot = process.env.WORKSPACE_ROOT || '/path/to/workspace') {
        this.stateFilePath = stateFilePath;
        this.brainbaseRoot = brainbaseRoot;
        this._mtime = null; // 最終書き込み時のmtime
        this._watcher = null;
        this._isReloading = false;
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

        // ファイル監視を開始
        this._startWatcher();

        // 初回のmtimeを記録
        try {
            const stat = await fs.stat(this.stateFilePath);
            this._mtime = stat.mtimeMs;
        } catch (e) {
            // ファイル未作成の場合は無視
        }
    }

    /**
     * ファイル変更監視を開始
     */
    _startWatcher() {
        this._watcher = chokidar.watch(this.stateFilePath, {
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 100,
                pollInterval: 50
            }
        });

        this._watcher.on('change', async () => {
            if (this._isReloading) return;

            console.log('[StateStore] External change detected, reloading...');
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
                console.log('[StateStore] Reloaded from file');

                // mtimeを更新（リロード後の競合検出を防ぐ）
                try {
                    const stat = await fs.stat(this.stateFilePath);
                    this._mtime = stat.mtimeMs;
                } catch (e) {
                    // ファイルが存在しない場合は無視
                }
            }
        } catch (err) {
            console.error('[StateStore] Failed to reload:', err.message);
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

        // バックアップチェーン: 優先度順に試行
        const backupChain = [
            { path: this.stateFilePath, label: 'primary' },
            { path: this.stateFilePath + '.bak', label: 'backup (.bak)' },
            { path: this.stateFilePath + '.clean', label: 'clean backup (.clean)' },
            { path: this.stateFilePath + '.before-name-restore', label: 'restore backup' },
            { path: this.stateFilePath + '.before-name-fix', label: 'fix backup' }
        ];

        for (const { path: filePath, label } of backupChain) {
            const state = await this._tryLoadState(filePath);

            if (state && this._isValid(state)) {
                const sessionCount = state.sessions?.length || 0;
                if (label === 'primary') {
                    console.log(`[StateStore] Primary load result: ${sessionCount} sessions`);
                } else {
                    console.warn(`[StateStore] Recovered from ${label}: ${sessionCount} sessions`);
                }
                return state;
            }
        }

        // 全てのバックアップチェーンが失敗 → null（デフォルトstateを使う）
        console.error('[StateStore] No valid state found in backup chain, using defaults');
        console.log(`[StateStore] Primary load result: null`);
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
        this.state = { ...this.state, ...newState };
        await this.persist();
        return this.state;
    }

    async persist() {
        try {
            // 1. 現在のファイルmtimeを取得
            let currentMtime = null;
            try {
                const stat = await fs.stat(this.stateFilePath);
                currentMtime = stat.mtimeMs;
            } catch (e) {
                // ファイル未作成の場合は無視
            }

            // 2. メモリ上のmtimeと比較（外部編集検出）
            if (this._mtime !== null && currentMtime !== null && currentMtime > this._mtime) {
                console.warn('[StateStore] Conflict detected (external edit), reloading...');
                await this._reloadFromFile();
                throw new Error('State conflict detected, please retry');
            }

            // 3. Atomic Renameで書き込み
            const data = JSON.stringify(this.state, null, 2);
            // tmpファイル名をユニークにする（並行persist()対応）
            const tmpPath = `${this.stateFilePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const bakPath = this.stateFilePath + '.bak';

            // tmpファイルに書き込み
            await fs.writeFile(tmpPath, data);

            // 現在のstate.jsonをバックアップ（存在する場合）
            try {
                await fs.copyFile(this.stateFilePath, bakPath);
            } catch (e) {
                // state.jsonがまだ無い場合は無視
            }

            // tmpをstate.jsonにrename（アトミック操作）
            await fs.rename(tmpPath, this.stateFilePath);

            // 4. mtimeを更新
            const newStat = await fs.stat(this.stateFilePath);
            this._mtime = newStat.mtimeMs;
        } catch (error) {
            console.error('Error writing state file:', error);
            throw error;
        }
    }
}
