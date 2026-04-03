export const runtimeStateRepositoryMethods = {
    async _persistResolvedWorkspacePath(sessionId, resolvedPath) {
        if (!sessionId || !resolvedPath) return;

        const currentState = this.stateStore.get();
        let changed = false;
        const updatedSessions = (currentState.sessions || []).map((session) => {
            if (session.id !== sessionId) return session;

            const nextSession = { ...session };
            if (nextSession.path !== resolvedPath) {
                nextSession.path = resolvedPath;
                changed = true;
            }

            if (nextSession.worktree) {
                const nextWorktree = { ...nextSession.worktree };
                if (nextWorktree.path !== resolvedPath) {
                    nextWorktree.path = resolvedPath;
                    changed = true;
                }
                nextSession.worktree = nextWorktree;
            }

            if (changed) {
                nextSession.updatedAt = new Date().toISOString();
            }

            return nextSession;
        });

        if (changed) {
            await this.stateStore.update({ ...currentState, sessions: updatedSessions });
        }
    },

    async _saveTtydProcessInfo(sessionId, { port, pid, engine }) {
        try {
            const state = this.stateStore.get();
            const sessions = state.sessions || [];
            const hasSession = sessions.some(session => session.id === sessionId);
            if (!hasSession) {
                return;
            }

            const updatedSessions = sessions.map(session =>
                session.id === sessionId
                    ? {
                        ...session,
                        ttydProcess: {
                            port,
                            pid,
                            startedAt: new Date().toISOString(),
                            engine: engine || 'claude'
                        }
                    }
                    : session
            );
            await this.stateStore.update({ ...state, sessions: updatedSessions });
        } catch {
            // keep existing behavior: best effort persistence
        }
    },

    async _clearTtydProcessInfo(sessionId) {
        try {
            const state = this.stateStore.get();
            const sessions = state.sessions || [];
            const updatedSessions = sessions.map(session =>
                session.id === sessionId
                    ? { ...session, ttydProcess: null }
                    : session
            );
            await this.stateStore.update({ ...state, sessions: updatedSessions });
        } catch {
            // best effort
        }
    },

    async _clearTtydProcessInfoIfMatches(sessionId, pid) {
        try {
            const state = this.stateStore.get();
            const sessions = state.sessions || [];

            let changed = false;
            const updatedSessions = sessions.map(session => {
                if (session.id !== sessionId) return session;
                if (!session.ttydProcess) return session;

                const currentPid = session.ttydProcess?.pid;
                if (Number.isFinite(currentPid) && Number.isFinite(pid) && currentPid !== pid) {
                    return session;
                }

                changed = true;
                return { ...session, ttydProcess: null };
            });

            if (!changed) return false;

            await this.stateStore.update({ ...state, sessions: updatedSessions });
            return true;
        } catch {
            return false;
        }
    }
};
