import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupViewNavigation } from '../../public/modules/ui/view-navigation.js';

describe('setupViewNavigation', () => {
    beforeEach(() => {
        document.body.className = 'dark-theme command-center-theme';
        document.body.innerHTML = `
            <aside class="activity-bar" id="activity-bar">
                <div class="activity-bar-top">
                    <button class="activity-bar-item active" id="ab-sessions-btn"></button>
                    <button class="activity-bar-item" id="ab-dashboard-btn" style="display:none"></button>
                    <button class="activity-bar-item" id="ab-wiki-btn"></button>
                    <button class="activity-bar-item" id="ab-livefeed-btn"></button>
                </div>
                <div class="activity-bar-bottom">
                    <button class="activity-bar-item" id="ab-settings-btn"></button>
                </div>
            </aside>
            <div class="view-toggle"></div>
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

        const { showFileViewer, showConsole } = setupViewNavigation();
        showFileViewer();
        expect(document.body.classList.contains('file-viewer-active')).toBe(true);

        showConsole();

        expect(document.getElementById('console-area').style.display).toBe('flex');
        expect(document.getElementById('file-viewer-panel').style.display).toBe('none');
        expect(document.body.classList.contains('file-viewer-active')).toBe(false);
        expect(document.getElementById('dashboard-overlay').classList.contains('open')).toBe(false);
        expect(focusSpy).toHaveBeenCalled();
    });

    it('showFileViewer呼び出し時_Command Centerでもターミナルを隠してビューアを全面表示状態にする', () => {
        const { showFileViewer } = setupViewNavigation();

        showFileViewer();

        expect(document.body.classList.contains('file-viewer-active')).toBe(true);
        expect(document.getElementById('console-area').style.display).toBe('none');
        expect(document.getElementById('file-viewer-panel').style.display).toBe('flex');
    });

    it('showConsole呼び出し時_レイアウト完了後に復帰フックを呼ぶ', () => {
        const callbacks = [];
        const originalRequestAnimationFrame = window.requestAnimationFrame;
        window.requestAnimationFrame = vi.fn((callback) => {
            callbacks.push(callback);
            return callbacks.length;
        });
        const onConsoleActivated = vi.fn();

        const { showConsole } = setupViewNavigation({ onConsoleActivated });
        showConsole();
        expect(onConsoleActivated).not.toHaveBeenCalled();

        callbacks.shift()?.();
        callbacks.shift()?.();
        expect(onConsoleActivated).toHaveBeenCalledTimes(1);

        window.requestAnimationFrame = originalRequestAnimationFrame;
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
        const infoDrawer = document.getElementById('info-drawer');

        infoDrawer.classList.add('open');

        showDashboard();
        expect(document.getElementById('dashboard-overlay').classList.contains('open')).toBe(true);

        showConsole();
        expect(document.getElementById('dashboard-overlay').classList.contains('open')).toBe(false);
        expect(document.getElementById('console-area').style.display).toBe('flex');
        expect(infoDrawer.classList.contains('open')).toBe(true);
    });
});
