import { SESSION_DISPLAY_MODES, deriveSessionDisplayRoute } from '../domain/session/session-display-route.js';

const CODEX_APP_SERVER_DISPLAY_OPT_IN_FLAG = '__BRAINBASE_ENABLE_CODEX_APP_SERVER_DISPLAY__';

function setText(root, selector, value) {
    const element = root?.querySelector?.(selector);
    if (element) element.textContent = value || '';
}

export function applyCodexAppServerDisplayMixin(AppClass) {
    AppClass.prototype._getSessionDisplayRoute = function(session) {
        return session?.displayRoute || deriveSessionDisplayRoute(session);
    };

    AppClass.prototype._isCodexAppServerDisplayEnabled = function() {
        return window?.[CODEX_APP_SERVER_DISPLAY_OPT_IN_FLAG] === true;
    };

    AppClass.prototype._shouldUseCodexAppServerDisplay = function(session, options = {}) {
        if (options.forceTtyd || this.isMobile?.()) return false;
        if (!this._isCodexAppServerDisplayEnabled?.()) return false;
        return this._getSessionDisplayRoute(session)?.mode === SESSION_DISPLAY_MODES.CODEX_APP_SERVER;
    };

    AppClass.prototype._getCodexAppServerDisplayPanel = function() {
        return document.getElementById('codex-app-server-display-panel');
    };

    AppClass.prototype._hideCodexAppServerDisplay = function() {
        const panel = this._getCodexAppServerDisplayPanel?.();
        panel?.classList.add('hidden');
        panel?.removeAttribute('data-session-id');
        panel?.removeAttribute('data-codex-app-server-thread-id');
        document.getElementById('console-area')?.classList.remove('using-codex-app-server');
    };

    AppClass.prototype._showCodexAppServerDisplay = function(session, route = null) {
        const panel = this._getCodexAppServerDisplayPanel?.();
        if (!panel || !session?.id) return false;

        const displayRoute = route || this._getSessionDisplayRoute(session);
        const threadId = displayRoute?.codexAppServerThreadId
            || session.codexAppServer?.threadId
            || session.codexAppServer?.restore?.threadId
            || '';

        this._restoreSnapshotPanelPosition?.();
        this.terminalTransportClient?.disconnect?.({ preserveView: false });
        this.terminalTransportClient?.hide?.();
        this._terminalTransportStatus = null;
        this.terminalXtermHost?.classList.add('hidden');
        this.terminalFrame?.classList.add('hidden');
        this._clearTerminalFrame?.(this.terminalFrame);
        this.terminalSnapshotPanelEl?.classList.add('hidden');
        this._renderTerminalSnapshotPanel?.({ visible: false });

        const consoleArea = document.getElementById('console-area');
        consoleArea?.classList.remove('using-xterm');
        consoleArea?.classList.remove('using-snapshot');
        consoleArea?.classList.add('using-codex-app-server');

        panel.dataset.sessionId = session.id;
        panel.dataset.codexAppServerThreadId = threadId;
        setText(panel, '[data-codex-app-server-session-id]', session.id);
        setText(panel, '[data-codex-app-server-thread-label]', threadId || 'unavailable');
        setText(panel, '[data-codex-app-server-status]', session.codexAppServer?.status || session.codexAppServer?.lifecycle || 'thread ready');
        panel.classList.remove('hidden');
        return true;
    };
}
