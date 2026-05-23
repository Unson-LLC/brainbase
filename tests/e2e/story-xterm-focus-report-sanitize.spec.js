import { test, expect } from '@playwright/test';

test.describe('story-xterm-focus-report-sanitize', () => {
    test('browser xterm input strips focus reports before echo and websocket send', async ({ page }) => {
        // story-xterm-focus-report-sanitize ac:1
        // story-xterm-focus-report-sanitize ac:2
        // story-xterm-focus-report-sanitize ac:3
        // story-xterm-focus-report-sanitize ac:4
        await page.goto('/');
        await page.waitForLoadState('domcontentloaded');

        const result = await page.evaluate(async () => {
            const { TerminalTransportClient } = await import('/modules/core/terminal-transport-client.js');
            const sent = [];
            const echoed = [];
            const client = new TerminalTransportClient({
                viewerId: 'story-focus-report-e2e',
                viewerLabel: 'Story Focus Report E2E'
            });
            client.sessionId = 'session-story-focus-report';
            client.status.mode = 'live';
            client.status.terminalAccess = { state: 'owner' };
            client.status.inputReady = true;
            client.ws = {
                readyState: WebSocket.OPEN,
                send: (payload) => sent.push(JSON.parse(payload))
            };
            client.terminal = {
                write: (text, callback) => {
                    echoed.push(text);
                    callback?.();
                }
            };

            await client.sendText('\x1b[I');
            await client.sendText('[I');
            await client.sendText('hello[Iworld\x1b[O');
            await new Promise((resolve) => setTimeout(resolve, 40));

            return {
                sent,
                echoed,
                pending: client._pendingTextBuffer
            };
        });

        expect(result.echoed).toEqual(['helloworld']);
        expect(result.sent).toEqual([{
            type: 'input',
            inputType: 'text',
            value: 'helloworld'
        }]);
        expect(result.pending).toBe('');
    });
});
