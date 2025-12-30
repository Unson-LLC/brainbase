import fs from 'fs/promises';
import path from 'path';

export class StateStore {
    constructor(stateFilePath, brainbaseRoot = '/Users/ksato/workspace') {
        this.stateFilePath = stateFilePath;
        this.brainbaseRoot = brainbaseRoot;
        this.defaultSessions = this._generateDefaultSessions();
        this.state = {
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

            // Migration: Ensure default sessions have paths and new defaults are added
            if (this.state.sessions) {
                // 1. Migrate to new schema (intendedState, hookStatus)
                this.state.sessions = this.state.sessions.map(session => {
                    // Add intendedState if missing
                    if (!session.intendedState) {
                        if (session.archived) {
                            session.intendedState = 'archived';
                        } else {
                            // Default to stopped for existing sessions
                            session.intendedState = 'stopped';
                        }
                    }

                    // Remove old archived field after migration
                    delete session.archived;

                    // Remove computed fields (should not be persisted)
                    delete session.ttydRunning;
                    delete session.runtimeStatus;

                    // Add hookStatus if missing
                    if (!session.hookStatus) {
                        session.hookStatus = null;
                    }

                    // Update paths for default sessions
                    const defaultSession = this.defaultSessions.find(ds => ds.id === session.id);
                    if (defaultSession && !session.path) {
                        session.path = defaultSession.path;
                    }

                    return session;
                });

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
