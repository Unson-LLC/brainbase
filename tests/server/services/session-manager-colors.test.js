import { describe, it, expect, vi } from 'vitest';
import { createSessionServices } from '../../../server/services/create-session-services.js';

describe('SessionManager.getContentWithColors', () => {
    it('tmux capture-pane に -e フラグが付与される', async () => {
        const execPromise = vi.fn().mockResolvedValue({ stdout: '\x1b[38;5;114mtest\x1b[0m' });
        const sm = createSessionServices({
            serverDir: '/tmp',
            execPromise,
            stateStore: { getState: vi.fn(() => ({})), setState: vi.fn(), subscribe: vi.fn() },
            worktreeService: null,
        }).sessionApi;
        const result = await sm.getContentWithColors('test-session', 10);
        expect(execPromise).toHaveBeenCalledWith(
            expect.stringContaining('-e')
        );
        expect(execPromise).toHaveBeenCalledWith(
            expect.stringContaining('test-session')
        );
        expect(result).toContain('\x1b[38;5;114m');
    });
});
