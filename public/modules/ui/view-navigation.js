/**
 * Backward-compatible wrapper for view navigation.
 * Delegates to panel-layout-manager internally.
 * Existing callers (app.js bb-dashboard plugin) continue to work.
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
    const liveFeedPanel = getById('live-feed-panel');

    // Ensure console is always visible
    if (consoleArea) consoleArea.style.display = 'flex';

    const hideAllPanels = () => {
        // Close wiki drawer
        const wikiDrawer = getById('wiki-drawer');
        if (wikiDrawer) wikiDrawer.classList.remove('open');
        // Close dashboard overlay
        const dashOverlay = getById('dashboard-overlay');
        if (dashOverlay) dashOverlay.classList.remove('open');
        // Hide file viewer
        if (fileViewerPanel) fileViewerPanel.style.display = 'none';
        // Hide live feed
        if (liveFeedPanel) liveFeedPanel.style.display = 'none';
        // Ensure console visible
        if (consoleArea) consoleArea.style.display = 'flex';
    };

    const showConsole = () => {
        hideAllPanels();
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
        const wikiDrawer = getById('wiki-drawer');
        if (wikiDrawer) wikiDrawer.classList.toggle('open');
        onWikiActivated?.();
    };

    const showLiveFeed = () => {
        hideAllPanels();
        if (liveFeedPanel) liveFeedPanel.style.display = 'flex';
        onLiveFeedActivated?.();
    };

    const cleanup = () => {};

    return { cleanup, showConsole, showDashboard, showFileViewer, showWiki, showLiveFeed };
}
