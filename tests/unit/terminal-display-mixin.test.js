import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTerminalDisplayMixin } from '../../public/modules/app/terminal-display-mixin.js';
import { appStore } from '../../public/modules/core/store.js';

class TestApp {
    constructor() {
        this._mobileTerminalMode = 'snapshot';
        this.terminalTransportClient = null;
        this.terminalFrame = document.getElementById('terminal-frame');
        this.terminalXtermHost = document.getElementById('terminal-xterm-host');
        this.messages = [];
    }

    isMobile() {
        return false;
    }

    postTerminalFrameMessage(message, frameEl = null) {
        this.messages.push({ message, frameEl });
    }
}

applyTerminalDisplayMixin(TestApp);

describe('terminal-display-mixin', () => {
    beforeEach(() => {
        appStore.setState({
            currentSessionId: null,
            sessions: []
        });
        document.body.innerHTML = `
            <div id="console-area" style="display:flex">
                <iframe id="terminal-frame"></iframe>
                <div id="terminal-xterm-host" class="hidden"></div>
            </div>
        `;
    });

    it('ttyd iframe表示復帰時にlayout/reveal/focusを送る', () => {
        const app = new TestApp();
        const frame = document.getElementById('terminal-frame');
        frame.getBoundingClientRect = () => ({ width: 960, height: 540 });

        app._restoreTerminalSurfaceAfterReveal('file-viewer-back');

        expect(app.messages.map(({ message }) => message.type)).toEqual([
            'bb-terminal-layout',
            'bb-terminal-reveal',
            'bb-terminal-focus'
        ]);
        expect(app.messages[0].message).toMatchObject({
            width: 960,
            height: 540,
            reason: 'file-viewer-back'
        });
        expect(frame.classList.contains('terminal-frame-revealing')).toBe(true);
    });

    it('xterm表示復帰時はactive判定に依存せずrestoreAfterRevealを呼ぶ', () => {
        const app = new TestApp();
        const frame = document.getElementById('terminal-frame');
        const xtermHost = document.getElementById('terminal-xterm-host');
        frame.classList.add('hidden');
        xtermHost.classList.remove('hidden');
        app.terminalTransportClient = { restoreAfterReveal: vi.fn() };

        app._restoreTerminalSurfaceAfterReveal('file-viewer-back');

        expect(app.terminalTransportClient.restoreAfterReveal).toHaveBeenCalledTimes(1);
        expect(app.messages).toEqual([]);
    });

    it('ttyd iframeがabout:blankで復帰した時_現在セッションを再接続する', () => {
        appStore.setState({
            currentSessionId: 'session-1',
            sessions: [{ id: 'session-1', intendedState: 'active' }]
        });
        const app = new TestApp();
        app.switchSession = vi.fn();
        const frame = document.getElementById('terminal-frame');
        frame.setAttribute('src', 'about:blank');

        app._restoreTerminalSurfaceAfterReveal('page-show');

        expect(app.switchSession).toHaveBeenCalledWith('session-1', {
            forceTtyd: true,
            previousSessionId: 'session-1',
            recoveryReason: 'page-show'
        });
        expect(app.messages).toEqual([]);
    });

    it('ttyd iframeが通常URLなら再接続せずlayout/reveal/focusを送る', () => {
        appStore.setState({
            currentSessionId: 'session-1',
            sessions: [{ id: 'session-1', intendedState: 'active' }]
        });
        const app = new TestApp();
        app.switchSession = vi.fn();
        const frame = document.getElementById('terminal-frame');
        frame.setAttribute('src', '/console/session-1/');

        app._restoreTerminalSurfaceAfterReveal('page-show');

        expect(app.switchSession).not.toHaveBeenCalled();
        expect(app.messages.map(({ message }) => message.type)).toEqual([
            'bb-terminal-layout',
            'bb-terminal-reveal',
            'bb-terminal-focus'
        ]);
    });
});
