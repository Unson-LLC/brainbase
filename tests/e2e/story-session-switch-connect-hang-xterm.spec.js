import { test, expect } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${process.env.BRAINBASE_E2E_PORT || process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

// Drives the REAL TerminalTransportClient in a real browser with a FakeWebSocket that opens
// but never emits `ready`, so connect() stays pending. Proves the orphaned-connect hang is
// gone: a superseding connect() makes the first promise settle (reject superseded) instead of
// hanging forever, the CONNECT_TIMEOUT_MS path survives for the un-superseded case, and every
// settle publishes an observable metric. The FakeWebSocket is defined inline (CSP forbids eval).

test.describe('story-session-switch-connect-hang', () => {
    test('AC: a superseded pending connect rejects instead of hanging', async ({ page }) => {
        // story-session-switch-connect-hang ac:1
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        const outcome = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import(`/modules/core/terminal-transport-client.js?hang=${Date.now()}`);
            class FakeWS extends EventTarget {
                static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
                constructor(url) { super(); this.url = String(url); this.readyState = 1; this.sent = []; setTimeout(() => this.dispatchEvent(new Event('open')), 0); }
                send(d) { this.sent.push(d); }
                close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: 'test' })); }
            }
            const orig = window.WebSocket; window.WebSocket = FakeWS;
            const host = document.createElement('div'); host.style.cssText = 'width:640px;height:360px;position:fixed;left:0;top:0'; document.body.appendChild(host);
            const c = new TerminalTransportClient({ viewerId: 'hang-e2e', viewerLabel: 'Hang E2E' });
            await c.init(host);
            const p1 = c.connect('s1', { skipInitialResize: true }); p1.catch(() => {});
            const p2 = c.connect('s1', { skipInitialResize: true }); p2.catch(() => {}); // bumps the token while p1 is pending
            const res = await Promise.race([
                p1.then(() => ({ resolved: true }), e => ({ rejected: String(e?.message ?? e) })),
                new Promise(r => setTimeout(() => r('HUNG'), 600))
            ]);
            window.WebSocket = orig; host.remove();
            return { res, metric: c._lastConnectMetric || null };
        });
        // A superseded pending connect (a concurrent or reconnect connect bumps the token while the first connect is still pending) rejects deterministically as superseded instead of hanging, so the awaiting switch reaches the snapshot fallback instead of freezing forever.
        expect(outcome.res, 'A superseded pending connect (a concurrent or reconnect connect bumps the token while the first connect is still pending) rejects deterministically as superseded instead of hanging, so the awaiting switch reaches the snapshot fallback instead of freezing forever.').not.toBe('HUNG');
        expect(outcome.res.rejected).toMatch(/supersed/i);
        await page.screenshot({ path: 'var/test-results/story-session-switch-connect-hang-xterm.png', fullPage: false });
    });

    test('AC: an un-superseded never-ready connect still rejects at the connect timeout', async ({ page }) => {
        // story-session-switch-connect-hang ac:2
        test.setTimeout(40000);
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        const outcome = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import(`/modules/core/terminal-transport-client.js?timeout=${Date.now()}`);
            class FakeWS extends EventTarget {
                static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
                constructor(url) { super(); this.url = String(url); this.readyState = 1; this.sent = []; setTimeout(() => this.dispatchEvent(new Event('open')), 0); }
                send(d) { this.sent.push(d); }
                close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: 'test' })); }
            }
            const orig = window.WebSocket; window.WebSocket = FakeWS;
            const host = document.createElement('div'); host.style.cssText = 'width:640px;height:360px;position:fixed;left:0;top:0'; document.body.appendChild(host);
            const c = new TerminalTransportClient({ viewerId: 'timeout-e2e', viewerLabel: 'Timeout E2E' });
            await c.init(host);
            const t0 = performance.now();
            const rejected = await c.connect('s1', { skipInitialResize: true }).then(() => null, e => String(e?.message ?? e));
            const elapsed = performance.now() - t0;
            window.WebSocket = orig; host.remove();
            return { rejected, elapsed, metric: c._lastConnectMetric || null };
        });
        // A non-superseded connect that never receives ready still rejects at CONNECT_TIMEOUT_MS, preserving the existing connect timeout for the un-superseded case.
        expect(outcome.rejected, 'A non-superseded connect that never receives ready still rejects at CONNECT_TIMEOUT_MS, preserving the existing connect timeout for the un-superseded case').toMatch(/timeout/i);
        expect(outcome.elapsed).toBeGreaterThan(12000);
        expect(outcome.metric?.outcome).toBe('timeout');
    });

    test('AC: every connect settle publishes an observable outcome+duration metric', async ({ page }) => {
        // story-session-switch-connect-hang ac:3
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        const metric = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import(`/modules/core/terminal-transport-client.js?metric=${Date.now()}`);
            class FakeWS extends EventTarget {
                static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
                constructor(url) {
                    super(); this.url = String(url); this.readyState = 1; this.sent = [];
                    setTimeout(() => this.dispatchEvent(new Event('open')), 0);
                    setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'ready', sessionId: 's1', cols: 80, rows: 24, inputReady: true, terminalAccess: { state: 'owner' } }) })), 5);
                }
                send(d) { this.sent.push(d); }
                close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: 'test' })); }
            }
            const orig = window.WebSocket; window.WebSocket = FakeWS;
            const host = document.createElement('div'); host.style.cssText = 'width:640px;height:360px;position:fixed;left:0;top:0'; document.body.appendChild(host);
            const c = new TerminalTransportClient({ viewerId: 'metric-e2e', viewerLabel: 'Metric E2E' });
            await c.init(host);
            const res = await c.connect('s1', { skipInitialResize: true });
            window.WebSocket = orig; host.remove();
            return { mode: res?.mode, metric: c._lastConnectMetric || null };
        });
        // Every connect settle publishes a _lastConnectMetric carrying the outcome and a numeric durationMs, making the previously invisible connect phase observable.
        expect(metric.metric, 'Every connect settle publishes a _lastConnectMetric carrying the outcome and a numeric durationMs, making the previously invisible connect phase observable').not.toBeNull();
        expect(metric.metric.outcome).toBe('live');
        expect(typeof metric.metric.durationMs).toBe('number');
    });
});
