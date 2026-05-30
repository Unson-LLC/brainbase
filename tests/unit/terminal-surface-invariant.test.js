import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTerminalDisplayMixin } from '../../public/modules/app/terminal-display-mixin.js';
import { applyTerminalInputUxMixin } from '../../public/modules/app/terminal-input-ux-mixin.js';
import { appStore } from '../../public/modules/core/store.js';

// Regression guard for the terminal surface invariant: the terminal shows EXACTLY ONE
// of { xterm, ttyd, snapshot } at a time. A deferred/stale snapshot render must never
// reveal the snapshot over a live xterm/ttyd surface — that race produced the measured
// "duplication" (two surfaces visible) where the stale snapshot hid the live xterm, so
// typed input looked invisible. Enforced via this._terminalSurface (single source of
// truth) + a guard in _renderTerminalSnapshotPanel.

class TestApp {
    constructor() {
        this.terminalFrame = document.getElementById('terminal-frame');
        this.terminalXtermHost = document.getElementById('terminal-xterm-host');
        this._terminalSnapshotCache = new Map();
    }
    isMobile() { return false; }
    _hideCodexAppServerDisplay() {}
}
applyTerminalDisplayMixin(TestApp);
applyTerminalInputUxMixin(TestApp);

const visible = (id) => {
    const el = document.getElementById(id);
    return Boolean(el && !el.classList.contains('hidden'));
};
const visibleSurfaceCount = () =>
    ['terminal-xterm-host', 'terminal-snapshot-panel', 'terminal-frame'].filter(visible).length;

describe('terminal surface invariant', () => {
    beforeEach(() => {
        appStore.setState({ currentSessionId: null, sessions: [] });
        document.body.innerHTML = `
            <div id="console-area" style="display:flex">
                <iframe id="terminal-frame" class="hidden"></iframe>
                <div id="terminal-xterm-host" class="hidden"></div>
                <div id="terminal-snapshot-panel" class="hidden">
                    <div id="terminal-snapshot-title"></div>
                    <div id="terminal-snapshot-timestamp"></div>
                    <div id="terminal-snapshot-content"></div>
                </div>
            </div>`;
    });
    afterEach(() => { vi.useRealTimers(); });

    it('_showXtermTransport sets surface=xterm and hides the snapshot', () => {
        const app = new TestApp();
        app._showXtermTransport();
        expect(app._terminalSurface).toBe('xterm');
        expect(visible('terminal-xterm-host')).toBe(true);
        expect(visible('terminal-snapshot-panel')).toBe(false);
        expect(visibleSurfaceCount()).toBe(1);
    });

    it('a deferred snapshot render does NOT reveal the snapshot over a live xterm', () => {
        const app = new TestApp();
        app._showXtermTransport();
        // stale/deferred snapshot-arrival path tries to reveal the snapshot:
        app._renderTerminalSnapshotPanel({ visible: true, snapshot: { text: 'stale output' }, title: 'x' });
        expect(visible('terminal-snapshot-panel')).toBe(false); // invariant holds
        expect(visible('terminal-xterm-host')).toBe(true);
        expect(visibleSurfaceCount()).toBe(1);
    });

    it('snapshot IS revealed when snapshot is the active surface', () => {
        const app = new TestApp();
        app._showSnapshotDisplay('s1', { title: 'snap', snapshot: { text: 'hello' } });
        expect(app._terminalSurface).toBe('snapshot');
        expect(visible('terminal-snapshot-panel')).toBe(true);
        expect(visible('terminal-xterm-host')).toBe(false);
        expect(visibleSurfaceCount()).toBe(1);
    });

    it('snapshot -> xterm switch + a deferred snapshot render never yields two visible surfaces', () => {
        const app = new TestApp();
        app._showSnapshotDisplay('s1', { title: 'snap', snapshot: { text: 'a' } });
        app._showXtermTransport();
        app._renderTerminalSnapshotPanel({ visible: true, snapshot: { text: 'stale' }, title: 'x' });
        expect(visibleSurfaceCount()).toBe(1);
        expect(visible('terminal-xterm-host')).toBe(true);
    });
});
