import { appStore } from '../core/store.js';
import { httpClient } from '../core/http-client.js';
import { eventBus } from '../core/event-bus.js';
import { TerminalInteractionService } from '../core/terminal-interaction-service.js';
import { AuthManager } from '../auth/auth-manager.js';
import { SettingsCore, CoreApiClient } from '../settings/settings-core.js';
import { SettingsPluginRegistry } from '../settings/settings-plugin-api.js';
import { SettingsUI } from '../settings/settings-ui.js';
import { showSuccess, showError, showInfo } from '../toast.js';
import { refreshIcons } from '../ui-helpers.js';
import { SessionService } from '../domain/session/session-service.js';
import { ScheduleService } from '../domain/schedule/schedule-service.js';
import { InboxService } from '../domain/inbox/inbox-service.js';
import { NocoDBTaskService } from '../domain/nocodb-task/nocodb-task-service.js';
import { CommitTreeService } from '../domain/commit-tree/commit-tree-service.js';
import { FileViewerService } from '../domain/file-viewer/file-viewer-service.js';
import { WikiService } from '../domain/wiki/wiki-service.js';
import { LiveFeedService } from '../domain/live-feed/live-feed-service.js';
import { ManaChatService } from '../domain/mana/mana-chat-service.js';
import { ManaChatView } from '../ui/views/mana-chat-view.js';
import { SessionView } from '../ui/views/session-view.js';
import { SessionContextBarView } from '../ui/views/session-context-bar-view.js';
import { CommitTreeView } from '../ui/views/commit-tree-view.js';
import { FileViewerView } from '../ui/views/file-viewer-view.js';
import { WikiView } from '../ui/views/wiki-view.js';
import { LiveFeedView } from '../ui/views/live-feed-view.js';
import { PortalView } from '../ui/views/portal-view.js';
import { PortalOverlayView } from '../ui/views/portal-overlay-view.js';
import { PortalService } from '../domain/portal/portal-service.js';
import { NocoDBIssueService } from '../domain/nocodb-issue/nocodb-issue-service.js';
import { setupSessionViewToggle } from '../ui/session-view-toggle.js';
import { setupSidebarPrimaryToggle } from '../ui/sidebar-primary-toggle.js';
import { TaskAddModal } from '../ui/modals/task-add-modal.js';
import { TaskEditModal } from '../ui/modals/task-edit-modal.js';
import { ArchiveModal } from '../ui/modals/archive-modal.js';
import { FocusEngineModal } from '../ui/modals/focus-engine-modal.js';
import { RenameModal } from '../ui/modals/rename-modal.js';

const LEARNING_HEALTH_DISMISS_KEY = 'brainbase.learningHealth.dismissedIssueKey';

export function applyUiSetupMixin(AppClass) {
    AppClass.prototype.ensureTopBannerStack = function() {
        let stack = document.getElementById('top-banner-stack');
        if (stack) return stack;

        stack = document.createElement('div');
        stack.id = 'top-banner-stack';
        stack.className = 'top-banner-stack';
        stack.setAttribute('aria-live', 'polite');

        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            document.body.insertBefore(stack, appContainer);
        } else {
            document.body.prepend(stack);
        }
        return stack;
    };

    AppClass.prototype.syncAppTopOffset = function() {
        const stack = this.ensureTopBannerStack();
        const height = stack ? Math.ceil(stack.getBoundingClientRect().height) : 0;
        document.body.style.setProperty('--app-top-offset', `${height}px`);
        this.syncMobileTerminalReserve?.(
            window.visualViewport?.height || window.innerHeight,
            window.visualViewport?.offsetTop || 0
        );
        return height;
    };

    AppClass.prototype.requestAppTopOffsetSync = function() {
        if (this._appTopOffsetSyncRaf) {
            window.cancelAnimationFrame(this._appTopOffsetSyncRaf);
        }
        this._appTopOffsetSyncRaf = window.requestAnimationFrame(() => {
            this._appTopOffsetSyncRaf = null;
            this.syncAppTopOffset();
        });
    };

    AppClass.prototype.setupAppTopOffsetSync = function() {
        const stack = this.ensureTopBannerStack();
        if (this._appTopOffsetSyncInitialized) {
            this.requestAppTopOffsetSync();
            return;
        }

        this._appTopOffsetSyncInitialized = true;
        const sync = () => this.requestAppTopOffsetSync();

        window.addEventListener('resize', sync);
        window.addEventListener('orientationchange', sync);
        this.unsubscribers.push(() => {
            window.removeEventListener('resize', sync);
            window.removeEventListener('orientationchange', sync);
        });

        if (typeof ResizeObserver === 'function') {
            this._appTopOffsetResizeObserver = new ResizeObserver(sync);
            this._appTopOffsetResizeObserver.observe(stack);
            this.unsubscribers.push(() => this._appTopOffsetResizeObserver?.disconnect());
        }

        this.requestAppTopOffsetSync();
    };

    AppClass.prototype.initAuth = async function() {
        this.authManager = new AuthManager({ httpClient, store: appStore, eventBus });

        httpClient.setUnauthorizedHandler(() => {
            this.authManager?.clearSession();
            showError('認証が必要です。Settings > 認証からログインしてください。');
        });

        await this.authManager.initFromStorage();
    };

    AppClass.prototype.initServices = function() {
        // Register services in DI container
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
            shouldUseXtermTransport: () => this._shouldUseXtermTransport(),
            getSessionEngine: (sessionId) => this._getSessionEngine(sessionId),
            isTerminalReadOnly: (sessionId) => (
                appStore.getState().currentSessionId === sessionId
                && this._isCodexAppServerDisplayActive?.()
            )
        }));

        this.container.register('commitTreeService', () => new CommitTreeService());
        this.container.register('fileViewerService', () => new FileViewerService({
            sessionService: this.container.get('sessionService')
        }));
        this.container.register('wikiService', () => new WikiService());
        this.container.register('liveFeedService', () => new LiveFeedService());
        this.container.register('portalService', () => new PortalService({ httpClient }));
        this.container.register('nocodbIssueService', () => new NocoDBIssueService({ httpClient }));
        this.container.register('manaChatService', () => new ManaChatService());

        // Get service instances
        this.sessionService = this.container.get('sessionService');
        this.scheduleService = this.container.get('scheduleService');
        this.inboxService = this.container.get('inboxService');
        this.nocodbTaskService = this.container.get('nocodbTaskService');
        this.terminalInteractionService = this.container.get('terminalInteractionService');
        this.fileViewerService = this.container.get('fileViewerService');
        this.wikiService = this.container.get('wikiService');
        this.liveFeedService = this.container.get('liveFeedService');
        this.portalService = this.container.get('portalService');
        this.nocodbIssueService = this.container.get('nocodbIssueService');
        this.manaChatService = this.container.get('manaChatService');
    };

    AppClass.prototype._getSessionEngine = function(sessionId) {
        if (!sessionId) return null;
        const state = appStore.getState();
        const currentSession = Array.isArray(state.sessions)
            ? state.sessions.find((session) => session.id === sessionId)
            : null;
        if (currentSession?.engine) return currentSession.engine;

        const escapedSessionId = window.CSS?.escape ? window.CSS.escape(sessionId) : sessionId.replace(/"/g, '\\"');
        const sessionRow = document.querySelector(`[data-id="${escapedSessionId}"]`);
        return sessionRow?.dataset?.engine || null;
    };

    AppClass.prototype.initViews = function() {
        // mana Chat Widget
        try {
            const svc = this.manaChatService || new ManaChatService();
            this.views.manaChatView = new ManaChatView({ manaChatService: svc });
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

        // Portal (info drawer tab)
        const portalContainer = document.getElementById('portal-panel');
        if (portalContainer) {
            this._initPortalView(portalContainer);
        }

        // Portal Overlay (fullscreen)
        const portalOverlayContainer = document.getElementById('portal-overlay-panel');
        if (portalOverlayContainer) {
            this._initPortalOverlayView(portalOverlayContainer);
        }
    };

    AppClass.prototype._initPortalView = async function(container) {
        try {
            const configResp = await httpClient.get('/api/config');
            const rawProjects = configResp?.projects?.projects || configResp?.projects || [];
            const projects = (Array.isArray(rawProjects) ? rawProjects : [])
                .filter(p => !p.archived)
                .map(p => ({ id: p.id, name: p.name || p.id }));

            this.views.portalView = new PortalView({
                portalService: this.portalService,
                configProjects: projects
            });
            this.views.portalView.mount(container);
        } catch (error) {
            this.views.portalView = new PortalView({
                portalService: this.portalService,
                configProjects: []
            });
            this.views.portalView.mount(container);
        }
    };

    AppClass.prototype._initPortalOverlayView = async function(container) {
        try {
            const configResp = await httpClient.get('/api/config');
            const rawProjects = configResp?.projects?.projects || configResp?.projects || [];
            const projects = (Array.isArray(rawProjects) ? rawProjects : [])
                .filter(p => !p.archived)
                .map(p => ({ id: p.id, name: p.name || p.id }));

            this.views.portalOverlayView = new PortalOverlayView({
                portalService: this.portalService,
                configProjects: projects
            });
            this.views.portalOverlayView.mount(container);
        } catch (error) {
            this.views.portalOverlayView = new PortalOverlayView({
                portalService: this.portalService,
                configProjects: []
            });
            this.views.portalOverlayView.mount(container);
        }
    };

    AppClass.prototype.initModals = function() {
        // Task add modal (NocoDB tasks)
        this.modals.taskAddModal = new TaskAddModal({
            nocodbTaskService: this.nocodbTaskService
        });
        this.modals.taskAddModal.mount();

        // Task edit modal (NocoDB tasks)
        this.modals.taskEditModal = new TaskEditModal({
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

    };

    AppClass.prototype.initDashboardController = async function() {
        if (this.dashboardController) {
            return this.dashboardController;
        }

        try {
            const { DashboardController } = await import('../dashboard-controller.js');
            this.dashboardController = new DashboardController();
            await this.dashboardController.init();
            console.log('Dashboard Controller loaded (Mana extension)');
            return this.dashboardController;
        } catch (error) {
            console.error('Dashboard Controller error:', error);
            this.dashboardController = null;
            return null;
        }
    };

    AppClass.prototype.setupTestModeBanner = function() {
        this.setupAppTopOffsetSync();

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
    };

    AppClass.prototype.updateTestModeBanner = function(testMode) {
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

                this.ensureTopBannerStack().appendChild(banner);
                refreshIcons();
            }
        } else {
            // Remove banner if it exists
            if (banner) {
                banner.remove();
            }
        }

        this.requestAppTopOffsetSync();
    };

    AppClass.prototype.setupLearningHealthBanner = function() {
        this.setupAppTopOffsetSync();
        this.refreshLearningHealthBanner();
    };

    AppClass.prototype.refreshLearningHealthBanner = async function() {
        try {
            const health = await this.inboxService?.getLearningHealth?.();
            this.updateLearningHealthBanner(health);
        } catch {
            this.updateLearningHealthBanner(null);
        }
    };

    AppClass.prototype.updateLearningHealthBanner = function(health) {
        let banner = document.getElementById('learning-health-banner');
        const issueKey = health?.issue_key || null;
        if (!health || health.status === 'healthy' || this.isLearningHealthIssueDismissed(issueKey)) {
            if (banner) banner.remove();
            this.requestAppTopOffsetSync();
            return;
        }

        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'learning-health-banner';
            banner.className = 'learning-health-banner';
            banner.innerHTML = `
                <div class="learning-health-banner-content">
                    <div class="learning-health-banner-copy">
                        <i data-lucide="triangle-alert"></i>
                        <span id="learning-health-banner-message"></span>
                    </div>
                    <div class="learning-health-banner-actions">
                        <button id="learning-health-open-inbox-btn" class="learning-health-banner-btn" type="button">Bellで見る</button>
                        <button id="learning-health-dismiss-btn" class="learning-health-banner-btn" type="button">閉じる</button>
                    </div>
                </div>
            `;
            const stack = this.ensureTopBannerStack();
            const testModeBanner = document.getElementById('test-mode-banner');
            if (testModeBanner && testModeBanner.parentElement === stack) {
                testModeBanner.insertAdjacentElement('afterend', banner);
            } else {
                stack.appendChild(banner);
            }

            banner.querySelector('#learning-health-open-inbox-btn')?.addEventListener('click', () => {
                this.views?.inboxView?.inboxTriggerBtn?.click?.();
            });
            banner.querySelector('#learning-health-dismiss-btn')?.addEventListener('click', () => {
                this.dismissLearningHealthIssue(banner.dataset.issueKey || null);
                banner.remove();
                this.requestAppTopOffsetSync();
            });
        }

        banner.dataset.issueKey = issueKey || '';
        const messageEl = banner.querySelector('#learning-health-banner-message');
        if (messageEl) {
            messageEl.textContent = health.message || '学習の日次ジョブが予定どおり動いていません。';
        }
        refreshIcons();
        this.requestAppTopOffsetSync();
    };

    AppClass.prototype.dismissLearningHealthIssue = function(issueKey) {
        if (!issueKey) return;
        localStorage.setItem(LEARNING_HEALTH_DISMISS_KEY, issueKey);
    };

    AppClass.prototype.isLearningHealthIssueDismissed = function(issueKey) {
        if (!issueKey) return false;
        return localStorage.getItem(LEARNING_HEALTH_DISMISS_KEY) === issueKey;
    };

    AppClass.prototype.setupGlobalButtons = async function() {
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

        // Settings button (Activity Bar)
        const abSettingsBtn = document.getElementById('ab-settings-btn');
        if (abSettingsBtn) {
            abSettingsBtn.onclick = async () => {
                if (this.settingsCore && this.settingsCore.ui) {
                    await this.settingsCore.ui.openModal();
                }
            };
        }

        // Add task button (NocoDB)
        const addNocodbTaskBtn = document.getElementById('add-nocodb-task-btn');
        if (addNocodbTaskBtn) {
            addNocodbTaskBtn.onclick = () => {
                this.modals.taskAddModal?.open();
            };
        }

        // Mobile bottom navigation
        this.setupMobileNavigation();
    };

    AppClass.prototype.setupAuthControls = function() {
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
    };

    AppClass.prototype.updateAuthButtonUI = function() {
        const authBtn = document.getElementById('auth-btn');
        if (!authBtn) return;

        const icon = authBtn.querySelector('[data-lucide]');
        const text = document.getElementById('auth-btn-text');
        const badge = document.getElementById('auth-status-badge');

        const summary = this.authManager?.getSummary?.() || appStore.getState().auth || {};
        const status = summary.status || 'anonymous';

        let label = 'ログイン';
        let iconName = 'circle-user-round';
        let badgeText = '未ログイン';
        let badgeClass = 'neutral';

        if (status === 'authenticated') {
            label = 'ログアウト';
            iconName = 'circle-user-round';
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
        authBtn.dataset.authStatus = status;
        authBtn.title = label;
        authBtn.setAttribute('aria-label', label);
        if (text) text.textContent = label;
        if (icon) icon.setAttribute('data-lucide', iconName);
        if (badge) {
            badge.textContent = badgeText;
            badge.classList.remove('success', 'warning', 'neutral');
            badge.classList.add(badgeClass);
        }

        if (typeof lucide !== 'undefined') {
            refreshIcons();
        }
    };

    AppClass.prototype.initSettingsWithExtensions = async function() {
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
    };

    AppClass.prototype.initProjectSelect = function() {
        this.refreshProjectSelect();
    };

    AppClass.prototype.refreshProjectSelect = async function(selectedProject = 'general') {
        const projectSelect = document.getElementById('session-project-select');
        if (!projectSelect) {
            console.warn('[App] session-project-select not found');
            return;
        }

        try {
            const { getSessionSelectableProjects, projectMappingReady } = await import('../project-mapping.js');
            await projectMappingReady;
            const projects = getSessionSelectableProjects(this.authManager?.access?.projectCodes);
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
    };
}
