import { appStore } from '../core/store.js';
import { httpClient } from '../core/http-client.js';
import { eventBus, EVENTS } from '../core/event-bus.js';
import { TimelineView } from '../ui/views/timeline-view.js';
import { NextTasksView } from '../ui/views/next-tasks-view.js';
import { InboxView } from '../ui/views/inbox-view.js';
import { NocoDBTasksView } from '../ui/views/nocodb-tasks-view.js';
import { setupNocoDBFilters } from '../ui/nocodb-filters.js';
import { setupTaskTabs } from '../ui/task-tabs.js';
import { setupViewNavigation } from '../ui/view-navigation.js';
import { renderPanelToggles } from '../ui/view-toggle.js';
import { setupPanelLayout } from '../ui/panel-layout-manager.js';
import { initTimelineResize } from '../ui/timeline-resize.js';

export function applyPluginRegistrationMixin(AppClass) {
    AppClass.prototype._registerUIPlugins = function() {
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
                        const abPortalBtn = document.getElementById('ab-portal-btn');
                        const abSnsGrowthBtn = document.getElementById('ab-sns-growth-btn');
                        const workspaceModeTerminalBtn = document.getElementById('workspace-mode-terminal');
                        const workspaceModePortalBtn = document.getElementById('workspace-mode-portal');
                        const portalBackTerminalBtn = document.getElementById('portal-back-terminal');

                        const onSessionsClick = () => panelLayout.closeAllPanels();
                        const onDashboardClick = () => panelLayout.toggleDashboard();
                        const onWikiClick = () => panelLayout.toggleInfoDrawer('wiki');
                        const onLivefeedClick = () => panelLayout.toggleInfoDrawer('live-feed');
                        const onCommitTreeClick = () => panelLayout.toggleInfoDrawer('commit-tree');
                        const onTasksClick = () => panelLayout.toggleInfoDrawer('tasks');
                        const onPortalClick = () => panelLayout.openPortalOverlay();
                        const onSnsGrowthClick = () => {
                            window.location.href = '/sns-growth.html';
                        };
                        const onTerminalModeClick = () => panelLayout.closePortalOverlay();
                        const onPortalModeClick = () => panelLayout.openPortalOverlay();

                        if (abSessionsBtn) abSessionsBtn.addEventListener('click', onSessionsClick);
                        if (abDashboardBtn) abDashboardBtn.addEventListener('click', onDashboardClick);
                        if (abWikiBtn) abWikiBtn.addEventListener('click', onWikiClick);
                        if (abLivefeedBtn) abLivefeedBtn.addEventListener('click', onLivefeedClick);
                        if (abCommitTreeBtn) abCommitTreeBtn.addEventListener('click', onCommitTreeClick);
                        if (abTasksBtn) abTasksBtn.addEventListener('click', onTasksClick);
                        if (abPortalBtn) abPortalBtn.addEventListener('click', onPortalClick);
                        if (abSnsGrowthBtn) abSnsGrowthBtn.addEventListener('click', onSnsGrowthClick);
                        if (workspaceModeTerminalBtn) workspaceModeTerminalBtn.addEventListener('click', onTerminalModeClick);
                        if (workspaceModePortalBtn) workspaceModePortalBtn.addEventListener('click', onPortalModeClick);
                        if (portalBackTerminalBtn) portalBackTerminalBtn.addEventListener('click', onTerminalModeClick);

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
                            if (abPortalBtn) abPortalBtn.removeEventListener('click', onPortalClick);
                            if (abSnsGrowthBtn) abSnsGrowthBtn.removeEventListener('click', onSnsGrowthClick);
                            if (workspaceModeTerminalBtn) workspaceModeTerminalBtn.removeEventListener('click', onTerminalModeClick);
                            if (workspaceModePortalBtn) workspaceModePortalBtn.removeEventListener('click', onPortalModeClick);
                            if (portalBackTerminalBtn) portalBackTerminalBtn.removeEventListener('click', onTerminalModeClick);
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
                            onConsoleActivated: () => {
                                this._restoreTerminalSurfaceAfterReveal?.('show-console');
                                window.setTimeout(() => {
                                    this._restoreTerminalSurfaceAfterReveal?.('show-console:delayed');
                                }, 120);
                            },
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
                        const unsubFileClose = eventBus.on(EVENTS.FILE_VIEWER_CLOSED, (event) => {
                            const state = appStore.getState();
                            const currentSessionId = state.currentSessionId || null;
                            const closedSessionId = event.detail?.sessionId || null;
                            const targetSessionId = closedSessionId || currentSessionId;
                            const folderTree = state.folderTree || {};
                            const activeFileBySessionId = {
                                ...(folderTree.activeFileBySessionId || {})
                            };
                            const rootOverrideBySessionId = {
                                ...(folderTree.rootOverrideBySessionId || {})
                            };
                            if (targetSessionId) {
                                delete activeFileBySessionId[targetSessionId];
                                delete rootOverrideBySessionId[targetSessionId];
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
                            void (async () => {
                                if (targetSessionId && targetSessionId !== currentSessionId) {
                                    await this.switchSession?.(targetSessionId);
                                }
                                if (this.isMobile() && this.mobileTabController) {
                                    this.mobileTabController.switchTab('terminal');
                                } else {
                                    this.showConsole?.();
                                }
                                this._scheduleTerminalViewportSync();
                            })();
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
                            if (abDashboardBtn) {
                                abDashboardBtn.style.display = 'none';
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
    };
}
