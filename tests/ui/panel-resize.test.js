import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initPanelResize } from '../../public/modules/ui/panel-resize.js';

describe('initPanelResize', () => {
    beforeEach(() => {
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

    it('保存済みの右パネル幅を初期化時に復元する', () => {
        localStorage.setItem('brainbase:right-panel-width', '620');

        const cleanup = initPanelResize();

        const drawer = document.getElementById('info-drawer');
        expect(drawer.style.width).toBe('620px');
        expect(drawer.style.getPropertyValue('--info-drawer-width')).toBe('620px');

        cleanup();
    });
});
