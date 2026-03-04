import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupSidebarPrimaryToggle } from '../../public/modules/ui/sidebar-primary-toggle.js';

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

describe('setupSidebarPrimaryToggle', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="sidebar-primary-toggle">
                <button class="sidebar-primary-btn" data-view="sessions">sessions</button>
                <button class="sidebar-primary-btn" data-view="folders">folders</button>
            </div>
            <div id="session-view-toggle"></div>
        `;
    });

    it('初期表示時_storeの値に応じてactiveが設定される', () => {
        const store = createStore({ ui: { sidebarPrimaryView: 'folders' } });

        setupSidebarPrimaryToggle({ store });

        expect(document.querySelector('[data-view="folders"]').classList.contains('active')).toBe(true);
        expect(document.querySelector('#session-view-toggle').classList.contains('is-hidden')).toBe(true);
    });

    it('クリック時_store更新とactive切替が行われる', () => {
        const store = createStore({ ui: { sidebarPrimaryView: 'sessions' } });

        setupSidebarPrimaryToggle({ store });
        document.querySelector('[data-view="folders"]').click();

        expect(store.getState().ui.sidebarPrimaryView).toBe('folders');
        expect(store.setState).toHaveBeenCalled();
        expect(document.querySelector('[data-view="folders"]').classList.contains('active')).toBe(true);
        expect(document.querySelector('#session-view-toggle').classList.contains('is-hidden')).toBe(true);
    });

    it('cleanup後はクリックしてもstore更新されない', () => {
        const store = createStore({ ui: { sidebarPrimaryView: 'sessions' } });
        const cleanup = setupSidebarPrimaryToggle({ store });

        cleanup();
        document.querySelector('[data-view="folders"]').click();

        expect(store.setState).not.toHaveBeenCalled();
    });
});
