import { test, expect } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

test.describe('story-terminal-open-scroll-bottom', () => {
    test('AC: browser xterm connect, reconnect, and session switch snapshots open at latest output', async ({ page }) => {
        // story-terminal-open-scroll-bottom ac:1
        // story-terminal-open-scroll-bottom ac:3
        // story-terminal-open-scroll-bottom ac:4
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        const result = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import('/modules/core/terminal-transport-client.js');
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
            const sendSnapshotThenReady = async (connectPromise, prefix) => {
                const ws = await waitForWs(wsInstances.length);
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
                client.connect('session-open', { skipInitialResize: true }),
                'open latest'
            );
            client.terminal.scrollToLine(0);
            const reconnect = await sendSnapshotThenReady(client.reconnect(), 'reconnect latest');
            client.terminal.scrollToLine(0);
            const sessionSwitch = await sendSnapshotThenReady(
                client.connect('session-switch', { skipInitialResize: true }),
                'switch latest'
            );

            window.WebSocket = originalWebSocket;
            host.remove();
            return {
                before,
                open,
                reconnect,
                sessionSwitch
            };
        });

        expect(result.before.baseY).toBeGreaterThan(result.before.viewportY);
        for (const state of [result.open, result.reconnect, result.sessionSwitch]) {
            expect(state.viewportY).toBe(state.baseY);
        }
        expect(result.open.visibleText).toContain('open latest line 160');
        expect(result.reconnect.visibleText).toContain('reconnect latest line 160');
        expect(result.sessionSwitch.visibleText).toContain('switch latest line 160');
        expect(result.sessionSwitch.visibleText).not.toContain('old line 1');
    });

    test('AC: browser xterm normal snapshot does not steal a scrolled-up viewport', async ({ page }) => {
        // story-terminal-open-scroll-bottom ac:2
        // story-terminal-open-scroll-bottom ac:3
        // story-terminal-open-scroll-bottom ac:4
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        const result = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import('/modules/core/terminal-transport-client.js');
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
        expect(result.afterReturnToBottom.visibleText).toContain('deferred refresh line 160');
    });
});
