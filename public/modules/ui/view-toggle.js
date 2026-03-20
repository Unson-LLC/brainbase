/**
 * Panel toggle buttons (replaces old exclusive view toggle).
 * Each button independently toggles a panel open/closed.
 */
export function renderPanelToggles(container) {
    if (!container) return () => {};

    container.innerHTML = `
        <div class="view-toggle">
            <button class="toggle-option" id="nav-wiki-btn" title="Wiki (Ctrl+Shift+W)">
                <i data-lucide="book-open"></i>
            </button>
            <button class="toggle-option" id="nav-live-feed-btn" title="Live Feed (Ctrl+Shift+F)">
                <i data-lucide="radio"></i>
            </button>
            <button class="toggle-option active" id="nav-sidebar-btn" title="サイドバー (Ctrl+Shift+B)">
                <i data-lucide="panel-right"></i>
            </button>
            <button class="toggle-option" id="nav-dashboard-btn" title="Dashboard (Ctrl+Shift+D)" style="display: none;">
                <i data-lucide="layout-dashboard"></i>
            </button>
        </div>
    `;

    if (window?.lucide?.createIcons) {
        window.lucide.createIcons();
    }

    return () => {
        container.innerHTML = '';
    };
}

// Backward compat alias
export const renderViewToggle = renderPanelToggles;
