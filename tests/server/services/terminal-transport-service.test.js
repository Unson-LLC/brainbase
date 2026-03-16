import { describe, expect, it, vi } from 'vitest';
import { TerminalTransportService } from '../../../server/services/terminal-transport-service.js';

function buildService() {
    const sessionManager = {
        sendInput: vi.fn(async () => {}),
        resizeSessionWindow: vi.fn(async () => {}),
        touchTerminalOwnership: vi.fn(),
        ensureTerminalOwnership: vi.fn(() => ({ allowed: true })),
        isTmuxSessionRunning: vi.fn(async () => true),
        getContent: vi.fn(async () => 'snapshot'),
        getContentWithColors: vi.fn(async () => null),
        getPaneMode: vi.fn(async () => false)
    };

    const service = new TerminalTransportService({ sessionManager });
    return { service, sessionManager };
}

describe('TerminalTransportService', () => {
    it('input message で tmux sendInput を呼ぶ', async () => {
        const { service, sessionManager } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() }
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: 'hello'
        }));

        expect(sessionManager.sendInput).toHaveBeenCalledWith('session-1', 'hello', 'text');
        expect(sessionManager.touchTerminalOwnership).toHaveBeenCalledWith('session-1', 'viewer-1', 'Local / Mac');
    });

    it('resize message で sessionManager.resizeSessionWindow を呼ぶ', async () => {
        const { service, sessionManager } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            cols: 80,
            rows: 24,
            ws: { readyState: 1, send: vi.fn() }
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'resize',
            cols: 120,
            rows: 40
        }));

        expect(sessionManager.resizeSessionWindow).toHaveBeenCalledWith('session-1', 120, 40);
    });
});
