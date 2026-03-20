import { EVENTS } from '../core/event-bus.js';

const STORAGE_KEY = 'bb-panel-state';

/**
 * Panel layout manager: Console is always visible.
 * Wiki opens as a right drawer, Dashboard as a fullscreen overlay,
 * Context sidebar is collapsible.
 */
export function setupPanelLayout({ store, eventBus }) {
    // Restore persisted state
    _restoreState(store);

    const getEl = (id) => document.getElementById(id);

    // --- Toggle functions ---

    const toggleWiki = () => {
        const panels = store.getState().ui.panels;
        const next = !panels.wikiOpen;
        store.setState({
            ui: { ...store.getState().ui, panels: { ...panels, wikiOpen: next, dashboardOpen: false } }
        });
        _applyWiki(next);
        _applyDashboard(false);
        _persistState(store);
        eventBus.emit(EVENTS.PANEL_TOGGLED, { panel: 'wiki', open: next });
    };

    const toggleContextSidebar = () => {
        const panels = store.getState().ui.panels;
        const next = !panels.contextSidebarCollapsed;
        store.setState({
            ui: { ...store.getState().ui, panels: { ...panels, contextSidebarCollapsed: next } }
        });
        _applyContextSidebar(next);
        _persistState(store);
        eventBus.emit(EVENTS.PANEL_TOGGLED, { panel: 'contextSidebar', collapsed: next });
    };

    const toggleLiveFeed = () => {
        const panels = store.getState().ui.panels;
        const next = !panels.liveFeedOpen;
        store.setState({
            ui: { ...store.getState().ui, panels: { ...panels, liveFeedOpen: next, wikiOpen: false, dashboardOpen: false } }
        });
        _applyLiveFeed(next);
        _applyWiki(false);
        _applyDashboard(false);
        _persistState(store);
        eventBus.emit(EVENTS.PANEL_TOGGLED, { panel: 'liveFeed', open: next });
    };

    const toggleDashboard = () => {
        const panels = store.getState().ui.panels;
        const next = !panels.dashboardOpen;
        store.setState({
            ui: { ...store.getState().ui, panels: { ...panels, dashboardOpen: next, wikiOpen: false, liveFeedOpen: false } }
        });
        _applyDashboard(next);
        _applyWiki(false);
        _applyLiveFeed(false);
        _persistState(store);
        eventBus.emit(EVENTS.PANEL_TOGGLED, { panel: 'dashboard', open: next });
    };

    const closeAllPanels = () => {
        const panels = store.getState().ui.panels;
        store.setState({
            ui: { ...store.getState().ui, panels: { ...panels, wikiOpen: false, liveFeedOpen: false, dashboardOpen: false } }
        });
        _applyWiki(false);
        _applyLiveFeed(false);
        _applyDashboard(false);
        _persistState(store);
    };

    // --- Apply DOM state ---

    function _applyWiki(open) {
        const drawer = getEl('wiki-drawer');
        if (drawer) {
            drawer.classList.toggle('open', open);
        }
        // Update toggle button active state
        const btn = getEl('nav-wiki-btn');
        if (btn) btn.classList.toggle('active', open);
    }

    function _applyContextSidebar(collapsed) {
        const sidebar = getEl('context-sidebar');
        const expandBtn = getEl('context-sidebar-expand-btn');
        const resizeHandle = getEl('right-panel-resize-handle');
        if (sidebar) {
            sidebar.classList.toggle('collapsed', collapsed);
        }
        if (expandBtn) {
            expandBtn.classList.toggle('hidden', !collapsed);
        }
        if (resizeHandle) {
            resizeHandle.style.display = collapsed ? 'none' : '';
        }
        // Update toggle button active state
        const btn = getEl('nav-sidebar-btn');
        if (btn) btn.classList.toggle('active', !collapsed);
    }

    function _applyLiveFeed(open) {
        const drawer = getEl('live-feed-drawer');
        if (drawer) {
            drawer.classList.toggle('open', open);
        }
        const btn = getEl('nav-live-feed-btn');
        if (btn) btn.classList.toggle('active', open);
    }

    function _applyDashboard(open) {
        const overlay = getEl('dashboard-overlay');
        if (overlay) {
            overlay.classList.toggle('open', open);
        }
        // Update toggle button active state
        const btn = getEl('nav-dashboard-btn');
        if (btn) btn.classList.toggle('active', open);
    }

    // --- Keyboard shortcuts ---

    const _onKeydown = (e) => {
        // Escape: close any open panel
        if (e.key === 'Escape') {
            const panels = store.getState().ui.panels;
            if (panels.dashboardOpen || panels.wikiOpen || panels.liveFeedOpen) {
                e.preventDefault();
                closeAllPanels();
                return;
            }
        }

        // Ctrl+Shift combos
        if (e.ctrlKey && e.shiftKey) {
            switch (e.key.toUpperCase()) {
                case 'W':
                    e.preventDefault();
                    toggleWiki();
                    break;
                case 'F':
                    e.preventDefault();
                    toggleLiveFeed();
                    break;
                case 'B':
                    e.preventDefault();
                    toggleContextSidebar();
                    break;
                case 'D':
                    e.preventDefault();
                    toggleDashboard();
                    break;
            }
        }
    };

    document.addEventListener('keydown', _onKeydown);

    // --- Initial DOM state ---
    const initialPanels = store.getState().ui.panels;
    _applyWiki(initialPanels.wikiOpen);
    _applyLiveFeed(initialPanels.liveFeedOpen);
    _applyContextSidebar(initialPanels.contextSidebarCollapsed);
    _applyDashboard(initialPanels.dashboardOpen);

    // Console area always visible
    const consoleArea = getEl('console-area');
    if (consoleArea) consoleArea.style.display = 'flex';

    // --- Cleanup ---

    const cleanup = () => {
        document.removeEventListener('keydown', _onKeydown);
    };

    return { cleanup, toggleWiki, toggleLiveFeed, toggleContextSidebar, toggleDashboard, closeAllPanels };
}

// --- Persistence helpers ---

function _persistState(store) {
    try {
        const panels = store.getState().ui.panels;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            contextSidebarCollapsed: panels.contextSidebarCollapsed
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
                        contextSidebarCollapsed: !!saved.contextSidebarCollapsed
                    }
                }
            });
        }
    } catch { /* ignore */ }
}
