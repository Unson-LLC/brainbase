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
            { id: 'brainbase', name: 'brainbase', icon: 'brain', path: `${root}/brainbase-ui` },
            { id: 'unson', name: 'unson', icon: 'briefcase', path: `${root}/unson` },
            { id: 'tech-knight', name: 'tech-knight', icon: 'shield', path: `${root}/tech-knight` },
            { id: 'salestailor', name: 'salestailor', icon: 'shirt', path: `${root}/salestailor` },
            { id: 'zeims', name: 'zeims', icon: 'zap', path: `${root}/zeims` },
            { id: 'baao', name: 'baao', icon: 'users', path: `${root}/baao` },
            { id: 'senrigan', name: 'senrigan', icon: 'eye', path: `${root}/senrigan` }
        ];
    }

    async init() {
        try {
            const content = await fs.readFile(this.stateFilePath, 'utf-8');
            const loadedState = JSON.parse(content);
            this.state = { ...this.state, ...loadedState };

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
            }

            // Phase 3: Schema version migration (ttydProcess永続化)
            if (this.state.schemaVersion < 3) {
                console.log('[StateStore Migration] Upgrading schema to v3...');
                this.state.schemaVersion = 3;
                this.state.sessions = this._migrateToV3(this.state.sessions || []);
                console.log('[StateStore Migration] Schema v3 migration completed');
            }

            // Migration: Ensure default sessions have paths and new defaults are added
            if (this.state.sessions) {

                // 2. Add missing default sessions
                this.defaultSessions.forEach(defaultSession => {
                    const exists = this.state.sessions.some(s => s.id === defaultSession.id);
                    if (!exists) {
                        this.state.sessions.push(defaultSession);
                    }
                });

                // 3. Persist migrated state
                await this.persist();
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
            await fs.writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2));
        } catch (error) {
            console.error('Error writing state file:', error);
        }
    }
}
