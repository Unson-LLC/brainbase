import { appStore as defaultStore } from '../core/store.js';

export function setupSessionViewToggle({
    root = document,
    store = defaultStore
} = {}) {
    const buttons = root.querySelectorAll('.session-view-btn');
    if (!buttons.length) return () => {};

    const handlers = [];

    const applyActive = (view) => {
        buttons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });
    };

    const setView = (view) => {
        const { ui } = store.getState();
        store.setState({
            ui: {
                ...(ui || {}),
                sessionListView: view
            }
        });
    };

    buttons.forEach(btn => {
        const handler = () => {
            const view = btn.dataset.view;
            if (view) setView(view);
        };
        btn.addEventListener('click', handler);
        handlers.push({ element: btn, handler });
    });

    applyActive(store.getState().ui?.sessionListView || 'project');
    const unsubscribe = store.subscribeToSelector(
        state => state.ui?.sessionListView,
        ({ value }) => applyActive(value || 'project')
    );

    return () => {
        handlers.forEach(({ element, handler }) => {
            element.removeEventListener('click', handler);
        });
        unsubscribe?.();
    };
}
