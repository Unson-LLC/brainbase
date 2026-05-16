import { describe, expect, it, vi } from 'vitest';
import { SessionService } from '../../public/modules/domain/session/session-service.js';
import { EVENTS } from '../../public/modules/core/event-bus.js';

describe('SessionService workspace generation rotation', () => {
    it('INV-1/C-5/AP-4: merge success keeps the same visible session selected', async () => {
        const service = new SessionService();
        const emit = vi.fn(async () => ({ success: true, errors: [] }));
        service.httpClient = {
            post: vi.fn(async () => ({
                success: true,
                prUrl: 'https://github.com/Unson-LLC/brainbase-unson/pull/999',
                mergedAt: '2026-05-16T08:00:00Z',
                rotation: {
                    active: {
                        workspaceId: 'session-1-g2',
                        path: '/tmp/worktrees/session-1-g2-brainbase'
                    }
                }
            }))
        };
        service.store = {
            getState: vi.fn(() => ({
                currentSessionId: 'session-1',
                sessions: [{ id: 'session-1', activeWorkspaceId: 'session-1-g1' }]
            })),
            setState: vi.fn()
        };
        service.eventBus = { emit };
        service.loadSessions = vi.fn(async () => {});
        service._switchToNextActive = vi.fn(async () => {});

        const result = await service.mergeSession('session-1');

        expect(result.success).toBe(true);
        expect(service.httpClient.post).toHaveBeenCalledWith('/api/sessions/session-1/merge');
        expect(service.loadSessions).toHaveBeenCalled();
        expect(service._switchToNextActive).not.toHaveBeenCalled();
        expect(service.store.setState).not.toHaveBeenCalledWith({ currentSessionId: null });
        expect(emit).toHaveBeenCalledWith(EVENTS.SESSION_UPDATED, {
            sessionId: 'session-1',
            updates: {
                merged: true,
                mergedAt: '2026-05-16T08:00:00Z',
                mergedPrUrl: 'https://github.com/Unson-LLC/brainbase-unson/pull/999',
                activeWorkspaceId: 'session-1-g2',
                workspaceRotationStatus: 'ready'
            }
        });
    });
});
