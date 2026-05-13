import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupPanelLayout } from '../../public/modules/ui/panel-layout-manager.js';

describe('setupPanelLayout', () => {
    let state;
    let store;
    let eventBus;

    beforeEach(() => {
        const storage = new Map();
        vi.stubGlobal('localStorage', {
            clear: vi.fn(() => storage.clear()),
            getItem: vi.fn((key) => storage.get(key) ?? null),
            setItem: vi.fn((key, value) => storage.set(key, String(value))),
            removeItem: vi.fn((key) => storage.delete(key))
        });
        localStorage.clear();
        document.body.innerHTML = `
            <div id="console-area">
                <button id="workspace-mode-terminal" class="workspace-mode-btn active" aria-selected="true"></button>
            <button id="workspace-mode-portal" class="workspace-mode-btn" aria-selected="false"></button>
            <div id="terminal-stage"></div>
            <div id="portal-overlay"></div>
            <div id="sns-growth-overlay"></div>
            </div>
            <div id="info-drawer-resize-handle" class="panel-resize-handle hidden" aria-hidden="true"></div>
            <button id="ab-sessions-btn"></button>
            <button id="ab-portal-btn"></button>
            <button id="ab-sns-growth-btn"></button>
            <button id="ab-tasks-btn"></button>
            <aside id="info-drawer"></aside>
            <button class="info-drawer-tab" data-tab="tasks"></button>
            <div class="info-tab-content" data-tab="tasks"></div>
        `;
        document.body.className = '';
        state = {
            sessions: [{ id: 'session-1', project: 'brainbase' }],
            currentSessionId: 'session-1',
            ui: {
                panels: {
                    infoDrawerOpen: false,
                    infoDrawerTab: 'tasks',
                    dashboardOpen: false,
                    portalOverlayOpen: false,
                    snsGrowthOverlayOpen: false
                }
            }
        };
        store = {
            getState: vi.fn(() => state),
            setState: vi.fn((nextState) => {
                state = { ...state, ...nextState };
            })
        };
        eventBus = {
            emit: vi.fn(),
            on: vi.fn(() => vi.fn())
        };
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('openPortalOverlay呼び出し時_ヘッダーを残してPortalを作業モードとして表示する', () => {
        const layout = setupPanelLayout({ store, eventBus });

        layout.openPortalOverlay();

        expect(document.getElementById('console-area')?.style.display).toBe('flex');
        expect(document.getElementById('terminal-stage')?.style.display).toBe('none');
        expect(document.getElementById('portal-overlay')?.classList.contains('open')).toBe(true);
        expect(document.getElementById('workspace-mode-terminal')?.getAttribute('aria-selected')).toBe('false');
        expect(document.getElementById('workspace-mode-portal')?.getAttribute('aria-selected')).toBe('true');
        expect(document.body.classList.contains('portal-mode-active')).toBe(true);
        expect(eventBus.emit).toHaveBeenCalledWith(expect.any(String), {
            panel: 'portal-overlay',
            open: true,
            autoProject: 'brainbase'
        });

        layout.cleanup();
    });

    it('closePortalOverlay呼び出し時_Terminalモードに戻る', () => {
        const layout = setupPanelLayout({ store, eventBus });

        layout.openPortalOverlay();
        layout.closePortalOverlay();

        expect(document.getElementById('terminal-stage')?.style.display).toBe('');
        expect(document.getElementById('portal-overlay')?.classList.contains('open')).toBe(false);
        expect(document.getElementById('workspace-mode-terminal')?.getAttribute('aria-selected')).toBe('true');
        expect(document.getElementById('workspace-mode-portal')?.getAttribute('aria-selected')).toBe('false');
        expect(document.body.classList.contains('portal-mode-active')).toBe(false);

        layout.cleanup();
    });

    it('toggleInfoDrawer呼び出し時_右パネルのリサイズハンドルを表示する', () => {
        const resizeEvent = vi.fn();
        window.addEventListener('resize', resizeEvent);
        const layout = setupPanelLayout({ store, eventBus });

        layout.toggleInfoDrawer('tasks');

        expect(document.getElementById('info-drawer-resize-handle')?.classList.contains('hidden')).toBe(false);
        expect(document.getElementById('info-drawer-resize-handle')?.getAttribute('aria-hidden')).toBe('false');
        expect(resizeEvent).toHaveBeenCalled();

        layout.closeAllPanels();

        expect(document.getElementById('info-drawer-resize-handle')?.classList.contains('hidden')).toBe(true);
        expect(document.getElementById('info-drawer-resize-handle')?.getAttribute('aria-hidden')).toBe('true');
        expect(resizeEvent.mock.calls.length).toBeGreaterThanOrEqual(2);

        layout.cleanup();
        window.removeEventListener('resize', resizeEvent);
    });

    it('openSnsGrowthOverlay呼び出し時_ページ遷移ではなくBrainbase作業モードとして表示する', () => {
        const layout = setupPanelLayout({ store, eventBus });

        layout.openSnsGrowthOverlay();

        expect(document.getElementById('console-area')?.style.display).toBe('flex');
        expect(document.getElementById('terminal-stage')?.style.display).toBe('none');
        expect(document.getElementById('sns-growth-overlay')?.classList.contains('open')).toBe(true);
        expect(document.getElementById('portal-overlay')?.classList.contains('open')).toBe(false);
        expect(document.getElementById('ab-sns-growth-btn')?.classList.contains('active')).toBe(true);
        expect(document.getElementById('ab-sessions-btn')?.classList.contains('active')).toBe(false);
        expect(document.body.classList.contains('sns-growth-mode-active')).toBe(true);

        layout.closeAllPanels();

        expect(document.getElementById('terminal-stage')?.style.display).toBe('');
        expect(document.getElementById('sns-growth-overlay')?.classList.contains('open')).toBe(false);
        expect(document.getElementById('ab-sns-growth-btn')?.classList.contains('active')).toBe(false);
        expect(document.getElementById('ab-sessions-btn')?.classList.contains('active')).toBe(true);
        expect(document.body.classList.contains('sns-growth-mode-active')).toBe(false);

        layout.cleanup();
    });
});
