/**
 * Backward-compatible wrapper for view navigation.
 * Delegates to panel-layout-manager internally.
 */
export function setupViewNavigation({
    root = document,
    onDashboardActivated,
    onConsoleActivated,
    onWikiActivated,
    onLiveFeedActivated
} = {}) {
    const getById = (id) => (root.getElementById ? root.getElementById(id) : root.querySelector(`#${id}`));
    const scheduleAfterNextPaint = (callback) => {
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => window.requestAnimationFrame(callback));
            return;
        }
        window.setTimeout(callback, 0);
    };

    const consoleArea = getById('console-area');
    const fileViewerPanel = getById('file-viewer-panel');
    const documentBody = root.body ?? document.body;

    if (consoleArea) consoleArea.style.display = 'flex';

    const hideTransientPanels = () => {
        const dashOverlay = getById('dashboard-overlay');
        if (dashOverlay) dashOverlay.classList.remove('open');
        documentBody?.classList.remove('file-viewer-active');
        if (fileViewerPanel) fileViewerPanel.style.display = 'none';
        if (consoleArea) consoleArea.style.display = 'flex';
    };

    const showConsole = () => {
        hideTransientPanels();
        // xterm.jsのfit()がコンテナサイズを正しく計算できるよう、
        // レイアウト完了後にresizeイベントを発火する。
        // これがないとファイルビューアから戻った時にターミナルが細く表示される。
        scheduleAfterNextPaint(() => {
            window.dispatchEvent(new Event('resize'));
            onConsoleActivated?.();
        });
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
        documentBody?.classList.add('file-viewer-active');
        if (consoleArea) consoleArea.style.display = 'none';
        if (fileViewerPanel) fileViewerPanel.style.display = 'flex';
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
