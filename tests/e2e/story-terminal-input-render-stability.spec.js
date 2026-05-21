import { test, expect } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

test.describe('story-terminal-input-render-stability', () => {
    test('AC: browser xterm serializes output, snapshot repaint, and follow-up output', async ({ page }) => {
        // story-terminal-input-render-stability ac:1
        // story-terminal-input-render-stability ac:2
        // story-terminal-input-render-stability ac:3
        // story-terminal-input-render-stability ac:4
        // story-terminal-input-render-stability ac:5
        // story-terminal-input-render-stability ac:6
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        const result = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import('/modules/core/terminal-transport-client.js');
            const host = document.createElement('div');
            host.id = 'story-terminal-input-render-stability-host';
            host.style.width = '960px';
            host.style.height = '360px';
            host.style.position = 'fixed';
            host.style.left = '0';
            host.style.top = '0';
            host.style.zIndex = '2147483647';
            host.style.background = '#000';
            document.body.appendChild(host);

            const client = new TerminalTransportClient({
                viewerId: 'story-e2e',
                viewerLabel: 'Story E2E'
            });
            await client.init(host);
            client.status.mode = 'live';
            client.status.transport = 'streaming';

            const originalWrite = client.terminal.write.bind(client.terminal);
            const originalReset = client.terminal.reset?.bind(client.terminal);
            const writeCalls = [];
            const pendingCallbacks = [];
            const resetOrder = [];

            client.terminal.write = (text, callback) => {
                writeCalls.push(text);
                originalWrite(text, () => {});
                pendingCallbacks.push(callback);
            };
            client.terminal.reset = () => {
                resetOrder.push(writeCalls.length);
                originalReset?.();
            };

            client._applyOutput('first output');
            client._applySnapshot('snapshot body', { resetTerminal: true });
            client._applyOutput('\r\nafter snapshot');

            await new Promise((resolve) => setTimeout(resolve, 30));
            const beforeRelease = {
                writeCalls: [...writeCalls],
                resetOrder: [...resetOrder],
                active: client._terminalWriteActive,
                queued: client._terminalWriteQueue.length
            };

            while (pendingCallbacks.length > 0) {
                const callback = pendingCallbacks.shift();
                callback?.();
                await new Promise((resolve) => setTimeout(resolve, 30));
            }
            await new Promise((resolve) => setTimeout(resolve, 80));

            const buffer = client.terminal.buffer.active;
            const rows = [];
            for (let index = 0; index < buffer.length; index += 1) {
                const line = buffer.getLine(index);
                if (line) rows.push(line.translateToString(true));
            }

            return {
                beforeRelease,
                writeCalls,
                resetOrder,
                finalText: rows.join('\n'),
                queueActive: client._terminalWriteActive,
                queueLength: client._terminalWriteQueue.length
            };
        });

        expect(result.beforeRelease.writeCalls).toEqual(['first output']);
        expect(result.beforeRelease.resetOrder).toEqual([]);
        expect(result.beforeRelease.active).toBe(true);
        expect(result.beforeRelease.queued).toBe(2);

        expect(result.writeCalls).toEqual([
            'first output',
            '\x1b[2J\x1b[3J\x1b[Hsnapshot body',
            '\r\nafter snapshot'
        ]);
        expect(result.resetOrder).toEqual([1]);
        expect(result.queueActive).toBe(false);
        expect(result.queueLength).toBe(0);
        expect(result.finalText).toContain('snapshot body');
        expect(result.finalText).toContain('after snapshot');
        expect(result.finalText).not.toContain('first outputfirst output');

        await page.screenshot({
            path: 'var/test-results/story-terminal-input-render-stability-xterm.png',
            fullPage: false
        });
        await page.evaluate(() => {
            document.getElementById('story-terminal-input-render-stability-host')?.remove();
        });
    });

    test('AC: browser keyboard type-to-focus sends xterm input keys without contract drift', async ({ page }) => {
        // story-terminal-input-render-stability ac:3
        // story-terminal-input-render-stability ac:4
        // story-terminal-input-render-stability ac:5
        // story-terminal-input-render-stability ac:7
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        await page.evaluate(async () => {
            const { applyTerminalInputUxMixin } = await import('/modules/app/terminal-input-ux-mixin.js');
            const { appStore } = await import('/modules/core/store.js');
            document.body.innerHTML = `
                <main id="story-terminal-input-render-stability-keyboard-root">
                    <button id="story-terminal-input-render-stability-outside-focus" type="button">outside focus</button>
                    <section id="console-area" class="using-xterm">
                        <iframe id="terminal-frame" src="/console/session-1"></iframe>
                        <div id="terminal-xterm-host"></div>
                        <button id="terminal-more-btn" type="button"></button>
                        <div id="terminal-more-actions"></div>
                        <button id="terminal-transport-switcher-btn" type="button"></button>
                        <div id="terminal-transport-dropdown"></div>
                    </section>
                </main>`;

            class TestApp {}
            applyTerminalInputUxMixin(TestApp);
            const sentKeys = [];
            const sentText = [];
            const app = new TestApp();
            app.terminalFrame = document.getElementById('terminal-frame');
            app.terminalXtermHost = document.getElementById('terminal-xterm-host');
            app._terminalInputUxCleanup = [];
            app._terminalSnapshotCache = new Map();
            app._terminalCopyModeSessions = new Set();
            app._terminalLastNavigateAt = 0;
            app._weeklyTokenUsage = null;
            app.isMobile = () => false;
            app._shouldUseXtermTransport = () => true;
            app._isConsoleVisible = () => true;
            app._isEditableTarget = () => false;
            app._isMobileSnapshotMode = () => false;
            app._getTerminalOverlayState = () => ({ any: false, choiceActive: false, dropActive: false });
            app._getSessionById = () => ({ id: 'session-1', engine: 'codex' });
            app._isXtermTransportActive = (sessionId) => sessionId === 'session-1';
            app._setTerminalInputStatus = () => {};
            app._resetTerminalChrome = () => {};
            app._updateTerminalTokenStatus = () => {};
            app._closeTransportDropdown = () => {};
            app._loadWeeklyTokenUsage = async () => {};
            app.focusTerminal = (reason) => {
                app.lastFocusReason = reason;
            };
            app.terminalTransportClient = {
                status: { isFocused: false },
                hasDomFocus: () => false,
                sendKey: async (value) => {
                    sentKeys.push(value);
                },
                sendText: async (value) => {
                    sentText.push(value);
                }
            };

            appStore.setState({
                currentSessionId: 'session-1',
                sessions: [{ id: 'session-1', engine: 'codex' }]
            });
            app.setupTerminalInputUx();
            window.__storyTerminalInputRenderStability = { sentKeys, sentText, app };
        });

        await page.locator('#story-terminal-input-render-stability-outside-focus').focus();
        await page.keyboard.type('a');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Shift+Enter');

        const result = await page.evaluate(() => ({
            sentKeys: window.__storyTerminalInputRenderStability.sentKeys,
            sentText: window.__storyTerminalInputRenderStability.sentText,
            focusReason: window.__storyTerminalInputRenderStability.app.lastFocusReason
        }));

        expect(result.sentText).toContain('a');
        expect(result.sentText).toContain('\x7f');
        expect(result.sentKeys).toContain('S-Enter');
        expect(result.sentKeys).not.toContain('M-Enter');
        expect(result.focusReason).toBe('type-to-focus');

        await page.screenshot({
            path: 'var/test-results/story-terminal-input-render-stability-keyboard.png',
            fullPage: false
        });
    });

    test('AC: browser xterm applies Backspace local erase without waiting for PTY echo', async ({ page }) => {
        // story-terminal-input-latency ac:1
        // story-terminal-input-latency ac:2
        // story-terminal-input-render-stability ac:3
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        const result = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import('/modules/core/terminal-transport-client.js');
            const host = document.createElement('div');
            host.id = 'story-terminal-backspace-local-echo-host';
            host.style.width = '960px';
            host.style.height = '240px';
            host.style.position = 'fixed';
            host.style.left = '0';
            host.style.top = '0';
            host.style.zIndex = '2147483647';
            host.style.background = '#000';
            document.body.appendChild(host);

            const client = new TerminalTransportClient({
                viewerId: 'story-e2e-backspace',
                viewerLabel: 'Story E2E Backspace'
            });
            await client.init(host);
            client.sessionId = 'session-1';
            client.status.mode = 'live';
            client.status.connected = true;
            client.status.inputReady = true;
            client.status.terminalAccess = { state: 'owner' };
            client.ws = {
                readyState: WebSocket.OPEN,
                send(message) {
                    this.sent.push(JSON.parse(message));
                },
                sent: []
            };

            const originalWrite = client.terminal.write.bind(client.terminal);
            const writeCalls = [];
            client.terminal.write = (text, callback) => {
                writeCalls.push(text);
                originalWrite(text, callback);
            };

            await client.sendText('\x7f');
            await new Promise((resolve) => requestAnimationFrame(resolve));

            return {
                writeCalls,
                sentMessages: client.ws.sent,
                pendingBackspaceEchoCount: client._pendingBackspaceEchoCount
            };
        });

        expect(result.writeCalls).toContain('\b \b');
        expect(result.sentMessages).toContainEqual({
            type: 'input',
            inputType: 'text',
            value: '\x7f'
        });
        expect(result.pendingBackspaceEchoCount).toBe(1);

        await page.screenshot({
            path: 'var/test-results/story-terminal-backspace-local-echo.png',
            fullPage: false
        });
        await page.evaluate(() => {
            document.getElementById('story-terminal-backspace-local-echo-host')?.remove();
        });
    });

    test('AC: browser xterm sends repeated Escape immediately without text batching', async ({ page }) => {
        // story-terminal-input-latency ac:1
        // story-terminal-input-latency ac:3
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        const result = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import('/modules/core/terminal-transport-client.js');
            const host = document.createElement('div');
            host.id = 'story-terminal-escape-immediate-host';
            host.style.width = '960px';
            host.style.height = '240px';
            host.style.position = 'fixed';
            host.style.left = '0';
            host.style.top = '0';
            host.style.zIndex = '2147483647';
            host.style.background = '#000';
            document.body.appendChild(host);

            const client = new TerminalTransportClient({
                viewerId: 'story-e2e-escape',
                viewerLabel: 'Story E2E Escape'
            });
            await client.init(host);
            client.sessionId = 'session-1';
            client.status.mode = 'live';
            client.status.connected = true;
            client.status.inputReady = true;
            client.status.terminalAccess = { state: 'owner' };
            client.ws = {
                readyState: WebSocket.OPEN,
                send(message) {
                    this.sent.push({ at: performance.now(), message: JSON.parse(message) });
                },
                sent: []
            };

            await client.sendText('a');
            await client.sendText('\x1b');
            await client.sendText('\x1b');

            return {
                sentMessages: client.ws.sent.map(item => item.message),
                pendingTextBuffer: client._pendingTextBuffer
            };
        });

        expect(result.sentMessages).toEqual([
            { type: 'input', inputType: 'text', value: 'a' },
            { type: 'input', inputType: 'text', value: '\x1b' },
            { type: 'input', inputType: 'text', value: '\x1b' }
        ]);
        expect(result.pendingTextBuffer).toBe('');

        await page.screenshot({
            path: 'var/test-results/story-terminal-escape-immediate.png',
            fullPage: false
        });
        await page.evaluate(() => {
            document.getElementById('story-terminal-escape-immediate-host')?.remove();
        });
    });
});
