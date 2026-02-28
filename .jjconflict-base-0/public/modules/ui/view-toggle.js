export function renderViewToggle(container) {
    if (!container) return () => {};

    container.innerHTML = `
        <div class="view-toggle">
            <button class="toggle-option active" id="nav-console-btn" title="コンソール">
                <i data-lucide="terminal-square"></i>
                <span>Console</span>
            </button>
            <button class="toggle-option" id="nav-dashboard-btn" title="ダッシュボード" style="display: none;">
                <i data-lucide="layout-dashboard"></i>
                <span>Dashboard</span>
            </button>
            <div class="toggle-bg-slider"></div>
        </div>
    `;

    if (window?.lucide?.createIcons) {
        window.lucide.createIcons();
    }

    return () => {
        container.innerHTML = '';
    };
}
