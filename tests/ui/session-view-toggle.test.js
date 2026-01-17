import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupSessionViewToggle } from '../../public/modules/ui/session-view-toggle.js';

const createStore = (initialState = {}) => {
    let state = { ...initialState };
    const listeners = new Set();

    const store = {
        getState: () => state,
        setState: vi.fn((next) => {
            state = {
                ...state,
                ...next,
                ui: {
                    ...(state.ui || {}),
                    ...(next.ui || {})
                }
            };
            listeners.forEach((listener) => listener());
        }),
        subscribeToSelector: (selector, callback) => {
            const handler = () => callback({ value: selector(state) });
            listeners.add(handler);
            return () => listeners.delete(handler);
        }
    };

    return store;
};

describe('setupSessionViewToggle', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <button class="session-view-btn" data-view="project">project</button>
            <button class="session-view-btn" data-view="list">list</button>
        `;
    });

    it('初期表示時_storeの値に応じてactiveが設定される', () => {
        const store = createStore({ ui: { sessionListView: 'list' } });

        setupSessionViewToggle({ store });

        expect(document.querySelector('[data-view="list"]').classList.contains('active')).toBe(true);
        expect(document.querySelector('[data-view="project"]').classList.contains('active')).toBe(false);
    });

    it('クリック時_store更新とactive切替が行われる', () => {
        const store = createStore({ ui: { sessionListView: 'project' } });

        setupSessionViewToggle({ store });

        document.querySelector('[data-view="list"]').click();

        expect(store.getState().ui.sessionListView).toBe('list');
        expect(store.setState).toHaveBeenCalled();
        expect(document.querySelector('[data-view="list"]').classList.contains('active')).toBe(true);
        expect(document.querySelector('[data-view="project"]').classList.contains('active')).toBe(false);
    });

    it('cleanup後はクリックしてもstore更新されない', () => {
        const store = createStore({ ui: { sessionListView: 'project' } });
        const cleanup = setupSessionViewToggle({ store });

        cleanup();
        document.querySelector('[data-view="list"]').click();

        expect(store.setState).not.toHaveBeenCalled();
    });
});
