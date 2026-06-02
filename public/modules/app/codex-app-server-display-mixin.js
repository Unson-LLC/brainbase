import { SESSION_DISPLAY_MODES, deriveSessionDisplayRoute } from '../domain/session/session-display-route.js';
import { httpClient } from '../core/http-client.js';

const CODEX_APP_SERVER_DISPLAY_OPT_IN_FLAG = '__BRAINBASE_ENABLE_CODEX_APP_SERVER_DISPLAY__';
const CODEX_APP_SERVER_TRANSCRIPT_ISLAND_URL = '/dist/codex-appserver-transcript-island.js';

function getCodexAppServerTranscriptIslandUrl({ retry = false } = {}) {
    if (!retry) return CODEX_APP_SERVER_TRANSCRIPT_ISLAND_URL;
    return `${CODEX_APP_SERVER_TRANSCRIPT_ISLAND_URL}?retry=${Date.now()}`;
}

function setText(root, selector, value) {
    const element = root?.querySelector?.(selector);
    if (element) element.textContent = value || '';
}

function ensureCodexAppServerFallbackShell(panel, { sessionId, threadId, status }) {
    const root = panel?.querySelector?.('[data-codex-app-server-react-root]');
    if (!root || root.querySelector('[data-codex-app-server-transcript]')) return;
    root.textContent = '';
    const shell = document.createElement('div');
    shell.className = 'codex-app-server-fallback-shell';
    const header = document.createElement('div');
    header.className = 'codex-app-server-display-header';
    const title = document.createElement('span');
    title.className = 'codex-app-server-display-title';
    title.textContent = 'Codex App Server';
    const statusEl = document.createElement('span');
    statusEl.className = 'codex-app-server-display-status';
    statusEl.dataset.codexAppServerStatus = '';
    header.append(title, statusEl);

    const body = document.createElement('div');
    body.className = 'codex-app-server-display-body';
    for (const [labelText, attr] of [['Session', 'codexAppServerSessionId'], ['Thread', 'codexAppServerThreadLabel']]) {
        const row = document.createElement('div');
        row.className = 'codex-app-server-display-row';
        const label = document.createElement('span');
        label.className = 'codex-app-server-display-label';
        label.textContent = labelText;
        const code = document.createElement('code');
        code.dataset[attr] = '';
        row.append(label, code);
        body.append(row);
    }

    const transcript = document.createElement('div');
    transcript.className = 'codex-app-server-transcript';
    transcript.dataset.codexAppServerTranscript = '';
    const form = document.createElement('form');
    form.className = 'codex-app-server-composer';
    form.dataset.codexAppServerComposer = '';
    const input = document.createElement('textarea');
    input.dataset.codexAppServerInput = '';
    input.rows = 3;
    input.placeholder = 'Codex に依頼する';
    const button = document.createElement('button');
    button.type = 'submit';
    button.className = 'primary-btn';
    button.textContent = '送信';
    form.append(input, button);
    shell.append(header, body, transcript, form);
    root.append(shell);
    setText(root, '[data-codex-app-server-session-id]', sessionId);
    setText(root, '[data-codex-app-server-thread-label]', threadId || 'unavailable');
    setText(root, '[data-codex-app-server-status]', status || 'thread ready');
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
        this._unmountCodexAppServerTranscriptIsland?.();
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
        panel.classList.remove('hidden');
        this._mountCodexAppServerTranscriptIsland?.(panel, {
            sessionId: session.id,
            threadId,
            status: session.codexAppServer?.status || session.codexAppServer?.lifecycle || 'thread ready',
            autoLoad: !options.deferInitialLoad
        });
        this._setCodexAppServerComposerEnabled?.(panel, !options.deferInitialLoad);
        this._bindCodexAppServerComposer?.(panel, session.id);
        if (!options.deferInitialLoad) {
            this._loadCodexAppServerTranscript?.(session.id, { scroll: true });
            this._startCodexAppServerTranscriptRefresh?.(session.id);
        }
        return true;
    };

    AppClass.prototype._mountCodexAppServerTranscriptIsland = async function(panel, { sessionId, threadId, status, autoLoad = true, initialSnapshot = null }) {
        const root = panel?.querySelector?.('[data-codex-app-server-react-root]');
        if (!root || !sessionId) return false;
        ensureCodexAppServerFallbackShell(panel, { sessionId, threadId, status });
        const api = {
            getTranscript: () => httpClient.get(`/api/sessions/${encodeURIComponent(sessionId)}/codex-app-server/transcript`, { timeout: 120000 }),
            startTurn: (text) => httpClient.post(`/api/sessions/${encodeURIComponent(sessionId)}/codex-app-server/turns`, { text }, { timeout: 120000 })
        };
        this._codexAppServerTranscriptIslandProps = {
            api,
            sessionId,
            threadId,
            initialStatus: status,
            initialSnapshot,
            autoLoad
        };
        let firstError = null;
        for (const retry of [false, true]) {
            try {
                const module = await import(getCodexAppServerTranscriptIslandUrl({ retry }));
                if (panel.dataset.sessionId !== sessionId) {
                    return false;
                }
                const mount = module.mountCodexAppServerTranscript || window.BrainbaseCodexAppServerTranscript?.mount;
                if (!mount) throw new Error('Codex App Server transcript island mount export is missing');
                if (panel.dataset.sessionId !== sessionId) {
                    return false;
                }
                this._codexAppServerTranscriptIsland?.unmount?.();
                this._codexAppServerTranscriptIsland = mount(root, this._codexAppServerTranscriptIslandProps);
                return true;
            } catch (error) {
                if (!retry) {
                    firstError = error;
                    console.warn('[brainbase] Codex App Server transcript island failed; retrying with cache-bust URL', error);
                    continue;
                }
                console.warn('[brainbase] Codex App Server transcript island retry failed; using fallback renderer', { firstError, error });
                return false;
            }
        }
        return false;
    };

    AppClass.prototype._unmountCodexAppServerTranscriptIsland = function() {
        this._codexAppServerTranscriptIsland?.unmount?.();
        this._codexAppServerTranscriptIsland = null;
        this._codexAppServerTranscriptIslandProps = null;
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
        if (!transcript && this._codexAppServerTranscriptIsland?.update && this._codexAppServerTranscriptIslandProps) {
            this._codexAppServerTranscriptIslandProps = {
                ...this._codexAppServerTranscriptIslandProps,
                threadId: snapshot?.threadId || this._codexAppServerTranscriptIslandProps.threadId,
                initialStatus: snapshot?.status || this._codexAppServerTranscriptIslandProps.initialStatus,
                initialSnapshot: snapshot,
                autoLoad: false
            };
            this._codexAppServerTranscriptIsland.update(this._codexAppServerTranscriptIslandProps);
            return;
        }
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
