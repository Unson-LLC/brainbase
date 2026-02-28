import { appStore as defaultStore } from '../core/store.js';

export function setupSidebarPrimaryToggle({
    root = document,
    store = defaultStore
} = {}) {
    const buttons = root.querySelectorAll('.sidebar-primary-btn');
    if (!buttons.length) return () => {};
    const secondaryToggle = root.querySelector('#session-view-toggle');

    const handlers = [];

    const applyActive = (view) => {
        buttons.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });
        if (secondaryToggle) {
            secondaryToggle.classList.toggle('is-hidden', view !== 'sessions');
        }
    };

    const setView = (view) => {
        const { ui } = store.getState();
        store.setState({
            ui: {
                ...(ui || {}),
                sidebarPrimaryView: view
            }
        });
    };

    buttons.forEach((btn) => {
        const handler = () => {
            const view = btn.dataset.view;
            if (view) setView(view);
        };
        btn.addEventListener('click', handler);
        handlers.push({ element: btn, handler });
    });

    applyActive(store.getState().ui?.sidebarPrimaryView || 'sessions');
    const unsubscribe = store.subscribeToSelector(
        (state) => state.ui?.sidebarPrimaryView,
        ({ value }) => applyActive(value || 'sessions')
    );

    return () => {
        handlers.forEach(({ element, handler }) => {
            element.removeEventListener('click', handler);
        });
        unsubscribe?.();
    };
}
