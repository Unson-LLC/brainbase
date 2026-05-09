// @ts-check

/** @typedef {Record<string, any>} AnyRecord */
/** @typedef {{ id: string, name?: string, icon?: string, path?: string, intendedState?: string, archived?: boolean, hookStatus?: string | null, ttydRunning?: boolean, runtimeStatus?: string, createdAt?: string, lastAccessedAt?: string, pausedAt?: string | null, tmuxCleanedAt?: string | null, ttydProcess?: AnyRecord | null, [key: string]: any }} StoredSession */
/** @typedef {{ schemaVersion: number, lastOpenTaskId: string | null, filters: AnyRecord, readNotifications: any[], focusSession: string | null, sessions: StoredSession[], [key: string]: any }} StoreState */

export function createDefaultSessions(brainbaseRoot) {
    return [{ id: 'brainbase', name: 'brainbase', icon: 'brain', path: brainbaseRoot }];
}

export function isEphemeralWorkspacePath(candidate) {
    if (!candidate || typeof candidate !== 'string') return false;
    return candidate === '/tmp'
        || candidate.startsWith('/tmp/')
        || candidate === '/private/tmp'
        || candidate.startsWith('/private/tmp/');
}

/**
 * @param {StoredSession[]} sessions
 * @returns {StoredSession[]}
 */
export function migrateSessionsToV2(sessions) {
    return sessions.map((session) => ({
        ...session,
        lastAccessedAt: session.lastAccessedAt || session.createdAt || new Date().toISOString(),
        pausedAt: session.intendedState === 'paused'
            ? (session.pausedAt || session.createdAt || new Date().toISOString())
            : null,
        tmuxCleanedAt: null
    }));
}

/**
 * @param {StoredSession[]} sessions
 * @returns {StoredSession[]}
 */
export function migrateSessionsToV3(sessions) {
    return sessions.map((session) => ({
        ...session,
        ttydProcess: session.ttydProcess || null
    }));
}

/**
 * @param {StoredSession[]} sessions
 * @param {StoredSession[]} defaultSessions
 * @returns {{ sessions: StoredSession[], changed: boolean }}
 */
export function normalizeLegacySessionFields(sessions, defaultSessions) {
    let changed = false;
    const normalized = (sessions || []).map((session) => {
        const updatedSession = { ...session };

        if (!updatedSession.intendedState) {
            updatedSession.intendedState = updatedSession.archived ? 'archived' : 'stopped';
            changed = true;
        }

        if (Object.prototype.hasOwnProperty.call(updatedSession, 'archived')) {
            delete updatedSession.archived;
            changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(updatedSession, 'ttydRunning')) {
            delete updatedSession.ttydRunning;
            changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(updatedSession, 'runtimeStatus')) {
            delete updatedSession.runtimeStatus;
            changed = true;
        }
        if (!Object.prototype.hasOwnProperty.call(updatedSession, 'hookStatus')) {
            updatedSession.hookStatus = null;
            changed = true;
        }

        const defaultSession = defaultSessions.find((item) => item.id === session.id);
        if (defaultSession && !updatedSession.path) {
            updatedSession.path = defaultSession.path;
            changed = true;
        }

        return updatedSession;
    });

    return { sessions: normalized, changed };
}

/**
 * @param {StoreState} state
 * @param {StoredSession[]} defaultSessions
 * @returns {{ state: StoreState, changed: boolean }}
 */
export function applyStateSchemaMigrations(state, defaultSessions) {
    let changed = false;
    const nextState = { ...state, sessions: [...(state.sessions || [])] };

    const legacy = normalizeLegacySessionFields(nextState.sessions, defaultSessions);
    nextState.sessions = legacy.sessions;
    changed = changed || legacy.changed;

    if (!nextState.schemaVersion || nextState.schemaVersion < 2) {
        nextState.schemaVersion = 2;
        nextState.sessions = migrateSessionsToV2(nextState.sessions);
        changed = true;
    }

    if (nextState.schemaVersion < 3) {
        nextState.schemaVersion = 3;
        nextState.sessions = migrateSessionsToV3(nextState.sessions);
        changed = true;
    }

    const sessionIds = new Set(nextState.sessions.map((session) => session.id));
    for (const defaultSession of defaultSessions) {
        if (!sessionIds.has(defaultSession.id)) {
            nextState.sessions = [...nextState.sessions, defaultSession];
            sessionIds.add(defaultSession.id);
            changed = true;
        }
    }

    return { state: nextState, changed };
}

/**
 * @param {StoredSession | null | undefined} nextSession
 * @param {StoredSession | null | undefined} previousSession
 * @returns {StoredSession | null}
 */
export function normalizeSession(nextSession, previousSession = null) {
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
        nextPath,
        nextWorktreePath,
        nextKnownGood,
        previousPath,
        previousWorktreePath,
        previousKnownGood
    ].find((candidate) => candidate && !isEphemeralWorkspacePath(candidate)) || null;

    if (nextPath && isEphemeralWorkspacePath(nextPath)) {
        if (durablePath) normalized.path = durablePath;
        else delete normalized.path;
    }

    if (normalized.worktree) {
        const nextWorktree = { ...normalized.worktree };
        if (nextWorktree.path && isEphemeralWorkspacePath(nextWorktree.path)) {
            if (durablePath) nextWorktree.path = durablePath;
            else delete nextWorktree.path;
        }
        normalized.worktree = nextWorktree;
    }

    if (nextKnownGood && isEphemeralWorkspacePath(nextKnownGood)) {
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
export function normalizeSessions(sessions, previousSessions = []) {
    const previousMap = new Map((previousSessions || []).map((session) => [session.id, session]));
    return (sessions || [])
        .map((session) => normalizeSession(session, previousMap.get(session.id) || null))
        .filter(Boolean);
}

/**
 * @param {StoredSession[]} sessions
 * @param {StoredSession} session
 * @param {{ insertAtStart?: boolean }} [options]
 * @returns {StoredSession[]}
 */
export function upsertSessionInList(sessions, session, options = {}) {
    const { insertAtStart = false } = options;
    const existingIndex = sessions.findIndex((item) => item.id === session.id);
    if (existingIndex >= 0) {
        const updated = [...sessions];
        updated[existingIndex] = { ...updated[existingIndex], ...session };
        return updated;
    }
    return insertAtStart ? [session, ...sessions] : [...sessions, session];
}

/**
 * @param {StoredSession[]} sessions
 * @param {string} sessionId
 * @param {Partial<StoredSession> | ((session: StoredSession) => Partial<StoredSession> | StoredSession | null)} patch
 * @returns {StoredSession[]}
 */
export function patchSessionInList(sessions, sessionId, patch) {
    return sessions.map((session) => {
        if (session.id !== sessionId) return session;
        const computedPatch = typeof patch === 'function' ? patch(session) : patch;
        if (!computedPatch) return session;
        const nextSession = { ...session, ...computedPatch };
        for (const [key, value] of Object.entries(computedPatch)) {
            if (value === undefined) delete nextSession[key];
        }
        return nextSession;
    });
}

/**
 * @param {StoredSession[]} sessions
 * @param {string} sessionId
 * @returns {StoredSession[]}
 */
export function deleteSessionFromList(sessions, sessionId) {
    return sessions.filter((session) => session.id !== sessionId);
}

/**
 * @param {StoredSession[]} sessions
 * @param {string[]} orderedIds
 * @returns {StoredSession[]}
 */
export function reorderSessionsList(sessions, orderedIds) {
    const sessionMap = new Map(sessions.map((session) => [session.id, session]));
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
}
