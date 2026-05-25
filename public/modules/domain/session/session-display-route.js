export const SESSION_DISPLAY_MODES = Object.freeze({
    CODEX_APP_SERVER: 'codex_app_server',
    TERMINAL_XTERM: 'terminal_xterm'
});

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function resolveCodexAppServerThreadId(session = null) {
    if (!session || session.engine !== 'codex') return null;
    if (session.codexAppServer?.stale === true) return null;

    return normalizeString(session.codexAppServer?.threadId)
        || normalizeString(session.codexAppServer?.restore?.threadId)
        || null;
}

export function deriveSessionDisplayRoute(session = null) {
    const threadId = resolveCodexAppServerThreadId(session);

    if (threadId) {
        return {
            mode: SESSION_DISPLAY_MODES.CODEX_APP_SERVER,
            reason: 'codex_app_server_thread',
            codexAppServerThreadId: threadId,
            terminalFallback: true
        };
    }

    const reason = session?.engine === 'codex'
        ? (session.codexAppServer?.stale === true
            ? 'codex_app_server_thread_stale'
            : 'codex_app_server_thread_missing')
        : 'non_codex_session';

    return {
        mode: SESSION_DISPLAY_MODES.TERMINAL_XTERM,
        reason,
        codexAppServerThreadId: null,
        terminalFallback: false
    };
}
