import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../public/modules/toast.js', () => ({
    showError: vi.fn(),
    showInfo: vi.fn()
}));

describe('session-indicators', () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = `
            <div id="connection-status">
                <span class="connection-icon"></span>
                <span class="connection-text"></span>
            </div>
            <div class="session-child-row" data-id="session-1"></div>
        `;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('pollSessionStatus呼び出し時_running/proxyPath差分でもonStatusChangeが呼ばれる', async () => {
        global.fetch = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    'session-1': {
                        isWorking: false,
                        isDone: false,
                        running: true,
                        proxyPath: '/console/session-1',
                        port: 9010
                    }
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    'session-1': {
                        isWorking: false,
                        isDone: false,
                        running: false,
                        proxyPath: null,
                        port: null
                    }
                })
            });

        const { pollSessionStatus } = await import('../../public/modules/session-indicators.js');
        const onStatusChange = vi.fn(async () => {});

        await pollSessionStatus('session-1', onStatusChange);
        await pollSessionStatus('session-1', onStatusChange);

        expect(onStatusChange).toHaveBeenCalledTimes(2);
    });

    it('pollSessionStatus呼び出し時_セッション消滅差分でもonStatusChangeが呼ばれる', async () => {
        global.fetch = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    'session-1': {
                        isWorking: true,
                        isDone: false,
                        running: true,
                        proxyPath: '/console/session-1',
                        port: 9010
                    }
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({})
            });

        const { pollSessionStatus, getSessionStatus } = await import('../../public/modules/session-indicators.js');
        const onStatusChange = vi.fn(async () => {});

        await pollSessionStatus('session-1', onStatusChange);
        await pollSessionStatus('session-1', onStatusChange);

        expect(onStatusChange).toHaveBeenCalledTimes(2);
        expect(getSessionStatus('session-1')).toBeUndefined();
    });
});
