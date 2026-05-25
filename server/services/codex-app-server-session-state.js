const CODEX_APP_SERVER_SOURCE = 'codex_app_server';

function normalizeString(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
}

export function extractCodexResumeId(value) {
    const text = normalizeString(value);
    if (!text) return null;
    const match = text.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    return match ? match[1] : null;
}

export function isCodexSession(session, engine = undefined) {
    const selectedEngine = normalizeString(engine) || session?.engine;
    return selectedEngine === 'codex';
}

export function getCodexAppServerThreadId(session, engine = undefined) {
    if (!session || !isCodexSession(session, engine)) return null;
    if (session.codexAppServer?.stale === true) return null;
    return normalizeString(session.codexAppServer?.threadId)
        || normalizeString(session.codexAppServer?.restore?.threadId)
        || null;
}

function getLegacyCodexResumeId(session, engine = undefined) {
    if (!session || !isCodexSession(session, engine)) return null;
    return normalizeString(session.codexThreadId)
        || normalizeString(session.conversationSummary?.codexThreadId)
        || normalizeString(session.conversationSummary?.lastConversation?.resumeId)
        || extractCodexResumeId(session.conversationSummary?.lastConversation?.conversationId)
        || null;
}

export function getCodexResumeId(session, engine = undefined) {
    if (!session || !isCodexSession(session, engine)) return null;
    return getCodexAppServerThreadId(session, engine)
        || getLegacyCodexResumeId(session, engine);
}

export function buildCodexAppServerRestoreMetadata(session, engine = undefined) {
    if (!session || !isCodexSession(session, engine)) {
        return {
            restoreStrategy: 'unsupported',
            codexResumeId: null,
            codexAppServerThreadId: null,
            source: null,
            blocker: 'unsupported_engine'
        };
    }

    const codexAppServerThreadId = getCodexAppServerThreadId(session, engine);
    const isStale = session.codexAppServer?.stale === true;
    const codexResumeId = codexAppServerThreadId || getLegacyCodexResumeId(session, engine);
    return {
        restoreStrategy: codexAppServerThreadId ? 'codex_app_server_thread' : 'codex_resume',
        codexResumeId,
        codexAppServerThreadId,
        source: codexAppServerThreadId ? CODEX_APP_SERVER_SOURCE : 'legacy_codex_resume',
        blocker: isStale
            ? 'stale_app_server_metadata'
            : (codexResumeId ? null : 'missing_restore_metadata')
    };
}

export function buildCodexAppServerStatePatch(session, {
    threadId = null,
    turnId = null,
    lifecycle = null,
    eventType = null,
    reportedAt = Date.now(),
    status = null
} = {}) {
    if (!session) return { patch: null, reason: 'session_not_found' };
    if (!isCodexSession(session)) return { patch: null, reason: 'unsupported_engine' };

    const previous = session.codexAppServer && typeof session.codexAppServer === 'object'
        ? session.codexAppServer
        : {};
    const resolvedThreadId = normalizeString(threadId)
        || normalizeString(previous.threadId)
        || normalizeString(previous.restore?.threadId);
    const resolvedTurnId = normalizeString(turnId);
    const normalizedLifecycle = normalizeString(lifecycle);
    const isComplete = normalizedLifecycle === 'turn_completed';
    const activeTurnId = isComplete
        ? (previous.activeTurnId === resolvedTurnId ? null : previous.activeTurnId || null)
        : resolvedTurnId || previous.activeTurnId || null;
    const numericReportedAt = Number(reportedAt);
    const updatedAt = new Date(Number.isFinite(numericReportedAt) ? numericReportedAt : Date.now()).toISOString();

    return {
        patch: {
            codexAppServer: {
                ...previous,
                schemaVersion: 1,
                source: CODEX_APP_SERVER_SOURCE,
                ...(resolvedThreadId ? { threadId: resolvedThreadId } : {}),
                ...(resolvedThreadId ? { restore: { ...(previous.restore || {}), threadId: resolvedThreadId } } : {}),
                activeTurnId,
                ...(resolvedTurnId ? { lastTurnId: resolvedTurnId } : {}),
                ...(normalizedLifecycle ? { lifecycle: normalizedLifecycle } : {}),
                ...(normalizeString(eventType) ? { lastEventType: normalizeString(eventType) } : {}),
                ...(normalizeString(status) ? { status: normalizeString(status) } : {}),
                updatedAt,
                stale: false
            }
        },
        reason: null
    };
}

export async function recordCodexAppServerSessionState({
    stateStore,
    sessionId,
    threadId = null,
    turnId = null,
    lifecycle = null,
    eventType = null,
    reportedAt = Date.now(),
    status = null
} = {}) {
    const resolvedSessionId = normalizeString(sessionId);
    if (!stateStore || typeof stateStore.get !== 'function' || typeof stateStore.patchSession !== 'function') {
        return { updated: false, reason: 'missing_state_store' };
    }
    if (!resolvedSessionId) {
        return { updated: false, reason: 'missing_session_id' };
    }

    const state = stateStore.get() || {};
    const session = Array.isArray(state.sessions)
        ? state.sessions.find((entry) => entry?.id === resolvedSessionId)
        : null;
    const { patch, reason } = buildCodexAppServerStatePatch(session, {
        threadId,
        turnId,
        lifecycle,
        eventType,
        reportedAt,
        status
    });
    if (!patch) return { updated: false, reason };

    await stateStore.patchSession(resolvedSessionId, patch);
    return {
        updated: true,
        sessionId: resolvedSessionId,
        codexAppServer: patch.codexAppServer
    };
}
