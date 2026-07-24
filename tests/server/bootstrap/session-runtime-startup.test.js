import { describe, expect, it, vi } from 'vitest';

import { initializeSessionRuntime } from '../../../server/bootstrap/session-runtime-startup.js';

describe('initializeSessionRuntime retirement boundary', () => {
    it('loads legacy state without managing sessions, worktrees, or processes', async () => {
        const stateStore = { init: vi.fn().mockResolvedValue(undefined) };
        const sessionServices = {
            workspace: { reconcileSessionWorkspacePaths: vi.fn() },
            activity: { restoreHookStatus: vi.fn() },
            runtime: {
                registry: { markReady: vi.fn() },
                maintenance: {
                    restoreActiveSessions: vi.fn(),
                    cleanupOrphans: vi.fn(),
                    startPtyWatchdog: vi.fn(),
                    startStaleSessionRecycler: vi.fn()
                }
            }
        };
        const log = { log: vi.fn(), error: vi.fn() };

        await initializeSessionRuntime({ stateStore, sessionServices, log });

        expect(stateStore.init).toHaveBeenCalledOnce();
        expect(sessionServices.workspace.reconcileSessionWorkspacePaths).not.toHaveBeenCalled();
        expect(sessionServices.activity.restoreHookStatus).not.toHaveBeenCalled();
        expect(sessionServices.runtime.maintenance.restoreActiveSessions).not.toHaveBeenCalled();
        expect(sessionServices.runtime.maintenance.cleanupOrphans).not.toHaveBeenCalled();
        expect(sessionServices.runtime.maintenance.startPtyWatchdog).not.toHaveBeenCalled();
        expect(sessionServices.runtime.maintenance.startStaleSessionRecycler).not.toHaveBeenCalled();
        expect(sessionServices.runtime.registry.markReady).toHaveBeenCalledOnce();
    });
});
