import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupViewNavigation } from '../../public/modules/ui/view-navigation.js';

describe('setupViewNavigation', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div class="view-toggle"></div>
            <button id="nav-dashboard-btn">dashboard</button>
            <div id="console-area" style="display:flex"></div>
            <div id="file-viewer-panel" style="display:none"></div>
            <div id="live-feed-panel" style="display:none"></div>
            <aside class="info-drawer" id="info-drawer">
                <div class="info-drawer-tabs">
                    <button class="info-drawer-tab active" data-tab="wiki">Wiki</button>
                    <button class="info-drawer-tab" data-tab="live-feed">Live Feed</button>
                </div>
                <div class="info-drawer-body">
                    <div id="wiki-panel" class="info-tab-content active" data-tab="wiki"></div>
                    <div id="live-feed-panel" class="info-tab-content" data-tab="live-feed"></div>
                </div>
            </aside>
            <div class="dashboard-overlay" id="dashboard-overlay"></div>
            <iframe id="terminal-frame"></iframe>
        `;

        const frame = document.getElementById('terminal-frame');
        Object.defineProperty(frame, 'contentWindow', {
            value: { focus: vi.fn() },
            configurable: true
        });
    });

    it('showDashboard呼び出し時_オーバーレイが表示される', () => {
        const onDashboardActivated = vi.fn();
        const resizeSpy = vi.spyOn(window, 'dispatchEvent');

        const { showDashboard } = setupViewNavigation({ onDashboardActivated });
        showDashboard();

        expect(document.getElementById('dashboard-overlay').classList.contains('open')).toBe(true);
        expect(onDashboardActivated).toHaveBeenCalled();
        expect(resizeSpy).toHaveBeenCalled();

        resizeSpy.mockRestore();
    });

    it('showConsole呼び出し時_ターミナルにフォーカスされconsoleが表示される', () => {
        const frame = document.getElementById('terminal-frame');
        const focusSpy = frame.contentWindow.focus;

        const { showConsole } = setupViewNavigation();
        showConsole();

        expect(document.getElementById('console-area').style.display).toBe('flex');
        expect(document.getElementById('dashboard-overlay').classList.contains('open')).toBe(false);
        expect(focusSpy).toHaveBeenCalled();
    });

    it('showWiki呼び出し時_wikiドロワーがトグルされる', () => {
        const onWikiActivated = vi.fn();
        const { showWiki } = setupViewNavigation({ onWikiActivated });

        showWiki();

        expect(document.getElementById('info-drawer').classList.contains('open')).toBe(true);
        expect(onWikiActivated).toHaveBeenCalled();
    });

    it('showConsole呼び出し時_パネルとドロワーが閉じられる', () => {
        const { showDashboard, showConsole } = setupViewNavigation();

        showDashboard();
        expect(document.getElementById('dashboard-overlay').classList.contains('open')).toBe(true);

        showConsole();
        expect(document.getElementById('dashboard-overlay').classList.contains('open')).toBe(false);
        expect(document.getElementById('console-area').style.display).toBe('flex');
    });
});
