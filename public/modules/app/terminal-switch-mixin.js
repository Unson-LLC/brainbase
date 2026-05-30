import { appStore } from '../core/store.js';
import { showError } from '../toast.js';

const TERMINAL_FRAME_COMMIT_TIMEOUT_MS = 5000;

export function applyTerminalSwitchMixin(AppClass) {
    AppClass.prototype._captureTerminalPresentation = function() {
        const consoleArea = document.getElementById('console-area');
        const frameEl = this.terminalFrame || document.getElementById('terminal-frame');
        const xtermHost = this.terminalXtermHost || document.getElementById('terminal-xterm-host');
        const snapshotPanel = this.terminalSnapshotPanelEl || document.getElementById('terminal-snapshot-panel');
        const codexAppServerPanel = this._getCodexAppServerDisplayPanel?.() || document.getElementById('codex-app-server-display-panel');
        const mobileModal = this.mobileLiveTerminalModalEl || document.getElementById('mobile-live-terminal-modal');

        return {
            frameSrc: frameEl?.getAttribute('src') || 'about:blank',
            frameHidden: Boolean(frameEl?.classList.contains('hidden')),
            xtermHidden: Boolean(xtermHost?.classList.contains('hidden')),
            snapshotHidden: Boolean(snapshotPanel?.classList.contains('hidden')),
            codexAppServerHidden: Boolean(codexAppServerPanel?.classList.contains('hidden')),
            codexAppServerSessionId: codexAppServerPanel?.dataset?.sessionId || '',
            codexAppServerThreadId: codexAppServerPanel?.dataset?.codexAppServerThreadId || '',
            codexAppServerStatusText: codexAppServerPanel?.querySelector?.('[data-codex-app-server-status]')?.textContent || '',
            codexAppServerSessionText: codexAppServerPanel?.querySelector?.('[data-codex-app-server-session-id]')?.textContent || '',
            codexAppServerThreadText: codexAppServerPanel?.querySelector?.('[data-codex-app-server-thread-label]')?.textContent || '',
            usingXterm: Boolean(consoleArea?.classList.contains('using-xterm')),
            usingSnapshot: Boolean(consoleArea?.classList.contains('using-snapshot')),
            usingCodexAppServer: Boolean(consoleArea?.classList.contains('using-codex-app-server')),
            mobileTerminalMode: this._mobileTerminalMode,
            mobileLiveTerminalSessionId: this._mobileLiveTerminalSessionId,
            mobileModalActive: Boolean(mobileModal?.classList.contains('active'))
        };
    };

    AppClass.prototype._setActiveSessionRow = function(sessionId) {
        // The React session-list island manages its own row active state declaratively
        // (from appStore.currentSessionId). Skip island-owned rows so this imperative
        // toggle does not fight React; still update the vanilla rows (mobile sheet /
        // ?island=0 opt-out desktop).
        document.querySelectorAll('.session-child-row').forEach((row) => {
            if (row.closest('[data-island-owned="1"]')) return;
            row.classList.toggle('active', row.dataset.id === sessionId);
        });
    };

    AppClass.prototype._beginTerminalSwitch = function(sessionId, {
        previousSessionId = null,
        switchToken = this._sessionSwitchToken,
        surface = this.isMobile() ? 'mobile' : 'desktop'
    } = {}) {
        this._pendingTerminalSwitch = {
            fromSessionId: previousSessionId,
            toSessionId: sessionId,
            token: switchToken,
            startedAt: Date.now(),
            surface,
            presentation: this._captureTerminalPresentation()
        };
        this._terminalSwitchState = 'switching';
        this.showTerminalLoadingOverlay?.();
        return this._pendingTerminalSwitch;
    };

    AppClass.prototype._isTerminalSwitchCurrent = function(sessionId, switchToken = null) {
        const pending = this._pendingTerminalSwitch;
        if (!pending) return false;
        if (sessionId && pending.toSessionId !== sessionId) return false;
        if (switchToken != null && pending.token !== switchToken) return false;
        return true;
    };

    AppClass.prototype._finishTerminalSwitch = function(sessionId, switchToken = null, {
        state = 'idle',
        hideOverlay = true
    } = {}) {
        if (!this._isTerminalSwitchCurrent(sessionId, switchToken)) return;
        this._terminalPresentationSessionId = sessionId || null;
        this._pendingTerminalSwitch = null;
        this._terminalSwitchState = state;
        if (hideOverlay) {
            this.hideTerminalLoadingOverlay?.();
        }
    };

    AppClass.prototype._failTerminalSwitch = function(sessionId, switchToken = null, {
        previousSessionId = null,
        error = null,
        errorMessage = 'セッションの切替に失敗しました',
        restorePresentation = true
    } = {}) {
        const pending = this._pendingTerminalSwitch;
        if (!pending) return false;
        if (switchToken != null && pending.token !== switchToken) return false;
        if (sessionId && pending.toSessionId !== sessionId) return false;

        const fallbackSessionId = previousSessionId || pending.fromSessionId || this._terminalPresentationSessionId || null;
        if (restorePresentation) {
            this._restoreTerminalPresentation?.(pending.presentation || null);
        }
        if (fallbackSessionId && appStore.getState().currentSessionId === pending.toSessionId) {
            appStore.setState({ currentSessionId: fallbackSessionId });
            this._setActiveSessionRow(fallbackSessionId);
        }

        this._pendingTerminalSwitch = null;
        this._terminalSwitchState = 'error';
        this.hideTerminalLoadingOverlay?.();
        if (error) {
            console.error('Failed to switch terminal session:', error);
        }
        if (errorMessage) {
            showError(errorMessage);
        }
        this._updateTerminalInputStatus?.();
        return true;
    };

    AppClass.prototype._restoreTerminalPresentation = function(presentation) {
        if (!presentation) return;
        const consoleArea = document.getElementById('console-area');
        const frameEl = this.terminalFrame || document.getElementById('terminal-frame');
        const xtermHost = this.terminalXtermHost || document.getElementById('terminal-xterm-host');
        const snapshotPanel = this.terminalSnapshotPanelEl || document.getElementById('terminal-snapshot-panel');
        const codexAppServerPanel = this._getCodexAppServerDisplayPanel?.() || document.getElementById('codex-app-server-display-panel');
        const mobileModal = this.mobileLiveTerminalModalEl || document.getElementById('mobile-live-terminal-modal');

        if (consoleArea) {
            consoleArea.classList.toggle('using-xterm', presentation.usingXterm);
            consoleArea.classList.toggle('using-snapshot', presentation.usingSnapshot);
            consoleArea.classList.toggle('using-codex-app-server', Boolean(presentation.usingCodexAppServer));
        }
        if (xtermHost) {
            xtermHost.classList.toggle('hidden', presentation.xtermHidden);
        }
        if (frameEl) {
            frameEl.classList.toggle('hidden', presentation.frameHidden);
            const currentSrc = frameEl.getAttribute('src') || 'about:blank';
            if (presentation.frameSrc && currentSrc !== presentation.frameSrc) {
                frameEl.src = presentation.frameSrc;
            }
        }
        if (snapshotPanel) {
            snapshotPanel.classList.toggle('hidden', presentation.snapshotHidden);
        }
        if (codexAppServerPanel) {
            codexAppServerPanel.classList.toggle('hidden', Boolean(presentation.codexAppServerHidden));
            if (presentation.codexAppServerSessionId) {
                codexAppServerPanel.dataset.sessionId = presentation.codexAppServerSessionId;
            } else {
                codexAppServerPanel.removeAttribute('data-session-id');
            }
            if (presentation.codexAppServerThreadId) {
                codexAppServerPanel.dataset.codexAppServerThreadId = presentation.codexAppServerThreadId;
            } else {
                codexAppServerPanel.removeAttribute('data-codex-app-server-thread-id');
            }
            const statusEl = codexAppServerPanel.querySelector('[data-codex-app-server-status]');
            const sessionEl = codexAppServerPanel.querySelector('[data-codex-app-server-session-id]');
            const threadEl = codexAppServerPanel.querySelector('[data-codex-app-server-thread-label]');
            if (statusEl) statusEl.textContent = presentation.codexAppServerStatusText || '';
            if (sessionEl) sessionEl.textContent = presentation.codexAppServerSessionText || '';
            if (threadEl) threadEl.textContent = presentation.codexAppServerThreadText || '';
        }

        this._mobileTerminalMode = presentation.mobileTerminalMode || 'snapshot';
        this._mobileLiveTerminalSessionId = presentation.mobileLiveTerminalSessionId || null;
        if (mobileModal) {
            mobileModal.classList.toggle('active', Boolean(presentation.mobileModalActive));
        }
    };

    AppClass.prototype._awaitTerminalFrameReady = function(frameEl, proxyPath, {
        timeoutMs = TERMINAL_FRAME_COMMIT_TIMEOUT_MS
    } = {}) {
        if (!frameEl || !proxyPath) {
            return Promise.reject(new Error('Missing terminal frame or proxy path'));
        }

        if (window.__BRAINBASE_TEST__ || /jsdom/i.test(navigator.userAgent || '')) {
            frameEl.src = proxyPath;
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
                frameEl.removeEventListener('load', handleLoad);
                frameEl.removeEventListener('error', handleError);
                if (timeoutId) {
                    window.clearTimeout(timeoutId);
                }
            };
            const finish = (fn) => {
                if (settled) return;
                settled = true;
                cleanup();
                fn();
            };
            const handleLoad = () => finish(resolve);
            const handleError = () => finish(() => reject(new Error('Terminal frame failed to load')));
            const timeoutId = window.setTimeout(() => {
                finish(() => reject(new Error('Terminal frame load timeout')));
            }, timeoutMs);

            frameEl.addEventListener('load', handleLoad, { once: true });
            frameEl.addEventListener('error', handleError, { once: true });
            frameEl.src = proxyPath;
        });
    };
}
