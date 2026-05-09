import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initPanelResize } from '../../public/modules/ui/panel-resize.js';

describe('initPanelResize', () => {
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
            <div id="left-panel-resize-handle"></div>
            <aside id="sidebar" style="width: 280px"></aside>
            <div id="info-drawer-resize-handle"></div>
            <aside id="info-drawer" style="width: 524px"></aside>
        `;
        window.requestAnimationFrame = (callback) => {
            callback();
            return 1;
        };
        window.cancelAnimationFrame = vi.fn();

        const drawer = document.getElementById('info-drawer');
        Object.defineProperty(drawer, 'offsetWidth', {
            configurable: true,
            get() {
                return Number.parseInt(drawer.style.width || '524', 10);
            }
        });
        const sidebar = document.getElementById('sidebar');
        Object.defineProperty(sidebar, 'offsetWidth', {
            configurable: true,
            get() {
                return Number.parseInt(sidebar.style.width || '280', 10);
            }
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('右パネル境界を左へドラッグ時_InfoDrawer幅を広げて保存する', () => {
        const resizeEvent = vi.fn();
        window.addEventListener('resize', resizeEvent);
        const cleanup = initPanelResize();

        const handle = document.getElementById('info-drawer-resize-handle');
        const drawer = document.getElementById('info-drawer');

        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 900, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 780, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        expect(drawer.style.width).toBe('644px');
        expect(drawer.style.getPropertyValue('--info-drawer-width')).toBe('644px');
        expect(localStorage.getItem('brainbase:right-panel-width')).toBe('644');
        expect(resizeEvent).toHaveBeenCalled();

        cleanup();
        window.removeEventListener('resize', resizeEvent);
    });

    it('左パネル境界を右へドラッグ時_Console幅同期用resizeを発火する', () => {
        const resizeEvent = vi.fn();
        window.addEventListener('resize', resizeEvent);
        const cleanup = initPanelResize();

        const handle = document.getElementById('left-panel-resize-handle');
        const sidebar = document.getElementById('sidebar');

        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 280, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 330, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        expect(sidebar.style.width).toBe('330px');
        expect(localStorage.getItem('brainbase:left-panel-width')).toBe('330');
        expect(resizeEvent).toHaveBeenCalled();

        cleanup();
        window.removeEventListener('resize', resizeEvent);
    });

    it('保存済みの右パネル幅を初期化時に復元する', () => {
        localStorage.setItem('brainbase:right-panel-width', '620');

        const cleanup = initPanelResize();

        const drawer = document.getElementById('info-drawer');
        expect(drawer.style.width).toBe('620px');
        expect(drawer.style.getPropertyValue('--info-drawer-width')).toBe('620px');

        cleanup();
    });
});
