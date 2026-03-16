import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalTransportClient } from '../../public/modules/core/terminal-transport-client.js';

/**
 * セッション中断（Interrupt）テスト（CommandMate移植）
 * AI処理中にCtrl+Cを送信して中断する機能
 */
describe('session interrupt (CommandMate pattern)', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {
            location: { protocol: 'http:', host: 'localhost:31013', hostname: 'localhost' }
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('TerminalTransportClient.interrupt()', () => {
        it('WebSocket接続中_C-cキーを送信する', async () => {
            const sentMessages = [];
            const client = new TerminalTransportClient({
                viewerId: 'test',
                viewerLabel: 'Test'
            });
            client.ws = {
                readyState: 1,
                send(msg) { sentMessages.push(JSON.parse(msg)); }
            };
            client.status.mode = 'live';
            client.status.copyMode = false;

            await client.interrupt();

            expect(sentMessages).toContainEqual({
                type: 'input',
                inputType: 'key',
                value: 'C-c'
            });
        });

        it('WebSocket未接続_何もしない（エラーなし）', async () => {
            const client = new TerminalTransportClient({
                viewerId: 'test',
                viewerLabel: 'Test'
            });
            client.ws = null;

            // Should not throw
            await client.interrupt();
        });

        it('copyMode中_先にexitCopyModeしてからC-cを送信', async () => {
            const sentMessages = [];
            const client = new TerminalTransportClient({
                viewerId: 'test',
                viewerLabel: 'Test'
            });
            client.ws = {
                readyState: 1,
                send(msg) { sentMessages.push(JSON.parse(msg)); }
            };
            client.status.mode = 'live';
            client.status.copyMode = true;

            await client.interrupt();

            expect(sentMessages[0]).toEqual({ type: 'exit_copy_mode' });
            expect(sentMessages[1]).toEqual({
                type: 'input',
                inputType: 'key',
                value: 'C-c'
            });
        });
    });
});
