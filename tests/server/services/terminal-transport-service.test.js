import { describe, expect, it, vi } from 'vitest';
import { TerminalTransportService } from '../../../server/services/terminal-transport-service.js';

function buildService() {
    const sessionManager = {
        scrollSession: vi.fn(async () => {}),
        exitCopyMode: vi.fn(async () => {}),
        sendInput: vi.fn(async () => {}),
        resizeSessionWindow: vi.fn(async () => {}),
        touchTerminalOwnership: vi.fn(),
        ensureTerminalOwnership: vi.fn(() => ({ allowed: true })),
        isTmuxSessionRunning: vi.fn(async () => true),
        getContent: vi.fn(async () => 'snapshot'),
        getPaneMode: vi.fn(async () => false)
    };

    const service = new TerminalTransportService({ sessionManager });
    return { service, sessionManager };
}

describe('TerminalTransportService', () => {
    it('scroll message で tmux scroll を呼ぶ', async () => {
        const { service, sessionManager } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() }
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'scroll',
            direction: 'down',
            steps: 99
        }));

        expect(sessionManager.scrollSession).toHaveBeenCalledWith('session-1', 'down', 8);
        expect(sessionManager.touchTerminalOwnership).toHaveBeenCalledWith('session-1', 'viewer-1', 'Local / Mac');
    });

    it('exit_copy_mode message で tmux copy-mode を抜ける', async () => {
        const { service, sessionManager } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() }
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'exit_copy_mode'
        }));

        expect(sessionManager.exitCopyMode).toHaveBeenCalledWith('session-1');
        expect(sessionManager.touchTerminalOwnership).toHaveBeenCalledWith('session-1', 'viewer-1', 'Local / Mac');
    });
});
