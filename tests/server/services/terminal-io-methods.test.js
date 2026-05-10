import { describe, expect, it, vi } from 'vitest';

import { terminalIoMethods } from '../../../server/services/session-runtime/terminal-io-methods.js';

function buildManager({ paneSize = '80,24', repairedPaneSize = '80,24' } = {}) {
    let displayCount = 0;
    return {
        ...terminalIoMethods,
        execPromise: vi.fn(async (cmd) => {
            if (cmd.includes('tmux display-message')) {
                displayCount += 1;
                return { stdout: displayCount === 1 ? paneSize : repairedPaneSize };
            }
            return { stdout: '' };
        }),
        _enqueueTerminalMutation: vi.fn(async (_sessionId, fn) => fn())
    };
}

describe('terminalIoMethods terminal geometry repair', () => {
    it('getSessionPaneSize呼び出し時_tmux pane sizeをparseする', async () => {
        const manager = buildManager({ paneSize: '121,35' });

        await expect(manager.getSessionPaneSize('session-1')).resolves.toEqual({
            cols: 121,
            rows: 35
        });
    });

    it('repairCollapsedSessionWindow呼び出し時_2x1 paneを80x24へ修復する', async () => {
        const manager = buildManager({ paneSize: '2,1', repairedPaneSize: '80,24' });

        const result = await manager.repairCollapsedSessionWindow('session-1', {
            reason: 'test'
        });

        expect(result).toEqual({
            repaired: true,
            paneSize: { cols: 2, rows: 1 },
            repairedPaneSize: { cols: 80, rows: 24 },
            target: { cols: 80, rows: 24 },
            reason: 'test'
        });
        expect(manager.execPromise).toHaveBeenCalledWith(expect.stringContaining('tmux resize-window -t "session-1" -x 80 -y 24'));
    });

    it('repairCollapsedSessionWindow呼び出し時_正常paneは修復しない', async () => {
        const manager = buildManager({ paneSize: '120,40' });

        const result = await manager.repairCollapsedSessionWindow('session-1', {
            reason: 'test'
        });

        expect(result).toEqual({
            repaired: false,
            paneSize: { cols: 120, rows: 40 },
            reason: 'pane-size-ok'
        });
        expect(manager.execPromise).not.toHaveBeenCalledWith(expect.stringContaining('resize-window'));
    });
});
