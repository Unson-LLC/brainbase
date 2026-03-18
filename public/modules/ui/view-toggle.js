export function renderViewToggle(container) {
    if (!container) return () => {};

    container.innerHTML = `
        <div class="view-toggle">
            <button class="toggle-option active" id="nav-console-btn" title="Console">
                <i data-lucide="terminal-square"></i>
            </button>
            <button class="toggle-option" id="nav-wiki-btn" title="Wiki">
                <i data-lucide="book-open"></i>
            </button>
            <button class="toggle-option" id="nav-live-feed-btn" title="Live Feed">
                <i data-lucide="radio"></i>
            </button>
            <button class="toggle-option" id="nav-dashboard-btn" title="Dashboard" style="display: none;">
                <i data-lucide="layout-dashboard"></i>
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
