import fs from 'fs/promises';
import path from 'path';

export class StateStore {
    constructor(stateFilePath) {
        this.stateFilePath = stateFilePath;
        this.defaultSessions = [
            { id: 'brainbase', name: 'brainbase', icon: 'brain', path: '/Users/ksato/workspace/brainbase-ui' },
            { id: 'unson', name: 'unson', icon: 'briefcase', path: '/Users/ksato/workspace/unson' },
            { id: 'tech-knight', name: 'tech-knight', icon: 'shield', path: '/Users/ksato/workspace/tech-knight' },
            { id: 'salestailor', name: 'salestailor', icon: 'shirt', path: '/Users/ksato/workspace/salestailor' },
            { id: 'zeims', name: 'zeims', icon: 'zap', path: '/Users/ksato/workspace/zeims' },
            { id: 'baao', name: 'baao', icon: 'users', path: '/Users/ksato/workspace/baao' },
            { id: 'senrigan', name: 'senrigan', icon: 'eye', path: '/Users/ksato/workspace/senrigan' }
        ];
        this.state = {
            lastOpenTaskId: null,
            filters: {},
            readNotifications: [],
            focusSession: null,
            sessions: this.defaultSessions
        };
    }

    async init() {
        try {
            const content = await fs.readFile(this.stateFilePath, 'utf-8');
            const loadedState = JSON.parse(content);
            this.state = { ...this.state, ...loadedState };
            
            // Migration: Ensure default sessions have paths and new defaults are added
            if (this.state.sessions) {
                // 1. Update existing sessions with paths
                this.state.sessions = this.state.sessions.map(session => {
                    const defaultSession = this.defaultSessions.find(ds => ds.id === session.id);
                    if (defaultSession && !session.path) {
                        return { ...session, path: defaultSession.path };
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
