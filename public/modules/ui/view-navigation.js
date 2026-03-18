export function setupViewNavigation({
    root = document,
    onDashboardActivated,
    onWikiActivated,
    onLiveFeedActivated
} = {}) {
    const getById = (id) => (root.getElementById ? root.getElementById(id) : root.querySelector(`#${id}`));

    const consoleBtn = getById('nav-console-btn');
    const dashboardBtn = getById('nav-dashboard-btn');
    const wikiBtn = getById('nav-wiki-btn');
    const liveFeedBtn = getById('nav-live-feed-btn');
    const toggleContainer = root.querySelector?.('.view-toggle') ?? document.querySelector('.view-toggle');
    const consoleArea = getById('console-area');
    const dashboardPanel = getById('dashboard-panel');
    const fileViewerPanel = getById('file-viewer-panel');
    const wikiPanel = getById('wiki-panel');
    const liveFeedPanel = getById('live-feed-panel');

    const allBtns = [consoleBtn, dashboardBtn, wikiBtn, liveFeedBtn].filter(Boolean);

    const deactivateAll = () => {
        allBtns.forEach(btn => btn.classList.remove('active'));
        toggleContainer?.classList.remove('dashboard-active');
        toggleContainer?.classList.remove('wiki-active');
        toggleContainer?.classList.remove('live-feed-active');
    };

    const hideAllPanels = () => {
        if (consoleArea) consoleArea.style.display = 'none';
        if (dashboardPanel) dashboardPanel.style.display = 'none';
        if (fileViewerPanel) fileViewerPanel.style.display = 'none';
        if (wikiPanel) wikiPanel.style.display = 'none';
        if (liveFeedPanel) liveFeedPanel.style.display = 'none';
    };

    const showConsole = () => {
        deactivateAll();
        consoleBtn?.classList.add('active');

        hideAllPanels();
        if (consoleArea) consoleArea.style.display = 'flex';

        const frame = getById('terminal-frame');
        if (frame) {
            // Focus iframe + xterm inside ttyd (best-effort, same-origin)
            frame.focus?.();
            frame.contentWindow?.focus?.();
            frame.contentWindow?.postMessage?.({ type: 'bb-terminal-focus' }, window.location.origin);
        }
    };

    const showDashboard = () => {
        deactivateAll();
        dashboardBtn?.classList.add('active');
        toggleContainer?.classList.add('dashboard-active');

        hideAllPanels();
        if (dashboardPanel) dashboardPanel.style.display = 'block';

        onDashboardActivated?.();
        window.dispatchEvent(new Event('resize'));
    };

    const showFileViewer = () => {
        deactivateAll();

        hideAllPanels();
        if (fileViewerPanel) fileViewerPanel.style.display = 'block';
    };

    const showWiki = () => {
        deactivateAll();
        wikiBtn?.classList.add('active');
        toggleContainer?.classList.add('wiki-active');

        hideAllPanels();
        if (wikiPanel) wikiPanel.style.display = 'block';

        onWikiActivated?.();
    };

    const showLiveFeed = () => {
        deactivateAll();
        liveFeedBtn?.classList.add('active');
        toggleContainer?.classList.add('live-feed-active');

        hideAllPanels();
        if (liveFeedPanel) liveFeedPanel.style.display = 'flex';

        onLiveFeedActivated?.();
    };

    if (consoleBtn) consoleBtn.addEventListener('click', showConsole);
    if (dashboardBtn) dashboardBtn.addEventListener('click', showDashboard);
    if (wikiBtn) wikiBtn.addEventListener('click', showWiki);
    if (liveFeedBtn) liveFeedBtn.addEventListener('click', showLiveFeed);

    const cleanup = () => {
        if (consoleBtn) consoleBtn.removeEventListener('click', showConsole);
        if (dashboardBtn) dashboardBtn.removeEventListener('click', showDashboard);
        if (wikiBtn) wikiBtn.removeEventListener('click', showWiki);
        if (liveFeedBtn) liveFeedBtn.removeEventListener('click', showLiveFeed);
    };

    return { cleanup, showConsole, showDashboard, showFileViewer, showWiki, showLiveFeed };
}
