/**
 * Backward-compatible wrapper for view navigation.
 * Delegates to panel-layout-manager internally.
 */
export function setupViewNavigation({
    root = document,
    onDashboardActivated,
    onWikiActivated,
    onLiveFeedActivated
} = {}) {
    const getById = (id) => (root.getElementById ? root.getElementById(id) : root.querySelector(`#${id}`));

    const consoleArea = getById('console-area');
    const fileViewerPanel = getById('file-viewer-panel');

    if (consoleArea) consoleArea.style.display = 'flex';

    const hideTransientPanels = () => {
        const dashOverlay = getById('dashboard-overlay');
        if (dashOverlay) dashOverlay.classList.remove('open');
        if (fileViewerPanel) fileViewerPanel.style.display = 'none';
        if (consoleArea) consoleArea.style.display = 'flex';
    };

    const showConsole = () => {
        hideTransientPanels();
        const frame = getById('terminal-frame');
        if (frame) {
            frame.focus?.();
            frame.contentWindow?.focus?.();
            frame.contentWindow?.postMessage?.({ type: 'bb-terminal-focus' }, window.location.origin);
        }
    };

    const showDashboard = () => {
        const dashOverlay = getById('dashboard-overlay');
        if (dashOverlay) dashOverlay.classList.add('open');
        onDashboardActivated?.();
        window.dispatchEvent(new Event('resize'));
    };

    const showFileViewer = () => {
        if (fileViewerPanel) fileViewerPanel.style.display = 'block';
    };

    const showWiki = () => {
        const infoDrawer = getById('info-drawer');
        if (infoDrawer) infoDrawer.classList.toggle('open');
        // Activate wiki tab
        const tabs = document.querySelectorAll('.info-drawer-tab');
        const contents = document.querySelectorAll('.info-tab-content');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'wiki'));
        contents.forEach(c => c.classList.toggle('active', c.dataset.tab === 'wiki'));
        onWikiActivated?.();
    };

    const showLiveFeed = () => {
        const infoDrawer = getById('info-drawer');
        if (infoDrawer) infoDrawer.classList.toggle('open');
        // Activate live-feed tab
        const tabs = document.querySelectorAll('.info-drawer-tab');
        const contents = document.querySelectorAll('.info-tab-content');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'live-feed'));
        contents.forEach(c => c.classList.toggle('active', c.dataset.tab === 'live-feed'));
        onLiveFeedActivated?.();
    };

    const cleanup = () => {};

    return { cleanup, showConsole, showDashboard, showFileViewer, showWiki, showLiveFeed };
}
