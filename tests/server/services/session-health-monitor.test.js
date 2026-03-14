import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionHealthMonitor } from '../../../server/services/session-health-monitor.js';

/**
 * セッションヘルスモニタリングテスト（CommandMate移植）
 * activeSessionsの生死を定期チェックし、死んだセッションを検出
 */
describe('SessionHealthMonitor', () => {
    let monitor;
    let mockSessionManager;

    beforeEach(() => {
        mockSessionManager = {
            activeSessions: new Map(),
            isTmuxSessionRunning: vi.fn(),
            hookStatus: new Map(),
        };
        monitor = new SessionHealthMonitor(mockSessionManager);
    });

    describe('checkHealth()', () => {
        it('全セッション生存_空の結果を返す', async () => {
            mockSessionManager.activeSessions.set('session-1', { port: 40001 });
            mockSessionManager.activeSessions.set('session-2', { port: 40002 });
            mockSessionManager.isTmuxSessionRunning
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(true);

            const result = await monitor.checkHealth();

            expect(result.dead).toEqual([]);
            expect(result.alive).toEqual(['session-1', 'session-2']);
        });

        it('1セッション死亡_deadに含まれる', async () => {
            mockSessionManager.activeSessions.set('session-1', { port: 40001 });
            mockSessionManager.activeSessions.set('session-2', { port: 40002 });
            mockSessionManager.isTmuxSessionRunning
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);

            const result = await monitor.checkHealth();

            expect(result.dead).toEqual(['session-2']);
            expect(result.alive).toEqual(['session-1']);
        });

        it('activeSessionsが空_空の結果を返す', async () => {
            const result = await monitor.checkHealth();

            expect(result.dead).toEqual([]);
            expect(result.alive).toEqual([]);
        });

        it('isTmuxSessionRunningが例外_deadとして扱う', async () => {
            mockSessionManager.activeSessions.set('session-1', { port: 40001 });
            mockSessionManager.isTmuxSessionRunning
                .mockRejectedValue(new Error('tmux error'));

            const result = await monitor.checkHealth();

            expect(result.dead).toEqual(['session-1']);
        });
    });

    describe('onDeadSession callback', () => {
        it('死亡セッション検出時にcallbackが呼ばれる', async () => {
            const onDead = vi.fn();
            monitor = new SessionHealthMonitor(mockSessionManager, { onDeadSession: onDead });

            mockSessionManager.activeSessions.set('session-1', { port: 40001 });
            mockSessionManager.isTmuxSessionRunning.mockResolvedValue(false);

            await monitor.checkHealth();

            expect(onDead).toHaveBeenCalledWith('session-1');
        });

        it('生存セッションではcallbackが呼ばれない', async () => {
            const onDead = vi.fn();
            monitor = new SessionHealthMonitor(mockSessionManager, { onDeadSession: onDead });

            mockSessionManager.activeSessions.set('session-1', { port: 40001 });
            mockSessionManager.isTmuxSessionRunning.mockResolvedValue(true);

            await monitor.checkHealth();

            expect(onDead).not.toHaveBeenCalled();
        });
    });
});
