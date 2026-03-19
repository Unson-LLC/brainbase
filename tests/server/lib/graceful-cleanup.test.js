import { describe, it, expect, vi } from 'vitest';
import { gracefulCleanup } from '../../../server/lib/graceful-cleanup.js';

describe('gracefulCleanup', () => {
    it('全ステップ成功_成功結果とwarnings空を返す', async () => {
        const result = await gracefulCleanup('test-session', [
            { name: 'step1', fn: async () => 'done1' },
            { name: 'step2', fn: async () => 'done2' },
        ]);

        expect(result.success).toBe(true);
        expect(result.warnings).toEqual([]);
        expect(result.completed).toEqual(['step1', 'step2']);
    });

    it('一部ステップ失敗_後続ステップが続行される', async () => {
        const step3Fn = vi.fn().mockResolvedValue('done3');

        const result = await gracefulCleanup('test-session', [
            { name: 'step1', fn: async () => 'done1' },
            { name: 'step2', fn: async () => { throw new Error('tmux kill failed'); } },
            { name: 'step3', fn: step3Fn },
        ]);

        expect(result.success).toBe(true); // partial success
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain('step2');
        expect(result.warnings[0]).toContain('tmux kill failed');
        expect(result.completed).toContain('step1');
        expect(result.completed).toContain('step3');
        expect(step3Fn).toHaveBeenCalledTimes(1);
    });

    it('全ステップ失敗_success=falseでwarnings全件を返す', async () => {
        const result = await gracefulCleanup('test-session', [
            { name: 'step1', fn: async () => { throw new Error('fail1'); } },
            { name: 'step2', fn: async () => { throw new Error('fail2'); } },
        ]);

        expect(result.success).toBe(false);
        expect(result.warnings).toHaveLength(2);
        expect(result.completed).toEqual([]);
    });

    it('空ステップ配列_success=trueを返す', async () => {
        const result = await gracefulCleanup('test-session', []);

        expect(result.success).toBe(true);
        expect(result.warnings).toEqual([]);
        expect(result.completed).toEqual([]);
    });

    it('sessionIdがログに含まれる', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await gracefulCleanup('my-session-123', [
            { name: 'fail-step', fn: async () => { throw new Error('oops'); } },
        ]);

        expect(consoleSpy).toHaveBeenCalled();
        const logMsg = consoleSpy.mock.calls[0][0];
        expect(logMsg).toContain('my-session-123');

        consoleSpy.mockRestore();
    });

    it('同期関数もステップとして使える', async () => {
        const result = await gracefulCleanup('test', [
            { name: 'sync-step', fn: () => 'sync-result' },
        ]);

        expect(result.success).toBe(true);
        expect(result.completed).toEqual(['sync-step']);
    });
});
