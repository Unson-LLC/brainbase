import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

    afterEach(() => {
        vi.useRealTimers();
    });

    it('ttyd iframe表示復帰時にlayout/reveal/focusを送る', () => {
        const app = new TestApp();
        const frame = document.getElementById('terminal-frame');
        frame.setAttribute('src', '/console/session-1/');
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

    it('ttyd iframeがabout:blankでセッション切替中なら完了後に再接続をリトライする', () => {
        vi.useFakeTimers();
        appStore.setState({
            currentSessionId: 'session-1',
            sessions: [{ id: 'session-1', intendedState: 'active' }]
        });
        const app = new TestApp();
        app._pendingTerminalSwitch = { sessionId: 'session-1' };
        app.switchSession = vi.fn();
        const frame = document.getElementById('terminal-frame');
        frame.setAttribute('src', 'about:blank');

        app._restoreTerminalSurfaceAfterReveal('file-viewer-back');

        expect(app.switchSession).not.toHaveBeenCalled();
        expect(app.messages).toEqual([]);

        app._pendingTerminalSwitch = null;
        vi.advanceTimersByTime(80);

        expect(app.switchSession).toHaveBeenCalledWith('session-1', {
            forceTtyd: true,
            previousSessionId: 'session-1',
            recoveryReason: 'file-viewer-back:retry-1'
        });
        expect(app.messages).toEqual([]);
    });

    it('ttyd iframeがabout:blankでpendingが長引いても補修リトライを打ち切らない', () => {
        vi.useFakeTimers();
        appStore.setState({
            currentSessionId: 'session-1',
            sessions: [{ id: 'session-1', intendedState: 'active' }]
        });
        const app = new TestApp();
        app._pendingTerminalSwitch = { sessionId: 'session-1', startedAt: Date.now() };
        app.switchSession = vi.fn();
        const frame = document.getElementById('terminal-frame');
        frame.setAttribute('src', 'about:blank');

        app._restoreTerminalSurfaceAfterReveal('file-viewer-back');
        vi.advanceTimersByTime(80 + 180 + 360 + 720 + 1200 + 1800 + 1);

        expect(app.switchSession).not.toHaveBeenCalled();

        app._pendingTerminalSwitch = null;
        vi.advanceTimersByTime(1200);

        expect(app.switchSession).toHaveBeenCalledWith('session-1', {
            forceTtyd: true,
            previousSessionId: 'session-1',
            recoveryReason: expect.stringContaining('pending-wait')
        });
        expect(app.messages).toEqual([]);
    });

    it('ttyd iframeがabout:blankでpendingがstaleなら再接続へ進む', () => {
        vi.useFakeTimers();
        appStore.setState({
            currentSessionId: 'session-1',
            sessions: [{ id: 'session-1', intendedState: 'active' }]
        });
        const app = new TestApp();
        app._pendingTerminalSwitch = { sessionId: 'session-1', startedAt: Date.now() };
        app.switchSession = vi.fn();
        const frame = document.getElementById('terminal-frame');
        frame.setAttribute('src', 'about:blank');

        app._restoreTerminalSurfaceAfterReveal('file-viewer-back');
        vi.advanceTimersByTime(80 + 180 + 360 + 720 + 1200 + 1800 + 1200);

        expect(app.switchSession).toHaveBeenCalledWith('session-1', {
            forceTtyd: true,
            previousSessionId: 'session-1',
            recoveryReason: expect.stringContaining('pending-wait')
        });
        expect(app.messages).toEqual([]);
    });

    it('ttyd iframeがabout:blankで現在セッション未確定なら確定後に再接続をリトライする', () => {
        vi.useFakeTimers();
        const app = new TestApp();
        app.switchSession = vi.fn();
        const frame = document.getElementById('terminal-frame');
        frame.setAttribute('src', 'about:blank');

        app._restoreTerminalSurfaceAfterReveal('page-show');

        expect(app.switchSession).not.toHaveBeenCalled();
        expect(app.messages).toEqual([]);

        appStore.setState({
            currentSessionId: 'session-2',
            sessions: [{ id: 'session-2', intendedState: 'active' }]
        });
        vi.advanceTimersByTime(80);

        expect(app.switchSession).toHaveBeenCalledWith('session-2', {
            forceTtyd: true,
            previousSessionId: 'session-2',
            recoveryReason: 'page-show:retry-1'
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
