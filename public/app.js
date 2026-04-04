/**
 * brainbase-ui Application Entry Point
 * 新アーキテクチャ: サービス層とビュー層の分離
 */

// Core
import { DIContainer } from './modules/core/di-container.js';
import { appStore } from './modules/core/store.js';
import { httpClient } from './modules/core/http-client.js';
import { eventBus, EVENTS } from './modules/core/event-bus.js';
import { getTerminalViewerId, getTerminalViewerLabel } from './modules/core/terminal-viewer.js';
import { TerminalTransportClient } from './modules/core/terminal-transport-client.js';
import { PluginManager } from './modules/core/plugin-manager.js';
import { SettingsExtensions } from './modules/settings/settings-extensions.js';
import { pollSessionStatus, startPolling } from './modules/session-indicators.js';
import { initFileUpload, compressImage } from './modules/file-upload.js';
import { showSuccess, showError, showInfo } from './modules/toast.js';
import { refreshIcons } from './modules/ui-helpers.js';
import { setupFileOpenerShortcuts } from './modules/file-opener.js';
import { setupTerminalContextMenuListener, setupXtermContextMenu } from './modules/iframe-contextmenu-handler.js';
import { applyTerminalDisplayMixin } from './modules/app/terminal-display-mixin.js';
import { applyTerminalMobileMixin } from './modules/app/terminal-mobile-mixin.js';
import { applyTerminalInputUxMixin } from './modules/app/terminal-input-ux-mixin.js';
import { applySessionManagementMixin } from './modules/app/session-management-mixin.js';
import { applySessionCreationMixin } from './modules/app/session-creation-mixin.js';
import { applyEventListenersMixin } from './modules/app/event-listeners-mixin.js';
import { applyPluginRegistrationMixin } from './modules/app/plugin-registration-mixin.js';
import { applyMobileNavigationMixin } from './modules/app/mobile-navigation-mixin.js';
import { applyUiSetupMixin } from './modules/app/ui-setup-mixin.js';
import { initMobileKeyboard } from './modules/mobile-keyboard.js';
import { TerminalReconnectManager } from './modules/terminal/terminal-reconnect-manager.js';
import { hydrateSessionRecentFiles } from './modules/session-ui-state.js';

// Services
import { TaskService } from './modules/domain/task/task-service.js';
import { SessionService } from './modules/domain/session/session-service.js';
import { ScheduleService } from './modules/domain/schedule/schedule-service.js';
import { InboxService } from './modules/domain/inbox/inbox-service.js';
import { NocoDBTaskService } from './modules/domain/nocodb-task/nocodb-task-service.js';
import { CommitTreeService } from './modules/domain/commit-tree/commit-tree-service.js';
import { FileViewerService } from './modules/domain/file-viewer/file-viewer-service.js';
import { CommitTreeView } from './modules/ui/views/commit-tree-view.js';
import { FileViewerView } from './modules/ui/views/file-viewer-view.js';
import { WikiService } from './modules/domain/wiki/wiki-service.js';
import { WikiView } from './modules/ui/views/wiki-view.js';
import { LiveFeedService } from './modules/domain/live-feed/live-feed-service.js';
import { LiveFeedView } from './modules/ui/views/live-feed-view.js';
import { ManaChatService } from './modules/domain/mana/mana-chat-service.js';
import { ManaChatView } from './modules/ui/views/mana-chat-view.js';

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
import { renderViewToggle, renderPanelToggles } from './modules/ui/view-toggle.js';
import { setupPanelLayout } from './modules/ui/panel-layout-manager.js';
import { initTimelineResize } from './modules/ui/timeline-resize.js';
import { initPanelResize } from './modules/ui/panel-resize.js';
import { ChoiceOverlayController } from './modules/ui/choice-overlay-controller.js';
import { MobileTabController } from './modules/ui/mobile-tab-controller.js';

// Modals

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
        this.sessionUiSummaryIntervalId = null;
        this.settingsCore = null; // Settings Plugin Architecture
        this.settingsExtensions = null;
        this.reconnectManager = null; // Terminal Reconnect Manager
        this.terminalTransportClient = null;
        this.terminalXtermHost = null;
        this._terminalTransportStatus = null;
        this.terminalFrame = null;
        this.terminalHeaderEl = null;
        this.terminalInputStatusEl = null;
        this.terminalTransportPillEl = null;
        this.terminalOwnerLabelEl = null;
        this.terminalSnapshotMetaEl = null;
        this.terminalSnapshotPanelEl = null;
        this.terminalSnapshotTitleEl = null;
        this.terminalSnapshotTimestampEl = null;
        this.terminalSnapshotContentEl = null;
        this.terminalReconnectBtn = null;
        this.terminalTakeoverBtn = null;
        this.terminalOpenFallbackBtn = null;
        this.terminalMoreBtn = null;
        this.terminalMoreActionsEl = null;
        this.terminalRecoveryPanelEl = null;
        this.terminalRecoveryBadgeEl = null;
        this.terminalRecoveryTitleEl = null;
        this.terminalRecoveryMessageEl = null;
        this.terminalRecoverBtn = null;
        this.mobileLiveTerminalModalEl = null;
        this.mobileLiveTerminalFrameEl = null;
        this._terminalInputUxCleanup = [];
        this._terminalLastNavigateAt = 0;
        this._terminalSnapshotCache = new Map();
        this._terminalSnapshotRequestKeys = new Map();
        this._terminalSnapshotRequests = new Map();
        this._snapshotPrefetchInFlight = new Set();
        this._snapshotPrefetchScheduled = false;
        this._mobileSnapshotPollTimer = null;
        this._mobileSnapshotPollDelay = null;
        this._mobileSnapshotInFlight = false;
        this._mobileTerminalMode = 'display';
        this._mobileLiveTerminalSessionId = null;
        this._mobileTapTracking = null;
        this._latestMobileViewportLayout = null;
        this._terminalFrameLayoutSyncRaf = null;
        // tmux copy-mode (pane_in_mode) blocks input. We can't reliably read it from the iframe,
        // so we track entry/exit based on TMUX_SCROLL / TERMINAL_INTERACT messages.
        this._terminalCopyModeSessions = new Set();
        this.pluginManager = null;
        this.authManager = null;
        this.mobileInputController = null;
        this.choiceOverlayController = null;
        this.terminalInteractionService = null;
        this._sessionSwitchToken = 0;
        this._terminalAutoFocusTimers = new Set();
        this.viewerId = getTerminalViewerId();
        this.viewerLabel = getTerminalViewerLabel();
        this.settingsExtensions = new SettingsExtensions({
            store: appStore,
            httpClient,
            compressImage,
            showSuccess,
            showError,
            showInfo
        });
    }

    _shouldUseXtermTransport() {
        return shouldUseXtermTransport();
    }

    _isXtermTransportActive(sessionId = appStore.getState().currentSessionId) {
        return Boolean(this._shouldUseXtermTransport() && this.terminalTransportClient?.isActiveForSession(sessionId));
    }

    _shouldAutoFocusTerminalSurface() {
        return !this.isMobile();
    }

    _clearScheduledTerminalAutoFocus() {
        this._terminalAutoFocusTimers.forEach(timerId => window.clearTimeout(timerId));
        this._terminalAutoFocusTimers.clear();
    }

    _scheduleTerminalAutoFocus(reason = 'unknown', delays = [75, 200]) {
        if (!this._shouldAutoFocusTerminalSurface()) return;
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) return;

        delays.forEach((delay) => {
            const timerId = window.setTimeout(() => {
                this._terminalAutoFocusTimers.delete(timerId);
                if (appStore.getState().currentSessionId !== sessionId) return;
                if (!this._shouldAutoFocusTerminalSurface() || !this._isConsoleVisible()) return;
                this.focusTerminal(reason);
            }, delay);
            this._terminalAutoFocusTimers.add(timerId);
        });
    }

    _triggerTerminalAutoFocus(reason = 'unknown', delays = [75, 200]) {
        this._clearScheduledTerminalAutoFocus();
        if (!this._shouldAutoFocusTerminalSurface()) return;
        if (!appStore.getState().currentSessionId) return;
        this.focusTerminal(reason);
        this._scheduleTerminalAutoFocus(reason, delays);
    }

    _isMobileTerminalDisplayMode() {
        return this.isMobile() && this._mobileTerminalMode !== 'interactive';
    }

    _showXtermTransport() {
        this._restoreSnapshotPanelPosition();
        this.terminalXtermHost?.classList.remove('hidden');
        this.terminalFrame?.classList.add('hidden');
        this.terminalSnapshotPanelEl?.classList.add('hidden');
        const consoleArea = document.getElementById('console-area');
        consoleArea?.classList.add('using-xterm');
        consoleArea?.classList.remove('using-snapshot');
    }

    _clearTerminalFrame(frameEl) {
        const frame = frameEl || this.terminalFrame;
        if (!frame) return;
        frame.classList.add('terminal-frame-clearing');
        frame.src = 'about:blank';
    }

    _showTerminalFrame(frameEl) {
        const frame = frameEl || this.terminalFrame;
        if (!frame) return;
        frame.classList.remove('terminal-frame-clearing');
    }

    _showTtydIframe() {
        this._restoreSnapshotPanelPosition();
        this.terminalXtermHost?.classList.add('hidden');
        this.terminalFrame?.classList.remove('hidden');
        this.terminalSnapshotPanelEl?.classList.add('hidden');
        const consoleArea = document.getElementById('console-area');
        consoleArea?.classList.remove('using-xterm');
        consoleArea?.classList.remove('using-snapshot');
    }

    _restoreSnapshotPanelPosition() {
        const panel = this.terminalSnapshotPanelEl || document.getElementById('terminal-snapshot-panel');
        if (panel && this._snapshotPanelOriginalParent && panel.parentElement === document.body) {
            this._snapshotPanelOriginalParent.appendChild(panel);
            this._snapshotPanelOriginalParent = null;
        }
    }

    _showMobileTerminalDisplay() {
        this.terminalXtermHost?.classList.add('hidden');
        this.terminalFrame?.classList.add('hidden');
        const consoleArea = document.getElementById('console-area');
        consoleArea?.classList.remove('using-xterm');
        consoleArea?.classList.add('using-snapshot');

        // iOS Safari: overflow:hidden ancestors clip fixed-position text rendering.
        // Move snapshot panel to body so it escapes the clipping context.
        const panel = this.terminalSnapshotPanelEl || document.getElementById('terminal-snapshot-panel');
        if (panel && panel.parentElement !== document.body) {
            this._snapshotPanelOriginalParent = panel.parentElement;
            document.body.appendChild(panel);
        }
        // Offset snapshot panel below mobile tab bar
        if (panel) {
            const tabBar = document.getElementById('mobile-tab-bar');
            const tabBarH = tabBar ? tabBar.offsetHeight : 0;
            if (tabBarH > 0) {
                document.body.style.setProperty('--mobile-tab-bar-height', `${tabBarH}px`);
            }
        }
        this.syncMobileTerminalReserve?.(
            window.visualViewport?.height || window.innerHeight,
            window.visualViewport?.offsetTop || 0
        );
    }

    _isConsoleVisible() {
        const consoleArea = document.getElementById('console-area');
        if (!consoleArea) return false;
        return window.getComputedStyle(consoleArea).display !== 'none';
    }

    _scheduleTerminalViewportSync() {
        scheduleAfterNextPaint(() => {
            if (!this._isConsoleVisible()) return;

            if (this._isXtermTransportActive()) {
                void this.terminalTransportClient?.syncViewportSize();
                return;
            }

            window.dispatchEvent(new Event('resize'));
        });
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

        if (this._isXtermTransportActive()) {
            this.terminalTransportClient?.focus();
            this._updateTerminalInputStatus();
            return;
        }

        const frame = this._mobileTerminalMode === 'interactive'
            ? this.mobileLiveTerminalFrameEl || document.getElementById('mobile-live-terminal-frame')
            : this.terminalFrame || document.getElementById('terminal-frame');
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

    _getSessionById(sessionId) {
        const { sessions } = appStore.getState();
        return (sessions || []).find(item => item.id === sessionId) || null;
    }

    _getMobileSnapshotPollInterval(sessionId) {
        const session = this._getSessionById(sessionId);
        return session?.hookStatus?.isWorking ? 1000 : 3000;
    }

    _setMobileSnapshotPoll(delay) {
        if (this._mobileSnapshotPollTimer && this._mobileSnapshotPollDelay === delay) {
            return;
        }
        this._stopMobileSnapshotPolling();
        this._mobileSnapshotPollDelay = delay;
        this._mobileSnapshotPollTimer = window.setTimeout(() => {
            this._mobileSnapshotPollTimer = null;
            void this._refreshMobileSnapshotDisplay();
        }, delay);
    }

    _stopMobileSnapshotPolling() {
        if (this._mobileSnapshotPollTimer) {
            window.clearTimeout(this._mobileSnapshotPollTimer);
            this._mobileSnapshotPollTimer = null;
        }
        this._mobileSnapshotPollDelay = null;
    }

    async _refreshMobileSnapshotDisplay({ force = false } = {}) {
        if (!this._isMobileTerminalDisplayMode()) return;
        // force=true（ユーザー操作起因）の場合はin-flightガードをバイパス
        if (this._mobileSnapshotInFlight && !force) return;
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) {
            this._stopMobileSnapshotPolling();
            return;
        }

        this._mobileSnapshotInFlight = true;
        try {
            const snapshot = await this._loadTerminalSnapshot(sessionId, { force });
            // snapshot取得後に直接DOMを更新（_updateTerminalInputStatus経由だと遅延する）
            if (snapshot && appStore.getState().currentSessionId === sessionId) {
                this._renderTerminalSnapshotPanel({
                    visible: true,
                    snapshot,
                    title: 'Terminal display'
                });
            }
        } catch (error) {
            console.warn('Failed to refresh mobile terminal snapshot:', error);
        } finally {
            this._mobileSnapshotInFlight = false;
            if (this._isMobileTerminalDisplayMode() && appStore.getState().currentSessionId === sessionId) {
                this._updateTerminalInputStatus();
                this._setMobileSnapshotPoll(this._getMobileSnapshotPollInterval(sessionId));
            }
        }
    }

    _syncMobileSnapshotPolling({ immediate = false, force = false } = {}) {
        if (!this._isMobileTerminalDisplayMode()) {
            this._stopMobileSnapshotPolling();
            return;
        }
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) {
            this._stopMobileSnapshotPolling();
            return;
        }
        if (immediate) {
            void this._refreshMobileSnapshotDisplay({ force });
            return;
        }
        this._setMobileSnapshotPoll(this._getMobileSnapshotPollInterval(sessionId));
    }

    _closeMobileLiveTerminalModalDom() {
        this.mobileLiveTerminalModalEl?.classList.remove('active');
        if (this.mobileLiveTerminalFrameEl) {
            this._clearTerminalFrame(this.mobileLiveTerminalFrameEl);
        }
    }

    closeMobileLiveTerminal() {
        if (this._mobileTerminalMode !== 'interactive') return;
        this._mobileTerminalMode = 'display';
        this._mobileLiveTerminalSessionId = null;
        this._closeMobileLiveTerminalModalDom();
        this._showMobileTerminalDisplay();
        this._syncMobileSnapshotPolling({ immediate: true, force: true });
        this._updateTerminalInputStatus();
    }

    postTerminalFrameMessage(message, frameEl = null) {
        if (!this.mobileLiveTerminalFrameEl) {
            this.mobileLiveTerminalFrameEl = document.getElementById('mobile-live-terminal-frame');
        }
        const targetFrame = frameEl || (this._mobileTerminalMode === 'interactive'
            ? this.mobileLiveTerminalFrameEl
            : this.terminalFrame);
        if (!targetFrame?.contentWindow) return;
        try {
            targetFrame.contentWindow.postMessage(message, window.location.origin);
        } catch (error) {
            // ignore
        }
    }

    scheduleTerminalFrameLayoutSync(layout) {
        this._latestMobileViewportLayout = layout || null;
        if (!this.mobileLiveTerminalFrameEl) {
            this.mobileLiveTerminalFrameEl = document.getElementById('mobile-live-terminal-frame');
        }
        if (!this.isMobile() || this._mobileTerminalMode !== 'interactive' || !this.mobileLiveTerminalFrameEl) {
            return;
        }
        if (this._terminalFrameLayoutSyncRaf) {
            window.cancelAnimationFrame(this._terminalFrameLayoutSyncRaf);
        }
        this._terminalFrameLayoutSyncRaf = window.requestAnimationFrame(() => {
            this._terminalFrameLayoutSyncRaf = null;
            if (!this._latestMobileViewportLayout || this._mobileTerminalMode !== 'interactive') return;
            this.postTerminalFrameMessage({
                type: 'bb-terminal-layout',
                source: 'brainbase-mobile-keyboard',
                ...this._latestMobileViewportLayout
            }, this.mobileLiveTerminalFrameEl);
        });
    }

    _handleMobileViewportChange(layout) {
        this._latestMobileViewportLayout = layout || null;
        this.scheduleTerminalFrameLayoutSync(layout);
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

    _collectVisibleSessionIds(container) {
        if (!container || !container.isConnected) return [];
        const containerRect = container.getBoundingClientRect();
        if (containerRect.width <= 0 || containerRect.height <= 0) return [];

        return Array.from(container.querySelectorAll('.session-child-row[data-id]'))
            .filter((row) => {
                const rect = row.getBoundingClientRect();
                return rect.height > 0
                    && rect.bottom >= containerRect.top
                    && rect.top <= containerRect.bottom;
            })
            .map((row) => row.dataset.id)
            .filter(Boolean);
    }

    _getSessionUiSummaryRefreshIds() {
        const ids = new Set();
        const state = appStore.getState();
        if (state.currentSessionId) {
            ids.add(state.currentSessionId);
        }

        for (const containerId of ['session-list', 'mobile-session-list']) {
            const container = document.getElementById(containerId);
            for (const sessionId of this._collectVisibleSessionIds(container)) {
                ids.add(sessionId);
            }
        }

        return Array.from(ids);
    }

    _runDeferredSessionSwitchWork(sessionId, switchToken) {
        if (switchToken !== this._sessionSwitchToken) return;
        if (appStore.getState().currentSessionId !== sessionId) return;

        void this.loadSessionData(sessionId);
        updateSessionIndicators(sessionId);
    }

    _getViewerProxyPath(proxyPath, port = null) {
        if (!proxyPath) return proxyPath;

        let nextProxyPath = appendViewerIdToProxyPath(proxyPath, this.viewerId);
        if (!nextProxyPath) return nextProxyPath;

        try {
            const absoluteUrl = new URL(nextProxyPath);
            if (this.viewerId && !absoluteUrl.searchParams.has('viewerId')) {
                absoluteUrl.searchParams.set('viewerId', this.viewerId);
            }
            return absoluteUrl.toString();
        } catch {
            // Relative path: fall through and optionally rewrite to loopback ttyd.
        }

        if (port && isLoopbackHost(window.location.hostname)) {
            return `http://127.0.0.1:${port}${nextProxyPath}`;
        }

        return nextProxyPath;
    }

    _buildTerminalFrameUrl(proxyPath, port = null) {
        return this._getViewerProxyPath(proxyPath, port);
    }

    _buildTerminalStartPayload(session) {
        const payload = {
            sessionId: session.id,
            initialCommand: session.initialCommand || '',
            cwd: session.path,
            engine: session.engine || 'claude',
            viewerId: this.viewerId,
            viewerLabel: this.viewerLabel
        };
        return payload;
    }

    async releaseTerminalOwnership(sessionId) {
        if (!sessionId) return;
        try {
            await httpClient.post(`/api/sessions/${encodeURIComponent(sessionId)}/release-terminal`, {
                viewerId: this.viewerId
            });
        } catch (error) {
            // best-effort only
        }
    }

    async _connectXtermTransport(session) {
        if (!this.terminalTransportClient || !session?.id) {
            return { ok: false };
        }

        this._showXtermTransport();
        this.terminalTransportClient.show();
        this.terminalFrame?.classList.add('hidden');

        try {
            const firstAttempt = await this.terminalTransportClient.connect(session.id);
            if (firstAttempt?.mode === 'blocked') {
                return { ok: false, blocked: true, terminalAccess: firstAttempt.terminalAccess || null };
            }
            this.hideTerminalLoadingOverlay();
            return { ok: true };
        } catch (error) {
            console.warn('Xterm transport unavailable:', error);
            this.terminalTransportClient.disconnect({ preserveView: false });
            this.terminalTransportClient.show();
            this._showXtermTransport();
            this._terminalTransportStatus = {
                mode: 'disconnected',
                copyMode: false,
                blockedAccess: null,
                connected: false,
                isFocused: false,
                lastSnapshotAt: null,
                transport: 'streaming'
            };
            this._updateTerminalInputStatus();
            return { ok: false, error };
        }
    }

    async _ensureDesktopTerminalRuntime(session) {
        if (!session?.id) return null;
        return await httpClient.post(`/api/sessions/${encodeURIComponent(session.id)}/terminal/ensure`, {
            initialCommand: session.initialCommand || '',
            cwd: session.path,
            engine: session.engine || 'claude',
            viewerId: this.viewerId
        });
    }

    async _preferXtermForCurrentSession() {
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) return false;
        if (!this._shouldUseXtermTransport() || !this.terminalTransportClient || !this.terminalXtermHost) {
            return false;
        }

        const { sessions } = appStore.getState();
        const session = (sessions || []).find(item => item.id === sessionId);
        if (!session || session.intendedState === 'archived') {
            return false;
        }

        if (this._isXtermTransportActive(sessionId)) {
            return false;
        }

        await this.switchSession(sessionId);
        return true;
    }

    async takeOverCurrentTerminal() {
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) return;

        const { sessions } = appStore.getState();
        const session = (sessions || []).find(item => item.id === sessionId);
        if (!session) return;

        const payload = {
            ...this._buildTerminalStartPayload(session),
            forceTakeover: true
        };

        try {
            const res = await httpClient.post('/api/sessions/start', payload);
            if (this._shouldUseXtermTransport() && this.terminalTransportClient) {
                const transportResult = await this._connectXtermTransport(session);
                if (transportResult.ok) {
                    this._updateTerminalInputStatus();
                    showInfo('ターミナルを引き継いだよ');
                    return;
                }
            }

            if (res?.proxyPath) {
                this.reconnectManager?.setCurrentSession(sessionId);
                if (this.reconnectManager) {
                    this.reconnectManager.terminalAccess = res.terminalAccess || {
                        state: 'owner',
                        ownerViewerLabel: this.viewerLabel,
                        ownerLastSeenAt: new Date().toISOString(),
                        canTakeover: false
                    };
                }
                this._terminalLastNavigateAt = Date.now();
                if (this._mobileTerminalMode === 'interactive' && this.mobileLiveTerminalFrameEl) {
                    this.mobileLiveTerminalFrameEl.src = this._getViewerProxyPath(res.proxyPath);
                    this.scheduleTerminalFrameLayoutSync(this._latestMobileViewportLayout);
                } else if (!this.isMobile() && this.terminalFrame) {
                    this.terminalFrame.src = this._getViewerProxyPath(res.proxyPath);
                } else {
                    this._syncMobileSnapshotPolling({ immediate: true, force: true });
                }
                this._updateTerminalInputStatus();
                showInfo('ターミナルを引き継いだよ');
            }
        } catch (error) {
            console.error('Failed to take over terminal:', error);
            showError('ターミナルの引き継ぎに失敗した');
        }
    }
    _setTerminalInputStatus({ hidden, stateClass, text, title }) {
        const el = this.terminalInputStatusEl;
        if (!el) return;

        // 前回と同じならDOM操作スキップ
        const key = hidden ? 'hidden' : `${stateClass}|${text}|${title}`;
        if (this._lastTerminalStatusKey === key) return;
        this._lastTerminalStatusKey = key;

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

    _setTerminalHeaderChip(el, { hidden = false, text = '', title = '' } = {}) {
        if (!el) return;
        const key = hidden || !text ? 'hidden' : `${text}|${title}`;
        const cacheKey = el.id || el.className;
        if (!this._terminalChipCache) this._terminalChipCache = new Map();
        if (this._terminalChipCache.get(cacheKey) === key) return;
        this._terminalChipCache.set(cacheKey, key);

        if (hidden || !text) {
            el.classList.add('hidden');
            el.textContent = '';
            el.title = '';
            return;
        }

        el.classList.remove('hidden');
        el.textContent = text;
        el.title = title || '';
    }

    _setTerminalHeaderAction(button, visible) {
        if (!button) return;
        button.classList.toggle('hidden', !visible);
    }

    _resetTerminalChrome() {
        this._setTerminalHeaderChip(this.terminalTransportPillEl, { hidden: true });
        this._setTerminalHeaderChip(this.terminalOwnerLabelEl, { hidden: true });
        this._setTerminalHeaderChip(this.terminalSnapshotMetaEl, { hidden: true });
        this._setTerminalHeaderAction(this.terminalReconnectBtn, false);
        this._setTerminalHeaderAction(this.terminalTakeoverBtn, false);
        this._setTerminalHeaderAction(this.terminalOpenFallbackBtn, false);
        this._renderTerminalSnapshotPanel({ visible: false });
    }

    async _loadTerminalSnapshot(sessionId, { force = false } = {}) {
        if (!sessionId) return null;
        const cached = this._terminalSnapshotCache.get(sessionId);
        if (cached && !force) {
            return cached;
        }

        const requestKey = `${sessionId}:${force ? 'force' : 'cached'}`;
        this._terminalSnapshotRequestKey = requestKey;
        const res = await httpClient.get(
            `/api/sessions/${encodeURIComponent(sessionId)}/terminal/snapshot?viewerId=${encodeURIComponent(this.viewerId)}&viewerLabel=${encodeURIComponent(this.viewerLabel)}`
        );

        if (this._terminalSnapshotRequestKey !== requestKey) {
            return this._terminalSnapshotCache.get(sessionId) || null;
        }

        const snapshot = {
            text: typeof res?.text === 'string' ? res.text : '',
            colorText: typeof res?.colorText === 'string' ? res.colorText : null,
            capturedAt: res?.capturedAt || null
        };
        this._terminalSnapshotCache.set(sessionId, snapshot);
        return snapshot;
    }

    _renderTerminalSnapshotPanel({ visible = false, snapshot = null, title = 'Snapshot fallback' } = {}) {
        this._cacheTerminalUiElements();
        if (!this.terminalSnapshotPanelEl || !this.terminalSnapshotContentEl) return;

        // 前回と同じ内容ならDOM操作スキップ
        const snapshotKey = visible
            ? `v|${title}|${snapshot?.capturedAt || ''}|${snapshot?.colorText?.length || snapshot?.text?.length || 0}`
            : 'hidden';
        if (this._lastSnapshotPanelKey === snapshotKey) return;
        this._lastSnapshotPanelKey = snapshotKey;

        if (!visible) {
            this.terminalSnapshotPanelEl.classList.add('hidden');
            this.terminalSnapshotContentEl.textContent = '';
            if (this.terminalSnapshotTimestampEl) {
                this.terminalSnapshotTimestampEl.textContent = '';
            }
            return;
        }

        this.terminalSnapshotPanelEl.classList.remove('hidden');
        if (this.terminalSnapshotTitleEl) {
            this.terminalSnapshotTitleEl.textContent = title;
        }
        const snapshotText = this._normalizeTerminalSnapshotText(snapshot?.text);
        if (snapshot?.colorText) {
            this.terminalSnapshotContentEl.innerHTML = ansiToHtml(snapshot.colorText);
        } else {
            this.terminalSnapshotContentEl.textContent = snapshotText || 'Snapshotを読み込み中...';
        }
        if (this.terminalSnapshotTimestampEl) {
            this.terminalSnapshotTimestampEl.textContent = formatTerminalTimestamp(snapshot?.capturedAt);
        }
        this.terminalSnapshotContentEl.scrollTop = this.terminalSnapshotContentEl.scrollHeight;
        this._bindSnapshotLinks();
    }

    _bindSnapshotLinks() {
        if (!this.terminalSnapshotContentEl) return;

        this.terminalSnapshotContentEl.querySelectorAll('.snapshot-url-link').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(el.href, '_blank', 'noopener');
            });
        });

        this.terminalSnapshotContentEl.querySelectorAll('.snapshot-file-link').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const filePath = el.dataset.path;
                if (!filePath) return;
                const line = el.dataset.line ? parseInt(el.dataset.line, 10) : undefined;
                window.postMessage({
                    type: 'OPEN_FILE',
                    filePath,
                    line,
                    sessionId: appStore.getState().currentSessionId
                }, window.location.origin);
            });
        });
    }

    _normalizeTerminalSnapshotText(text) {
        if (typeof text !== 'string') return '';
        return text
            .replace(/\r\n/g, '\n')
            .replace(/^(?:\s*\n)+/, '')
            .replace(/(?:\n[ \t]*){3,}/g, '\n\n')
            .trimEnd();
    }

    _syncTerminalSnapshotPanel({ sessionId, visible, title }) {
        if (!visible || !sessionId) {
            this._renderTerminalSnapshotPanel({ visible: false });
            return;
        }

        const cached = this._terminalSnapshotCache.get(sessionId) || null;
        this._renderTerminalSnapshotPanel({
            visible: true,
            snapshot: cached,
            title
        });

        if (cached) return;

        void this._loadTerminalSnapshot(sessionId)
            .then((snapshot) => {
                if (appStore.getState().currentSessionId !== sessionId) return;
                this._renderTerminalSnapshotPanel({
                    visible: true,
                    snapshot,
                    title
                });
                this._updateTerminalInputStatus();
            })
            .catch(() => {
                if (appStore.getState().currentSessionId !== sessionId) return;
                this._renderTerminalSnapshotPanel({
                    visible: true,
                    snapshot: {
                        text: 'Snapshotの取得に失敗した',
                        capturedAt: null
                    },
                    title
                });
            });
    }

    async openTerminalIframeFallback() {
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) return;
        this._terminalSnapshotCache.delete(sessionId);
        await this.switchSession(sessionId, { forceTtyd: true });
    }

    _scheduleTerminalInputStatusUpdate() {
        if (this._terminalStatusRafId) return;
        this._terminalStatusRafId = requestAnimationFrame(() => {
            this._terminalStatusRafId = null;
            this._updateTerminalInputStatus();
        });
    }

    _updateTerminalInputStatus() {
        this._cacheTerminalUiElements();
        if (!this.terminalInputStatusEl) return;

        if (!this._isConsoleVisible()) {
            this._setTerminalInputStatus({ hidden: true });
            this._resetTerminalChrome();
            return;
        }

        const sessionId = appStore.getState().currentSessionId;
        const frame = this._mobileTerminalMode === 'interactive'
            ? this.mobileLiveTerminalFrameEl || document.getElementById('mobile-live-terminal-frame')
            : this.terminalFrame || document.getElementById('terminal-frame');
        const xtermStatus = this._terminalTransportStatus || null;
        const xtermActive = this._isXtermTransportActive(sessionId);
        const usingMobileDisplay = this._isMobileTerminalDisplayMode();
        const session = this._getSessionById(sessionId);

        if (!sessionId || (!frame && !xtermActive)) {
            this._setTerminalInputStatus({ hidden: true });
            this._resetTerminalChrome();
            return;
        }

        const overlayState = this._getTerminalOverlayState();
        const isFocused = xtermActive
            ? Boolean(xtermStatus?.isFocused)
            : document.activeElement === frame;
        const frameSrcAttr = frame?.getAttribute('src');
        const frameBlank = xtermActive
            ? false
            : (!frameSrcAttr || frameSrcAttr === 'about:blank');
        const wsConnected = Boolean(this.reconnectManager?.wsConnected);
        const isReconnecting = Boolean(this.reconnectManager?.isReconnecting);
        const terminalAccess = xtermActive
            ? (xtermStatus?.blockedAccess || null)
            : (this.reconnectManager?.terminalAccess || null);
        const isCopyMode = xtermActive
            ? Boolean(xtermStatus?.copyMode)
            : this._terminalCopyModeSessions.has(sessionId);
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
        let presentationMode = 'blocked';
        let snapshotVisible = false;
        let snapshotTitle = 'Snapshot fallback';
        let ownerLabel = '';

        if (usingMobileDisplay) {
            presentationMode = 'snapshot';
            snapshotVisible = true;
            snapshotTitle = 'Terminal display';
            transportState = terminalAccess?.state === 'blocked' ? 'blocked' : 'connected';
            if (overlayState.any) {
                stateClass = 'blocked';
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
            } else if (terminalAccess?.state === 'blocked') {
                stateClass = 'blocked';
                transportState = 'blocked';
                text = buildTerminalBlockedText(terminalAccess);
                title = terminalAccess?.ownerViewerLabel
                    ? `${terminalAccess.ownerViewerLabel} がこのセッションを表示中。クリックで引き継ぎ`
                    : '別の viewer がこのセッションを表示中。クリックで引き継ぎ';
                ownerLabel = terminalAccess?.ownerViewerLabel || '';
            } else if (session?.hookStatus?.isWorking) {
                stateClass = 'ready';
                text = '入力: 表示更新中';
                title = `session=${sessionId} snapshot display`;
            } else {
                stateClass = 'ready';
                text = '入力: 表示';
                title = `session=${sessionId} snapshot display`;
            }
        } else if (overlayState.any) {
            stateClass = 'blocked';
            transportState = 'blocked';
            presentationMode = 'blocked';
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
        } else if (terminalAccess?.state === 'blocked') {
            stateClass = 'blocked';
            presentationMode = 'blocked';
            text = buildTerminalBlockedText(terminalAccess);
            title = terminalAccess?.ownerViewerLabel
                ? `${terminalAccess.ownerViewerLabel} がこのセッションを表示中。クリックで引き継ぎ`
                : '別の viewer がこのセッションを表示中。クリックで引き継ぎ';
            ownerLabel = terminalAccess?.ownerViewerLabel || '';
        } else if (xtermActive && xtermStatus?.mode === 'snapshot') {
            // snapshotモードでもxtermに内容が描画済みなのでlive風に見せる
            // クリックで再接続をトリガーできるようにする
            stateClass = 'needs-focus';
            transportState = 'connected';
            attentionState = 'needs-focus';
            presentationMode = 'live';
            text = '入力: クリックで再接続';
            title = `session=${sessionId} (click to reconnect)`;
        } else if (xtermActive && xtermStatus?.mode === 'reconnecting') {
            stateClass = 'reconnecting';
            transportState = 'reconnecting';
            presentationMode = 'reconnecting';
            text = '入力: 再接続中...';
            title = `session=${sessionId} xterm reconnecting`;
        } else if (xtermActive && xtermStatus?.mode === 'live') {
            presentationMode = 'live';
            if (!isFocused && !isMobile) {
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
                text = '入力: Live';
                title = `session=${sessionId} xterm live`;
            }
        } else if (isReconnecting) {
            stateClass = 'reconnecting';
            transportState = 'reconnecting';
            presentationMode = 'reconnecting';
            text = `入力: 再接続中 (${retryCount}/${maxRetries})`;
            title = `session=${sessionId} reconnecting`;
        } else if (frameBlank) {
            if (recentlyNavigated) {
                stateClass = 'reconnecting';
                transportState = 'reconnecting';
                presentationMode = 'reconnecting';
                text = '入力: 接続中...';
                title = `session=${sessionId} connecting`;
            } else {
                stateClass = 'disconnected';
                transportState = 'disconnected';
                presentationMode = 'snapshot';
                text = '入力: 未接続';
                title = `session=${sessionId} iframe=about:blank`;
                snapshotVisible = true;
            }
        } else if (!wsConnected) {
            if (recentlyNavigated) {
                stateClass = 'reconnecting';
                transportState = 'reconnecting';
                presentationMode = 'reconnecting';
                text = '入力: 接続中...';
                title = `session=${sessionId} connecting`;
            } else {
                stateClass = 'disconnected';
                transportState = 'disconnected';
                presentationMode = 'snapshot';
                text = '入力: 切断';
                title = `session=${sessionId} disconnected${typeof lastCode === 'number' ? ` (code ${lastCode})` : ''}`;
                snapshotVisible = true;
            }
        } else if (!isFocused && !isMobile) {
            // デスクトップのみ: フォーカスが外れていたらクリックを促す
            // モバイルではMobile Input Dockから入力するためフォーカス不要
            stateClass = 'needs-focus';
            transportState = 'connected';
            attentionState = 'needs-focus';
            presentationMode = 'live';
            text = '入力: クリックでフォーカス';
            title = `session=${sessionId} (click to focus)`;
        } else if (isCopyMode) {
            stateClass = 'copy-mode';
            transportState = 'connected';
            attentionState = 'copy-mode';
            presentationMode = 'live';
            text = '入力: スクロール中 (クリックで戻る)';
            title = `session=${sessionId} copy-mode (click to exit)`;
        } else {
            stateClass = 'ready';
            transportState = 'connected';
            presentationMode = 'live';
            text = '入力: OK';
            title = `session=${sessionId} connected`;
        }

        this._setTerminalInputStatus({ hidden: false, stateClass, text, title });
        const transportPillText = presentationMode === 'snapshot'
            ? 'Snapshot'
            : (xtermActive ? 'xterm' : (usingMobileDisplay ? 'display' : 'ttyd'));
        const transportPillTitle = presentationMode === 'snapshot'
            ? 'snapshot terminal display'
            : (xtermActive ? 'xterm transport' : (usingMobileDisplay ? 'snapshot terminal display' : 'ttyd iframe fallback'));
        this._setTerminalHeaderChip(this.terminalTransportPillEl, {
            hidden: false,
            text: transportPillText,
            title: transportPillTitle
        });
        this._setTerminalHeaderChip(this.terminalOwnerLabelEl, {
            hidden: !ownerLabel,
            text: ownerLabel,
            title: ownerLabel ? `現在のowner: ${ownerLabel}` : ''
        });

        const snapshotSource = this._terminalSnapshotCache.get(sessionId) || null;
        this._setTerminalHeaderChip(this.terminalSnapshotMetaEl, {
            hidden: presentationMode !== 'snapshot',
            text: snapshotSource?.capturedAt ? `Snapshot ${formatTerminalTimestamp(snapshotSource.capturedAt)}` : 'Snapshot fallback',
            title: snapshotSource?.capturedAt ? `Snapshot captured at ${snapshotSource.capturedAt}` : 'Snapshot fallback'
        });

        this._setTerminalHeaderAction(this.terminalReconnectBtn, presentationMode === 'snapshot' || presentationMode === 'reconnecting');
        this._setTerminalHeaderAction(this.terminalTakeoverBtn, terminalAccess?.state === 'blocked');
        this._setTerminalHeaderAction(
            this.terminalOpenFallbackBtn,
            xtermActive && shouldUseXtermTransport()
        );

        this._syncTerminalSnapshotPanel({
            sessionId,
            visible: snapshotVisible,
            title: snapshotTitle
        });

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

    _cacheTerminalUiElements() {
        this.terminalHeaderEl = document.getElementById('terminal-header');
        this.terminalInputStatusEl = document.getElementById('terminal-input-status');
        this.terminalTransportPillEl = document.getElementById('terminal-transport-pill');
        this.terminalOwnerLabelEl = document.getElementById('terminal-owner-label');
        this.terminalSnapshotMetaEl = document.getElementById('terminal-snapshot-meta');
        this.terminalSnapshotPanelEl = document.getElementById('terminal-snapshot-panel');
        this.terminalSnapshotTitleEl = document.getElementById('terminal-snapshot-title');
        this.terminalSnapshotTimestampEl = document.getElementById('terminal-snapshot-timestamp');
        this.terminalSnapshotContentEl = document.getElementById('terminal-snapshot-content');
        this.terminalReconnectBtn = document.getElementById('terminal-reconnect-btn');
        this.terminalTakeoverBtn = document.getElementById('terminal-takeover-btn');
        this.terminalOpenFallbackBtn = document.getElementById('terminal-open-fallback-btn');
        this.terminalMoreBtn = document.getElementById('terminal-more-btn');
        this.terminalMoreActionsEl = document.getElementById('terminal-more-actions');
        this.mobileLiveTerminalModalEl = document.getElementById('mobile-live-terminal-modal');
        this.mobileLiveTerminalFrameEl = document.getElementById('mobile-live-terminal-frame');
    }

    setupTerminalInputUx() {
        if (!this.terminalFrame) return;

        this._cacheTerminalUiElements();
        const consoleArea = document.getElementById('console-area');
        const closeMobileLiveTerminalBtn = document.getElementById('close-mobile-live-terminal-btn');

        // Keep status in sync with session selection, focus changes, overlay visibility, and WS events.
        const unsub = appStore.subscribeToSelector(
            state => state.currentSessionId,
            () => {
                // Mark navigation time to show "connecting..." briefly.
                this._terminalLastNavigateAt = Date.now();
                this._scheduleTerminalInputStatusUpdate();
            }
        );
        this._terminalInputUxCleanup.push(unsub);

        const onFocusChange = () => this._scheduleTerminalInputStatusUpdate();
        document.addEventListener('focusin', onFocusChange, true);
        window.addEventListener('blur', onFocusChange);
        this._terminalInputUxCleanup.push(() => document.removeEventListener('focusin', onFocusChange, true));
        this._terminalInputUxCleanup.push(() => window.removeEventListener('blur', onFocusChange));

        // Observe overlay class changes (menu/drop/choice) to update status.
        const overlays = ['menu-overlay', 'drop-overlay', 'choice-overlay']
            .map(id => document.getElementById(id))
            .filter(Boolean);
        const observer = new MutationObserver(() => this._scheduleTerminalInputStatusUpdate());
        overlays.forEach(el => observer.observe(el, { attributes: true, attributeFilter: ['class'] }));
        this._terminalInputUxCleanup.push(() => observer.disconnect());

        // Reconnect manager status callback.
        if (this.reconnectManager) {
            this.reconnectManager.onStatusChange = () => this._scheduleTerminalInputStatusUpdate();
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
            this._scheduleTerminalInputStatusUpdate();
        };
        window.addEventListener('message', onTerminalMessage);
        this._terminalInputUxCleanup.push(() => window.removeEventListener('message', onTerminalMessage));

        const onMobileInputSent = () => {
            if (!this._isMobileTerminalDisplayMode()) return;
            this._syncMobileSnapshotPolling({ immediate: true, force: true });
        };
        const unsubMobileInputSent = eventBus.on(EVENTS.MOBILE_INPUT_SENT, onMobileInputSent);
        this._terminalInputUxCleanup.push(unsubMobileInputSent);

        // Handle OPEN_FILE from terminal link clicks
        const onOpenFileMessage = (event) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type !== 'OPEN_FILE') return;

            const {
                filePath,
                previewPath,
                previewable,
                line,
                sessionId: msgSessionId
            } = event.data;
            if (!filePath) return;
            console.log('[OPEN_FILE] received', {
                filePath,
                previewPath,
                previewable,
                line,
                sessionId: msgSessionId || null
            });

            const currentSessionId = msgSessionId || appStore.getState().currentSessionId;
            const session = appStore.getState().sessions.find(s => s.id === currentSessionId);
            const workspaceRoot = session?.worktree?.path || session?.path || null;
            const previewRelativePath = previewPath
                || resolvePreviewRelativePath(filePath, workspaceRoot, currentSessionId)
                || null;
            const shouldOpenInBrowser = Boolean(previewRelativePath)
                || Boolean(previewable)
                || isBrowserPreviewablePath(filePath);
            console.log('[OPEN_FILE] resolved', {
                currentSessionId,
                workspaceRoot,
                previewRelativePath,
                shouldOpenInBrowser
            });

            if (shouldOpenInBrowser && this.fileViewerService) {
                void this.fileViewerService.openFile(currentSessionId, previewRelativePath || filePath);
                if (this.isMobile() && this.mobileTabController) {
                    this.mobileTabController.showFileViewer();
                } else {
                    this.showFileViewer?.();
                }
                return;
            }

            if (this.isMobile()) return;

            fetch('/api/open-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, mode: 'file', line, sessionId: currentSessionId })
            }).catch(err => console.error('[OPEN_FILE] Error:', err));
        };
        window.addEventListener('message', onOpenFileMessage);
        this._terminalInputUxCleanup.push(() => window.removeEventListener('message', onOpenFileMessage));

        // Click-to-focus: clicking on the console background (including the menu overlay) should restore focus.
        const onConsoleClick = (e) => {
            if (!this._isConsoleVisible()) return;
            if (this._isEditableTarget(e.target)) return;

            const overlayState = this._getTerminalOverlayState();
            // Don't steal focus while modal overlays (choices/drag) are active.
            if (overlayState.choiceActive || overlayState.dropActive) return;

            // Don't steal focus when clicking toolbar buttons or other buttons.
            if (e.target?.closest?.('button')) return;

            if (this._isMobileTerminalDisplayMode()) {
                void this.openMobileLiveTerminal(appStore.getState().currentSessionId);
                return;
            }

            // snapshotモード中にクリックしたら即reconnect
            if (this._isXtermTransportActive() && this.terminalTransportClient?.status?.mode === 'snapshot') {
                void this.terminalTransportClient.reconnect().catch(() => {});
                this._updateTerminalInputStatus();
                return;
            }

            this.focusTerminal('console-click');
        };
        consoleArea?.addEventListener('click', onConsoleClick, true);
        this._terminalInputUxCleanup.push(() => consoleArea?.removeEventListener('click', onConsoleClick, true));

        const onConsoleTouchStart = (event) => {
            if (!this._isMobileTerminalDisplayMode()) return;
            if (this._isEditableTarget(event.target)) return;
            this._mobileTapTracking = {
                startX: event.touches?.[0]?.clientX ?? 0,
                startY: event.touches?.[0]?.clientY ?? 0,
                moved: false
            };
        };
        const onConsoleTouchMove = (event) => {
            if (!this._mobileTapTracking) return;
            const touch = event.touches?.[0];
            if (!touch) return;
            const dx = Math.abs(touch.clientX - this._mobileTapTracking.startX);
            const dy = Math.abs(touch.clientY - this._mobileTapTracking.startY);
            if (dx > 8 || dy > 8) {
                this._mobileTapTracking.moved = true;
            }
        };
        const onConsoleTouchEnd = (event) => {
            if (!this._isMobileTerminalDisplayMode() || !this._mobileTapTracking || this._mobileTapTracking.moved) {
                this._mobileTapTracking = null;
                return;
            }
            if (this._isEditableTarget(event.target)) {
                this._mobileTapTracking = null;
                return;
            }
            const overlayState = this._getTerminalOverlayState();
            if (!overlayState.any) {
                void this.openMobileLiveTerminal(appStore.getState().currentSessionId);
            }
            this._mobileTapTracking = null;
        };
        consoleArea?.addEventListener('touchstart', onConsoleTouchStart, { passive: true });
        consoleArea?.addEventListener('touchmove', onConsoleTouchMove, { passive: true });
        consoleArea?.addEventListener('touchend', onConsoleTouchEnd, { passive: true });
        this._terminalInputUxCleanup.push(() => consoleArea?.removeEventListener('touchstart', onConsoleTouchStart, { passive: true }));
        this._terminalInputUxCleanup.push(() => consoleArea?.removeEventListener('touchmove', onConsoleTouchMove, { passive: true }));
        this._terminalInputUxCleanup.push(() => consoleArea?.removeEventListener('touchend', onConsoleTouchEnd, { passive: true }));

        const onSnapshotClick = (event) => {
            if (!this._isMobileTerminalDisplayMode()) return;
            if (this._isEditableTarget(event.target)) return;
            if (event.target.closest('.snapshot-url-link, .snapshot-file-link')) return;
            const overlayState = this._getTerminalOverlayState();
            if (overlayState.choiceActive || overlayState.dropActive) return;
            event.stopPropagation();
            void this.openMobileLiveTerminal(appStore.getState().currentSessionId);
        };
        this.terminalSnapshotPanelEl?.addEventListener('click', onSnapshotClick, true);
        this._terminalInputUxCleanup.push(() => this.terminalSnapshotPanelEl?.removeEventListener('click', onSnapshotClick, true));

        const onSnapshotTouchStart = (event) => {
            if (!this._isMobileTerminalDisplayMode()) return;
            if (this._isEditableTarget(event.target)) return;
            if (event.target.closest('.snapshot-url-link, .snapshot-file-link')) return;
            this._mobileTapTracking = {
                startX: event.touches?.[0]?.clientX ?? 0,
                startY: event.touches?.[0]?.clientY ?? 0,
                moved: false
            };
        };
        const onSnapshotTouchMove = (event) => {
            if (!this._mobileTapTracking) return;
            const touch = event.touches?.[0];
            if (!touch) return;
            const dx = Math.abs(touch.clientX - this._mobileTapTracking.startX);
            const dy = Math.abs(touch.clientY - this._mobileTapTracking.startY);
            if (dx > 8 || dy > 8) {
                this._mobileTapTracking.moved = true;
            }
        };
        const onSnapshotTouchEnd = (event) => {
            if (!this._isMobileTerminalDisplayMode() || !this._mobileTapTracking || this._mobileTapTracking.moved) {
                this._mobileTapTracking = null;
                return;
            }
            if (this._isEditableTarget(event.target)) {
                this._mobileTapTracking = null;
                return;
            }
            const overlayState = this._getTerminalOverlayState();
            if (!overlayState.any) {
                event.stopPropagation();
                void this.openMobileLiveTerminal(appStore.getState().currentSessionId);
            }
            this._mobileTapTracking = null;
        };
        this.terminalSnapshotPanelEl?.addEventListener('touchstart', onSnapshotTouchStart, { passive: true });
        this.terminalSnapshotPanelEl?.addEventListener('touchmove', onSnapshotTouchMove, { passive: true });
        this.terminalSnapshotPanelEl?.addEventListener('touchend', onSnapshotTouchEnd, { passive: true });
        this._terminalInputUxCleanup.push(() => this.terminalSnapshotPanelEl?.removeEventListener('touchstart', onSnapshotTouchStart, { passive: true }));
        this._terminalInputUxCleanup.push(() => this.terminalSnapshotPanelEl?.removeEventListener('touchmove', onSnapshotTouchMove, { passive: true }));
        this._terminalInputUxCleanup.push(() => this.terminalSnapshotPanelEl?.removeEventListener('touchend', onSnapshotTouchEnd, { passive: true }));

        const onMobileLiveTerminalLoad = () => {
            if (this._mobileTerminalMode !== 'interactive') return;
            this.scheduleTerminalFrameLayoutSync(this._latestMobileViewportLayout);
        };
        this.mobileLiveTerminalFrameEl?.addEventListener('load', onMobileLiveTerminalLoad);
        this._terminalInputUxCleanup.push(() => this.mobileLiveTerminalFrameEl?.removeEventListener('load', onMobileLiveTerminalLoad));

        const onTerminalFrameLoad = () => {
            this._scheduleTerminalInputStatusUpdate();
            if (this._mobileTerminalMode === 'interactive') return;
            this._scheduleTerminalAutoFocus('terminal-frame-load', [60, 180]);
        };
        this.terminalFrame?.addEventListener('load', onTerminalFrameLoad);
        this._terminalInputUxCleanup.push(() => this.terminalFrame?.removeEventListener('load', onTerminalFrameLoad));

        const onMobileLiveTerminalClose = (event) => {
            event?.preventDefault?.();
            this.closeMobileLiveTerminal();
        };
        closeMobileLiveTerminalBtn?.addEventListener('click', onMobileLiveTerminalClose);
        this._terminalInputUxCleanup.push(() => closeMobileLiveTerminalBtn?.removeEventListener('click', onMobileLiveTerminalClose));

        const onMobileLiveTerminalOverlayClick = (event) => {
            if (event.target === this.mobileLiveTerminalModalEl) {
                this.closeMobileLiveTerminal();
            }
        };
        this.mobileLiveTerminalModalEl?.addEventListener('click', onMobileLiveTerminalOverlayClick);
        this._terminalInputUxCleanup.push(() => this.mobileLiveTerminalModalEl?.removeEventListener('click', onMobileLiveTerminalOverlayClick));

        const onEscapeClose = (event) => {
            if (event.key === 'Escape' && this._mobileTerminalMode === 'interactive') {
                this.closeMobileLiveTerminal();
            }
        };
        document.addEventListener('keydown', onEscapeClose);
        this._terminalInputUxCleanup.push(() => document.removeEventListener('keydown', onEscapeClose));

        // Status badge click: focus, and if disconnected, trigger reconnect.
        const onStatusClick = (e) => {
            e.preventDefault();
            const overlayState = this._getTerminalOverlayState();
            if (overlayState.any) return;

            if (this._isMobileTerminalDisplayMode()) {
                void this.openMobileLiveTerminal(appStore.getState().currentSessionId);
                return;
            }

            const xtermActive = this._isXtermTransportActive();
            if ((xtermActive && this._terminalTransportStatus?.blockedAccess?.state === 'blocked')
                || this.reconnectManager?.terminalAccess?.state === 'blocked') {
                void this.takeOverCurrentTerminal();
                return;
            }

            const sessionId = appStore.getState().currentSessionId;
            if (xtermActive && this._terminalTransportStatus?.copyMode) {
                void this.terminalTransportClient?.exitCopyMode().catch(() => {});
            } else if (sessionId && this._terminalCopyModeSessions.has(sessionId)) {
                // Best-effort: exit tmux copy-mode so input works again.
                fetch(`/api/sessions/${sessionId}/exit_copy_mode`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                }).catch(() => {});
                this._terminalCopyModeSessions.delete(sessionId);
            }

            if (xtermActive && this._terminalTransportStatus?.mode === 'snapshot') {
                void this.terminalTransportClient?.reconnect().catch(() => {});
            } else if (!this.reconnectManager?.wsConnected && !this.reconnectManager?.isReconnecting) {
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

        const onReconnectClick = (e) => {
            e.preventDefault();
            if (this._isMobileTerminalDisplayMode()) {
                void this.openMobileLiveTerminal(appStore.getState().currentSessionId);
                return;
            }
            if (this._isXtermTransportActive()) {
                void this.terminalTransportClient?.reconnect().catch(() => {});
                return;
            }
            if (!this.reconnectManager?.isReconnecting) {
                this.reconnectManager?.handleDisconnect?.();
            }
        };
        this.terminalReconnectBtn?.addEventListener('click', onReconnectClick);
        this._terminalInputUxCleanup.push(() => this.terminalReconnectBtn?.removeEventListener('click', onReconnectClick));

        const onTakeoverClick = (e) => {
            e.preventDefault();
            void this.takeOverCurrentTerminal();
        };
        this.terminalTakeoverBtn?.addEventListener('click', onTakeoverClick);
        this._terminalInputUxCleanup.push(() => this.terminalTakeoverBtn?.removeEventListener('click', onTakeoverClick));

        const onOpenFallbackClick = (e) => {
            e.preventDefault();
            void this.openTerminalIframeFallback();
        };
        this.terminalOpenFallbackBtn?.addEventListener('click', onOpenFallbackClick);
        this._terminalInputUxCleanup.push(() => this.terminalOpenFallbackBtn?.removeEventListener('click', onOpenFallbackClick));

        const closeMoreActions = () => {
            this.terminalMoreActionsEl?.classList.remove('open');
        };
        const onMoreClick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.terminalMoreActionsEl?.classList.toggle('open');
        };
        const onDocumentClick = (e) => {
            if (!this.terminalHeaderEl?.contains(e.target)) {
                closeMoreActions();
            }
        };
        this.terminalMoreBtn?.addEventListener('click', onMoreClick);
        document.addEventListener('click', onDocumentClick, true);
        this._terminalInputUxCleanup.push(() => this.terminalMoreBtn?.removeEventListener('click', onMoreClick));
        this._terminalInputUxCleanup.push(() => document.removeEventListener('click', onDocumentClick, true));

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
            if (this._isXtermTransportActive(sessionId)) return;
            if (this.reconnectManager?.terminalAccess?.state === 'blocked') return;

            const overlayState = this._getTerminalOverlayState();
            if (overlayState.any) return;

            // If the websocket is down, attempting a reconnect here reduces "typed but nothing happened".
            if (this.reconnectManager && !this.reconnectManager.wsConnected && !this.reconnectManager.isReconnecting) {
                this.reconnectManager.handleDisconnect?.();
            }

            const key = e.key;

            // Only inject safe/simple keys.
            if (key === 'Enter' && e.shiftKey) {
                this.focusTerminal('type-to-focus');
                httpClient.post(`/api/sessions/${sessionId}/input`, { input: 'M-Enter', type: 'key' }).catch(() => {});
                e.preventDefault();
                return;
            }

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
        closeMoreActions();
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
        this.container.register('terminalInteractionService', () => new TerminalInteractionService({
            httpClient,
            getTerminalTransportClient: () => this.terminalTransportClient,
            getFallbackTerminalAccess: (sessionId) => {
                if (appStore.getState().currentSessionId !== sessionId) return null;
                return this.reconnectManager?.terminalAccess || null;
            },
            shouldUseXtermTransport: () => this._shouldUseXtermTransport()
        }));

        this.container.register('commitTreeService', () => new CommitTreeService());
        this.container.register('fileViewerService', () => new FileViewerService({
            sessionService: this.container.get('sessionService')
        }));
        this.container.register('wikiService', () => new WikiService());
        this.container.register('liveFeedService', () => new LiveFeedService());
        this.container.register('manaChatService', () => new ManaChatService());

        // Get service instances
        this.taskService = this.container.get('taskService');
        this.sessionService = this.container.get('sessionService');
        this.scheduleService = this.container.get('scheduleService');
        this.inboxService = this.container.get('inboxService');
        this.nocodbTaskService = this.container.get('nocodbTaskService');
        this.terminalInteractionService = this.container.get('terminalInteractionService');
        this.fileViewerService = this.container.get('fileViewerService');
        this.wikiService = this.container.get('wikiService');
        this.liveFeedService = this.container.get('liveFeedService');
        this.manaChatService = this.container.get('manaChatService');
    }

    /**
     * Initialize views
     */
    initViews() {
        // mana Chat Widget (floating, no container needed) — init first to survive downstream errors
        try {
            this.views.manaChatView = new ManaChatView({
                manaChatService: this.manaChatService
            });
            this.views.manaChatView.mount();
        } catch (err) {
            console.error('[mana] Failed to mount chat widget:', err);
        }

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
            this.views.sessionView = new SessionView({
                sessionService: this.sessionService,
                fileViewerService: this.fileViewerService,
                commitTreeService: this.container.get('commitTreeService')
            });
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

        // File Viewer (main panel)
        const fileViewerContainer = document.getElementById('file-viewer-panel');
        if (fileViewerContainer) {
            this.views.fileViewerView = new FileViewerView({
                fileViewerService: this.fileViewerService
            });
            this.views.fileViewerView.mount(fileViewerContainer);
        }

        // Wiki (main panel)
        const wikiContainer = document.getElementById('wiki-panel');
        if (wikiContainer) {
            this.views.wikiView = new WikiView({
                wikiService: this.wikiService
            });
            this.views.wikiView.mount(wikiContainer);
        }

        // Live Feed (main panel)
        const liveFeedContainer = document.getElementById('live-feed-panel');
        if (liveFeedContainer) {
            this.views.liveFeedView = new LiveFeedView({
                liveFeedService: this.liveFeedService
            });
            this.views.liveFeedView.mount(liveFeedContainer);
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

        // 1.5. Restore cached sessions for instant UI (stale-while-revalidate)
        if (this.sessionService?.restoreFromCache()) {
            console.log('[Startup] Restored sessions from cache');
        }

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
        await this.refreshLearningHealthBanner();

        // 5. Initialize terminal reconnect manager before session auto-selection.
        const terminalFrame = document.getElementById('terminal-frame');
        const terminalXtermHost = document.getElementById('terminal-xterm-host');
        if (terminalFrame) {
            this.terminalFrame = terminalFrame;
            this.reconnectManager = new TerminalReconnectManager();
            this.reconnectManager.setViewerContext({
                viewerId: this.viewerId,
                viewerLabel: this.viewerLabel
            });
            this.reconnectManager.init(terminalFrame);
            const currentSessionId = appStore.getState().currentSessionId;
            if (currentSessionId) {
                this.reconnectManager.setCurrentSession(currentSessionId);
            }
            if (terminalXtermHost && this._shouldUseXtermTransport()) {
                this.terminalXtermHost = terminalXtermHost;
                this.terminalTransportClient = new TerminalTransportClient({
                    viewerId: this.viewerId,
                    viewerLabel: this.viewerLabel,
                    onStatusChange: (status) => {
                        this._terminalTransportStatus = status;
                        this._updateTerminalInputStatus();
                    },
                    onSnapshotChange: (snapshot) => {
                        if (!snapshot?.sessionId) return;
                        this._cacheTerminalSnapshot(snapshot.sessionId, snapshot);
                        if (appStore.getState().currentSessionId === snapshot.sessionId) {
                            const consoleArea = document.getElementById('console-area');
                            if (consoleArea?.classList.contains('using-snapshot')) {
                                this._syncTerminalSnapshotPanel({
                                    sessionId: snapshot.sessionId,
                                    visible: true,
                                    title: 'Terminal display'
                                });
                            }
                        }
                    }
                });
                await this.terminalTransportClient.init(terminalXtermHost);
                if (this.terminalTransportClient.terminal) {
                    setupXtermContextMenu(this.terminalTransportClient.terminal);
                }
            }
            this.setupTerminalInputUx();
        }

        // 6. Load initial data
        await this.loadInitialData();

        const currentSessionId = appStore.getState().currentSessionId;
        if (currentSessionId) {
            this.reconnectManager?.setCurrentSession(currentSessionId);
        }
        if (currentSessionId && this.isMobile()) {
            await this.switchSession(currentSessionId);
        } else if (currentSessionId && this._shouldUseXtermTransport()) {
            await this._preferXtermForCurrentSession();
        }

        // 6.5. Initialize file upload (Drag & Drop, Clipboard)
        initFileUpload(() => appStore.getState().currentSessionId);

        const onPageHide = () => {
            void this.releaseTerminalOwnership(appStore.getState().currentSessionId);
        };
        window.addEventListener('pagehide', onPageHide);
        this._terminalInputUxCleanup.push(() => window.removeEventListener('pagehide', onPageHide));

        // 7. Start session status polling (every 3 seconds)
        this.pollingIntervalId = startPolling(
            () => appStore.getState().currentSessionId,
            3000,
            async () => {
                await this.sessionService.loadSessions({ silent: true });
            }
        );

        // 8. Start periodic refresh (every 5 minutes)
        this.startPeriodicRefresh();
        this.startSessionUiSummaryRefresh();

        // 9. Setup choice detection (mobile only)
        this.choiceOverlayController = new ChoiceOverlayController({
            httpClient,
            store: appStore,
            isMobile: () => this.isMobile(),
            focusTerminal: (reason) => this.focusTerminal(reason),
            showError: (message) => this.showError(message)
        });
        this.choiceOverlayController.init();

        // 10. Setup file opener shortcuts
        setupFileOpenerShortcuts();

        // 11. Setup terminal contextmenu listener
        setupTerminalContextMenuListener();

        // 12. Setup mobile keyboard handling
        initMobileKeyboard({ terminalInput: this.terminalInteractionService });

        // 13. Setup mobile input UI (Dock/Composer)
        this.initMobileInput();

        // 14. Setup mobile tab bar
        if (this.isMobile()) {
            this.mobileTabController = new MobileTabController({
                container: this.container
            });
            this.mobileTabController.init();
        }

        console.log('brainbase-ui started successfully');

        // Hide initial loading splash
        const splash = document.getElementById('app-loading-splash');
        if (splash) {
            splash.classList.add('hidden');
            splash.addEventListener('transitionend', () => splash.remove(), { once: true });
        }
    }

    /**
     * Check if device is mobile
     */
    isMobile() {
        return window.innerWidth <= 768;
    }

    /**
     * Cleanup
     */
    destroy() {
        // Stop polling
        if (this.pollingIntervalId) {
            if (typeof this.pollingIntervalId === 'function') {
                this.pollingIntervalId();
            } else {
                clearInterval(this.pollingIntervalId);
            }
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
        this._stopMobileSnapshotPolling();
        if (this._terminalFrameLayoutSyncRaf) {
            window.cancelAnimationFrame(this._terminalFrameLayoutSyncRaf);
            this._terminalFrameLayoutSyncRaf = null;
        }
        this._clearScheduledTerminalAutoFocus();

        this.choiceOverlayController?.destroy();
        this.choiceOverlayController = null;

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
        this.terminalTransportClient?.destroy();

        void this.releaseTerminalOwnership(appStore.getState().currentSessionId);
        this._terminalInputUxCleanup.forEach(cleanup => cleanup());
        this._terminalInputUxCleanup = [];

        console.log('brainbase-ui destroyed');
    }
}

applyTerminalDisplayMixin(App);
applyTerminalMobileMixin(App);
applyTerminalInputUxMixin(App);
applySessionManagementMixin(App);
applySessionCreationMixin(App);
applyEventListenersMixin(App);
applyPluginRegistrationMixin(App);
applyMobileNavigationMixin(App);
applyUiSetupMixin(App);

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
