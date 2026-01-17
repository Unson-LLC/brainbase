export function setupViewNavigation({
    root = document,
    onDashboardActivated
} = {}) {
    const getById = (id) => (root.getElementById ? root.getElementById(id) : root.querySelector(`#${id}`));

    const consoleBtn = getById('nav-console-btn');
    const dashboardBtn = getById('nav-dashboard-btn');
    const toggleContainer = root.querySelector?.('.view-toggle') ?? document.querySelector('.view-toggle');
    const consoleArea = getById('console-area');
    const dashboardPanel = getById('dashboard-panel');

    const showConsole = () => {
        consoleBtn?.classList.add('active');
        dashboardBtn?.classList.remove('active');
        toggleContainer?.classList.remove('dashboard-active');

        if (consoleArea) consoleArea.style.display = 'flex';
        if (dashboardPanel) dashboardPanel.style.display = 'none';

        const frame = getById('terminal-frame');
        if (frame?.contentWindow?.focus) {
            frame.contentWindow.focus();
        }
    };

    const showDashboard = () => {
        dashboardBtn?.classList.add('active');
        consoleBtn?.classList.remove('active');
        toggleContainer?.classList.add('dashboard-active');

        if (consoleArea) consoleArea.style.display = 'none';
        if (dashboardPanel) dashboardPanel.style.display = 'block';

        onDashboardActivated?.();
        window.dispatchEvent(new Event('resize'));
    };

    if (consoleBtn && dashboardBtn) {
        consoleBtn.addEventListener('click', showConsole);
        dashboardBtn.addEventListener('click', showDashboard);
    }

    const cleanup = () => {
        if (consoleBtn) {
            consoleBtn.removeEventListener('click', showConsole);
        }
        if (dashboardBtn) {
            dashboardBtn.removeEventListener('click', showDashboard);
        }
    };

    return { cleanup, showConsole, showDashboard };
}
