import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalInteractionService } from '../../public/modules/core/terminal-interaction-service.js';

describe('TerminalInteractionService', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('xtermがwritableならWebSocket経由で送信する', async () => {
        const httpClient = { post: vi.fn() };
        const transport = {
            canSendInput: vi.fn(() => true),
            sendText: vi.fn(async () => {}),
            sendKey: vi.fn(async () => {})
        };
        const service = new TerminalInteractionService({
            httpClient,
            getTerminalTransportClient: () => transport,
            shouldUseXtermTransport: () => true
        });

        await service.sendInput('session-1', 'hello');

        expect(transport.sendText).toHaveBeenCalledWith('hello\n');
        expect(transport.sendKey).not.toHaveBeenCalled();
        expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('sendTextは改行を付けずにxtermへ即時送信する', async () => {
        const httpClient = { post: vi.fn() };
        const transport = {
            canSendInput: vi.fn(() => true),
            sendText: vi.fn(async () => {})
        };
        const service = new TerminalInteractionService({
            httpClient,
            getTerminalTransportClient: () => transport,
            shouldUseXtermTransport: () => true
        });

        await service.sendText('session-1', '/tmp/image.png');

        expect(transport.sendText).toHaveBeenCalledWith('/tmp/image.png');
        expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('slash commandはpaste経路に落とさずliteral textとEnterに分けて送信する', async () => {
        const httpClient = { post: vi.fn(async () => {}) };
        const service = new TerminalInteractionService({
            httpClient,
            shouldUseXtermTransport: () => false
        });

        await service.sendInput('session-1', '/ohayo');

        expect(httpClient.post).toHaveBeenNthCalledWith(1, '/api/sessions/session-1/input', {
            input: '/ohayo',
            type: 'text'
        });
        expect(httpClient.post).toHaveBeenNthCalledWith(2, '/api/sessions/session-1/input', {
            input: 'Enter',
            type: 'key'
        });
    });

    it('slash command with optionsもliteral textとEnterに分けて送信する', async () => {
        const httpClient = { post: vi.fn(async () => {}) };
        const service = new TerminalInteractionService({
            httpClient,
            shouldUseXtermTransport: () => false
        });

        await service.sendInput('session-1', '/ohayo --include-calendar --include-mail');

        expect(httpClient.post).toHaveBeenNthCalledWith(1, '/api/sessions/session-1/input', {
            input: '/ohayo --include-calendar --include-mail',
            type: 'text'
        });
        expect(httpClient.post).toHaveBeenNthCalledWith(2, '/api/sessions/session-1/input', {
            input: 'Enter',
            type: 'key'
        });
    });

    it('codexセッションのproject slash commandは通常プロンプトへ変換して送信する', async () => {
        const httpClient = { post: vi.fn(async () => {}) };
        const service = new TerminalInteractionService({
            httpClient,
            getSessionEngine: () => 'codex',
            shouldUseXtermTransport: () => false
        });

        await service.sendInput('session-1', '/ohayo');

        expect(httpClient.post).toHaveBeenCalledTimes(1);
        expect(httpClient.post).toHaveBeenCalledWith('/api/sessions/session-1/input', {
            input: 'Run the project command /ohayo by following .claude/commands/ohayo.md.\n',
            type: 'text'
        });
    });

    it('codexセッションのproject slash command引数も通常プロンプトへ渡す', async () => {
        const httpClient = { post: vi.fn(async () => {}) };
        const service = new TerminalInteractionService({
            httpClient,
            getSessionEngine: () => 'codex',
            shouldUseXtermTransport: () => false
        });

        await service.sendInput('session-1', '/ohayo --include-calendar');

        expect(httpClient.post).toHaveBeenCalledWith('/api/sessions/session-1/input', {
            input: 'Run the project command /ohayo by following .claude/commands/ohayo.md. Arguments: --include-calendar\n',
            type: 'text'
        });
    });

    it('claudeセッションのproject slash commandは変換しない', async () => {
        const httpClient = { post: vi.fn(async () => {}) };
        const service = new TerminalInteractionService({
            httpClient,
            getSessionEngine: () => 'claude',
            shouldUseXtermTransport: () => false
        });

        await service.sendInput('session-1', '/ohayo');

        expect(httpClient.post).toHaveBeenNthCalledWith(1, '/api/sessions/session-1/input', {
            input: '/ohayo',
            type: 'text'
        });
        expect(httpClient.post).toHaveBeenNthCalledWith(2, '/api/sessions/session-1/input', {
            input: 'Enter',
            type: 'key'
        });
    });

    it('codexセッションのproject slash commandはxterm経由でも通常プロンプトへ変換する', async () => {
        const httpClient = { post: vi.fn(async () => {}) };
        const transport = {
            canSendInput: vi.fn(() => true),
            sendText: vi.fn(async () => {}),
            sendKey: vi.fn(async () => {})
        };
        const service = new TerminalInteractionService({
            httpClient,
            getTerminalTransportClient: () => transport,
            getSessionEngine: () => 'codex',
            shouldUseXtermTransport: () => true
        });

        await service.sendInput('session-1', '/ohayo');

        expect(transport.sendText).toHaveBeenCalledWith(
            'Run the project command /ohayo by following .claude/commands/ohayo.md.\n'
        );
        expect(transport.sendKey).not.toHaveBeenCalled();
        expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('ファイルパスはslash command扱いにしない', async () => {
        const httpClient = { post: vi.fn(async () => {}) };
        const service = new TerminalInteractionService({
            httpClient,
            shouldUseXtermTransport: () => false
        });

        await service.sendInput('session-1', '/Users/ksato/workspace/code/brainbase/screenshot.png');

        expect(httpClient.post).toHaveBeenCalledTimes(1);
        expect(httpClient.post).toHaveBeenCalledWith('/api/sessions/session-1/input', {
            input: '/Users/ksato/workspace/code/brainbase/screenshot.png\n',
            type: 'text'
        });
    });

    it('xtermがwritableでなければHTTP fallback後にsnapshot同期する', async () => {
        const httpClient = { post: vi.fn(async () => {}) };
        const transport = {
            canSendInput: vi.fn(() => false),
            isActiveForSession: vi.fn(() => true),
            isBlockedForSession: vi.fn(() => false),
            refreshSnapshot: vi.fn(async () => {})
        };
        const service = new TerminalInteractionService({
            httpClient,
            getTerminalTransportClient: () => transport,
            shouldUseXtermTransport: () => true
        });

        await service.sendKey('session-1', 'Escape');

        expect(httpClient.post).toHaveBeenCalledWith('/api/sessions/session-1/input', {
            input: 'Escape',
            type: 'key'
        });
        expect(transport.refreshSnapshot).toHaveBeenCalled();
    });

    it('sendTextのHTTP fallback後もsnapshot同期する', async () => {
        const httpClient = { post: vi.fn(async () => {}) };
        const transport = {
            canSendInput: vi.fn(() => false),
            isActiveForSession: vi.fn(() => true),
            isBlockedForSession: vi.fn(() => false),
            refreshSnapshot: vi.fn(async () => {})
        };
        const service = new TerminalInteractionService({
            httpClient,
            getTerminalTransportClient: () => transport,
            shouldUseXtermTransport: () => true
        });

        await service.sendText('session-1', '/tmp/image.png');

        expect(httpClient.post).toHaveBeenCalledWith('/api/sessions/session-1/input', {
            input: '/tmp/image.png',
            type: 'text'
        });
        expect(transport.refreshSnapshot).toHaveBeenCalled();
    });

    it('blocked状態では送信しない', async () => {
        const httpClient = { post: vi.fn(async () => {}) };
        const transport = {
            canSendInput: vi.fn(() => false),
            isBlockedForSession: vi.fn(() => true)
        };
        const service = new TerminalInteractionService({
            httpClient,
            getTerminalTransportClient: () => transport,
            shouldUseXtermTransport: () => true
        });

        await expect(service.sendKey('session-1', 'Enter')).rejects.toMatchObject({
            code: 'TERMINAL_BLOCKED'
        });
        expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('ttyd系fallback時も送信可能と判定する', () => {
        const service = new TerminalInteractionService({
            httpClient: { post: vi.fn() },
            getFallbackTerminalAccess: () => ({ state: 'owner' }),
            shouldUseXtermTransport: () => false
        });

        expect(service.getAvailability('session-1')).toEqual({
            canSend: true,
            reason: 'ready'
        });
    });
});
