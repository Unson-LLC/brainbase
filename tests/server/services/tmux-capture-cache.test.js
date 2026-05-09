import { describe, expect, it, vi } from 'vitest';
import { TmuxCaptureCache } from '../../../server/services/tmux-capture-cache.js';

describe('TmuxCaptureCache', () => {
    it('履歴snapshotは最大5000行まで要求できる', async () => {
        const snapshotService = {
            getContent: vi.fn(async () => 'history snapshot'),
            getContentWithColors: vi.fn(async () => null),
            getPaneMode: vi.fn(async () => false)
        };
        const cache = new TmuxCaptureCache({ snapshotService });

        await cache.getSnapshot('session-1', {
            lines: 5000,
            includeColors: true,
            includeCopyMode: true,
            visibleOnly: false
        });

        expect(snapshotService.getContent).toHaveBeenCalledWith('session-1', 5000);
        expect(snapshotService.getContentWithColors).toHaveBeenCalledWith('session-1', 5000);
    });

    it('過大な履歴snapshot要求は5000行に丸める', async () => {
        const snapshotService = {
            getContent: vi.fn(async () => 'history snapshot'),
            getContentWithColors: vi.fn(async () => null),
            getPaneMode: vi.fn(async () => false)
        };
        const cache = new TmuxCaptureCache({ snapshotService });

        await cache.getSnapshot('session-1', {
            lines: 9999,
            includeColors: false,
            includeCopyMode: false,
            visibleOnly: false
        });

        expect(snapshotService.getContent).toHaveBeenCalledWith('session-1', 5000);
    });
});
