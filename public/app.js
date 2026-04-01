/**
 * brainbase-ui Application Entry Point
 * 新アーキテクチャ: サービス層とビュー層の分離
 */

// Core
import { DIContainer } from './modules/core/di-container.js';
import { appStore } from './modules/core/store.js';
import { httpClient } from './modules/core/http-client.js';
import { eventBus, EVENTS } from './modules/core/event-bus.js';
import { TerminalInteractionService } from './modules/core/terminal-interaction-service.js';
import { getTerminalViewerId, getTerminalViewerLabel } from './modules/core/terminal-viewer.js';
import { TerminalTransportClient } from './modules/core/terminal-transport-client.js';
import { AuthManager } from './modules/auth/auth-manager.js';
import { PluginManager } from './modules/core/plugin-manager.js';
import { SettingsCore, CoreApiClient } from './modules/settings/settings-core.js';
import { SettingsExtensions } from './modules/settings/settings-extensions.js';
import { SettingsPluginRegistry } from './modules/settings/settings-plugin-api.js';
import { SettingsUI } from './modules/settings/settings-ui.js';
import { pollSessionStatus, startPolling, markDoneAsRead } from './modules/session-indicators.js';
import { initFileUpload, compressImage } from './modules/file-upload.js';
import { showSuccess, showError, showInfo } from './modules/toast.js';
import { refreshIcons } from './modules/ui-helpers.js';
import { setupFileOpenerShortcuts } from './modules/file-opener.js';
import { setupTerminalContextMenuListener, setupXtermContextMenu } from './modules/iframe-contextmenu-handler.js';
import { attachSectionHeaderHandlers, attachGroupHeaderHandlers, attachSessionRowClickHandlers, attachAddProjectSessionHandlers } from './modules/session-handlers.js';
import { applyTerminalDisplayMixin } from './modules/app/terminal-display-mixin.js';
import { applyTerminalMobileMixin } from './modules/app/terminal-mobile-mixin.js';
import { applyTerminalInputUxMixin } from './modules/app/terminal-input-ux-mixin.js';
import { applySessionManagementMixin } from './modules/app/session-management-mixin.js';
import { applySessionCreationMixin } from './modules/app/session-creation-mixin.js';
import { scheduleAfterNextPaint } from './modules/app/schedule-after-next-paint.js';
import { initMobileKeyboard } from './modules/mobile-keyboard.js';
import { TerminalReconnectManager } from './modules/terminal/terminal-reconnect-manager.js';
import { hydrateSessionRecentFiles, recordRecentFileOpen } from './modules/session-ui-state.js';

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
import { MobileInputController } from './modules/ui/mobile-input-controller.js';
import { MobileTabController } from './modules/ui/mobile-tab-controller.js';

// Modals
import { TaskAddModal } from './modules/ui/modals/task-add-modal.js';
import { TaskEditModal } from './modules/ui/modals/task-edit-modal.js';
import { ArchiveModal } from './modules/ui/modals/archive-modal.js';
import { FocusEngineModal } from './modules/ui/modals/focus-engine-modal.js';
import { RenameModal } from './modules/ui/modals/rename-modal.js';

const LEARNING_HEALTH_DISMISS_KEY = 'brainbase.learningHealth.dismissedIssueKey';

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
    _registerUIPlugins() {
        if (!this.pluginManager) return;


        this.pluginManager.registerPlugin({
            id: 'bb-dashboard',
            layer: 'business',
            slots: {
                'nav:view-toggle': {
                    mount: ({ container }) => {
                        const cleanupToggle = renderPanelToggles(container);

                        // Setup panel layout manager
                        const panelLayout = setupPanelLayout({ store: appStore, eventBus });
                        this._panelLayout = panelLayout;

                        // Wire Activity Bar buttons
                        const abSessionsBtn = document.getElementById('ab-sessions-btn');
                        const abDashboardBtn = document.getElementById('ab-dashboard-btn');
                        const abWikiBtn = document.getElementById('ab-wiki-btn');
                        const abLivefeedBtn = document.getElementById('ab-livefeed-btn');
                        const abCommitTreeBtn = document.getElementById('ab-commit-tree-btn');
                        const abTasksBtn = document.getElementById('ab-tasks-btn');

                        const onSessionsClick = () => panelLayout.closeAllPanels();
                        const onDashboardClick = () => panelLayout.toggleDashboard();
                        const onWikiClick = () => panelLayout.toggleInfoDrawer('wiki');
                        const onLivefeedClick = () => panelLayout.toggleInfoDrawer('live-feed');
                        const onCommitTreeClick = () => panelLayout.toggleInfoDrawer('commit-tree');
                        const onTasksClick = () => panelLayout.toggleInfoDrawer('tasks');

                        if (abSessionsBtn) abSessionsBtn.addEventListener('click', onSessionsClick);
                        if (abDashboardBtn) abDashboardBtn.addEventListener('click', onDashboardClick);
                        if (abWikiBtn) abWikiBtn.addEventListener('click', onWikiClick);
                        if (abLivefeedBtn) abLivefeedBtn.addEventListener('click', onLivefeedClick);
                        if (abCommitTreeBtn) abCommitTreeBtn.addEventListener('click', onCommitTreeClick);
                        if (abTasksBtn) abTasksBtn.addEventListener('click', onTasksClick);

                        // Wire close buttons inside drawer/overlay
                        const infoCloseBtn = document.getElementById('info-drawer-close');
                        const dashCloseBtn = document.getElementById('dashboard-overlay-close');
                        if (infoCloseBtn) infoCloseBtn.addEventListener('click', panelLayout.closeAllPanels);
                        if (dashCloseBtn) dashCloseBtn.addEventListener('click', panelLayout.toggleDashboard);

                        return () => {
                            cleanupToggle?.();
                            panelLayout.cleanup();
                            if (abSessionsBtn) abSessionsBtn.removeEventListener('click', onSessionsClick);
                            if (abDashboardBtn) abDashboardBtn.removeEventListener('click', onDashboardClick);
                            if (abWikiBtn) abWikiBtn.removeEventListener('click', onWikiClick);
                            if (abLivefeedBtn) abLivefeedBtn.removeEventListener('click', onLivefeedClick);
                            if (abCommitTreeBtn) abCommitTreeBtn.removeEventListener('click', onCommitTreeClick);
                            if (abTasksBtn) abTasksBtn.removeEventListener('click', onTasksClick);
                            if (infoCloseBtn) infoCloseBtn.removeEventListener('click', panelLayout.closeAllPanels);
                            if (dashCloseBtn) dashCloseBtn.removeEventListener('click', panelLayout.toggleDashboard);
                        };
                    }
                },
                'view:dashboard': {
                    manageVisibility: false,
                    mount: async ({ container }) => {
                        const abDashboardBtn = document.getElementById('ab-dashboard-btn');
                        const mobileDashboardBtn = document.getElementById('mobile-dashboard-btn');
                        if (abDashboardBtn) {
                            abDashboardBtn.style.display = '';
                        }
                        if (mobileDashboardBtn) {
                            mobileDashboardBtn.style.display = '';
                        }

                        // Setup backward-compatible navigation helpers
                        const { cleanup, showConsole, showDashboard, showFileViewer, showWiki } = setupViewNavigation({
                            onDashboardActivated: () => {
                                this.dashboardController?.init();
                            },
                            onWikiActivated: () => {
                                this.wikiService?.loadPages();
                            }
                        });
                        this.showConsole = showConsole;
                        this.showDashboard = () => {
                            this._panelLayout?.toggleDashboard();
                            this.dashboardController?.init();
                        };
                        this.showFileViewer = showFileViewer;
                        this.showWiki = () => {
                            this._panelLayout?.toggleInfoDrawer('wiki');
                            this.wikiService?.loadPages();
                        };

                        // Wire file viewer events to panel switching
                        const unsubFileOpen = eventBus.on(EVENTS.FILE_VIEWER_OPENED, (event) => {
                            const {
                                sessionId,
                                relativePath,
                                treeNavigable = true,
                                treeRootPath = null,
                                treeRelativePath = null
                            } = event.detail || {};
                            this._syncSidebarToOpenedFile(
                                sessionId,
                                treeRelativePath || relativePath,
                                treeNavigable,
                                treeRootPath
                            );
                            this.showFileViewer?.();
                        });
                        const unsubFileClose = eventBus.on(EVENTS.FILE_VIEWER_CLOSED, () => {
                            const state = appStore.getState();
                            const currentSessionId = state.currentSessionId || null;
                            const folderTree = state.folderTree || {};
                            const activeFileBySessionId = {
                                ...(folderTree.activeFileBySessionId || {})
                            };
                            const rootOverrideBySessionId = {
                                ...(folderTree.rootOverrideBySessionId || {})
                            };
                            if (currentSessionId) {
                                delete activeFileBySessionId[currentSessionId];
                                delete rootOverrideBySessionId[currentSessionId];
                            }
                            appStore.setState({
                                ui: {
                                    ...(state.ui || {}),
                                    sidebarPrimaryView: 'sessions'
                                },
                                folderTree: {
                                    ...folderTree,
                                    activeFileBySessionId,
                                    rootOverrideBySessionId
                                }
                            });
                            if (this.isMobile() && this.mobileTabController) {
                                this.mobileTabController.switchTab('terminal');
                            } else {
                                this.showConsole?.();
                            }
                            this._scheduleTerminalViewportSync();
                        });
                        this.unsubscribers.push(unsubFileOpen, unsubFileClose);
                        await this.initDashboardController();

                        // Wire dashboard init on panel toggle
                        const unsubPanelToggle = eventBus.on(EVENTS.PANEL_TOGGLED, (e) => {
                            if (e.detail?.panel === 'dashboard' && e.detail?.open) {
                                this.dashboardController?.init();
                            }
                            if (e.detail?.panel === 'info' && e.detail?.open && e.detail?.tab === 'wiki') {
                                this.wikiService?.loadPages();
                            }
                        });
                        this.unsubscribers.push(unsubPanelToggle);

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

        if (this.terminalRecoverBtn) {
            this.terminalRecoverBtn.onclick = async () => {
                const sessionId = this.terminalRecoverBtn?.dataset?.sessionId || appStore.getState().currentSessionId;
                if (!sessionId) return;
                const session = this._getSessionById(sessionId);
                if (!session) return;

                try {
                    const res = await this._recoverSessionRuntime(session);
                    const updatedSessions = (appStore.getState().sessions || []).map((item) => (
                        item.id === sessionId
                            ? { ...item, runtimeStatus: res?.runtimeStatus || item.runtimeStatus, recoveryState: 'healthy', recoveryReason: null }
                            : item
                    ));
                    appStore.setState({ sessions: updatedSessions });
                    this._hideTerminalRecoveryPanel();
                    await this.switchSession(sessionId);
                } catch (error) {
                    console.error('Failed to recover session:', error);
                    showError(error?.message || 'セッションの復旧に失敗しました');
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
            const switchToken = ++this._sessionSwitchToken;

            // Mark previous session's green indicator as read when leaving it
            if (previousSessionId && previousSessionId !== sessionId) {
                void markDoneAsRead(previousSessionId, sessionId);
                void this.releaseTerminalOwnership(previousSessionId);
            }

            // Update currentSessionId in store
            appStore.setState({ currentSessionId: sessionId });

            const startTime = performance.now();
            await this.switchSession(sessionId, { proxyPath, switchToken });
            const duration = performance.now() - startTime;
            console.log(`[SessionSwitch] Terminal ready in ${duration.toFixed(2)}ms`);

            if (switchToken !== this._sessionSwitchToken || appStore.getState().currentSessionId !== sessionId) {
                return;
            }

            // Auto-return to console view
            if (this.showConsole) {
                this.showConsole();
            } else {
                // Fallback: showConsole未初期化時（ダッシュボード未訪問）でもconsole viewに戻す
                const consoleArea = document.getElementById('console-area');
                const dashboardPanel = document.getElementById('dashboard-panel');
                const fileViewerPanel = document.getElementById('file-viewer-panel');
                if (consoleArea) consoleArea.style.display = 'flex';
                if (dashboardPanel) dashboardPanel.style.display = 'none';
                if (fileViewerPanel) fileViewerPanel.style.display = 'none';
            }

            if (this._shouldAutoFocusTerminalSurface()) {
                this._triggerTerminalAutoFocus('session-changed');
            }

            scheduleAfterNextPaint(() => {
                this._runDeferredSessionSwitchWork(sessionId, switchToken);
                void this.refreshSessionUiSummaries([sessionId]);
                const rowUpdateIds = previousSessionId && previousSessionId !== sessionId
                    ? [previousSessionId, sessionId]
                    : [sessionId];
                void eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, { sessionIds: rowUpdateIds });
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

        // Setup settings-related UI extensions
        this.settingsExtensions?.setupSettingsExtensions();

        // Setup test mode banner
        this.setupTestModeBanner();
        this.setupLearningHealthBanner();
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
                    refreshIcons();
                }
            }
        } else {
            // Remove banner if it exists
            if (banner) {
                banner.remove();
            }
        }
    }

    setupLearningHealthBanner() {
        this.refreshLearningHealthBanner();
    }

    async refreshLearningHealthBanner() {
        try {
            const health = await this.inboxService?.getLearningHealth?.();
            this.updateLearningHealthBanner(health);
        } catch {
            this.updateLearningHealthBanner(null);
        }
    }

    updateLearningHealthBanner(health) {
        let banner = document.getElementById('learning-health-banner');
        const issueKey = health?.issue_key || null;
        if (!health || health.status === 'healthy' || this.isLearningHealthIssueDismissed(issueKey)) {
            if (banner) banner.remove();
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
            const appContainer = document.querySelector('.app-container');
            const testModeBanner = document.getElementById('test-mode-banner');
            if (appContainer) {
                if (testModeBanner) {
                    testModeBanner.insertAdjacentElement('afterend', banner);
                } else {
                    document.body.insertBefore(banner, appContainer);
                }
            }

            banner.querySelector('#learning-health-open-inbox-btn')?.addEventListener('click', () => {
                this.views?.inboxView?.inboxTriggerBtn?.click?.();
            });
            banner.querySelector('#learning-health-dismiss-btn')?.addEventListener('click', () => {
                this.dismissLearningHealthIssue(banner.dataset.issueKey || null);
                banner.remove();
            });
        }

        banner.dataset.issueKey = issueKey || '';
        const messageEl = banner.querySelector('#learning-health-banner-message');
        if (messageEl) {
            messageEl.textContent = health.message || '学習の日次ジョブが予定どおり動いていません。';
        }
        refreshIcons();
    }

    dismissLearningHealthIssue(issueKey) {
        if (!issueKey) return;
        localStorage.setItem(LEARNING_HEALTH_DISMISS_KEY, issueKey);
    }

    isLearningHealthIssueDismissed(issueKey) {
        if (!issueKey) return false;
        return localStorage.getItem(LEARNING_HEALTH_DISMISS_KEY) === issueKey;
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

        // Settings button (Activity Bar)
        const abSettingsBtn = document.getElementById('ab-settings-btn');
        if (abSettingsBtn) {
            abSettingsBtn.onclick = async () => {
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
            refreshIcons();
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
            terminalInput: this.terminalInteractionService,
            isMobile: () => this.isMobile(),
            onViewportChange: (layout) => this._handleMobileViewportChange(layout)
        });
        this.mobileInputController.init();
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
        const mobileAddSessionBtn = document.getElementById('mobile-add-session-btn') || document.getElementById('mobile-new-session-btn');
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
            // Non-terminalタブ表示中はTerminalに戻す（シートを閉じた後にタブが残る問題の防止）
            if (this.mobileTabController && this.mobileTabController._activeTab !== 'terminal') {
                this.mobileTabController.switchTab('terminal');
            }
            renderMobileSessionList();
            sessionsSheetOverlay?.classList.add('active');
            sessionsBottomSheet?.classList.add('active');
            refreshIcons();
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
            const tasksTabContent = document.getElementById('tasks-tab-content');
            if (!mobileTasksContent || !tasksTabContent) return;

            mobileTasksContent.innerHTML = tasksTabContent.innerHTML;

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

            refreshIcons();
        };

        // Open Tasks bottom sheet
        const openTasksSheet = () => {
            closeSessionsSheet();
            closeSettingsPanel();
            renderMobileTasksContent();
            tasksSheetOverlay?.classList.add('active');
            tasksBottomSheet?.classList.add('active');
            refreshIcons();
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

            const abDashBtn = document.getElementById('ab-dashboard-btn');
            const isDashboardActive = abDashBtn?.classList.contains('active');
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
        // Bottom nav +New button
        document.getElementById('mobile-new-session-btn')?.addEventListener('click', () => {
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
        // Cache multi-touch state at touchstart to allow passive touchmove
        let isMultiTouching = false;
        document.addEventListener('touchstart', (e) => {
            isMultiTouching = e.touches.length > 1;
            if (isMultiTouching) e.preventDefault();
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (isMultiTouching) e.preventDefault();
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
