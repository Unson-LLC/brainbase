import { test, expect } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${process.env.BRAINBASE_E2E_PORT || process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

// Real-browser proof that connect() no longer blocks on the discarded GET /api/auth/verify.
// A FakeWebSocket emits `ready`; fetch to /api/auth/verify is made to hang (ac:1) or pass (ac:2).
// FakeWS + fetch override are inline (CSP forbids eval).

test.describe('story-session-switch-auth-nonblocking', () => {
    test('AC: a hanging auth verify does not block connect', async ({ page }) => {
        // story-session-switch-auth-nonblocking ac:1
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        const result = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import(`/modules/core/terminal-transport-client.js?authnb=${Date.now()}`);
            class FakeWS extends EventTarget {
                static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
                constructor(url) { super(); this.url = String(url); this.readyState = 1; this.sent = [];
                    setTimeout(() => this.dispatchEvent(new Event('open')), 0);
                    setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'ready', sessionId: 's1', cols: 80, rows: 24, inputReady: true, terminalAccess: { state: 'owner' } }) })), 5);
                }
                send(d) { this.sent.push(d); } close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code: 1000 })); }
            }
            const origWS = window.WebSocket; window.WebSocket = FakeWS;
            const origFetch = window.fetch.bind(window);
            window.fetch = (u, o) => String(u).includes('/api/auth/verify') ? new Promise(() => {}) : origFetch(u, o); // hang verify
            const host = document.createElement('div'); host.style.cssText = 'width:640px;height:360px;position:fixed;left:0;top:0'; document.body.appendChild(host);
            const c = new TerminalTransportClient({ viewerId: 'authnb-e2e', viewerLabel: 'AuthNB E2E' });
            await c.init(host);
            const res = await Promise.race([
                c.connect('s1', { skipInitialResize: true }).then(r => r, e => ({ error: String(e?.message ?? e) })),
                new Promise(r => setTimeout(() => r('BLOCKED'), 800))
            ]);
            window.WebSocket = origWS; window.fetch = origFetch; host.remove();
            return res;
        });
        // A connect whose auth verify never resolves still reaches WS ready and resolves mode live, because the discarded best-effort auth verify is fire-and-forget and does not block the connect critical path.
        expect(result, 'A connect whose auth verify never resolves still reaches WS ready and resolves mode live, because the discarded best-effort auth verify is fire-and-forget and does not block the connect critical path.').not.toBe('BLOCKED');
        expect(result.mode).toBe('live');
        await page.screenshot({ path: 'var/test-results/story-session-switch-auth-nonblocking-xterm.png', fullPage: false });
    });

    test('AC: a normal connect with resolving auth verify still works', async ({ page }) => {
        // story-session-switch-auth-nonblocking ac:2
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        const result = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import(`/modules/core/terminal-transport-client.js?authok=${Date.now()}`);
            class FakeWS extends EventTarget {
                static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
                constructor(url) { super(); this.url = String(url); this.readyState = 1; this.sent = [];
                    setTimeout(() => this.dispatchEvent(new Event('open')), 0);
                    setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'ready', sessionId: 's1', cols: 80, rows: 24, inputReady: true, terminalAccess: { state: 'owner' } }) })), 5);
                }
                send(d) { this.sent.push(d); } close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code: 1000 })); }
            }
            const origWS = window.WebSocket; window.WebSocket = FakeWS;
            const host = document.createElement('div'); host.style.cssText = 'width:640px;height:360px;position:fixed;left:0;top:0'; document.body.appendChild(host);
            const c = new TerminalTransportClient({ viewerId: 'authok-e2e', viewerLabel: 'AuthOK E2E' });
            await c.init(host);
            const res = await c.connect('s1', { skipInitialResize: true });
            window.WebSocket = origWS; host.remove();
            return res;
        });
        // A normal connect whose auth verify resolves still reaches WS ready and resolves mode live, so making auth verify non-blocking does not regress the happy path.
        expect(result, 'A normal connect whose auth verify resolves still reaches WS ready and resolves mode live, so making auth verify non-blocking does not regress the happy path.').toBeTruthy();
        expect(result.mode).toBe('live');
    });
});
