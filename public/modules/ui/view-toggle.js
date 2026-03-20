/**
 * Panel toggle buttons.
 * - Info drawer (Wiki + LiveFeed tabs): right drawer
 * - Dashboard: fullscreen overlay (visually distinct)
 */
export function renderPanelToggles(container) {
    if (!container) return () => {};

    container.innerHTML = `
        <div class="view-toggle">
            <button class="toggle-option" id="nav-info-btn" title="Info (Ctrl+Shift+I)">
                <i data-lucide="book-open"></i>
            </button>
            <button class="toggle-option toggle-option-dashboard" id="nav-dashboard-btn" title="Dashboard (Ctrl+Shift+D)" style="display: none;">
                <i data-lucide="layout-dashboard"></i>
                <span class="toggle-label">Dashboard</span>
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
