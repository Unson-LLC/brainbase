/**
 * brainbase-ui Application Entry Point
 * 新アーキテクチャ: サービス層とビュー層の分離
 */

// Core
import { DIContainer } from './modules/core/di-container.js';
import { appStore } from './modules/core/store.js';
import { httpClient } from './modules/core/http-client.js';
import { eventBus, EVENTS } from './modules/core/event-bus.js';
import { AuthManager } from './modules/auth/auth-manager.js';
import { PluginManager } from './modules/core/plugin-manager.js';
import { SettingsCore, CoreApiClient } from './modules/settings/settings-core.js';
import { SettingsPluginRegistry } from './modules/settings/settings-plugin-api.js';
import { SettingsUI } from './modules/settings/settings-ui.js';
import { pollSessionStatus, updateSessionIndicators, startPolling, markDoneAsRead } from './modules/session-indicators.js';
import { initFileUpload, compressImage } from './modules/file-upload.js';
import { showSuccess, showError, showInfo } from './modules/toast.js';
import { createSessionId } from './modules/session-manager.js';
import { setupFileOpenerShortcuts } from './modules/file-opener.js';
import { setupTerminalContextMenuListener } from './modules/iframe-contextmenu-handler.js';
import { attachSectionHeaderHandlers, attachGroupHeaderHandlers, attachSessionRowClickHandlers, attachAddProjectSessionHandlers } from './modules/session-handlers.js';
import { initMobileKeyboard } from './modules/mobile-keyboard.js';
import { getSessionUiEntry, hydrateSessionRecentFiles, mergeSessionUiEntry, recordRecentFileOpen } from './modules/session-ui-state.js';

// Services
import { TaskService } from './modules/domain/task/task-service.js';
import { SessionService } from './modules/domain/session/session-service.js';
import { ScheduleService } from './modules/domain/schedule/schedule-service.js';
import { InboxService } from './modules/domain/inbox/inbox-service.js';
import { NocoDBTaskService } from './modules/domain/nocodb-task/nocodb-task-service.js';
import { CommitTreeService } from './modules/domain/commit-tree/commit-tree-service.js';
import { CommitTreeView } from './modules/ui/views/commit-tree-view.js';

// Views
import { TimelineView } from './modules/ui/views/timeline-view.js';
import { NextTasksView } from './modules/ui/views/next-tasks-view.js';
import { SessionView } from './modules/ui/views/session-view.js';
import { InboxView } from './modules/ui/views/inbox-view.js';
import { NocoDBTasksView } from './modules/ui/views/nocodb-tasks-view.js';
import { SessionContextBarView } from './modules/ui/views/session-context-bar-view.js';
import { setupNocoDBFilters } from './modules/ui/nocodb-filters.js';
import { setupTaskTabs } from './modules/ui/task-tabs.js';
import { setupSessionViewToggle } from './modules/ui/session-view-toggle.js';
import { setupSidebarPrimaryToggle } from './modules/ui/sidebar-primary-toggle.js';
import { setupViewNavigation } from './modules/ui/view-navigation.js';
import { renderViewToggle } from './modules/ui/view-toggle.js';
import { initTimelineResize } from './modules/ui/timeline-resize.js';
import { initPanelResize } from './modules/ui/panel-resize.js';
import { MobileInputController } from './modules/ui/mobile-input-controller.js';

// Modals
import { TaskAddModal } from './modules/ui/modals/task-add-modal.js';
import { TaskEditModal } from './modules/ui/modals/task-edit-modal.js';
import { ArchiveModal } from './modules/ui/modals/archive-modal.js';
import { FocusEngineModal } from './modules/ui/modals/focus-engine-modal.js';
import { RenameModal } from './modules/ui/modals/rename-modal.js';

/**
 * Terminal Reconnect Manager
 * Handles iframe disconnection detection and automatic reconnection
 */
class TerminalReconnectManager {
    constructor() {
        this.maxRetries = 3;
        this.retryCount = 0;
        this.retryDelay = 2000; // 初回2秒
        this.currentSessionId = null;
        this.terminalFrame = null;
        this.isReconnecting = false;
        this.lastConnectTime = null; // 最後のWebSocket接続成功時刻
        this.wsConnected = false;
        this.lastDisconnectCode = null;
        this.lastDisconnectReason = null;
        this.lastDisconnectAt = null;
        this.lastErrorAt = null;
        this.onStatusChange = null;
    }

    _emitStatus() {
        if (typeof this.onStatusChange !== 'function') return;
        this.onStatusChange({
            sessionId: this.currentSessionId,
            wsConnected: this.wsConnected,
            isReconnecting: this.isReconnecting,
            retryCount: this.retryCount,
            maxRetries: this.maxRetries,
            lastConnectTime: this.lastConnectTime,
            lastDisconnectCode: this.lastDisconnectCode,
            lastDisconnectReason: this.lastDisconnectReason,
            lastDisconnectAt: this.lastDisconnectAt,
            lastErrorAt: this.lastErrorAt
        });
    }

    init(terminalFrame) {
        this.terminalFrame = terminalFrame;

        // iframeのエラー検知
        terminalFrame.addEventListener('error', () => {
            this.handleDisconnect();
        });

        // iframeのload成功
        terminalFrame.addEventListener('load', () => {
            this.handleConnect();
        });

        // ttyd内部WebSocket監視用のpostMessageリスナー
        this.initPostMessageListener();
        this._emitStatus();
    }

    initPostMessageListener() {
        window.addEventListener('message', (event) => {
            // セキュリティ: 同一オリジンのみ許可
            if (event.origin !== window.location.origin) return;

            const { type, sessionId, code, reason } = event.data || {};

            switch (type) {
                case 'ttyd-disconnect':
                    console.log(`[ttyd] Session ${sessionId} WebSocket disconnected (code: ${code})`);
                    this.handleTtydDisconnect(sessionId, code, reason);
                    break;
                case 'ttyd-error':
                    console.log(`[ttyd] Session ${sessionId} WebSocket error`);
                    this.handleTtydError(sessionId);
                    break;
                case 'ttyd-connect':
                    console.log(`[ttyd] Session ${sessionId} WebSocket connected`);
                    this.handleTtydConnect(sessionId);
                    break;
            }
        });
    }

    handleTtydDisconnect(sessionId, code, reason) {
        // 現在のセッションの場合のみ処理
        if (sessionId !== this.currentSessionId) return;

        // 正常切断（code 1000）は無視（セッション切り替え等）
        if (code === 1000) return;

        // アーカイブ済みセッションの切断は再接続しない
        const state = appStore.getState();
        const session = (state.sessions || []).find(s => s.id === sessionId);
        if (session?.intendedState === 'archived') {
            console.log(`[reconnect] Ignoring disconnect for archived session ${sessionId}`);
            this.wsConnected = false;
            this._emitStatus();
            return;
        }

        // 最近接続成功した場合は無視（race condition防止）
        if (this.lastConnectTime && Date.now() - this.lastConnectTime < 3000) {
            console.log('[reconnect] Ignoring disconnect within 3s of connect');
            return;
        }

        this.wsConnected = false;
        this.lastDisconnectCode = code;
        this.lastDisconnectReason = reason || null;
        this.lastDisconnectAt = Date.now();
        this._emitStatus();

        // 自動再接続トリガー
        if (!this.isReconnecting) {
            showInfo('ターミナル接続が切断されました。再接続中...');
            this.handleDisconnect();
        }
    }

    handleTtydError(sessionId) {
        // 現在のセッションの場合のみ処理
        if (sessionId !== this.currentSessionId) return;

        this.wsConnected = false;
        this.lastErrorAt = Date.now();
        this._emitStatus();

        if (!this.isReconnecting) {
            this.handleDisconnect();
        }
    }

    handleTtydConnect(sessionId) {
        // 現在のセッションの場合のみ処理
        if (sessionId !== this.currentSessionId) return;

        this.wsConnected = true;
        this.lastDisconnectCode = null;
        this.lastDisconnectReason = null;
        this.lastDisconnectAt = null;
        this.lastErrorAt = null;

        // 接続成功時刻を記録（disconnect race condition防止用）
        this.lastConnectTime = Date.now();

        if (this.retryCount > 0 || this.isReconnecting) {
            showInfo('ターミナル接続が復旧しました');
            this.retryCount = 0;
            this.isReconnecting = false;
        }
        this._emitStatus();
    }

    handleDisconnect() {
        // 再接続中または既にリトライ上限に達している場合はスキップ
        if (this.isReconnecting || !this.currentSessionId) return;

        if (this.retryCount < this.maxRetries) {
            this.isReconnecting = true;
            this.retryCount++;
            const delay = this.retryDelay * Math.pow(2, this.retryCount - 1);

            showInfo(`ターミナル再接続中... (${this.retryCount}/${this.maxRetries})`);
            this._emitStatus();

            setTimeout(() => {
                this.reconnect();
            }, delay);
        } else {
            showError('ターミナル接続に失敗しました。ページをリロードしてください。');
        }
    }

    handleConnect() {
        if (this.retryCount > 0) {
            showInfo('ターミナル接続が復旧しました');
        }
        this.retryCount = 0;
        this.isReconnecting = false;
        this._emitStatus();
    }

    async reconnect() {
        if (!this.currentSessionId) {
            this.isReconnecting = false;
            return;
        }

        // アーカイブ済みセッションの再接続をスキップ
        const state = appStore.getState();
        const currentSession = (state.sessions || []).find(s => s.id === this.currentSessionId);
        if (currentSession?.intendedState === 'archived') {
            console.log(`[reconnect] Skipping: session ${this.currentSessionId} is archived`);
            this.isReconnecting = false;
            this.retryCount = 0;
            return;
        }

        try {
            const payload = { sessionId: this.currentSessionId };

            const sessionCwd = currentSession?.worktree?.path || currentSession?.path;
            if (typeof sessionCwd === 'string' && sessionCwd.trim()) {
                payload.cwd = sessionCwd;
            }
            if (typeof currentSession?.initialCommand === 'string') {
                payload.initialCommand = currentSession.initialCommand;
            }
            if (typeof currentSession?.engine === 'string' && currentSession.engine.trim()) {
                payload.engine = currentSession.engine;
            }

            const res = await httpClient.post('/api/sessions/start', payload);

            if (res?.proxyPath) {
                const nextSrc = res.proxyPath;
                const currentSrc = this.terminalFrame.src || '';

                // Force reload even if the base path is the same. Proxy routing may have changed (new ttyd port).
                if (currentSrc.includes(nextSrc)) {
                    this.terminalFrame.src = 'about:blank';
                    setTimeout(() => {
                        this.terminalFrame.src = nextSrc;
                    }, 50);
                } else {
                    this.terminalFrame.src = nextSrc;
                }
            } else {
                this.handleDisconnect();
            }
        } catch (error) {
            console.error('Reconnect failed:', error);
            this.isReconnecting = false;
            // 無限ループ防止: catchでは再試行せず、ユーザーにリロードを促す
            if (this.retryCount >= this.maxRetries) {
                showError('ターミナル接続に失敗しました。ページをリロードしてください。');
            }
        }
    }

    setCurrentSession(sessionId) {
        this.currentSessionId = sessionId;
        this.retryCount = 0;
        this.isReconnecting = false;
        this.wsConnected = false;
        this.lastDisconnectCode = null;
        this.lastDisconnectReason = null;
        this.lastDisconnectAt = null;
        this.lastErrorAt = null;
        this._emitStatus();
    }
}

/**
 * Application initialization
 */
export class App {
    constructor() {
        this.container = new DIContainer();
        this.views = {};
        this.modals = {};
        this.unsubscribers = [];
        this.pollingIntervalId = null;
        this.refreshIntervalId = null;
        this.choiceCheckInterval = null;
        this.sessionUiSummaryIntervalId = null;
        this.lastChoiceHash = null;
        this.settingsCore = null; // Settings Plugin Architecture
        this.reconnectManager = null; // Terminal Reconnect Manager
        this.terminalFrame = null;
        this.terminalInputStatusEl = null;
        this._terminalInputUxCleanup = [];
        this._terminalLastNavigateAt = 0;
        // tmux copy-mode (pane_in_mode) blocks input. We can't reliably read it from the iframe,
        // so we track entry/exit based on TMUX_SCROLL / TERMINAL_INTERACT messages.
        this._terminalCopyModeSessions = new Set();
        this.pluginManager = null;
        this.authManager = null;
        this.mobileInputController = null;
    }

    _isConsoleVisible() {
        const consoleArea = document.getElementById('console-area');
        if (!consoleArea) return false;
        return window.getComputedStyle(consoleArea).display !== 'none';
    }

    _isEditableTarget(target) {
        const el = target instanceof Element ? target : null;
        if (!el) return false;
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (el.isContentEditable) return true;
        return Boolean(el.closest?.('[contenteditable="true"]'));
    }

    _getTerminalOverlayState() {
        const menuOverlay = document.getElementById('menu-overlay');
        const dropOverlay = document.getElementById('drop-overlay');
        const choiceOverlay = document.getElementById('choice-overlay');

        const menuActive = Boolean(menuOverlay && !menuOverlay.classList.contains('hidden'));
        const dropActive = Boolean(dropOverlay && dropOverlay.classList.contains('active'));
        const choiceActive = Boolean(choiceOverlay && choiceOverlay.classList.contains('active'));

        return {
            menuActive,
            dropActive,
            choiceActive,
            any: menuActive || dropActive || choiceActive
        };
    }

    focusTerminal(reason = 'unknown') {
        if (!this._isConsoleVisible()) return;

        const frame = this.terminalFrame || document.getElementById('terminal-frame');
        if (!frame) return;

        try {
            frame.focus?.();
        } catch (error) {
            // ignore
        }
        try {
            frame.contentWindow?.focus?.();
        } catch (error) {
            // ignore
        }
        try {
            // Best-effort: ask ttyd iframe to focus xterm helper textarea
            frame.contentWindow?.postMessage?.({ type: 'bb-terminal-focus', reason }, window.location.origin);
        } catch (error) {
            // ignore
        }

        this._updateTerminalInputStatus();
    }

    scheduleAfterNextPaint(fn) {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => fn());
            });
            return;
        }
        setTimeout(() => fn(), 0);
    }

    _setCurrentSessionUiState(updates = {}, options = {}) {
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) return;
        const { emit = false } = options;
        const previous = getSessionUiEntry(sessionId) || {};
        const changed = Object.entries(updates).some(([key, value]) => previous?.[key] !== value);
        if (!changed) return;
        mergeSessionUiEntry(sessionId, updates);
        if (emit) {
            void eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, { sessionIds: [sessionId] });
        }
    }

    async refreshSessionUiSummaries(sessionIds = []) {
        return await this.sessionService.refreshSessionUiSummaries(sessionIds);
    }

    _setTerminalInputStatus({ hidden, stateClass, text, title }) {
        const el = this.terminalInputStatusEl;
        if (!el) return;

        const classes = ['ready', 'needs-focus', 'reconnecting', 'disconnected', 'blocked', 'copy-mode'];
        el.classList.remove(...classes);

        if (hidden) {
            el.classList.add('hidden');
            el.textContent = '';
            el.title = '';
            return;
        }

        el.classList.remove('hidden');
        if (stateClass) el.classList.add(stateClass);
        el.textContent = text || '';
        el.title = title || '';
    }

    _updateTerminalInputStatus() {
        if (!this.terminalInputStatusEl) return;

        if (!this._isConsoleVisible()) {
            this._setTerminalInputStatus({ hidden: true });
            return;
        }

        const sessionId = appStore.getState().currentSessionId;
        const frame = this.terminalFrame || document.getElementById('terminal-frame');

        if (!sessionId || !frame) {
            this._setTerminalInputStatus({ hidden: true });
            return;
        }

        const overlayState = this._getTerminalOverlayState();
        const isFocused = document.activeElement === frame;
        const frameSrcAttr = frame.getAttribute('src');
        const frameBlank = !frameSrcAttr || frameSrcAttr === 'about:blank';
        const wsConnected = Boolean(this.reconnectManager?.wsConnected);
        const isReconnecting = Boolean(this.reconnectManager?.isReconnecting);
        const isCopyMode = this._terminalCopyModeSessions.has(sessionId);
        const retryCount = this.reconnectManager?.retryCount ?? 0;
        const maxRetries = this.reconnectManager?.maxRetries ?? 3;
        const lastCode = this.reconnectManager?.lastDisconnectCode;
        const recentlyNavigated = this._terminalLastNavigateAt && Date.now() - this._terminalLastNavigateAt < 2500;

        // モバイルではMobile Input Dockから入力するため、iframeフォーカスは不要
        const isMobile = window.innerWidth <= 768;

        let stateClass = 'blocked';
        let text = '入力: 不明';
        let title = `session=${sessionId}`;
        let transportState = 'blocked';
        let attentionState = 'none';

        if (overlayState.any) {
            stateClass = 'blocked';
            transportState = 'blocked';
            if (overlayState.choiceActive) {
                text = '入力: 選択中';
                title = '選択UIが開いている間はターミナル入力できません';
            } else if (overlayState.dropActive) {
                text = '入力: ドロップ待ち';
                title = 'ファイルドロップ中はターミナル入力できません';
            } else {
                text = '入力: メニュー表示中';
                title = 'メニューを閉じるとターミナル入力できます';
            }
        } else if (isReconnecting) {
            stateClass = 'reconnecting';
            transportState = 'reconnecting';
            text = `入力: 再接続中 (${retryCount}/${maxRetries})`;
            title = `session=${sessionId} reconnecting`;
        } else if (frameBlank) {
            if (recentlyNavigated) {
                stateClass = 'reconnecting';
                transportState = 'reconnecting';
                text = '入力: 接続中...';
                title = `session=${sessionId} connecting`;
            } else {
                stateClass = 'disconnected';
                transportState = 'disconnected';
                text = '入力: 未接続';
                title = `session=${sessionId} iframe=about:blank`;
            }
        } else if (!wsConnected) {
            if (recentlyNavigated) {
                stateClass = 'reconnecting';
                transportState = 'reconnecting';
                text = '入力: 接続中...';
                title = `session=${sessionId} connecting`;
            } else {
                stateClass = 'disconnected';
                transportState = 'disconnected';
                text = '入力: 切断';
                title = `session=${sessionId} disconnected${typeof lastCode === 'number' ? ` (code ${lastCode})` : ''}`;
            }
        } else if (!isFocused && !isMobile) {
            // デスクトップのみ: フォーカスが外れていたらクリックを促す
            // モバイルではMobile Input Dockから入力するためフォーカス不要
            stateClass = 'needs-focus';
            transportState = 'connected';
            attentionState = 'needs-focus';
            text = '入力: クリックでフォーカス';
            title = `session=${sessionId} (click to focus)`;
        } else if (isCopyMode) {
            stateClass = 'copy-mode';
            transportState = 'connected';
            attentionState = 'copy-mode';
            text = '入力: スクロール中 (クリックで戻る)';
            title = `session=${sessionId} copy-mode (click to exit)`;
        } else {
            stateClass = 'ready';
            transportState = 'connected';
            text = '入力: OK';
            title = `session=${sessionId} connected`;
        }

        this._setTerminalInputStatus({ hidden: false, stateClass, text, title });
        const previous = getSessionUiEntry(sessionId) || {};
        const shouldEmit = previous.transport !== transportState || previous.attention !== attentionState;
        this._setCurrentSessionUiState(
            {
                transport: transportState,
                attention: attentionState
            },
            { emit: shouldEmit }
        );
    }

    setupTerminalInputUx() {
        if (!this.terminalFrame) return;

        this.terminalInputStatusEl = document.getElementById('terminal-input-status');
        const consoleArea = document.getElementById('console-area');

        // Keep status in sync with session selection, focus changes, overlay visibility, and WS events.
        const unsub = appStore.subscribeToSelector(
            state => state.currentSessionId,
            () => {
                // Mark navigation time to show "connecting..." briefly.
                this._terminalLastNavigateAt = Date.now();
                this._updateTerminalInputStatus();
            }
        );
        this._terminalInputUxCleanup.push(unsub);

        const onFocusChange = () => this._updateTerminalInputStatus();
        document.addEventListener('focusin', onFocusChange, true);
        window.addEventListener('blur', onFocusChange);
        this._terminalInputUxCleanup.push(() => document.removeEventListener('focusin', onFocusChange, true));
        this._terminalInputUxCleanup.push(() => window.removeEventListener('blur', onFocusChange));

        // Observe overlay class changes (menu/drop/choice) to update status.
        const overlays = ['menu-overlay', 'drop-overlay', 'choice-overlay']
            .map(id => document.getElementById(id))
            .filter(Boolean);
        const observer = new MutationObserver(() => this._updateTerminalInputStatus());
        overlays.forEach(el => observer.observe(el, { attributes: true, attributeFilter: ['class'] }));
        this._terminalInputUxCleanup.push(() => observer.disconnect());

        // Reconnect manager status callback.
        if (this.reconnectManager) {
            this.reconnectManager.onStatusChange = () => this._updateTerminalInputStatus();
        }

        // Track tmux copy-mode (entered by TMUX_SCROLL; exited by TERMINAL_INTERACT).
        const onTerminalMessage = (event) => {
            // Only trust same-origin messages coming from the current terminal iframe.
            if (event.origin !== window.location.origin) return;
            if (this.terminalFrame?.contentWindow && event.source !== this.terminalFrame.contentWindow) return;

            const type = event.data?.type;
            if (type !== 'TMUX_SCROLL' && type !== 'TERMINAL_INTERACT') return;

            const sessionId = appStore.getState().currentSessionId;
            if (!sessionId) return;

            if (type === 'TMUX_SCROLL') {
                this._terminalCopyModeSessions.add(sessionId);
            } else if (type === 'TERMINAL_INTERACT') {
                this._terminalCopyModeSessions.delete(sessionId);
            }
            this._updateTerminalInputStatus();
        };
        window.addEventListener('message', onTerminalMessage);
        this._terminalInputUxCleanup.push(() => window.removeEventListener('message', onTerminalMessage));

        // Click-to-focus: clicking on the console background (including the menu overlay) should restore focus.
        const onConsoleClick = (e) => {
            if (!this._isConsoleVisible()) return;
            if (this._isEditableTarget(e.target)) return;

            const overlayState = this._getTerminalOverlayState();
            // Don't steal focus while modal overlays (choices/drag) are active.
            if (overlayState.choiceActive || overlayState.dropActive) return;

            // Don't steal focus when clicking toolbar buttons or other buttons.
            if (e.target?.closest?.('button')) return;

            this.focusTerminal('console-click');
        };
        consoleArea?.addEventListener('click', onConsoleClick, true);
        this._terminalInputUxCleanup.push(() => consoleArea?.removeEventListener('click', onConsoleClick, true));

        // Status badge click: focus, and if disconnected, trigger reconnect.
        const onStatusClick = (e) => {
            e.preventDefault();
            const overlayState = this._getTerminalOverlayState();
            if (overlayState.any) return;

            const sessionId = appStore.getState().currentSessionId;
            if (sessionId && this._terminalCopyModeSessions.has(sessionId)) {
                // Best-effort: exit tmux copy-mode so input works again.
                fetch(`/api/sessions/${sessionId}/exit_copy_mode`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                }).catch(() => {});
                this._terminalCopyModeSessions.delete(sessionId);
            }

            if (!this.reconnectManager?.wsConnected && !this.reconnectManager?.isReconnecting) {
                this.reconnectManager?.handleDisconnect?.();
            }

            // モバイルでは focusTerminal を呼ばない（iframe.focus() でキーボードが閉じる問題を回避）
            const isMobile = window.innerWidth <= 768;
            if (!isMobile) {
                this.focusTerminal('status-click');
            }

            this._updateTerminalInputStatus();
        };
        this.terminalInputStatusEl?.addEventListener('click', onStatusClick);
        this._terminalInputUxCleanup.push(() => this.terminalInputStatusEl?.removeEventListener('click', onStatusClick));

        // Type-to-focus: if user starts typing while terminal isn't focused, focus it and inject the first key.
        const onKeydownCapture = (e) => {
            if (!this._isConsoleVisible()) return;
            if (e.defaultPrevented) return;
            if (e.isComposing) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (this._isEditableTarget(e.target)) return;

            const sessionId = appStore.getState().currentSessionId;
            if (!sessionId) return;
            if (document.activeElement === this.terminalFrame) return;
            if (this.terminalFrame?.getAttribute?.('src') === 'about:blank') return;

            const overlayState = this._getTerminalOverlayState();
            if (overlayState.any) return;

            // If the websocket is down, attempting a reconnect here reduces "typed but nothing happened".
            if (this.reconnectManager && !this.reconnectManager.wsConnected && !this.reconnectManager.isReconnecting) {
                this.reconnectManager.handleDisconnect?.();
            }

            const key = e.key;

            // Only inject safe/simple keys.
            if (key === 'Enter') {
                this.focusTerminal('type-to-focus');
                httpClient.post(`/api/sessions/${sessionId}/input`, { input: 'Enter', type: 'key' }).catch(() => {});
                e.preventDefault();
                return;
            }

            if (typeof key === 'string' && key.length === 1 && key !== ' ') {
                this.focusTerminal('type-to-focus');
                httpClient.post(`/api/sessions/${sessionId}/input`, { input: key, type: 'text' }).catch(() => {});
                e.preventDefault();
            }
        };
        document.addEventListener('keydown', onKeydownCapture, true);
        this._terminalInputUxCleanup.push(() => document.removeEventListener('keydown', onKeydownCapture, true));

        // Initial paint
        if (appStore.getState().currentSessionId) {
            this._terminalLastNavigateAt = Date.now();
        }
        this._updateTerminalInputStatus();
    }

    /**
     * Initialize authentication manager
     */
    async initAuth() {
        this.authManager = new AuthManager({ httpClient, store: appStore, eventBus });

        httpClient.setUnauthorizedHandler(() => {
            this.authManager?.clearSession();
            showError('認証が必要です。Settings > 認証からログインしてください。');
        });

        await this.authManager.initFromStorage();
    }

    /**
     * Initialize services
     */
    initServices() {
        // Register services in DI container
        this.container.register('taskService', () => new TaskService());
        this.container.register('sessionService', () => new SessionService());
        this.container.register('scheduleService', () => new ScheduleService());
        this.container.register('inboxService', () => new InboxService());
        this.container.register('nocodbTaskService', () => new NocoDBTaskService({ httpClient }));

        this.container.register('commitTreeService', () => new CommitTreeService());

        // Get service instances
        this.taskService = this.container.get('taskService');
        this.sessionService = this.container.get('sessionService');
        this.scheduleService = this.container.get('scheduleService');
        this.inboxService = this.container.get('inboxService');
        this.nocodbTaskService = this.container.get('nocodbTaskService');
    }

    /**
     * Initialize views
     */
    initViews() {
        const contextBarContainer = document.getElementById('session-context-bar');
        if (contextBarContainer) {
            this.views.sessionContextBarView = new SessionContextBarView({
                sessionService: this.sessionService
            });
            this.views.sessionContextBarView.mount(contextBarContainer);
        }

        // Sessions (left sidebar)
        const sessionContainer = document.getElementById('session-list');
        if (sessionContainer) {
            this.views.sessionView = new SessionView({ sessionService: this.sessionService });
            this.views.sessionView.mount(sessionContainer);
        }

        // Commit Tree (right sidebar)
        const commitTreeContainer = document.getElementById('commit-tree-list');
        if (commitTreeContainer) {
            this.commitTreeService = this.container.get('commitTreeService');
            this.views.commitTreeView = new CommitTreeView({
                commitTreeService: this.commitTreeService
            });
            this.views.commitTreeView.mount(commitTreeContainer);
        }
    }

    /**
     * Initialize UI plugins
     */
    async initPlugins() {
        try {
            this.pluginManager = new PluginManager({ eventBus, store: appStore });
            this.pluginManager.registerSlotsFromDOM();
            this._registerUIPlugins();
            await this.pluginManager.loadConfig();
            await this.pluginManager.enableConfiguredPlugins();
        } catch (error) {
            console.warn('Plugin initialization failed, continuing without plugins:', error.message);
        }
    }

    /**
     * Register UI plugins
     * @private
     */
    _registerUIPlugins() {
        if (!this.pluginManager) return;


        this.pluginManager.registerPlugin({
            id: 'bb-dashboard',
            layer: 'business',
            slots: {
                'nav:view-toggle': {
                    mount: ({ container }) => {
                        const cleanupToggle = renderViewToggle(container);
                        return () => {
                            cleanupToggle?.();
                        };
                    }
                },
                'view:dashboard': {
                    manageVisibility: false,
                    mount: async ({ container }) => {
                        const dashboardBtn = document.getElementById('nav-dashboard-btn');
                        const mobileDashboardBtn = document.getElementById('mobile-dashboard-btn');
                        if (dashboardBtn) {
                            dashboardBtn.style.display = '';
                        }
                        if (mobileDashboardBtn) {
                            mobileDashboardBtn.style.display = '';
                        }

                        const { cleanup, showConsole, showDashboard } = setupViewNavigation({
                            onDashboardActivated: () => {
                                this.dashboardController?.init();
                            }
                        });
                        this.showConsole = showConsole;
                        this.showDashboard = showDashboard;
                        await this.initDashboardController();

                        return () => {
                            cleanup?.();
                            if (this.showConsole) {
                                this.showConsole();
                            }
                            if (dashboardBtn) {
                                dashboardBtn.style.display = 'none';
                            }
                            if (mobileDashboardBtn) {
                                mobileDashboardBtn.style.display = 'none';
                            }
                            if (this.dashboardController?.destroy) {
                                this.dashboardController.destroy();
                            }
                            this.dashboardController = null;
                            container.style.display = 'none';
                        };
                    }
                }
            }
        });


        this.pluginManager.registerPlugin({
            id: 'bb-tasks',
            layer: 'core',
            slots: {
                'sidebar:next-tasks': {
                    mount: ({ container }) => {
                        const nextTasksContainer = document.getElementById('next-tasks-list');
                        if (nextTasksContainer) {
                            this.views.nextTasksView = new NextTasksView({ taskService: this.taskService });
                            this.views.nextTasksView.mount(nextTasksContainer);
                        }

                        const cleanupTabs = setupTaskTabs({
                            eventBus,
                            events: EVENTS,
                            onTabActivated: () => {
                                this.views.nocodbTasksView?.onTabActivated?.();
                            }
                        });

                        return () => {
                            cleanupTabs?.();
                            this.views.nextTasksView?.unmount?.();
                            delete this.views.nextTasksView;
                            container.style.display = 'none';
                        };
                    }
                },
                'mobile:tasks': {
                    mount: () => {
                        const tasksBottomSheet = document.getElementById('tasks-bottom-sheet');
                        const tasksSheetOverlay = document.getElementById('tasks-sheet-overlay');
                        if (tasksBottomSheet) tasksBottomSheet.style.display = '';
                        if (tasksSheetOverlay) tasksSheetOverlay.style.display = '';

                        return () => {
                            if (tasksBottomSheet) tasksBottomSheet.style.display = 'none';
                            if (tasksSheetOverlay) tasksSheetOverlay.style.display = 'none';
                        };
                    }
                }
            }
        });

        this.pluginManager.registerPlugin({
            id: 'bb-tasks-project',
            layer: 'business',
            requirements: {
                configKeys: ['nocodb']
            },
            slots: {
                'sidebar:project-tasks-tab': {
                    mount: () => { }
                },
                'sidebar:project-tasks-panel': {
                    mount: () => {
                        const nocodbTasksContainer = document.getElementById('nocodb-tasks-list');
                        if (nocodbTasksContainer) {
                            this.views.nocodbTasksView = new NocoDBTasksView({ nocodbTaskService: this.nocodbTaskService });
                            this.views.nocodbTasksView.mount(nocodbTasksContainer);
                        }

                        const cleanupFilters = setupNocoDBFilters({
                            onSearchChange: (value) => this.views.nocodbTasksView?.handleSearchFilterChange(value),
                            onAssigneeChange: (value) => this.views.nocodbTasksView?.handleAssigneeFilterChange(value),
                            onProjectChange: (value) => this.views.nocodbTasksView?.handleFilterChange(value),
                            onHideCompletedChange: (checked) => this.views.nocodbTasksView?.handleHideCompletedChange(checked),
                            onSync: () => this.views.nocodbTasksView?.handleSync?.()
                        });

                        return () => {
                            cleanupFilters?.();
                            this.views.nocodbTasksView?.unmount?.();
                            delete this.views.nocodbTasksView;
                        };
                    }
                }
            }
        });

        this.pluginManager.registerPlugin({
            id: 'bb-inbox',
            layer: 'business',
            slots: {
                'nav:inbox': {
                    mount: () => {
                        this.views.inboxView = new InboxView({ inboxService: this.inboxService, httpClient });
                        this.views.inboxView.mount();

                        return () => {
                            this.views.inboxView?.unmount?.();
                            delete this.views.inboxView;
                        };
                    }
                }
            }
        });

        this.pluginManager.registerPlugin({
            id: 'bb-schedule',
            layer: 'core',
            slots: {
                'sidebar:schedule': {
                    mount: () => {
                        const timelineContainer = document.getElementById('timeline-list');
                        if (timelineContainer) {
                            this.views.timelineView = new TimelineView({ scheduleService: this.scheduleService });
                            this.views.timelineView.mount(timelineContainer);
                        }

                        // Initialize timeline resize functionality
                        const cleanupResize = initTimelineResize();

                        return () => {
                            cleanupResize?.();
                            this.views.timelineView?.unmount?.();
                            delete this.views.timelineView;
                        };
                    }
                }
            }
        });

        /*
                this.pluginManager.registerPlugin({
                    id: 'bb-mana',
                    layer: 'business',
                    slots: {}
                });
        */
    }

    /**
     * Initialize Dashboard Controller (Mana extension)
     * OSS版では利用不可
     */
    async initDashboardController() {
        if (this.dashboardController) {
            return this.dashboardController;
        }

        try {
            const { DashboardController } = await import('./modules/dashboard-controller.js');
            this.dashboardController = new DashboardController();
            await this.dashboardController.init();
            console.log('Dashboard Controller loaded (Mana extension)');
            return this.dashboardController;
        } catch (error) {
            console.error('Dashboard Controller error:', error);
            this.dashboardController = null;
            return null;
        }
    }

    /**
     * Initialize modals
     */
    initModals() {
        // Task add modal (supports both local and NocoDB tasks)
        this.modals.taskAddModal = new TaskAddModal({
            taskService: this.taskService,
            nocodbTaskService: this.nocodbTaskService
        });
        this.modals.taskAddModal.mount();

        // Task edit modal (supports both local and NocoDB tasks)
        this.modals.taskEditModal = new TaskEditModal({
            taskService: this.taskService,
            nocodbTaskService: this.nocodbTaskService
        });
        this.modals.taskEditModal.mount();

        // Archive modal
        this.modals.archiveModal = new ArchiveModal({ sessionService: this.sessionService });
        this.modals.archiveModal.mount();

        // Focus engine modal
        this.modals.focusEngineModal = new FocusEngineModal();
        this.modals.focusEngineModal.mount();

        // Rename modal
        this.modals.renameModal = new RenameModal({ sessionService: this.sessionService });
        this.modals.renameModal.mount();

    }

    /**
     * Initialize project select dropdown
     */
    initProjectSelect() {
        this.refreshProjectSelect();
    }

    /**
     * Refresh project select options (filters archived)
     * @param {string} selectedProject - Project ID to preselect
     */
    async refreshProjectSelect(selectedProject = 'general') {
        const projectSelect = document.getElementById('session-project-select');
        if (!projectSelect) {
            console.warn('[App] session-project-select not found');
            return;
        }

        try {
            const { getSessionSelectableProjects, projectMappingReady } = await import('./modules/project-mapping.js');
            await projectMappingReady;
            const projects = getSessionSelectableProjects();
            console.log('[App] Initializing project select with projects:', projects);

            // Clear existing options
            projectSelect.innerHTML = '';

            // Add general option
            const generalOption = document.createElement('option');
            generalOption.value = 'general';
            generalOption.textContent = 'general';
            projectSelect.appendChild(generalOption);

            // Add all projects
            projects.forEach((proj) => {
                const option = document.createElement('option');
                option.value = proj;
                option.textContent = proj;
                projectSelect.appendChild(option);
            });

            projectSelect.value = selectedProject;
        } catch (error) {
            console.warn('[App] Failed to refresh project select:', error);
        }
    }

    /**
     * Setup global event listeners
     */
    async setupEventListeners() {
        // Terminal copy modal
        const copyTerminalBtn = document.getElementById('copy-terminal-btn');
        const copyTerminalModal = document.getElementById('copy-terminal-modal');
        const terminalContentDisplay = document.getElementById('terminal-content-display');
        const copyContentBtn = document.getElementById('copy-content-btn');

        if (copyTerminalBtn && copyTerminalModal && terminalContentDisplay) {
            copyTerminalBtn.onclick = async () => {
                const currentSessionId = appStore.getState().currentSessionId;
                if (!currentSessionId) {
                    alert('セッションを選択してください');
                    return;
                }

                try {
                    const res = await fetch(`/api/sessions/${currentSessionId}/content?lines=500`);
                    if (!res.ok) throw new Error('Failed to fetch content');

                    const { content } = await res.json();
                    terminalContentDisplay.textContent = content;
                    copyTerminalModal.classList.add('active');

                    // Scroll to bottom
                    setTimeout(() => {
                        terminalContentDisplay.scrollTop = terminalContentDisplay.scrollHeight;
                    }, 50);
                } catch (error) {
                    console.error('Failed to get terminal content:', error);
                    alert('ターミナル内容の取得に失敗しました');
                }
            };
        }

        if (copyContentBtn && terminalContentDisplay) {
            copyContentBtn.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(terminalContentDisplay.textContent);
                    alert('コピーしました！');
                } catch (error) {
                    console.error('Failed to copy:', error);
                    alert('コピーに失敗しました');
                }
            };
        }

        // Close modal buttons
        const closeModalBtns = document.querySelectorAll('.close-modal-btn');
        closeModalBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.modal.active').forEach(modal => {
                    modal.classList.remove('active');
                });
            });
        });

        // Close modal on background click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });

        // Session change: reload related data and switch terminal
        const unsub1 = eventBus.onAsync(EVENTS.SESSION_CHANGED, async (event) => {
            const { sessionId, proxyPath = null } = event.detail;
            console.log('[SessionSwitch] Starting for:', sessionId);
            const previousSessionId = event.detail?.previousSessionId ?? appStore.getState().currentSessionId;

            // Mark previous session's green indicator as read when leaving it
            if (previousSessionId && previousSessionId !== sessionId) {
                void markDoneAsRead(previousSessionId, sessionId);
            }

            // Update currentSessionId in store
            appStore.setState({ currentSessionId: sessionId });

            const startTime = performance.now();
            await this.switchSession(sessionId, { proxyPath });
            const duration = performance.now() - startTime;
            console.log(`[SessionSwitch] Terminal ready in ${duration.toFixed(2)}ms`);

            // Auto-return to console view
            if (this.showConsole) {
                this.showConsole();
            } else {
                // Fallback: showConsole未初期化時（ダッシュボード未訪問）でもconsole viewに戻す
                const consoleArea = document.getElementById('console-area');
                const dashboardPanel = document.getElementById('dashboard-panel');
                if (consoleArea) consoleArea.style.display = 'flex';
                if (dashboardPanel) dashboardPanel.style.display = 'none';
            }

            this.focusTerminal('session-changed');

            this.scheduleAfterNextPaint(() => {
                void this.loadSessionData(sessionId);
                void this.refreshSessionUiSummaries([sessionId]);
                void eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, { sessionIds: [sessionId] });
            });

        });

        const unsub1b = eventBus.onAsync(EVENTS.FOLDER_TREE_FILE_OPENED, async (event) => {
            const { sessionId, relativePath } = event.detail || {};
            if (!sessionId || !relativePath) return;
            recordRecentFileOpen(sessionId, relativePath);
            await eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, { sessionIds: [sessionId] });
        });

        const refreshUiSummaries = () => {
            const sessions = appStore.getState().sessions || [];
            const activeIds = sessions
                .filter((session) => session.intendedState !== 'archived')
                .map((session) => session.id);
            if (activeIds.length === 0) return;
            void this.refreshSessionUiSummaries(activeIds);
        };

        const unsub1d = eventBus.on(EVENTS.SESSION_CREATED, refreshUiSummaries);
        const unsub1e = eventBus.on(EVENTS.SESSION_ARCHIVED, refreshUiSummaries);
        const unsub1f = eventBus.on(EVENTS.SESSION_PAUSED, refreshUiSummaries);
        const unsub1g = eventBus.on(EVENTS.SESSION_RESUMED, refreshUiSummaries);

        // Start task: create session and switch to it
        const unsub2 = eventBus.onAsync(EVENTS.START_TASK, async (event) => {
            const { task: taskObj, taskId, engine } = event.detail;

            try {
                // Step 1: Task objectを取得
                let task = taskObj;
                if (!task && taskId) {
                    // taskIdのみの場合はTaskServiceから取得
                    const tasks = this.taskService.getFilteredTasks();
                    task = tasks.find(t => t.id === taskId);

                    if (!task) {
                        console.error('Task not found:', taskId);
                        showError('Task not found');
                        return;
                    }
                }

                if (!task) {
                    console.error('No task provided to START_TASK event');
                    showError('No task provided');
                    return;
                }

                // Step 2: エンジン未指定なら選択モーダルを開く
                if (!engine) {
                    if (this.modals?.focusEngineModal) {
                        this.modals.focusEngineModal.open(task);
                        return;
                    }
                    console.warn('FocusEngineModal not available, falling back to Claude engine.');
                }

                const resolvedEngine = engine || 'claude';

                // Step 3: セッション名を生成
                const sessionName = task.title || task.name || `Task: ${task.id}`;

                // Step 4: プロジェクト名を取得
                const project = task.project;
                if (!project) {
                    console.error('Task has no project:', task);
                    showError('Task has no project');
                    return;
                }

                // Step 5: セッション作成
                console.log('Creating session for task:', task.id, 'project:', project);

                // タスクコンテキストを構築（議事録から登録されたタスクの場合）
                const taskTitle = task.title || task.name || 'Untitled';
                const deadline = task.deadline || task.due;
                const taskLines = [
                    '以下のタスクを対応してください。',
                    `ID: ${task.id}`,
                    `プロジェクト: ${project}`,
                    `タイトル: ${taskTitle}`,
                    deadline ? `期限: ${deadline}` : '',
                    task.assignee ? `担当者: ${task.assignee}` : '',
                    task.description ? `説明: ${task.description}` : ''
                ].filter(Boolean);
                let initialCommand = taskLines.join('\n');
                if (task.context || task.meetingTitle) {
                    const contextParts = [];
                    if (task.context) {
                        contextParts.push(`## 背景\n${task.context}`);
                    }
                    if (task.meetingTitle || task.meetingDate) {
                        const meetingInfo = task.meetingTitle || '';
                        const dateInfo = task.meetingDate ? `(${task.meetingDate})` : '';
                        contextParts.push(`会議: ${meetingInfo} ${dateInfo}`.trim());
                    }
                    if (contextParts.length > 0) {
                        initialCommand += '\n\n' + contextParts.join('\n\n');
                    }
                }

                const newSession = await this.sessionService.createSession({
                    project: project,
                    name: sessionName,
                    initialCommand: initialCommand,  // タスクコンテキストを自動読み込み
                    engine: resolvedEngine,
                    useWorktree: true  // デフォルトでworktree使用
                });

                console.log('Session created for task:', task.id, '→', newSession.id);
                showSuccess(`Session "${sessionName}" created`);

                // Step 6: タスクステータスを「進行中」に更新
                try {
                    if (task.source === 'nocodb') {
                        // NocoDBタスクの場合
                        await this.nocodbTaskService.updateStatus(task.id, 'in_progress');
                    } else {
                        // ローカルタスクの場合
                        await this.taskService.updateTask(task.id, { status: 'in_progress' });
                    }
                    console.log('Task status updated to in_progress:', task.id);
                } catch (statusError) {
                    // ステータス更新失敗はログのみ（セッション作成は成功しているため）
                    console.warn('Failed to update task status:', statusError);
                }

                // Step 7: セッション切り替え
                eventBus.emit(EVENTS.SESSION_CHANGED, {
                    sessionId: newSession.id
                });

            } catch (error) {
                console.error('Failed to start task:', error);
                showError(`Failed to start task: ${error.message}`);
            }
        });

        // Edit task: open task edit modal
        const unsub3 = eventBus.on(EVENTS.EDIT_TASK, (event) => {
            const { task } = event.detail;
            console.log('Edit task requested:', task);
            this.modals.taskEditModal.open(task);
        });

        // Create session: open modal
        const unsub4 = eventBus.on(EVENTS.CREATE_SESSION, (event) => {
            const { project } = event.detail;
            console.log('Create session requested for project:', project);
            this.openCreateSessionModal(project);
        });

        // Worktree fallback: warn user when session falls back to main workspace
        const unsubWorktreeFallback = eventBus.on(EVENTS.SESSION_WORKTREE_FALLBACK, (event) => {
            const { project, reason } = event.detail || {};
            const projectLabel = project ? `「${project}」` : 'このプロジェクト';
            showInfo(`Worktree作成に失敗したため、${projectLabel}は本体フォルダで開始しました。`);
            console.warn('[Session] Worktree fallback:', reason || 'unknown');
        });

        // Rename session: open rename modal
        const unsub5 = eventBus.on(EVENTS.RENAME_SESSION, (event) => {
            const { session } = event.detail;
            console.log('Rename session requested:', session);
            this.modals.renameModal.open(session);
        });

        this.unsubscribers.push(
            unsub1,
            unsub1b,
            unsub1d,
            unsub1e,
            unsub1f,
            unsub1g,
            unsub2,
            unsub3,
            unsub4,
            unsubWorktreeFallback,
            unsub5
        );

        // Setup global UI button handlers
        await this.setupGlobalButtons();

        // Setup terminal toolbar buttons
        this.setupTerminalToolbar();

        // Setup test mode banner
        this.setupTestModeBanner();
    }

    /**
     * Setup test mode banner display
     */
    setupTestModeBanner() {
        // Subscribe to store changes
        const unsub = appStore.subscribe((change) => {
            if (change.key === 'testMode') {
                this.updateTestModeBanner(change.value);
            }
        });
        this.unsubscribers.push(unsub);

        // Check initial state
        const { testMode } = appStore.getState();
        if (testMode) {
            this.updateTestModeBanner(true);
        }
    }

    /**
     * Update test mode banner visibility
     * @param {boolean} testMode - Whether test mode is enabled
     */
    updateTestModeBanner(testMode) {
        let banner = document.getElementById('test-mode-banner');

        if (testMode) {
            // Create banner if it doesn't exist
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'test-mode-banner';
                banner.className = 'test-mode-banner';
                banner.innerHTML = `
                    <div class="test-mode-banner-content">
                        <i data-lucide="flask-conical"></i>
                        <span><strong>テストモード:</strong> このサーバーは読み取り専用です。セッション管理は無効化されています。</span>
                    </div>
                `;

                // Insert at the top of body (before app-container)
                const appContainer = document.querySelector('.app-container');
                if (appContainer) {
                    document.body.insertBefore(banner, appContainer);

                    // Re-render lucide icons
                    if (window.lucide && window.lucide.createIcons) {
                        window.lucide.createIcons();
                    }
                }
            }
        } else {
            // Remove banner if it exists
            if (banner) {
                banner.remove();
            }
        }
    }

    /**
     * Setup global UI button handlers
     */
    async setupGlobalButtons() {
        // Initialize settings module with conditional extension loading
        await this.initSettingsWithExtensions();

        const cleanupSessionViewToggle = setupSessionViewToggle({ store: appStore });
        this.unsubscribers.push(cleanupSessionViewToggle);
        const cleanupSidebarPrimaryToggle = setupSidebarPrimaryToggle({ store: appStore });
        this.unsubscribers.push(cleanupSidebarPrimaryToggle);

        // Auth button (sidebar)
        this.setupAuthControls();

        // Archive toggle button
        const toggleArchivedBtn = document.getElementById('toggle-archived-btn');
        if (toggleArchivedBtn) {
            toggleArchivedBtn.onclick = async () => {
                await this.modals.archiveModal.open();
            };
        }

        // Settings button
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.onclick = async () => {
                if (this.settingsCore && this.settingsCore.ui) {
                    await this.settingsCore.ui.openModal();
                }
            };
        }

        // Add task buttons (local / NocoDB)
        const addLocalTaskBtn = document.getElementById('add-local-task-btn');
        if (addLocalTaskBtn) {
            addLocalTaskBtn.onclick = () => {
                this.modals.taskAddModal?.open({ mode: 'local' });
            };
        }

        const addNocodbTaskBtn = document.getElementById('add-nocodb-task-btn');
        if (addNocodbTaskBtn) {
            addNocodbTaskBtn.onclick = () => {
                this.modals.taskAddModal?.open({ mode: 'nocodb' });
            };
        }

        // Focus button (footer)
        const focusBtn = document.getElementById('focus-btn');
        if (focusBtn) {
            focusBtn.onclick = () => {
                const focusTask = this.taskService.getFocusTask();
                if (!focusTask) {
                    showInfo('フォーカスタスクがありません');
                    return;
                }
                // Open focus engine modal to select which engine to use
                this.modals.focusEngineModal.open(focusTask);
            };
        }

        // Mobile bottom navigation
        this.setupMobileNavigation();
    }

    /**
     * Setup auth controls in sidebar
     */
    setupAuthControls() {
        const authBtn = document.getElementById('auth-btn');
        if (!authBtn) return;

        authBtn.onclick = async () => {
            if (!this.authManager) {
                showError('認証が利用できません');
                return;
            }
            const summary = this.authManager.getSummary();
            if (summary.status === 'authenticated') {
                authBtn.disabled = true;
                try {
                    await this.authManager.logout();
                    showSuccess('ログアウトしました');
                } catch (error) {
                    showError('ログアウトに失敗しました');
                } finally {
                    authBtn.disabled = false;
                    this.updateAuthButtonUI();
                }
                return;
            }

            showInfo('Slack認証に移動します');
            const redirectPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            this.authManager.startSlackLogin({ redirectPath });
        };

        eventBus.on('auth:changed', () => {
            this.updateAuthButtonUI();
        });

        this.updateAuthButtonUI();
    }

    /**
     * Update auth button UI
     */
    updateAuthButtonUI() {
        const authBtn = document.getElementById('auth-btn');
        if (!authBtn) return;

        const icon = authBtn.querySelector('i');
        const text = document.getElementById('auth-btn-text');
        const badge = document.getElementById('auth-status-badge');

        const summary = this.authManager?.getSummary?.() || appStore.getState().auth || {};
        const status = summary.status || 'anonymous';

        let label = 'ログイン';
        let iconName = 'log-in';
        let badgeText = '未ログイン';
        let badgeClass = 'neutral';

        if (status === 'authenticated') {
            label = 'ログアウト';
            iconName = 'log-out';
            badgeText = 'ログイン済み';
            badgeClass = 'success';
        } else if (status === 'checking') {
            label = '確認中';
            iconName = 'loader';
            badgeText = '確認中';
            badgeClass = 'neutral';
        } else if (status === 'expired') {
            label = '再ログイン';
            iconName = 'log-in';
            badgeText = '期限切れ';
            badgeClass = 'warning';
        } else if (status === 'unavailable') {
            label = 'ログイン';
            iconName = 'log-in';
            badgeText = '未設定';
            badgeClass = 'neutral';
        }

        authBtn.disabled = status === 'checking';
        if (text) text.textContent = label;
        if (icon) icon.setAttribute('data-lucide', iconName);
        if (badge) {
            badge.textContent = badgeText;
            badge.classList.remove('success', 'warning', 'neutral');
            badge.classList.add(badgeClass);
        }

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    /**
     * Initialize Settings with conditional Mana extension loading
     * Phase 3: Plugin Architecture - Dynamic extension loading
     */
    async initSettingsWithExtensions() {
        // 1. Core Settings初期化（OSS版）
        const registry = new SettingsPluginRegistry({ eventBus, store: appStore });
        const ui = new SettingsUI();
        const apiClient = new CoreApiClient();

        this.settingsCore = new SettingsCore({
            pluginRegistry: registry,
            ui,
            apiClient
        });
        await this.settingsCore.init();

        // 2. Mana拡張の条件付きロード（OSS版では拡張なし）
        if (this.pluginManager && !this.pluginManager.isActive('bb-mana')) {
            console.log('Mana Settings Extension disabled by plugin config');
            return;
        }

        try {
            const extensionPath = globalThis.__BRAINBASE_MANA_EXTENSION_PATH__ || '/extensions/mana-integration/index.js';
            const { ManaSettingsPlugin } = await import(/* @vite-ignore */ extensionPath);
            const manaPlugin = new ManaSettingsPlugin({
                pluginRegistry: registry,
                store: appStore,
                eventBus
            });
            manaPlugin.register();
            console.log('Mana Settings Extension loaded');
        } catch (error) {
            console.log('Mana Settings Extension not available (OSS mode)');
            // エラーは握りつぶす（OSS版では正常動作）
        }
    }

    /**
     * Initialize mobile input UI controller
     */
    initMobileInput() {
        this.mobileInputController = new MobileInputController({
            httpClient,
            isMobile: () => this.isMobile()
        });
        this.mobileInputController.init();
    }

    /**
     * Setup terminal toolbar button handlers
     */
    setupTerminalToolbar() {
        // Paste from clipboard button
        const pasteTerminalBtn = document.getElementById('paste-terminal-btn');
        if (pasteTerminalBtn) {
            pasteTerminalBtn.onclick = async () => {
                const currentSessionId = appStore.getState().currentSessionId;
                if (!currentSessionId) {
                    showInfo('セッションを選択してください');
                    return;
                }

                try {
                    // Try to read clipboard items (supports both text and images)
                    const clipboardItems = await navigator.clipboard.read();

                    for (const item of clipboardItems) {
                        // Check for image
                        const imageType = item.types.find(type => type.startsWith('image/'));
                        if (imageType) {
                            showInfo('画像を圧縮中...');

                            const blob = await item.getType(imageType);

                            // 圧縮前のサイズ
                            const originalSize = (blob.size / 1024 / 1024).toFixed(2);

                            // 画像を圧縮
                            const compressedBlob = await compressImage(blob);

                            // 圧縮後のサイズ
                            const compressedSize = (compressedBlob.size / 1024 / 1024).toFixed(2);

                            showInfo(`アップロード中... (${originalSize}MB → ${compressedSize}MB)`);

                            // Upload compressed image to server
                            const formData = new FormData();
                            formData.append('file', compressedBlob, 'clipboard-image.jpg');

                            const uploadRes = await fetch('/api/upload', {
                                method: 'POST',
                                body: formData
                            });

                            if (!uploadRes.ok) {
                                showError('画像のアップロードに失敗しました');
                                return;
                            }

                            const { path: imagePath } = await uploadRes.json();

                            // Send image path to terminal with Enter key
                            await fetch(`/api/sessions/${currentSessionId}/input`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ input: imagePath + '\n', type: 'text' })
                            });

                            showSuccess(`画像をペーストしました (圧縮率: ${((1 - compressedBlob.size / blob.size) * 100).toFixed(0)}%)`);
                            return;
                        }

                        // Check for text
                        if (item.types.includes('text/plain')) {
                            const textBlob = await item.getType('text/plain');
                            const text = await textBlob.text();

                            if (!text) {
                                showInfo('クリップボードが空です');
                                return;
                            }

                            // Show paste confirm modal for text
                            const modal = document.getElementById('paste-confirm-modal');
                            const preview = document.getElementById('paste-preview-text');
                            const confirmBtn = document.getElementById('paste-confirm-btn');
                            const cancelBtn = document.getElementById('paste-cancel-btn');

                            if (!modal || !preview || !confirmBtn || !cancelBtn) {
                                // Fallback: paste directly without modal
                                await this.pasteTextToTerminal(currentSessionId, text);
                                return;
                            }

                            // Show preview
                            const displayText = text.length > 500 ? text.substring(0, 500) + '\n...(省略)...' : text;
                            preview.textContent = displayText;
                            modal.classList.add('active');

                            // Wait for user action
                            const confirmed = await new Promise((resolve) => {
                                const confirm = () => {
                                    cleanup();
                                    resolve(true);
                                };
                                const cancel = () => {
                                    cleanup();
                                    resolve(false);
                                };
                                const cleanup = () => {
                                    confirmBtn.removeEventListener('click', confirm);
                                    cancelBtn.removeEventListener('click', cancel);
                                };

                                confirmBtn.addEventListener('click', confirm);
                                cancelBtn.addEventListener('click', cancel);
                            });

                            modal.classList.remove('active');

                            // Paste if confirmed
                            if (confirmed) {
                                await this.pasteTextToTerminal(currentSessionId, text);
                            }
                            return;
                        }
                    }

                    showInfo('クリップボードが空です');
                } catch (error) {
                    console.error('Failed to paste:', error);
                    if (error.name === 'NotAllowedError') {
                        showError('クリップボードへのアクセスが拒否されました。ブラウザの設定を確認してください。');
                    } else {
                        showError('ペーストに失敗しました');
                    }
                }
            };
        }

        // Upload image button
        const uploadImageBtn = document.getElementById('upload-image-btn');
        const imageFileInput = document.getElementById('image-file-input');
        if (uploadImageBtn && imageFileInput) {
            uploadImageBtn.onclick = () => {
                imageFileInput.click();
            };

            // Handle file selection
            imageFileInput.onchange = async (e) => {
                const files = e.target.files;
                if (files && files.length > 0) {
                    await this.handleFileUpload(files);
                }
                // Reset input so same file can be selected again
                imageFileInput.value = '';
            };
        }

        // Send Escape button
        const sendEscapeBtn = document.getElementById('send-escape-btn');
        if (sendEscapeBtn) {
            sendEscapeBtn.onclick = async () => {
                const currentSessionId = appStore.getState().currentSessionId;
                if (!currentSessionId) {
                    showInfo('セッションを選択してください');
                    return;
                }

                try {
                    await httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                        input: 'Escape',
                        type: 'key'
                    });
                } catch (error) {
                    console.error('Failed to send Escape:', error);
                    showError('Escapeキーの送信に失敗しました');
                }
            };
        }

        // Send Clear button (Ctrl+L)
        const sendClearBtn = document.getElementById('send-clear-btn');
        if (sendClearBtn) {
            sendClearBtn.onclick = async () => {
                const currentSessionId = appStore.getState().currentSessionId;
                if (!currentSessionId) {
                    showInfo('セッションを選択してください');
                    return;
                }

                try {
                    await httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                        input: 'C-l',
                        type: 'key'
                    });
                } catch (error) {
                    console.error('Failed to send Clear:', error);
                    showError('クリアコマンドの送信に失敗しました');
                }
            };
        }
    }

    /**
     * Paste text to terminal
     */
    async pasteTextToTerminal(sessionId, text) {
        try {
            await httpClient.post(`/api/sessions/${sessionId}/input`, {
                input: text,
                type: 'text'
            });
            showSuccess('貼り付けました');
        } catch (error) {
            console.error('Failed to paste text:', error);
            showError('テキストの貼り付けに失敗しました');
        }
    }

    /**
     * Handle file upload
     */
    async handleFileUpload(files) {
        const currentSessionId = appStore.getState().currentSessionId;
        if (!currentSessionId) {
            showInfo('セッションを選択してください');
            return;
        }

        const file = files[0];
        const formData = new FormData();
        formData.append('file', file);

        try {
            // Upload file
            const uploadRes = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!uploadRes.ok) throw new Error('Upload failed');

            const { path } = await uploadRes.json();

            // Paste path into terminal
            await httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                input: path,
                type: 'text'
            });

            showSuccess('ファイルをアップロードしました');
        } catch (error) {
            console.error('File upload failed:', error);
            showError('ファイルアップロードに失敗しました');
        }
    }

    /**
     * Setup mobile bottom navigation handlers
     */
    setupMobileNavigation() {
        const mobileSessionsBtn = document.getElementById('mobile-sessions-btn');
        const mobileTasksBtn = document.getElementById('mobile-tasks-btn');
        const mobileDashboardBtn = document.getElementById('mobile-dashboard-btn');
        const mobileSettingsBtn = document.getElementById('mobile-settings-btn');
        const sessionsSheetOverlay = document.getElementById('sessions-sheet-overlay');
        const tasksSheetOverlay = document.getElementById('tasks-sheet-overlay');
        const sessionsBottomSheet = document.getElementById('sessions-bottom-sheet');
        const tasksBottomSheet = document.getElementById('tasks-bottom-sheet');
        const closeSessionsSheetBtn = document.getElementById('close-sessions-sheet');
        const closeTasksSheetBtn = document.getElementById('close-tasks-sheet');
        const mobileAddSessionBtn = document.getElementById('mobile-add-session-btn');
        const mobileSessionList = document.getElementById('mobile-session-list');
        const mobileTasksContent = document.getElementById('mobile-tasks-content');
        const settingsUI = this.settingsCore?.ui;

        // Close Sessions bottom sheet
        const closeSessionsSheet = () => {
            sessionsSheetOverlay?.classList.remove('active');
            sessionsBottomSheet?.classList.remove('active');
        };

        const closeSettingsPanel = () => {
            if (settingsUI?.isOpen?.()) {
                settingsUI.closeModal();
            }
        };

        const renderMobileSessionList = () => {
            const sessionList = document.getElementById('session-list');
            const sessionListContent = sessionList?.innerHTML || '';

            if (mobileSessionList) {
                mobileSessionList.innerHTML = sessionListContent;

                // Re-attach all handlers using dedicated functions
                try {
                    // セッション行クリックハンドラ
                    attachSessionRowClickHandlers(mobileSessionList, (sessionId) => {
                        eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId });
                        closeSessionsSheet();
                    });

                    // プロジェクト追加ボタンハンドラ
                    attachAddProjectSessionHandlers(mobileSessionList, (project) => {
                        eventBus.emit(EVENTS.CREATE_SESSION, { project });
                        closeSessionsSheet();
                    });

                    // セクション・グループヘッダー展開ハンドラ
                    attachSectionHeaderHandlers(mobileSessionList);
                    attachGroupHeaderHandlers(mobileSessionList);

                    // セッションアクションハンドラ（リネーム、削除、アーカイブ等）
                    this.views.sessionView?.attachActionHandlersToContainer(mobileSessionList);
                } catch (error) {
                    console.error('Error attaching handlers:', error);
                }
            }
        };

        // Open Sessions bottom sheet
        const openSessionsSheet = () => {
            closeTasksSheet();
            closeSettingsPanel();
            renderMobileSessionList();
            sessionsSheetOverlay?.classList.add('active');
            sessionsBottomSheet?.classList.add('active');
            lucide.createIcons();
        };

        const refreshMobileSessionListIfOpen = () => {
            if (sessionsBottomSheet?.classList.contains('active')) {
                requestAnimationFrame(() => {
                    renderMobileSessionList();
                });
            }
        };

        const unsubscribeMobileSessionView = appStore.subscribeToSelector(
            state => state.ui?.sessionListView,
            () => refreshMobileSessionListIfOpen()
        );
        this.unsubscribers.push(unsubscribeMobileSessionView);

        const renderMobileTasksContent = ({ activeTab } = {}) => {
            const contextSidebar = document.getElementById('context-sidebar');
            if (!mobileTasksContent || !contextSidebar) return;

            mobileTasksContent.innerHTML = contextSidebar.innerHTML;

            if (activeTab) {
                const tabButtons = mobileTasksContent.querySelectorAll('.task-tab');
                tabButtons.forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.tab === activeTab);
                });

                const tabContents = mobileTasksContent.querySelectorAll('.task-tab-content');
                tabContents.forEach(content => {
                    content.classList.toggle('active', content.id === `${activeTab}-tasks-panel`);
                });
            }

            setupTaskTabs({
                root: mobileTasksContent,
                eventBus,
                events: EVENTS,
                onTabActivated: async (tab) => {
                    await this.views.nocodbTasksView?.onTabActivated?.();
                    if (tab === 'nocodb') {
                        renderMobileTasksContent({ activeTab: tab });
                    }
                }
            });

            lucide.createIcons();
        };

        // Open Tasks bottom sheet
        const openTasksSheet = () => {
            closeSessionsSheet();
            closeSettingsPanel();
            renderMobileTasksContent();
            tasksSheetOverlay?.classList.add('active');
            tasksBottomSheet?.classList.add('active');
            lucide.createIcons();
        };

        // Close Tasks bottom sheet
        const closeTasksSheet = () => {
            tasksSheetOverlay?.classList.remove('active');
            tasksBottomSheet?.classList.remove('active');
        };

        const openSettingsPanel = async () => {
            closeSessionsSheet();
            closeTasksSheet();
            if (settingsUI?.openModal) {
                await settingsUI.openModal();
            }
        };

        // Event listeners for mobile navigation
        mobileSessionsBtn?.addEventListener('click', () => {
            openSessionsSheet();
        });
        mobileTasksBtn?.addEventListener('click', openTasksSheet);
        mobileDashboardBtn?.addEventListener('click', () => {
            closeSessionsSheet();
            closeTasksSheet();
            closeSettingsPanel();

            const dashboardBtn = document.getElementById('nav-dashboard-btn');
            const isDashboardActive = dashboardBtn?.classList.contains('active');
            if (isDashboardActive) {
                this.showConsole?.();
                return;
            }

            if (typeof this.showDashboard === 'function') {
                this.showDashboard();
                return;
            }

            dashboardBtn?.click();
        });
        mobileSettingsBtn?.addEventListener('click', async () => {
            await openSettingsPanel();
        });
        mobileAddSessionBtn?.addEventListener('click', () => {
            closeSessionsSheet();
            eventBus.emit(EVENTS.CREATE_SESSION, { project: 'general' });
        });
        // Desktop New Session button
        const addSessionBtn = document.getElementById('add-session-btn');
        addSessionBtn?.addEventListener('click', () => {
            eventBus.emit(EVENTS.CREATE_SESSION, { project: 'general' });
        });
        closeSessionsSheetBtn?.addEventListener('click', closeSessionsSheet);
        closeTasksSheetBtn?.addEventListener('click', closeTasksSheet);
        sessionsSheetOverlay?.addEventListener('click', closeSessionsSheet);
        tasksSheetOverlay?.addEventListener('click', closeTasksSheet);

        // Mobile archive toggle button
        const mobileToggleArchivedBtn = document.getElementById('mobile-toggle-archived-btn');
        if (mobileToggleArchivedBtn) {
            mobileToggleArchivedBtn.addEventListener('click', async () => {
                await this.modals.archiveModal.open();
                closeSessionsSheet();
            });
        }

        // Close sheets on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (sessionsBottomSheet?.classList.contains('active')) closeSessionsSheet();
                if (tasksBottomSheet?.classList.contains('active')) closeTasksSheet();
            }
        });

        // Swipe down to close bottom sheets (only when at top of scroll)
        let sheetTouchStartY = 0;
        [sessionsBottomSheet, tasksBottomSheet].forEach(sheet => {
            sheet?.addEventListener('touchstart', (e) => {
                sheetTouchStartY = e.touches[0].clientY;
            }, { passive: true });

            sheet?.addEventListener('touchmove', (e) => {
                const touchY = e.touches[0].clientY;
                const diff = touchY - sheetTouchStartY;

                // スクロール可能な要素を取得（モバイルボトムシート用の正しいセレクタ）
                const scrollableContent = sheet.querySelector('.bottom-sheet-content');
                const isAtTop = !scrollableContent || scrollableContent.scrollTop === 0;

                // スクロール位置が一番上 かつ 下方向に100px以上スワイプした場合のみ閉じる
                if (isAtTop && diff > 100) {
                    if (sheet === sessionsBottomSheet) closeSessionsSheet();
                    if (sheet === tasksBottomSheet) closeTasksSheet();
                }
            }, { passive: true });
        });

        // Prevent pinch-to-zoom on mobile
        // Note: passive: false is required to call preventDefault()
        document.addEventListener('touchstart', (e) => {
            if (e.touches.length > 1) {
                e.preventDefault();
            }
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (e.touches.length > 1) {
                e.preventDefault();
            }
        }, { passive: false });
    }

    /**
     * Close mobile sessions bottom sheet (if open)
     */
    closeMobileSessionsSheet() {
        const sessionsSheetOverlay = document.getElementById('sessions-sheet-overlay');
        const sessionsBottomSheet = document.getElementById('sessions-bottom-sheet');
        sessionsSheetOverlay?.classList.remove('active');
        sessionsBottomSheet?.classList.remove('active');
    }

    async _resolveSessionRuntime(sessionId, session) {
        const currentRuntime = session?.runtimeStatus;
        if (currentRuntime) {
            return currentRuntime;
        }

        const state = await httpClient.get('/api/state');
        const refreshedSession = (state?.sessions || []).find(s => s.id === sessionId);
        return refreshedSession?.runtimeStatus || null;
    }

    /**
     * Switch to a session and update terminal frame
     */
    async switchSession(sessionId, options = {}) {
        const terminalFrame = document.getElementById('terminal-frame');
        if (!terminalFrame) {
            console.warn('Terminal frame not found');
            return;
        }
        this.terminalFrame = terminalFrame;

        try {
            // Get session info from store
            const { sessions } = appStore.getState();
            const session = sessions.find(s => s.id === sessionId);

            if (!session) {
                console.error('Session not found:', sessionId);
                terminalFrame.src = 'about:blank';
                return;
            }

            // アーカイブ済みセッションへの切り替えを防止
            if (session.intendedState === 'archived') {
                console.log(`[switchSession] Skipping archived session ${sessionId}`);
                terminalFrame.src = 'about:blank';
                return;
            }

            let proxyPath = typeof options.proxyPath === 'string' && options.proxyPath.trim()
                ? options.proxyPath
                : null;

            if (proxyPath) {
                console.log('Using provided proxyPath for session switch:', proxyPath);
            } else {
                const runtimeStatus = await this._resolveSessionRuntime(sessionId, session);
                if (runtimeStatus?.ttydRunning && runtimeStatus?.proxyPath) {
                    proxyPath = runtimeStatus.proxyPath;
                    console.log('Session already running, using existing proxyPath:', proxyPath);
                }
            }

            if (!proxyPath) {
                // Session not running, start it
                const res = await httpClient.post('/api/sessions/start', {
                    sessionId: session.id,
                    initialCommand: session.initialCommand || '',
                    cwd: session.worktree?.path || session.path,
                    engine: session.engine || 'claude'
                });

                if (res && res.proxyPath) {
                    proxyPath = res.proxyPath;
                    console.log('Started session, got proxyPath:', proxyPath);
                }
            }

            if (proxyPath) {
                terminalFrame.src = proxyPath;
                console.log('Terminal switched to:', proxyPath);

                // Update reconnect manager with current session
                this.reconnectManager?.setCurrentSession(sessionId);
                this._terminalLastNavigateAt = Date.now();
                this._setCurrentSessionUiState({
                    transport: 'reconnecting',
                    attention: 'none'
                });
                this.focusTerminal('switchSession');
            } else {
                console.error('No proxyPath available for session:', sessionId);
                terminalFrame.src = 'about:blank';
                this._setCurrentSessionUiState({
                    transport: 'disconnected',
                    attention: 'none'
                });
            }

            // Update active state in UI (handled by SessionView re-render, but keep for now)
            document.querySelectorAll('.session-child-row').forEach(row => {
                row.classList.remove('active');
                if (row.dataset.id === sessionId) {
                    row.classList.add('active');
                }
            });

            updateSessionIndicators(appStore.getState().currentSessionId);

        } catch (error) {
            console.error('Failed to switch session:', error);
            terminalFrame.src = 'about:blank';
            this._setCurrentSessionUiState({
                transport: 'disconnected',
                attention: 'none'
            });
        }
    }

    /**
     * Load session-specific data
     */
    async loadSessionData(sessionId) {
        try {
            // 並列実行: loadTasks と loadSchedule
            const startTime = performance.now();
            await Promise.all([
                this.taskService.loadTasks(),
                this.scheduleService.loadSchedule()
            ]);
            const duration = performance.now() - startTime;
            console.log(`[SessionSwitch] Data loaded in ${duration.toFixed(2)}ms`);

            console.log('Session data loaded for:', sessionId);
        } catch (error) {
            console.error('Failed to load session data:', error);
        }
    }

    /**
     * Initial data load
     */
    async loadInitialData() {
        try {
            // Load all sessions (404エラーは許容)
            try {
                await this.sessionService.loadSessions();
            } catch (error) {
                console.warn('Sessions not available, using empty state:', error.message);
            }

            // Get current session from store
            let { currentSessionId, sessions } = appStore.getState();

            // If no current session, select the first session automatically
            if (!currentSessionId && sessions && sessions.length > 0) {
                currentSessionId = sessions[0].id;
                console.log('Auto-selecting first session:', currentSessionId);
                await eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId: currentSessionId });
            }

            if (sessions && sessions.length > 0) {
                void this.refreshSessionUiSummaries(
                    sessions
                        .filter((session) => session.intendedState !== 'archived')
                        .map((session) => session.id)
                );
            }

            if (currentSessionId) {
                await this.loadSessionData(currentSessionId);
                this._updateSessionGoalBanner(currentSessionId);
            } else {
                // Load default data (404エラーは許容)
                try {
                    await this.taskService.loadTasks();
                } catch (error) {
                    console.warn('Tasks not available, using empty state:', error.message);
                }

                try {
                    await this.scheduleService.loadSchedule();
                } catch (error) {
                    console.warn('Schedule not available, using empty state:', error.message);
                }
            }

            console.log('Initial data loaded successfully');
        } catch (error) {
            console.error('Failed to load initial data:', error);
            // エラーダイアログは表示しない（空の状態で表示）
            console.warn('App started with empty data due to errors');
        }
    }

    /**
     * Show error message
     */
    showError(message) {
        // TODO: Better error UI
        alert(message);
    }

    /**
     * Start application
     */
    async start() {
        console.log('Starting brainbase-ui...');
        hydrateSessionRecentFiles();

        // 0. Initialize auth (load token before API calls)
        await this.initAuth();

        // 1. Initialize services
        this.initServices();

        // 2. Initialize views
        this.initViews();

        // 2.5. Update app version display
        await this.updateAppVersionDisplay();

        // 3. Initialize modals
        this.initModals();

        // 3.5. Initialize project select dropdown
        this.initProjectSelect();

        // 3.8. Initialize UI plugins (non-blocking to prevent session load delay)
        this.initPlugins();

        // 3.9. Initialize panel resize
        this.cleanupPanelResize = initPanelResize();

        // 4. Setup event listeners
        await this.setupEventListeners();

        // 4.5. Register active port for hook routing
        await this.registerActivePort();

        // 4.6. Update app version display (include runtime info)
        await this.updateAppVersionDisplay();

        // 5. Load initial data
        await this.loadInitialData();

        // 6. Initialize file upload (Drag & Drop, Clipboard)
        initFileUpload(() => appStore.getState().currentSessionId);

        // 6.5. Initialize terminal reconnect manager
        const terminalFrame = document.getElementById('terminal-frame');
        if (terminalFrame) {
            this.terminalFrame = terminalFrame;
            this.reconnectManager = new TerminalReconnectManager();
            this.reconnectManager.init(terminalFrame);
            this.setupTerminalInputUx();
        }

        // 7. Start session status polling (every 3 seconds)
        this.pollingIntervalId = startPolling(
            () => appStore.getState().currentSessionId,
            3000,
            async () => {
                await this.sessionService.loadSessions();
            }
        );

        // 8. Start periodic refresh (every 5 minutes)
        this.startPeriodicRefresh();
        this.startSessionUiSummaryRefresh();

        // 9. Setup choice detection (mobile only)
        this.setupResponsiveChoiceDetection();

        // 10. Setup file opener shortcuts
        setupFileOpenerShortcuts();

        // 11. Setup terminal contextmenu listener
        setupTerminalContextMenuListener();

        // 12. Setup mobile keyboard handling
        initMobileKeyboard();

        // 13. Setup mobile input UI (Dock/Composer)
        this.initMobileInput();

        console.log('brainbase-ui started successfully');
    }

    /**
     * Register active UI port for hook routing
     */
    async registerActivePort() {
        try {
            await fetch('/api/active-port', { cache: 'no-store' });
        } catch (error) {
            console.warn('Failed to register active port:', error);
        }
    }

    /**
     * Update app version display from server
     */
    async updateAppVersionDisplay() {
        const versionElements = [
            document.getElementById('app-version'),
            document.getElementById('mobile-app-version')
        ].filter(Boolean);

        if (versionElements.length === 0) return;

        try {
            const { version, runtime } = await httpClient.get('/api/version');
            if (!version) return;

            const gitSha = runtime?.git?.sha ? String(runtime.git.sha) : null;
            const branch = runtime?.git?.branch ? String(runtime.git.branch) : null;
            const cwd = runtime?.cwd ? String(runtime.cwd) : null;
            const pid = Number.isFinite(runtime?.pid) ? String(runtime.pid) : null;

            const display = gitSha ? `${version} (${gitSha})` : version;
            const details = [
                branch ? `branch: ${branch}` : null,
                cwd ? `cwd: ${cwd}` : null,
                pid ? `pid: ${pid}` : null
            ].filter(Boolean).join(' | ');

            versionElements.forEach((element) => {
                element.textContent = display;
                if (details) {
                    element.title = details;
                }
            });
        } catch (error) {
            console.warn('Failed to load app version:', error?.message || error);
        }
    }

    /**
     * Open create session modal
     * @param {string} project - Project name
     */
    openCreateSessionModal(project = 'general') {
        console.log('Opening create session modal for project:', project);

        const modal = document.getElementById('create-session-modal');
        const nameInput = document.getElementById('session-name-input');
        const commandInput = document.getElementById('session-command-input');
        const worktreeCheckbox = document.getElementById('use-worktree-checkbox');
        const projectSelect = document.getElementById('session-project-select');
        const worktreeLabel = worktreeCheckbox?.parentElement;

        if (!modal || !nameInput) {
            console.error('Create session modal elements not found');
            return;
        }

        // Helper function to update worktree checkbox state
        const updateWorktreeAvailability = async (selectedProject) => {
            if (!worktreeCheckbox) return;

            // general は常にworktree可能（workspace全体を使用）
            if (selectedProject === 'general') {
                worktreeCheckbox.disabled = false;
                worktreeCheckbox.checked = true;
                if (worktreeLabel) {
                    worktreeLabel.title = '';
                    worktreeLabel.style.opacity = '1';
                }
                return;
            }

            try {
                const { hasGitRepository } = await import('./modules/project-mapping.js');
                const hasGit = hasGitRepository(selectedProject);

                worktreeCheckbox.disabled = !hasGit;
                worktreeCheckbox.checked = hasGit;

                if (worktreeLabel) {
                    if (!hasGit) {
                        worktreeLabel.title = 'このプロジェクトにはGitリポジトリがないため、worktreeを作成できません';
                        worktreeLabel.style.opacity = '0.5';
                    } else {
                        worktreeLabel.title = '';
                        worktreeLabel.style.opacity = '1';
                    }
                }

                console.log(`[CreateSession] Project ${selectedProject} hasGitRepository: ${hasGit}`);
            } catch (err) {
                console.warn('[CreateSession] Failed to check git repository:', err);
                // エラー時はデフォルト動作（worktree有効）
                worktreeCheckbox.disabled = false;
                worktreeCheckbox.checked = true;
            }
        };

        // Set defaults
        nameInput.value = `New ${project} Session`;
        if (commandInput) commandInput.value = '';

        // Refresh project options (filters archived) and set selection
        if (projectSelect) {
            this.refreshProjectSelect(project);
        }

        // Update worktree checkbox based on initial project
        updateWorktreeAvailability(project);

        // Add change listener for project select
        const handleProjectChange = (e) => {
            updateWorktreeAvailability(e.target.value);
        };
        projectSelect?.addEventListener('change', handleProjectChange);

        // Show modal
        modal.classList.add('active');
        nameInput.focus();
        nameInput.select();

        // Setup one-time submit handler
        const createBtn = document.getElementById('create-session-btn');
        const handleCreate = async () => {
            const name = nameInput.value.trim();
            if (!name) {
                nameInput.focus();
                return;
            }

            const engine = document.querySelector('input[name="session-engine"]:checked')?.value || 'claude';
            const initialCommand = commandInput?.value || '';
            const useWorktree = worktreeCheckbox?.checked || false;
            const selectedProject = projectSelect?.value || project;

            // Close modal
            modal.classList.remove('active');
            this.closeMobileSessionsSheet();

            // Create session
            await this.createSession(selectedProject, name, initialCommand, useWorktree, engine);

            // Remove this event listener
            createBtn?.removeEventListener('click', handleCreate);
        };

        createBtn?.addEventListener('click', handleCreate);

        // Setup close handlers
        const closeHandlers = () => {
            modal.classList.remove('active');
            createBtn?.removeEventListener('click', handleCreate);
            projectSelect?.removeEventListener('change', handleProjectChange);
        };

        modal.querySelectorAll('.close-modal-btn').forEach(btn => {
            btn.addEventListener('click', closeHandlers, { once: true });
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeHandlers();
        }, { once: true });
    }

    /**
     * Create a new session
     */
    async createSession(project, name, initialCommand, useWorktree, engine) {
        console.log('Creating session:', { project, name, useWorktree, engine });

        // useWorktreeの場合、sessionIdを事前に生成してプログレスポーリングを開始
        let sessionId;
        if (useWorktree) {
            sessionId = createSessionId('session');
            this.showProgressModal();
            this._pollProgress(sessionId);
        }

        try {
            const result = await this.sessionService.createSession({
                project,
                name,
                initialCommand,
                useWorktree,
                engine,
                sessionId
            });

            console.log('Session created successfully:', result);

            if (useWorktree) {
                this.hideProgressModal();
            }

            // Switch to the newly created session
            if (result.sessionId) {
                appStore.setState({ currentSessionId: result.sessionId });
                eventBus.emit(EVENTS.SESSION_CHANGED, {
                    sessionId: result.sessionId,
                    proxyPath: result.proxyPath || null
                });

                if (useWorktree) {
                    this.showTerminalLoadingOverlay();
                    this._waitForClaudeInitialization(result.sessionId);
                }
            }

            this.closeMobileSessionsSheet();

            // If worktree session, handle proxy path for terminal
            if (result.proxyPath) {
                console.log('Worktree session created with proxy path:', result.proxyPath);
            }

        } catch (error) {
            console.error('Failed to create session:', error);
            if (useWorktree) {
                this.hideProgressModal();
            }
            this.showError('セッションの作成に失敗しました');
        }
    }

    /**
     * プログレスモーダル表示
     */
    showProgressModal() {
        const modal = document.getElementById('session-progress-modal');
        if (!modal) return;
        modal.classList.add('active');
    }

    /**
     * プログレスモーダル非表示
     */
    hideProgressModal() {
        const modal = document.getElementById('session-progress-modal');
        if (!modal) return;
        modal.classList.remove('active');
        this._stopProgressPolling();
    }

    /**
     * プログレスポーリング
     * @param {string} sessionId - セッションID
     */
    _pollProgress(sessionId) {
        this._progressSessionId = sessionId;
        this._progressPollingActive = true;
        this._currentPercent = 0;

        const poll = async () => {
            if (!this._progressPollingActive) return;

            try {
                const progress = await this.sessionService.getProgress(this._progressSessionId, this._currentPercent || 0);

                if (progress) {
                    this._currentPercent = progress.percent;
                    this._updateProgressUI(progress);

                    if (progress.percent >= 100 || progress.phase === 'error') {
                        this._stopProgressPolling();
                        return;
                    }
                }

                setTimeout(poll, 500);
            } catch (error) {
                console.error('[Progress Poll] Error:', error);
                setTimeout(poll, 1000);
            }
        };

        poll();
    }

    /**
     * プログレスポーリング停止
     */
    _stopProgressPolling() {
        this._progressPollingActive = false;
    }

    /**
     * プログレスUI更新
     * @param {Object} progress - プログレス情報
     */
    _updateProgressUI(progress) {
        const fill = document.getElementById('progress-fill');
        const message = document.getElementById('progress-message');
        const percent = document.getElementById('progress-percent');

        if (fill) fill.style.width = `${progress.percent}%`;
        if (message) message.textContent = progress.message;
        if (percent) percent.textContent = `${progress.percent}%`;
    }

    /**
     * ターミナルローディングオーバーレイ表示
     */
    showTerminalLoadingOverlay() {
        const overlay = document.getElementById('terminal-loading-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');
    }

    /**
     * ターミナルローディングオーバーレイ非表示
     */
    hideTerminalLoadingOverlay() {
        const overlay = document.getElementById('terminal-loading-overlay');
        if (!overlay) return;
        overlay.classList.add('hidden');
    }

    /**
     * Claude初期化待機
     * @param {string} sessionId - セッションID
     */
    async _waitForClaudeInitialization(sessionId) {
        const maxWaitTime = 30000;
        const pollInterval = 500;
        const startTime = Date.now();

        const checkInitialization = async () => {
            // 条件1: ターミナルiframeがロード済みならオーバーレイ解除
            const iframe = document.getElementById('terminal-frame');
            if (iframe && iframe.src && iframe.src !== 'about:blank') {
                try {
                    // iframeがロード済みか確認（srcが設定されていればttydが起動済み）
                    console.log(`[Claude Init] Terminal iframe loaded for ${sessionId}`);
                    this.hideTerminalLoadingOverlay();
                    return;
                } catch (e) {
                    // cross-origin error is expected, means iframe is loaded
                    console.log(`[Claude Init] Terminal iframe active for ${sessionId}`);
                    this.hideTerminalLoadingOverlay();
                    return;
                }
            }

            // 条件2: hookStatusにisWorking/isDoneがあればオーバーレイ解除
            try {
                const status = await this.httpClient.get('/api/sessions/status');
                const sessionStatus = status[sessionId];

                if (sessionStatus?.isWorking || sessionStatus?.isDone) {
                    console.log(`[Claude Init] Session ${sessionId} initialized (via status)`);
                    this.hideTerminalLoadingOverlay();
                    return;
                }
            } catch (error) {
                console.error('[Claude Init] Status check failed:', error);
            }

            // タイムアウト
            if (Date.now() - startTime > maxWaitTime) {
                console.warn(`[Claude Init] Timeout for session ${sessionId}, removing overlay`);
                this.hideTerminalLoadingOverlay();
                return;
            }

            setTimeout(checkInitialization, pollInterval);
        };

        // 少し待ってからチェック開始（switchSessionがiframe srcを設定する時間を確保）
        setTimeout(checkInitialization, 1000);
    }

    startSessionUiSummaryRefresh() {
        if (this.sessionUiSummaryIntervalId) {
            clearInterval(this.sessionUiSummaryIntervalId);
        }

        this.sessionUiSummaryIntervalId = setInterval(() => {
            const state = appStore.getState();
            if (state.ui?.sidebarPrimaryView !== 'sessions') return;
            const activeIds = (state.sessions || [])
                .filter((session) => session.intendedState !== 'archived')
                .map((session) => session.id);
            if (activeIds.length === 0) return;
            void this.refreshSessionUiSummaries(activeIds);
        }, 15_000);
    }

    /**
     * Start periodic refresh (every 5 minutes)
     */
    startPeriodicRefresh() {
        this.refreshIntervalId = setInterval(async () => {
            try {
                await this.scheduleService.loadSchedule();
                await this.taskService.loadTasks();
                if (this.views.inboxView && this.views.inboxView.loadInbox) {
                    await this.views.inboxView.loadInbox();
                }
                console.log('Periodic refresh completed');
            } catch (error) {
                console.error('Periodic refresh failed:', error);
            }
        }, 5 * 60 * 1000); // 5 minutes
    }

    /**
     * Check if device is mobile
     */
    isMobile() {
        return window.innerWidth <= 768;
    }

    /**
     * Start choice detection (mobile only)
     */
    startChoiceDetection() {
        this.stopChoiceDetection();

        this.choiceCheckInterval = setInterval(async () => {
            const currentSessionId = appStore.getState().currentSessionId;
            if (!currentSessionId) return;

            try {
                const res = await httpClient.get(`/api/sessions/${currentSessionId}/output`);
                const data = res;

                if (data.hasChoices && data.choices.length > 0) {
                    const choiceHash = JSON.stringify(data.choices);
                    if (choiceHash !== this.lastChoiceHash) {
                        this.lastChoiceHash = choiceHash;
                        this.showChoiceOverlay(data.choices);
                        this.stopChoiceDetection();
                    }
                }
            } catch (error) {
                console.error('Failed to check for choices:', error);
            }
        }, 2000); // Check every 2 seconds
    }

    /**
     * Stop choice detection
     */
    stopChoiceDetection() {
        if (this.choiceCheckInterval) {
            clearInterval(this.choiceCheckInterval);
            this.choiceCheckInterval = null;
        }
    }

    /**
     * Show choice overlay
     */
    showChoiceOverlay(choices) {
        const overlay = document.getElementById('choice-overlay');
        const container = document.getElementById('choice-buttons');
        const closeBtn = document.getElementById('close-choice-overlay');

        if (!overlay || !container) return;

        container.innerHTML = '';
        choices.forEach((choice) => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn';
            btn.textContent = choice.originalText || `${choice.number}) ${choice.text}`;
            btn.onclick = () => this.selectChoice(choice.number);
            container.appendChild(btn);
        });

        overlay.classList.add('active');
        lucide.createIcons();

        closeBtn.onclick = () => this.closeChoiceOverlay();
    }

    /**
     * Close choice overlay
     */
    closeChoiceOverlay() {
        const overlay = document.getElementById('choice-overlay');
        overlay?.classList.remove('active');
        this.lastChoiceHash = null;
        if (this.isMobile()) {
            this.startChoiceDetection();
        }
        this.focusTerminal('closeChoiceOverlay');
    }

    /**
     * Send choice selection
     */
    async selectChoice(number) {
        const currentSessionId = appStore.getState().currentSessionId;
        if (!currentSessionId) return;

        try {
            await httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                input: number,
                type: 'text'
            });

            await new Promise(resolve => setTimeout(resolve, 100));
            await httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                input: 'Enter',
                type: 'key'
            });

            this.closeChoiceOverlay();
        } catch (error) {
            console.error('Failed to send choice:', error);
            this.showError('選択の送信に失敗しました');
        }
    }

    /**
     * Setup responsive choice detection
     */
    setupResponsiveChoiceDetection() {
        // Start on mobile
        if (this.isMobile()) {
            this.startChoiceDetection();
        }

        // Handle resize
        window.addEventListener('resize', () => {
            if (this.isMobile() && !this.choiceCheckInterval) {
                this.startChoiceDetection();
            } else if (!this.isMobile() && this.choiceCheckInterval) {
                this.stopChoiceDetection();
                this.closeChoiceOverlay();
            }
        });
    }

    /**
     * Cleanup
     */
    destroy() {
        // Stop polling
        if (this.pollingIntervalId) {
            clearInterval(this.pollingIntervalId);
            this.pollingIntervalId = null;
        }

        // Stop refresh
        if (this.refreshIntervalId) {
            clearInterval(this.refreshIntervalId);
            this.refreshIntervalId = null;
        }

        if (this.sessionUiSummaryIntervalId) {
            clearInterval(this.sessionUiSummaryIntervalId);
            this.sessionUiSummaryIntervalId = null;
        }

        // Stop choice detection
        this.stopChoiceDetection();

        // Unsubscribe from events
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];

        // Unmount views
        Object.values(this.views).forEach(view => {
            if (view.unmount) view.unmount();
        });

        // Unmount modals
        Object.values(this.modals).forEach(modal => {
            if (modal.unmount) modal.unmount();
        });

        // Cleanup mobile input controller
        this.mobileInputController?.destroy();

        console.log('brainbase-ui destroyed');
    }
}

export const createApp = () => new App();

const shouldAutoStart = !(typeof window !== 'undefined' && window.__BRAINBASE_TEST__ === true);

if (shouldAutoStart) {
    // Initialize and start application
    const app = createApp();

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => app.start());
    } else {
        app.start();
    }

    // Expose for debugging
    window.brainbaseApp = app;

    // バックグラウンドから復帰時のボトムナビ表示復元
    // iOS Safariでページがキャッシュから復元された時にCSSが正しく適用されない問題の対策
    const ensureBottomNavVisibility = () => {
        // モバイルのみ処理
        if (window.innerWidth > 768) return;

        const bottomNav = document.getElementById('mobile-bottom-nav');
        if (!bottomNav) return;

        // キーボード表示中は非表示のまま（要件通り）
        const keyboardOpen = document.body.classList.contains('keyboard-open');
        if (keyboardOpen) {
            bottomNav.style.display = 'none';
        } else {
            // キーボード非表示の場合は必ず表示
            bottomNav.style.display = 'flex';
        }
    };

    // ページが visible になった時（バックグラウンドから復帰）
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            ensureBottomNavVisibility();
        }
    });

    // iOS Safari でページがキャッシュから復元された時
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            ensureBottomNavVisibility();
        }
    });

    // 初回ロード時も実行
    ensureBottomNavVisibility();
}
