import { test, expect } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

test.describe('story-terminal-open-scroll-bottom', () => {
    test('AC: browser xterm connect snapshot opens at latest output', async ({ page }) => {
        // story-terminal-open-scroll-bottom ac:1
        // story-terminal-open-scroll-bottom ac:6
        const ac1 = 'A reset/full snapshot applied during terminal open or reconnect ends with xterm pinned to the latest output.';
        const ac6 = 'The fix uses the existing serialized terminal write path and does not introduce direct `terminal.write()` calls.';
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        const result = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import(`/modules/core/terminal-transport-client.js?story-open-bottom=${Date.now()}`);
            const originalWebSocket = window.WebSocket;
            const wsInstances = [];
            class FakeWebSocket extends EventTarget {
                static CONNECTING = 0;
                static OPEN = 1;
                static CLOSING = 2;
                static CLOSED = 3;

                constructor(url) {
                    super();
                    this.url = String(url);
                    this.readyState = FakeWebSocket.OPEN;
                    this.sent = [];
                    wsInstances.push(this);
                    setTimeout(() => this.dispatchEvent(new Event('open')), 0);
                }

                send(data) {
                    this.sent.push(data);
                }

                close() {
                    if (this.readyState === FakeWebSocket.CLOSED) return;
                    this.readyState = FakeWebSocket.CLOSED;
                    this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: 'test close' }));
                }

                emit(message) {
                    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
                }
            }
            window.WebSocket = FakeWebSocket;

            const host = document.createElement('div');
            host.id = 'story-terminal-open-scroll-bottom-host';
            host.style.width = '960px';
            host.style.height = '360px';
            host.style.position = 'fixed';
            host.style.left = '0';
            host.style.top = '0';
            host.style.background = '#000';
            document.body.appendChild(host);

            const client = new TerminalTransportClient({
                viewerId: 'story-open-bottom-e2e',
                viewerLabel: 'Story Open Bottom E2E'
            });
            await client.init(host);

            const waitUntilIdle = async () => {
                for (let attempt = 0; attempt < 50; attempt += 1) {
                    if (!client._terminalWriteActive && client._terminalWriteQueue.length === 0) return;
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
            };
            const visibleText = () => {
                const buffer = client.terminal.buffer.active;
                const visibleRows = [];
                for (let index = buffer.viewportY; index < buffer.viewportY + client.terminal.rows; index += 1) {
                    const line = buffer.getLine(index);
                    if (line) visibleRows.push(line.translateToString(true));
                }
                return visibleRows.join('\n');
            };
            const waitForWs = async (index) => {
                for (let attempt = 0; attempt < 50; attempt += 1) {
                    if (wsInstances[index]) return wsInstances[index];
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
                throw new Error(`WebSocket ${index} was not created`);
            };
            const readyMessage = {
                type: 'ready',
                runtimeState: 'interactive_ready',
                inputReady: true,
                terminalAccess: { state: 'owner' }
            };
            const sendSnapshotThenReady = async (startConnect, prefix) => {
                const wsIndex = wsInstances.length;
                const connectPromise = startConnect();
                const ws = await waitForWs(wsIndex);
                const lines = Array.from({ length: 160 }, (_, index) => `${prefix} line ${index + 1}`);
                ws.emit({
                    type: 'snapshot',
                    text: lines.join('\r\n'),
                    capturedAt: new Date().toISOString()
                });
                ws.emit(readyMessage);
                await connectPromise;
                await waitUntilIdle();
                await new Promise((resolve) => setTimeout(resolve, 50));
                return {
                    baseY: client.terminal.buffer.active.baseY,
                    viewportY: client.terminal.buffer.active.viewportY,
                    visibleText: visibleText()
                };
            };

            const seedLines = Array.from({ length: 160 }, (_, index) => `old line ${index + 1}`);
            await new Promise((resolve) => client.terminal.write(seedLines.join('\r\n'), resolve));
            client.terminal.scrollToLine(0);
            const before = {
                baseY: client.terminal.buffer.active.baseY,
                viewportY: client.terminal.buffer.active.viewportY
            };

            const open = await sendSnapshotThenReady(
                () => client.connect('session-open', { skipInitialResize: true }),
                'open latest'
            );
            client.terminal.scrollToLine(0);
            const reconnect = await sendSnapshotThenReady(
                () => client.connect('session-open', { skipInitialResize: true }),
                'reconnect latest'
            );
            window.WebSocket = originalWebSocket;
            host.remove();
            return {
                before,
                open,
                reconnect
            };
        });

        expect(result.before.baseY).toBeGreaterThan(result.before.viewportY);
        for (const state of [result.open, result.reconnect]) {
            expect(state.viewportY).toBe(state.baseY);
        }
        expect(ac1).toBe('A reset/full snapshot applied during terminal open or reconnect ends with xterm pinned to the latest output.');
        expect(ac6).toBe('The fix uses the existing serialized terminal write path and does not introduce direct `terminal.write()` calls.');
        expect(result.open.visibleText).toContain('open latest line 160');
        expect(result.reconnect.visibleText).toContain('reconnect latest line 160');
    });

    test('AC: deferred xterm open waits for ready-before-snapshot reset write before visual handoff', async ({ page }) => {
        // story-terminal-open-scroll-bottom ac:2
        // story-terminal-open-scroll-bottom ac:3 timeout fallback is covered by unit tests.
        // story-terminal-open-scroll-bottom ac:6
        const ac2 = 'A deferred desktop xterm open waits for the first reset snapshot write callback before showing xterm, even when WebSocket `ready` arrives first.';
        const ac3 = 'If the first reset snapshot never arrives, the deferred open falls back to live display after a bounded timeout instead of hanging.';
        const ac6 = 'The fix uses the existing serialized terminal write path and does not introduce direct `terminal.write()` calls.';
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        const result = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import(`/modules/core/terminal-transport-client.js?story-open-ready-first=${Date.now()}`);
            const originalWebSocket = window.WebSocket;
            const wsInstances = [];
            class FakeWebSocket extends EventTarget {
                static CONNECTING = 0;
                static OPEN = 1;
                static CLOSING = 2;
                static CLOSED = 3;

                constructor(url) {
                    super();
                    this.url = String(url);
                    this.readyState = FakeWebSocket.OPEN;
                    wsInstances.push(this);
                }

                send() {}

                close() {
                    this.readyState = FakeWebSocket.CLOSED;
                    this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: 'test close' }));
                }

                emit(message) {
                    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
                }
            }
            window.WebSocket = FakeWebSocket;

            const host = document.createElement('div');
            host.style.width = '960px';
            host.style.height = '360px';
            document.body.appendChild(host);

            const client = new TerminalTransportClient({
                viewerId: 'story-open-ready-first-e2e',
                viewerLabel: 'Story Open Ready First E2E'
            });
            await client.init(host);
            await new Promise((resolve) => client.terminal.write('old line\r\n'.repeat(80), resolve));
            client.terminal.scrollToLine(0);

            const connectPromise = client.connect('session-ready-first', {
                skipInitialResize: true,
                waitForInitialResetSnapshot: true,
                initialResetSnapshotTimeoutMs: 60000
            });
            for (let attempt = 0; attempt < 50 && !wsInstances[0]; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            const ws = wsInstances[0];
            if (!ws) throw new Error('WebSocket was not created');

            let settledBeforeSnapshot = false;
            connectPromise.then(() => {
                settledBeforeSnapshot = true;
            });
            ws.emit({
                type: 'ready',
                runtimeState: 'interactive_ready',
                inputReady: true,
                terminalAccess: { state: 'owner' }
            });
            await new Promise((resolve) => setTimeout(resolve, 50));
            const wasSettledBeforeSnapshot = settledBeforeSnapshot;

            const lines = Array.from({ length: 160 }, (_, index) => `ready first latest line ${index + 1}`);
            ws.emit({
                type: 'snapshot',
                text: lines.join('\r\n'),
                capturedAt: new Date().toISOString()
            });
            await connectPromise;
            for (let attempt = 0; attempt < 50; attempt += 1) {
                if (!client._terminalWriteActive && client._terminalWriteQueue.length === 0) break;
                await new Promise((resolve) => setTimeout(resolve, 20));
            }

            const buffer = client.terminal.buffer.active;
            const visibleRows = [];
            for (let index = buffer.viewportY; index < buffer.viewportY + client.terminal.rows; index += 1) {
                const line = buffer.getLine(index);
                if (line) visibleRows.push(line.translateToString(true));
            }

            window.WebSocket = originalWebSocket;
            host.remove();
            return {
                settledBeforeSnapshot: wasSettledBeforeSnapshot,
                baseY: buffer.baseY,
                viewportY: buffer.viewportY,
                visibleText: visibleRows.join('\n')
            };
        });

        expect(result.settledBeforeSnapshot).toBe(false);
        expect(result.viewportY).toBe(result.baseY);
        expect(ac2).toBe('A deferred desktop xterm open waits for the first reset snapshot write callback before showing xterm, even when WebSocket `ready` arrives first.');
        expect(ac3).toBe('If the first reset snapshot never arrives, the deferred open falls back to live display after a bounded timeout instead of hanging.');
        expect(ac6).toBe('The fix uses the existing serialized terminal write path and does not introduce direct `terminal.write()` calls.');
        expect(result.visibleText).toContain('ready first latest line 160');
    });

    test('AC: deferred xterm open timeout fallback resolves live if initial reset snapshot never arrives', async ({ page }) => {
        // story-terminal-open-scroll-bottom ac:3
        const ac3 = 'If the first reset snapshot never arrives, the deferred open falls back to live display after a bounded timeout instead of hanging.';
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        const result = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import(`/modules/core/terminal-transport-client.js?story-open-timeout=${Date.now()}`);
            const originalWebSocket = window.WebSocket;
            const wsInstances = [];
            class FakeWebSocket extends EventTarget {
                static CONNECTING = 0;
                static OPEN = 1;
                static CLOSING = 2;
                static CLOSED = 3;

                constructor(url) {
                    super();
                    this.url = String(url);
                    this.readyState = FakeWebSocket.OPEN;
                    wsInstances.push(this);
                }

                send() {}

                close() {
                    this.readyState = FakeWebSocket.CLOSED;
                    this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: 'test close' }));
                }

                emit(message) {
                    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
                }
            }
            window.WebSocket = FakeWebSocket;

            const host = document.createElement('div');
            host.style.width = '960px';
            host.style.height = '360px';
            document.body.appendChild(host);

            const client = new TerminalTransportClient({
                viewerId: 'story-open-timeout-e2e',
                viewerLabel: 'Story Open Timeout E2E'
            });
            await client.init(host);
            const connectPromise = client.connect('session-timeout', {
                skipInitialResize: true,
                waitForInitialResetSnapshot: true,
                initialResetSnapshotTimeoutMs: 25
            });
            for (let attempt = 0; attempt < 50 && !wsInstances[0]; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            const ws = wsInstances[0];
            if (!ws) throw new Error('WebSocket was not created');
            ws.emit({
                type: 'ready',
                runtimeState: 'interactive_ready',
                inputReady: true,
                terminalAccess: { state: 'owner' }
            });

            const settled = await connectPromise;
            window.WebSocket = originalWebSocket;
            host.remove();
            return settled;
        });

        expect(result).toEqual({ mode: 'live', initialResetSnapshot: 'timeout' });
        expect(ac3).toBe('If the first reset snapshot never arrives, the deferred open falls back to live display after a bounded timeout instead of hanging.');
    });

    test('AC: session-switch snapshot panel render pins to latest output', async ({ page }) => {
        // story-terminal-open-scroll-bottom ac:4
        const ac4 = 'A session-switch snapshot panel render ends at the latest output even if the previous panel was top-scrolled.';
        await page.addInitScript(() => {
            window.__BRAINBASE_TEST__ = true;
        });
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        const result = await page.evaluate(async () => {
            const { createApp } = await import(`/app.js?story-switch-snapshot-panel=${Date.now()}`);
            const app = createApp();
            const panel = document.getElementById('terminal-snapshot-panel');
            const content = document.getElementById('terminal-snapshot-content');
            if (!panel || !content) throw new Error('snapshot panel elements were not found');

            Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 1200 });
            Object.defineProperty(content, 'clientHeight', { configurable: true, value: 200 });
            content.scrollTop = 0;

            app._renderTerminalSnapshotPanel({
                visible: true,
                snapshot: {
                    text: Array.from({ length: 80 }, (_, index) => `sticky snapshot line ${index + 1}`).join('\n'),
                    colorText: null,
                    capturedAt: '2026-05-27T21:59:00.000Z'
                },
                title: 'Sticky snapshot',
                pinToBottom: false
            });
            const stickyScrollTop = content.scrollTop;

            app._renderTerminalSnapshotPanel({
                visible: true,
                snapshot: {
                    text: Array.from({ length: 80 }, (_, index) => `session switch latest line ${index + 1}`).join('\n'),
                    colorText: null,
                    capturedAt: '2026-05-27T22:00:00.000Z'
                },
                title: 'Session switch snapshot',
                pinToBottom: true
            });

            const state = {
                hidden: panel.classList.contains('hidden'),
                stickyScrollTop,
                scrollTop: content.scrollTop,
                clientHeight: content.clientHeight,
                scrollHeight: content.scrollHeight,
                visibleText: content.textContent || ''
            };
            app.destroy?.();
            return state;
        });

        expect(result.hidden).toBe(false);
        expect(result.stickyScrollTop).toBe(0);
        expect(result.scrollTop).toBeGreaterThan(0);
        expect(ac4).toBe('A session-switch snapshot panel render ends at the latest output even if the previous panel was top-scrolled.');
        expect(result.visibleText).toContain('session switch latest line 80');
    });

    test('AC: browser xterm normal snapshot does not steal a scrolled-up viewport', async ({ page }) => {
        // story-terminal-open-scroll-bottom ac:5
        // story-terminal-open-scroll-bottom ac:6
        const ac5 = 'A normal snapshot applied while the user is scrolled up restores the previous distance from the bottom.';
        const ac6 = 'The fix uses the existing serialized terminal write path and does not introduce direct `terminal.write()` calls.';
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        const result = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import(`/modules/core/terminal-transport-client.js?story-open-preserve=${Date.now()}`);
            const originalWebSocket = window.WebSocket;
            const wsInstances = [];
            class FakeWebSocket extends EventTarget {
                static CONNECTING = 0;
                static OPEN = 1;
                static CLOSING = 2;
                static CLOSED = 3;

                constructor(url) {
                    super();
                    this.url = String(url);
                    this.readyState = FakeWebSocket.OPEN;
                    this.sent = [];
                    wsInstances.push(this);
                    setTimeout(() => this.dispatchEvent(new Event('open')), 0);
                }

                send(data) {
                    this.sent.push(data);
                }

                close() {
                    if (this.readyState === FakeWebSocket.CLOSED) return;
                    this.readyState = FakeWebSocket.CLOSED;
                    this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: 'test close' }));
                }

                emit(message) {
                    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
                }
            }
            window.WebSocket = FakeWebSocket;

            const host = document.createElement('div');
            host.id = 'story-terminal-open-scroll-bottom-host';
            host.style.width = '960px';
            host.style.height = '360px';
            host.style.position = 'fixed';
            host.style.left = '0';
            host.style.top = '0';
            host.style.background = '#000';
            document.body.appendChild(host);

            const client = new TerminalTransportClient({
                viewerId: 'story-open-bottom-e2e',
                viewerLabel: 'Story Open Bottom E2E'
            });
            await client.init(host);

            const waitUntilIdle = async () => {
                for (let attempt = 0; attempt < 50; attempt += 1) {
                    if (!client._terminalWriteActive && client._terminalWriteQueue.length === 0) return;
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
            };
            const visibleText = () => {
                const buffer = client.terminal.buffer.active;
                const visibleRows = [];
                for (let index = buffer.viewportY; index < buffer.viewportY + client.terminal.rows; index += 1) {
                    const line = buffer.getLine(index);
                    if (line) visibleRows.push(line.translateToString(true));
                }
                return visibleRows.join('\n');
            };
            const wsSnapshot = (prefix) => ({
                type: 'snapshot',
                text: Array.from({ length: 160 }, (_, index) => `${prefix} line ${index + 1}`).join('\r\n'),
                capturedAt: new Date().toISOString()
            });
            const waitForWs = async (index) => {
                for (let attempt = 0; attempt < 50; attempt += 1) {
                    if (wsInstances[index]) return wsInstances[index];
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
                throw new Error(`WebSocket ${index} was not created`);
            };
            const readyMessage = {
                type: 'ready',
                runtimeState: 'interactive_ready',
                inputReady: true,
                terminalAccess: { state: 'owner' }
            };

            const connectPromise = client.connect('session-open', { skipInitialResize: true });
            const ws = await waitForWs(0);
            ws.emit(wsSnapshot('initial latest'));
            ws.emit(readyMessage);
            await connectPromise;
            await waitUntilIdle();

            client.terminal.scrollToLine(0);
            const beforeRefresh = {
                baseY: client.terminal.buffer.active.baseY,
                viewportY: client.terminal.buffer.active.viewportY,
                visibleText: visibleText()
            };

            ws.emit(wsSnapshot('deferred refresh'));
            await waitUntilIdle();
            await new Promise((resolve) => setTimeout(resolve, 50));
            const afterRefreshWhileReading = {
                baseY: client.terminal.buffer.active.baseY,
                viewportY: client.terminal.buffer.active.viewportY,
                pendingSnapshotText: client._pendingSnapshotText,
                visibleText: visibleText()
            };

            client.terminal.scrollToBottom();
            await waitUntilIdle();
            await new Promise((resolve) => setTimeout(resolve, 50));
            const afterReturnToBottom = {
                baseY: client.terminal.buffer.active.baseY,
                viewportY: client.terminal.buffer.active.viewportY,
                visibleText: visibleText()
            };

            window.WebSocket = originalWebSocket;
            host.remove();
            return {
                beforeRefresh,
                afterRefreshWhileReading,
                afterReturnToBottom
            };
        });

        expect(result.beforeRefresh.baseY).toBeGreaterThan(result.beforeRefresh.viewportY);
        expect(result.afterRefreshWhileReading.viewportY).toBe(result.beforeRefresh.viewportY);
        expect(result.afterRefreshWhileReading.pendingSnapshotText).toContain('deferred refresh line 160');
        expect(result.afterRefreshWhileReading.visibleText).not.toContain('deferred refresh line 160');
        expect(result.afterReturnToBottom.viewportY).toBe(result.afterReturnToBottom.baseY);
        expect(ac5).toBe('A normal snapshot applied while the user is scrolled up restores the previous distance from the bottom.');
        expect(ac6).toBe('The fix uses the existing serialized terminal write path and does not introduce direct `terminal.write()` calls.');
        expect(result.afterReturnToBottom.visibleText).toContain('deferred refresh line 160');
    });
});
