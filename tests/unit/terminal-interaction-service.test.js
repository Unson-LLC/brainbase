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

        expect(transport.sendText).toHaveBeenCalledWith('hello');
        expect(transport.sendKey).toHaveBeenCalledWith('Enter');
        expect(httpClient.post).not.toHaveBeenCalled();
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
