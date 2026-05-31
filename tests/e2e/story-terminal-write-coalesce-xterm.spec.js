import { test, expect } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${process.env.BRAINBASE_E2E_PORT || process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

// Real-browser xterm proof that a burst of output messages (a long paste echo) is coalesced into
// far fewer terminal.write calls while rendering every line, and that a reset stays a boundary.
// FakeWebSocket is inline (CSP forbids eval).

function harness() {
    return {
        FakeWS: class FakeWS extends EventTarget {
            static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
            constructor(url) { super(); this.url = String(url); this.readyState = 1; this.sent = []; setTimeout(() => this.dispatchEvent(new Event('open')), 0); }
            send(d) { this.sent.push(d); } close() { this.readyState = 3; }
            emit(m) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(m) })); }
        }
    };
}

test.describe('story-terminal-write-coalesce', () => {
    test('AC: a burst of output messages coalesces into few terminal.write calls', async ({ page }) => {
        // story-terminal-write-coalesce ac:1
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        const result = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import(`/modules/core/terminal-transport-client.js?coalesce=${Date.now()}`);
            class FakeWS extends EventTarget {
                static OPEN = 1;
                constructor(url) { super(); this.url = String(url); this.readyState = 1; this.sent = []; setTimeout(() => this.dispatchEvent(new Event('open')), 0); }
                send(d) { this.sent.push(d); } close() { this.readyState = 3; }
                emit(m) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(m) })); }
            }
            const origWS = window.WebSocket; window.WebSocket = FakeWS;
            const host = document.createElement('div'); host.style.cssText = 'width:900px;height:480px;position:fixed;left:0;top:0;background:#000'; document.body.appendChild(host);
            const c = new TerminalTransportClient({ viewerId: 'coalesce-e2e', viewerLabel: 'Coalesce E2E' });
            await c.init(host);
            const waitOpen = async () => { for (let i = 0; i < 50; i++) { if (c.ws) return c.ws; await new Promise(r => setTimeout(r, 20)); } throw new Error('no ws'); };
            const cp = c.connect('s1', { skipInitialResize: true }); const ws = await waitOpen();
            ws.emit({ type: 'snapshot', text: 'prompt\r\n', capturedAt: new Date().toISOString() });
            ws.emit({ type: 'ready', runtimeState: 'interactive_ready', inputReady: true, terminalAccess: { state: 'owner' } });
            await cp;
            const drained = () => !c._terminalWriteActive && c._terminalWriteQueue.length === 0;
            const waitDrain = async () => { const t = performance.now(); while (performance.now() - t < 30000) { if (drained()) return; await new Promise(r => setTimeout(r, 8)); } };
            await waitDrain();
            let writeCalls = 0; const ow = c.terminal.write.bind(c.terminal); c.terminal.write = (t, cb) => { writeCalls++; return ow(t, cb); };
            const N = 300; const lines = Array.from({ length: N }, (_, i) => `paste echo line number ${i}\r\n`);
            for (const ln of lines) ws.emit({ type: 'output', data: ln });
            await waitDrain();
            const buf = c.terminal.buffer.active; let nonEmpty = 0;
            for (let y = 0; y < buf.length; y++) { if ((buf.getLine(y)?.translateToString(true) || '').trim()) nonEmpty++; }
            window.WebSocket = origWS; host.remove();
            return { N, writeCalls, nonEmptyLines: nonEmpty };
        });
        // A burst of many output messages is coalesced into far fewer terminal write calls while preserving byte order and full content, so a long paste echo no longer drains one terminal write per message.
        expect(result.writeCalls, 'A burst of many output messages is coalesced into far fewer terminal write calls while preserving byte order and full content, so a long paste echo no longer drains one terminal write per message.').toBeLessThan(result.N / 10);
        expect(result.nonEmptyLines).toBeGreaterThanOrEqual(result.N - 5);
        await page.screenshot({ path: 'var/test-results/story-terminal-write-coalesce-xterm.png', fullPage: false });
    });

    test('AC: a reset stays a batch boundary', async ({ page }) => {
        // story-terminal-write-coalesce ac:2
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        const result = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import(`/modules/core/terminal-transport-client.js?reset=${Date.now()}`);
            const host = document.createElement('div'); host.style.cssText = 'width:900px;height:480px;position:fixed;left:0;top:0;background:#000'; document.body.appendChild(host);
            const c = new TerminalTransportClient({ viewerId: 'reset-e2e', viewerLabel: 'Reset E2E' });
            await c.init(host);
            const drained = () => !c._terminalWriteActive && c._terminalWriteQueue.length === 0;
            const waitDrain = async () => { const t = performance.now(); while (performance.now() - t < 10000) { if (drained()) return; await new Promise(r => setTimeout(r, 8)); } };
            let resetCalls = 0; const orq = c.terminal.reset.bind(c.terminal); c.terminal.reset = () => { resetCalls++; return orq(); };
            c._writeToTerminal('BEFORE-1\r\n');
            c._writeToTerminal('BEFORE-2\r\n');
            c._writeToTerminal('AFTER-RESET-1\r\n', null, { resetTerminal: true });
            c._writeToTerminal('AFTER-RESET-2\r\n');
            await waitDrain();
            const buf = c.terminal.buffer.active; const rows = [];
            for (let y = 0; y < buf.length; y++) { const s = (buf.getLine(y)?.translateToString(true) || '').trim(); if (s) rows.push(s); }
            host.remove();
            return { resetCalls, rows, hasBefore: rows.some(r => r.includes('BEFORE-1')), hasAfter: rows.some(r => r.includes('AFTER-RESET-2')) };
        });
        // A reset terminal write stays a batch boundary so content before and after a reset is never merged into the same terminal write.
        expect(result.resetCalls, 'A reset terminal write stays a batch boundary so content before and after a reset is never merged into the same terminal write.').toBe(1);
        // reset() cleared the screen, so the pre-reset lines are gone and the post-reset lines remain
        expect(result.hasBefore).toBe(false);
        expect(result.hasAfter).toBe(true);
    });
});
