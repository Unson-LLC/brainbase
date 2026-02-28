import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupViewNavigation } from '../../public/modules/ui/view-navigation.js';

describe('setupViewNavigation', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div class="view-toggle"></div>
            <button id="nav-console-btn">console</button>
            <button id="nav-dashboard-btn">dashboard</button>
            <div id="console-area" style="display:flex"></div>
            <div id="dashboard-panel" style="display:none"></div>
            <iframe id="terminal-frame"></iframe>
        `;

        const frame = document.getElementById('terminal-frame');
        Object.defineProperty(frame, 'contentWindow', {
            value: { focus: vi.fn() },
            configurable: true
        });
    });

    it('dashboardクリック時_ビュー表示とイベントが更新される', () => {
        const onDashboardActivated = vi.fn();
        const resizeSpy = vi.spyOn(window, 'dispatchEvent');

        setupViewNavigation({ onDashboardActivated });

        document.getElementById('nav-dashboard-btn').click();

        expect(document.getElementById('nav-dashboard-btn').classList.contains('active')).toBe(true);
        expect(document.getElementById('nav-console-btn').classList.contains('active')).toBe(false);
        expect(document.querySelector('.view-toggle').classList.contains('dashboard-active')).toBe(true);
        expect(document.getElementById('console-area').style.display).toBe('none');
        expect(document.getElementById('dashboard-panel').style.display).toBe('block');
        expect(onDashboardActivated).toHaveBeenCalled();
        expect(resizeSpy).toHaveBeenCalled();

        resizeSpy.mockRestore();
    });

    it('consoleクリック時_ターミナルにフォーカスされる', () => {
        const frame = document.getElementById('terminal-frame');
        const focusSpy = frame.contentWindow.focus;

        setupViewNavigation();

        document.getElementById('nav-console-btn').click();

        expect(document.getElementById('nav-console-btn').classList.contains('active')).toBe(true);
        expect(document.getElementById('nav-dashboard-btn').classList.contains('active')).toBe(false);
        expect(document.querySelector('.view-toggle').classList.contains('dashboard-active')).toBe(false);
        expect(document.getElementById('console-area').style.display).toBe('flex');
        expect(document.getElementById('dashboard-panel').style.display).toBe('none');
        expect(focusSpy).toHaveBeenCalled();
    });

    it('cleanup後_クリックしても切り替わらない', () => {
        const { cleanup } = setupViewNavigation();

        cleanup();

        document.getElementById('nav-dashboard-btn').click();

        expect(document.querySelector('.view-toggle').classList.contains('dashboard-active')).toBe(false);
        expect(document.getElementById('dashboard-panel').style.display).toBe('none');
    });
});
