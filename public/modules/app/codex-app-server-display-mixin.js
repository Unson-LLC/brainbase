import { SESSION_DISPLAY_MODES, deriveSessionDisplayRoute } from '../domain/session/session-display-route.js';
import { httpClient } from '../core/http-client.js';

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
        return window?.[CODEX_APP_SERVER_DISPLAY_OPT_IN_FLAG] !== false;
    };

    AppClass.prototype._shouldUseCodexAppServerDisplay = function(session, options = {}) {
        if (options.forceTtyd || options.forceXterm || this.isMobile?.()) return false;
        if (!this._isCodexAppServerDisplayEnabled?.()) return false;
        return this._getSessionDisplayRoute(session)?.mode === SESSION_DISPLAY_MODES.CODEX_APP_SERVER;
    };

    AppClass.prototype._getCodexAppServerDisplayPanel = function() {
        return document.getElementById('codex-app-server-display-panel');
    };

    AppClass.prototype._hideCodexAppServerDisplay = function() {
        const panel = this._getCodexAppServerDisplayPanel?.();
        this._stopCodexAppServerTranscriptRefresh?.();
        panel?.classList.add('hidden');
        panel?.removeAttribute('data-session-id');
        panel?.removeAttribute('data-codex-app-server-thread-id');
        document.getElementById('console-area')?.classList.remove('using-codex-app-server');
    };

    AppClass.prototype._showCodexAppServerDisplay = function(session, route = null, options = {}) {
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
        this._setCodexAppServerComposerEnabled?.(panel, !options.deferInitialLoad);
        this._bindCodexAppServerComposer?.(panel, session.id);
        if (!options.deferInitialLoad) {
            this._loadCodexAppServerTranscript?.(session.id, { scroll: true });
            this._startCodexAppServerTranscriptRefresh?.(session.id);
        }
        return true;
    };

    AppClass.prototype._setCodexAppServerComposerEnabled = function(panel, enabled) {
        const form = panel?.querySelector?.('[data-codex-app-server-composer]');
        if (!form) return;
        const input = form.querySelector('[data-codex-app-server-input]');
        const button = form.querySelector('button[type="submit"]');
        form.dataset.restorePending = enabled ? 'false' : 'true';
        if (input) input.disabled = !enabled;
        if (button) button.disabled = !enabled;
    };

    AppClass.prototype._bindCodexAppServerComposer = function(panel, sessionId) {
        const form = panel.querySelector('[data-codex-app-server-composer]');
        if (!form) return;
        if (form._codexAppServerSubmitHandler) {
            form.removeEventListener('submit', form._codexAppServerSubmitHandler);
        }
        const handler = async (event) => {
            event.preventDefault();
            const input = form.querySelector('[data-codex-app-server-input]');
            const button = form.querySelector('button[type="submit"]');
            const text = input?.value?.trim();
            if (form.dataset.restorePending === 'true') return;
            if (!text) return;
            input.disabled = true;
            if (button) button.disabled = true;
            try {
                const snapshot = await httpClient.post(`/api/sessions/${encodeURIComponent(sessionId)}/codex-app-server/turns`, { text }, { timeout: 120000 });
                input.value = '';
                this._renderCodexAppServerTranscript?.(sessionId, snapshot, { scroll: true });
            } catch (error) {
                this._renderCodexAppServerTranscript?.(sessionId, {
                    status: 'error',
                    timeline: [{
                        id: `browser-error-${Date.now()}`,
                        kind: 'error',
                        text: error.message || 'Failed to send turn'
                    }]
                }, { append: true, scroll: true });
            } finally {
                input.disabled = false;
                if (button) button.disabled = false;
                input.focus?.();
            }
        };
        form._codexAppServerSubmitHandler = handler;
        form.dataset.boundSessionId = sessionId;
        form.addEventListener('submit', handler);
    };

    AppClass.prototype._renderCodexAppServerTranscript = function(sessionId, snapshot, options = {}) {
        const panel = this._getCodexAppServerDisplayPanel?.();
        if (!panel || panel.dataset.sessionId !== sessionId) return;
        const transcript = panel.querySelector('[data-codex-app-server-transcript]');
        if (!transcript) return;
        if (!options.append) transcript.textContent = '';

        const timeline = Array.isArray(snapshot?.timeline) ? snapshot.timeline : [];
        for (const item of timeline) {
            const message = document.createElement('article');
            const kind = item.kind || 'assistant';
            message.className = `codex-app-server-message ${kind}`;
            message.dataset.itemId = item.id || '';
            const label = document.createElement('span');
            label.className = 'codex-app-server-message-label';
            label.textContent = kind.replace('_', ' ');
            const body = document.createElement('div');
            body.textContent = item.text || '';
            message.append(label, body);
            transcript.append(message);
        }

        if (snapshot?.threadId) {
            panel.dataset.codexAppServerThreadId = snapshot.threadId;
            setText(panel, '[data-codex-app-server-thread-label]', snapshot.threadId);
        }
        if (snapshot?.status) {
            setText(panel, '[data-codex-app-server-status]', snapshot.status);
        }
        if (options.scroll) transcript.scrollTop = transcript.scrollHeight;
    };

    AppClass.prototype._loadCodexAppServerTranscript = async function(sessionId, options = {}) {
        try {
            const snapshot = await httpClient.get(`/api/sessions/${encodeURIComponent(sessionId)}/codex-app-server/transcript`, { timeout: 120000 });
            this._renderCodexAppServerTranscript?.(sessionId, snapshot, options);
            const panel = this._getCodexAppServerDisplayPanel?.();
            if (panel?.dataset.sessionId === sessionId) {
                this._setCodexAppServerComposerEnabled?.(panel, true);
            }
            return snapshot;
        } catch (error) {
            this._renderCodexAppServerTranscript?.(sessionId, {
                status: 'error',
                timeline: [{
                    id: `browser-error-${Date.now()}`,
                    kind: 'error',
                    text: error.message || 'Failed to load transcript'
                }]
            }, { append: true, scroll: true });
            return null;
        }
    };

    AppClass.prototype._startCodexAppServerTranscriptRefresh = function(sessionId) {
        this._stopCodexAppServerTranscriptRefresh?.();
        this._codexAppServerTranscriptRefreshTimer = window.setInterval(() => {
            const panel = this._getCodexAppServerDisplayPanel?.();
            if (!panel || panel.classList.contains('hidden') || panel.dataset.sessionId !== sessionId) {
                this._stopCodexAppServerTranscriptRefresh?.();
                return;
            }
            this._loadCodexAppServerTranscript?.(sessionId);
        }, 1200);
    };

    AppClass.prototype._stopCodexAppServerTranscriptRefresh = function() {
        if (this._codexAppServerTranscriptRefreshTimer) {
            window.clearInterval(this._codexAppServerTranscriptRefreshTimer);
            this._codexAppServerTranscriptRefreshTimer = null;
        }
    };
}
