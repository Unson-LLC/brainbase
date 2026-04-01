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
import { renderViewToggle } from './modules/ui/view-toggle.js';
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
