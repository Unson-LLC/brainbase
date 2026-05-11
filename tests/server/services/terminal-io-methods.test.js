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

describe('terminalIoMethods input routing', () => {
    it('長い画像パスはtyping simulationせずliteral textで送る対象にする', () => {
        const imagePath = '/Users/ksato/workspace/code/brainbase/uploads/2026-05-11/codex-image-path-performance-probe-abcdefghijklmnopqrstuvwxyz0123456789.png';

        expect(terminalIoMethods._shouldUseTypingSimulation(imagePath, 'text')).toBe(false);
        expect(terminalIoMethods._shouldUseLiteralText(imagePath, 'text')).toBe(true);
        expect(terminalIoMethods._isFastStructuredText(imagePath)).toBe(true);
    });

    it('長いslash commandはtyping simulationしない', () => {
        const command = '/ohayo --include-calendar --include-mail --include-slack --format html';

        expect(terminalIoMethods._shouldUseTypingSimulation(command, 'text')).toBe(false);
        expect(terminalIoMethods._shouldUseLiteralText(command, 'text')).toBe(true);
        expect(terminalIoMethods._isFastStructuredText(command)).toBe(true);
    });

    it('長い自然文はCodex向けtyping simulationを維持する', () => {
        const prompt = 'Please analyze the current UI rendering issue and summarize the remaining heavy path before changing code.';

        expect(terminalIoMethods._shouldUseTypingSimulation(prompt, 'text')).toBe(true);
        expect(terminalIoMethods._isFastStructuredText(prompt)).toBe(false);
    });

    it('長い画像パスのsendInputは1回のliteral送信にする', async () => {
        const manager = {
            ...terminalIoMethods,
            ALLOWED_KEYS: [],
            terminalMutationQueues: new Map(),
            execPromise: vi.fn(async () => ({ stdout: '' })),
            _capturePromptInput: vi.fn(async () => {}),
            _runTmux: vi.fn(async () => ({ stdout: '' }))
        };
        const imagePath = '/Users/ksato/workspace/code/brainbase/uploads/2026-05-11/codex-image-path-performance-probe-abcdefghijklmnopqrstuvwxyz0123456789.png';

        await manager.sendInput('session-1', imagePath, 'text');

        expect(manager._runTmux).toHaveBeenCalledTimes(1);
        expect(manager._runTmux).toHaveBeenCalledWith(['send-keys', '-t', 'session-1', '-l', '--', imagePath]);
    });
});
