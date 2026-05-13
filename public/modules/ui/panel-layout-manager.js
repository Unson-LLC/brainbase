import { EVENTS } from '../core/event-bus.js';

const STORAGE_KEY = 'bb-panel-state';

/**
 * Panel layout manager: Console is always visible.
 * - Info Drawer (Commit Tree / Tasks / Wiki / LiveFeed tabs): right slide-in panel
 * - Dashboard: fullscreen overlay
 * - Portal Overlay: fullscreen framework-driven portal
 * - SNS Growth Overlay: Brainbase workspace mode for SNS operations
 */
export function setupPanelLayout({ store, eventBus }) {
    _restoreState(store);

    const getEl = (id) => document.getElementById(id);

    // --- Toggle functions ---

    const toggleInfoDrawer = (tab) => {
        const panels = store.getState().ui.panels;
        const isOpen = panels.infoDrawerOpen;
        const currentTab = panels.infoDrawerTab;

        // If open and clicking the same tab → close. If different tab → switch tab.
        let nextOpen, nextTab;
        if (isOpen && tab && tab === currentTab) {
            nextOpen = false;
            nextTab = currentTab;
        } else {
            nextOpen = true;
            nextTab = tab || currentTab;
        }

        store.setState({
            ui: {
                ...store.getState().ui,
                panels: { ...panels, infoDrawerOpen: nextOpen, infoDrawerTab: nextTab, dashboardOpen: false }
            }
        });
        _applyInfoDrawer(nextOpen, nextTab);
        _applyDashboard(false);
        _persistState(store);
        eventBus.emit(EVENTS.PANEL_TOGGLED, { panel: 'info', open: nextOpen, tab: nextTab });

        // Emit commit-tree toggled event for backward compat
        if (nextTab === 'commit-tree' || currentTab === 'commit-tree') {
            const commitTreeVisible = nextOpen && nextTab === 'commit-tree';
            eventBus.emit(EVENTS.COMMIT_TREE_PANEL_TOGGLED, { collapsed: !commitTreeVisible });
        }
    };

    // Backward compat: toggleContextSidebar now opens/closes the tasks tab
    const toggleContextSidebar = () => toggleInfoDrawer('tasks');

    const toggleDashboard = () => {
        const panels = store.getState().ui.panels;
        const next = !panels.dashboardOpen;
        store.setState({
            ui: { ...store.getState().ui, panels: { ...panels, dashboardOpen: next, infoDrawerOpen: false, portalOverlayOpen: false, snsGrowthOverlayOpen: false } }
        });
        _applyDashboard(next);
        _applyInfoDrawer(false, panels.infoDrawerTab);
        _applyPortalOverlay(false);
        _applySnsGrowthOverlay(false);
        _persistState(store);
        eventBus.emit(EVENTS.PANEL_TOGGLED, { panel: 'dashboard', open: next });
    };

    const setPortalOverlay = (open) => {
        const panels = store.getState().ui.panels;
        const next = Boolean(open);
        if (panels.portalOverlayOpen === next) {
            _applyPortalOverlay(next);
            return;
        }

        store.setState({
            ui: { ...store.getState().ui, panels: { ...panels, portalOverlayOpen: next, snsGrowthOverlayOpen: false, dashboardOpen: false, infoDrawerOpen: false } }
        });
        _applyPortalOverlay(next);
        _applySnsGrowthOverlay(false);
        _applyDashboard(false);
        _applyInfoDrawer(false, panels.infoDrawerTab);
        _persistState(store);

        // Auto-select current session's project when opening
        let autoProject = null;
        if (next) {
            const state = store.getState();
            const currentSession = (state.sessions || []).find(s => s.id === state.currentSessionId);
            autoProject = currentSession?.project || null;
        }
        eventBus.emit(EVENTS.PANEL_TOGGLED, { panel: 'portal-overlay', open: next, autoProject });
    };

    const openPortalOverlay = () => setPortalOverlay(true);
    const closePortalOverlay = () => setPortalOverlay(false);
    const togglePortalOverlay = () => {
        const panels = store.getState().ui.panels;
        setPortalOverlay(!panels.portalOverlayOpen);
    };

    const setSnsGrowthOverlay = (open) => {
        const panels = store.getState().ui.panels;
        const next = Boolean(open);
        if (panels.snsGrowthOverlayOpen === next) {
            _applySnsGrowthOverlay(next);
            return;
        }

        store.setState({
            ui: { ...store.getState().ui, panels: { ...panels, snsGrowthOverlayOpen: next, portalOverlayOpen: false, dashboardOpen: false, infoDrawerOpen: false } }
        });
        _applySnsGrowthOverlay(next);
        _applyPortalOverlay(false);
        _applyDashboard(false);
        _applyInfoDrawer(false, panels.infoDrawerTab);
        _persistState(store);
        eventBus.emit(EVENTS.PANEL_TOGGLED, { panel: 'sns-growth-overlay', open: next });
    };

    const openSnsGrowthOverlay = () => setSnsGrowthOverlay(true);
    const closeSnsGrowthOverlay = () => setSnsGrowthOverlay(false);
    const toggleSnsGrowthOverlay = () => {
        const panels = store.getState().ui.panels;
        setSnsGrowthOverlay(!panels.snsGrowthOverlayOpen);
    };

    const closeAllPanels = () => {
        const panels = store.getState().ui.panels;
        store.setState({
            ui: { ...store.getState().ui, panels: { ...panels, infoDrawerOpen: false, dashboardOpen: false, portalOverlayOpen: false, snsGrowthOverlayOpen: false } }
        });
        _applyInfoDrawer(false, panels.infoDrawerTab);
        _applyDashboard(false);
        _applyPortalOverlay(false);
        _applySnsGrowthOverlay(false);
        _persistState(store);
    };

    // Backward compat aliases
    const toggleWiki = () => toggleInfoDrawer('wiki');
    const toggleLiveFeed = () => toggleInfoDrawer('live-feed');
    const togglePortal = () => togglePortalOverlay();

    // --- Apply DOM state ---

    function _applyInfoDrawer(open, activeTab) {
        const drawer = getEl('info-drawer');
        if (drawer) drawer.classList.toggle('open', open);
        const resizeHandle = getEl('info-drawer-resize-handle');
        if (resizeHandle) {
            resizeHandle.classList.toggle('hidden', !open);
            resizeHandle.setAttribute('aria-hidden', open ? 'false' : 'true');
        }

        // Update tab content visibility
        const tabs = document.querySelectorAll('.info-drawer-tab');
        const contents = document.querySelectorAll('.info-tab-content');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));
        contents.forEach(c => c.classList.toggle('active', c.dataset.tab === activeTab));

        // Update Activity Bar buttons (all tab-based buttons)
        const abWiki = getEl('ab-wiki-btn');
        const abLive = getEl('ab-livefeed-btn');
        const abCommitTree = getEl('ab-commit-tree-btn');
        const abTasks = getEl('ab-tasks-btn');
        const abPortal = getEl('ab-portal-btn');
        const abSnsGrowth = getEl('ab-sns-growth-btn');
        const abSessions = getEl('ab-sessions-btn');

        if (abWiki) abWiki.classList.toggle('active', open && activeTab === 'wiki');
        if (abLive) abLive.classList.toggle('active', open && activeTab === 'live-feed');
        if (abCommitTree) abCommitTree.classList.toggle('active', open && activeTab === 'commit-tree');
        if (abTasks) abTasks.classList.toggle('active', open && activeTab === 'tasks');
        const portalOvOpen = store.getState().ui.panels.portalOverlayOpen;
        const snsGrowthOpen = store.getState().ui.panels.snsGrowthOverlayOpen;
        if (abPortal) abPortal.classList.toggle('active', portalOvOpen || (open && activeTab === 'portal'));
        if (abSnsGrowth) abSnsGrowth.classList.toggle('active', Boolean(snsGrowthOpen));

        // Sessions button is active only when no panel is open
        const dashOpen = store.getState().ui.panels.dashboardOpen;
        if (abSessions) abSessions.classList.toggle('active', !open && !dashOpen && !portalOvOpen && !snsGrowthOpen);
        window.dispatchEvent(new Event('resize'));
    }

    function _applyPortalOverlay(open) {
        const overlay = getEl('portal-overlay');
        if (overlay) overlay.classList.toggle('open', open);

        // Portal is a workspace mode: keep the shared header visible and swap the stage.
        const consoleArea = getEl('console-area');
        if (consoleArea) consoleArea.style.display = 'flex';
        const snsGrowthOpen = store.getState().ui.panels.snsGrowthOverlayOpen;
        const terminalStage = getEl('terminal-stage');
        if (terminalStage) terminalStage.style.display = (open || snsGrowthOpen) ? 'none' : '';

        const abPortal = getEl('ab-portal-btn');
        if (abPortal) abPortal.classList.toggle('active', open);

        const terminalMode = getEl('workspace-mode-terminal');
        const portalMode = getEl('workspace-mode-portal');
        if (terminalMode) {
            terminalMode.classList.toggle('active', !open && !snsGrowthOpen);
            terminalMode.setAttribute('aria-selected', (open || snsGrowthOpen) ? 'false' : 'true');
        }
        if (portalMode) {
            portalMode.classList.toggle('active', open);
            portalMode.setAttribute('aria-selected', open ? 'true' : 'false');
        }
        document.body.classList.toggle('portal-mode-active', open);

        const abSessions = getEl('ab-sessions-btn');
        const infoOpen = store.getState().ui.panels.infoDrawerOpen;
        const dashOpen = store.getState().ui.panels.dashboardOpen;
        if (abSessions) abSessions.classList.toggle('active', !open && !infoOpen && !dashOpen && !snsGrowthOpen);
    }

    function _applySnsGrowthOverlay(open) {
        const overlay = getEl('sns-growth-overlay');
        if (overlay) overlay.classList.toggle('open', open);

        const consoleArea = getEl('console-area');
        if (consoleArea) consoleArea.style.display = 'flex';
        const terminalStage = getEl('terminal-stage');
        const portalOpen = store.getState().ui.panels.portalOverlayOpen;
        if (terminalStage) terminalStage.style.display = (open || portalOpen) ? 'none' : '';

        const abSnsGrowth = getEl('ab-sns-growth-btn');
        if (abSnsGrowth) abSnsGrowth.classList.toggle('active', open);
        const mobileSnsGrowth = getEl('mobile-sns-growth-btn');
        if (mobileSnsGrowth) mobileSnsGrowth.classList.toggle('active', open);

        const terminalMode = getEl('workspace-mode-terminal');
        const portalMode = getEl('workspace-mode-portal');
        if (terminalMode) {
            terminalMode.classList.toggle('active', !open && !portalOpen);
            terminalMode.setAttribute('aria-selected', (open || portalOpen) ? 'false' : 'true');
        }
        if (portalMode) {
            portalMode.classList.toggle('active', portalOpen);
            portalMode.setAttribute('aria-selected', portalOpen ? 'true' : 'false');
        }
        document.body.classList.toggle('sns-growth-mode-active', open);

        const abSessions = getEl('ab-sessions-btn');
        const infoOpen = store.getState().ui.panels.infoDrawerOpen;
        const dashOpen = store.getState().ui.panels.dashboardOpen;
        if (abSessions) abSessions.classList.toggle('active', !open && !portalOpen && !infoOpen && !dashOpen);
    }

    function _applyDashboard(open) {
        const overlay = getEl('dashboard-overlay');
        if (overlay) overlay.classList.toggle('open', open);

        // Update Activity Bar buttons
        const abDash = getEl('ab-dashboard-btn');
        const abSessions = getEl('ab-sessions-btn');
        if (abDash) abDash.classList.toggle('active', open);

        // Sessions button is active only when no panel is open
        const infoOpen = store.getState().ui.panels.infoDrawerOpen;
        const portalOpen = store.getState().ui.panels.portalOverlayOpen;
        const snsGrowthOpen = store.getState().ui.panels.snsGrowthOverlayOpen;
        if (abSessions) abSessions.classList.toggle('active', !open && !infoOpen && !portalOpen && !snsGrowthOpen);
    }

    // --- Info drawer tab clicks ---

    function _onTabClick(e) {
        const tab = e.currentTarget.dataset.tab;
        if (tab) {
            const panels = store.getState().ui.panels;
            store.setState({
                ui: { ...store.getState().ui, panels: { ...panels, infoDrawerTab: tab } }
            });
            _applyInfoDrawer(true, tab);
            _persistState(store);
        }
    }

    const tabButtons = document.querySelectorAll('.info-drawer-tab');
    tabButtons.forEach(btn => btn.addEventListener('click', _onTabClick));

    // --- EventBus: handle commit-tree toggle request ---

    const unsubCommitTreeReq = eventBus.on(EVENTS.COMMIT_TREE_PANEL_TOGGLE_REQUESTED, () => {
        toggleInfoDrawer('commit-tree');
    });

    // --- Keyboard shortcuts ---

    const _onKeydown = (e) => {
        if (e.key === 'Escape') {
            const panels = store.getState().ui.panels;
            if (panels.portalOverlayOpen || panels.dashboardOpen || panels.infoDrawerOpen) {
                e.preventDefault();
                closeAllPanels();
                return;
            }
        }

        if (e.ctrlKey && e.shiftKey) {
            switch (e.key.toUpperCase()) {
                case 'I':
                    e.preventDefault();
                    toggleInfoDrawer('wiki');
                    break;
                case 'B':
                    e.preventDefault();
                    toggleInfoDrawer('tasks');
                    break;
                case 'G':
                    e.preventDefault();
                    toggleInfoDrawer('commit-tree');
                    break;
                case 'D':
                    e.preventDefault();
                    toggleDashboard();
                    break;
                case 'P':
                    e.preventDefault();
                    togglePortalOverlay();
                    break;
            }
        }
    };

    document.addEventListener('keydown', _onKeydown);

    // --- Initial DOM state ---
    const initialPanels = store.getState().ui.panels;
    _applyInfoDrawer(initialPanels.infoDrawerOpen, initialPanels.infoDrawerTab);
    _applyDashboard(initialPanels.dashboardOpen);
    _applyPortalOverlay(initialPanels.portalOverlayOpen || false);
    _applySnsGrowthOverlay(initialPanels.snsGrowthOverlayOpen || false);

    const consoleArea = getEl('console-area');
    if (consoleArea && !initialPanels.portalOverlayOpen && !initialPanels.snsGrowthOverlayOpen) consoleArea.style.display = 'flex';

    // --- Cleanup ---

    const cleanup = () => {
        document.removeEventListener('keydown', _onKeydown);
        tabButtons.forEach(btn => btn.removeEventListener('click', _onTabClick));
        unsubCommitTreeReq();
    };

    return {
        cleanup,
        toggleInfoDrawer,
        toggleWiki,
        toggleLiveFeed,
        togglePortal,
        openPortalOverlay,
        closePortalOverlay,
        togglePortalOverlay,
        openSnsGrowthOverlay,
        closeSnsGrowthOverlay,
        toggleSnsGrowthOverlay,
        toggleContextSidebar,
        toggleDashboard,
        closeAllPanels
    };
}

// --- Persistence helpers ---

function _persistState(store) {
    try {
        const panels = store.getState().ui.panels;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            infoDrawerTab: panels.infoDrawerTab
        }));
    } catch { /* ignore */ }
}

function _restoreState(store) {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved) {
            const ui = store.getState().ui;
            store.setState({
                ui: {
                    ...ui,
                    panels: {
                        ...ui.panels,
                        infoDrawerTab: saved.infoDrawerTab || 'tasks'
                    }
                }
            });
        }
    } catch { /* ignore */ }
}
