import { eventBus as defaultEventBus, EVENTS as defaultEvents } from '../core/event-bus.js';

export function setupTaskTabs({
    root = document,
    eventBus = defaultEventBus,
    events = defaultEvents,
    onTabActivated,
    lucide
} = {}) {
    const tabButtons = root.querySelectorAll('.task-tab');
    const tabContents = root.querySelectorAll('.task-tab-content');
    const handlers = [];

    const refreshIcons = () => {
        if (lucide?.createIcons) {
            lucide.createIcons();
            return;
        }
        if (window?.lucide?.createIcons) {
            window.lucide.createIcons();
        }
    };

    tabButtons.forEach(btn => {
        const handler = () => {
            const targetTab = btn.dataset.tab;
            if (!targetTab) return;

            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            tabContents.forEach(content => {
                content.classList.toggle('active', content.id === `${targetTab}-tasks-panel`);
            });

            eventBus?.emit?.(events.TASK_TAB_CHANGED, { tab: targetTab });

            if (targetTab === 'nocodb' && onTabActivated) {
                onTabActivated(targetTab);
            }

            refreshIcons();
        };

        btn.addEventListener('click', handler);
        handlers.push({ element: btn, handler });
    });

    return () => {
        handlers.forEach(({ element, handler }) => {
            element.removeEventListener('click', handler);
        });
    };
}
