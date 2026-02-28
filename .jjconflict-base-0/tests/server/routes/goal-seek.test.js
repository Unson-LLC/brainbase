import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGoalSeekRouter } from '../../../server/routes/goal-seek.js';

// Mock auth middleware
vi.mock('../../../server/middleware/auth.js', () => ({
    requireAuth: () => (req, res, next) => next()
}));

// Helper: extract route handler from express router
function getHandler(router, method, path) {
    const layer = router.stack.find(l =>
        l.route &&
        l.route.path === path &&
        l.route.methods[method]
    );
    if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
    // Last handler in stack (after middleware)
    const handlers = layer.route.stack.map(s => s.handle);
    return handlers[handlers.length - 1];
}

function mockReq(params = {}, body = {}, query = {}) {
    return { params, body, query };
}

function mockRes() {
    const res = {
        _status: 200,
        _json: null,
        status(code) { res._status = code; return res; },
        json(data) { res._json = data; return res; }
    };
    return res;
}

describe('Goal Seek V2 Routes', () => {
    let router;
    let goalStore;
    let sessionMonitor;
    let managerAI;

    const mockGoal = {
        id: 'goal_abc',
        sessionId: 'session-123',
        title: 'Test Goal',
        description: 'desc',
        status: 'active',
        criteria: { commit: [], signal: [] },
        managerConfig: { autoAnswerLevel: 'moderate' }
    };

    beforeEach(() => {
        goalStore = {
            createGoal: vi.fn().mockReturnValue(mockGoal),
            getGoal: vi.fn().mockReturnValue(mockGoal),
            getAllGoals: vi.fn().mockReturnValue([mockGoal]),
            updateGoal: vi.fn().mockReturnValue({ ...mockGoal, title: 'Updated' }),
            deleteGoal: vi.fn().mockReturnValue(true),
            getProblems: vi.fn().mockReturnValue([]),
            getTimeline: vi.fn().mockReturnValue([]),
            respondToEscalation: vi.fn().mockReturnValue({
                id: 'esc_1', goalId: 'goal_abc', status: 'responded',
                response: { choice: 'yes', reason: '' }
            }),
            addTimelineEntry: vi.fn()
        };

        sessionMonitor = {
            getMonitoredSessions: vi.fn().mockReturnValue([]),
            startMonitoring: vi.fn(),
            stopMonitoring: vi.fn()
        };

        managerAI = {};

        router = createGoalSeekRouter({
            authService: {},
            goalStore,
            sessionMonitor,
            managerAI
        });
    });

    // ========== Status ==========

    describe('GET /status', () => {
        it('returns service status', () => {
            const handler = getHandler(router, 'get', '/status');
            const res = mockRes();
            handler(mockReq(), res);

            expect(res._json.status).toBe('available');
            expect(res._json.version).toBe('v2');
            expect(res._json.totalGoals).toBe(1);
        });
    });

    // ========== Goal CRUD ==========

    describe('POST /goals', () => {
        it('creates goal with valid payload', () => {
            const handler = getHandler(router, 'post', '/goals');
            const req = mockReq({}, { sessionId: 'session-123', title: 'New Goal' });
            const res = mockRes();
            handler(req, res);

            expect(res._status).toBe(201);
            expect(goalStore.createGoal).toHaveBeenCalledWith(
                expect.objectContaining({ sessionId: 'session-123', title: 'New Goal' })
            );
        });

        it('returns 400 without sessionId', () => {
            const handler = getHandler(router, 'post', '/goals');
            const res = mockRes();
            handler(mockReq({}, { title: 'No Session' }), res);
            expect(res._status).toBe(400);
            expect(res._json.error).toContain('sessionId');
        });

        it('returns 400 without title', () => {
            const handler = getHandler(router, 'post', '/goals');
            const res = mockRes();
            handler(mockReq({}, { sessionId: 'session-123' }), res);
            expect(res._status).toBe(400);
            expect(res._json.error).toContain('title');
        });
    });

    describe('GET /goals', () => {
        it('returns all goals', () => {
            const handler = getHandler(router, 'get', '/goals');
            const res = mockRes();
            handler(mockReq(), res);
            expect(res._json).toHaveLength(1);
        });
    });

    describe('GET /goals/:id', () => {
        it('returns goal by id', () => {
            const handler = getHandler(router, 'get', '/goals/:id');
            const res = mockRes();
            handler(mockReq({ id: 'goal_abc' }), res);
            expect(res._json.id).toBe('goal_abc');
        });

        it('returns 404 for unknown goal', () => {
            goalStore.getGoal.mockReturnValue(null);
            const handler = getHandler(router, 'get', '/goals/:id');
            const res = mockRes();
            handler(mockReq({ id: 'goal_nope' }), res);
            expect(res._status).toBe(404);
        });
    });

    describe('PUT /goals/:id', () => {
        it('updates goal', () => {
            const handler = getHandler(router, 'put', '/goals/:id');
            const res = mockRes();
            handler(mockReq({ id: 'goal_abc' }, { title: 'Updated' }), res);
            expect(goalStore.updateGoal).toHaveBeenCalledWith('goal_abc', expect.objectContaining({ title: 'Updated' }));
        });

        it('returns 404 for unknown goal', () => {
            goalStore.updateGoal.mockReturnValue(null);
            const handler = getHandler(router, 'put', '/goals/:id');
            const res = mockRes();
            handler(mockReq({ id: 'goal_nope' }, { title: 'X' }), res);
            expect(res._status).toBe(404);
        });
    });

    describe('DELETE /goals/:id', () => {
        it('deletes goal and stops monitoring', () => {
            const handler = getHandler(router, 'delete', '/goals/:id');
            const res = mockRes();
            handler(mockReq({ id: 'goal_abc' }), res);
            expect(res._json.deleted).toBe(true);
            expect(sessionMonitor.stopMonitoring).toHaveBeenCalledWith('session-123');
        });

        it('returns 404 for unknown goal', () => {
            goalStore.getGoal.mockReturnValue(null);
            goalStore.deleteGoal.mockReturnValue(false);
            const handler = getHandler(router, 'delete', '/goals/:id');
            const res = mockRes();
            handler(mockReq({ id: 'goal_nope' }), res);
            expect(res._status).toBe(404);
        });
    });

    // ========== Monitoring ==========

    describe('POST /goals/:id/start-monitor', () => {
        it('starts monitoring for goal', () => {
            const handler = getHandler(router, 'post', '/goals/:id/start-monitor');
            const res = mockRes();
            handler(mockReq({ id: 'goal_abc' }), res);
            expect(res._json.monitoring).toBe(true);
            expect(sessionMonitor.startMonitoring).toHaveBeenCalledWith('session-123', mockGoal);
            expect(goalStore.updateGoal).toHaveBeenCalledWith('goal_abc', { status: 'monitoring' });
        });

        it('returns 404 for unknown goal', () => {
            goalStore.getGoal.mockReturnValue(null);
            const handler = getHandler(router, 'post', '/goals/:id/start-monitor');
            const res = mockRes();
            handler(mockReq({ id: 'goal_nope' }), res);
            expect(res._status).toBe(404);
        });
    });

    describe('POST /goals/:id/stop-monitor', () => {
        it('stops monitoring for goal', () => {
            const handler = getHandler(router, 'post', '/goals/:id/stop-monitor');
            const res = mockRes();
            handler(mockReq({ id: 'goal_abc' }), res);
            expect(res._json.monitoring).toBe(false);
            expect(sessionMonitor.stopMonitoring).toHaveBeenCalledWith('session-123');
            expect(goalStore.updateGoal).toHaveBeenCalledWith('goal_abc', { status: 'active' });
        });
    });

    // ========== Problems ==========

    describe('GET /goals/:id/problems', () => {
        it('returns problems for goal', () => {
            const handler = getHandler(router, 'get', '/goals/:id/problems');
            const res = mockRes();
            handler(mockReq({ id: 'goal_abc' }), res);
            expect(Array.isArray(res._json)).toBe(true);
        });

        it('returns 404 for unknown goal', () => {
            goalStore.getGoal.mockReturnValue(null);
            const handler = getHandler(router, 'get', '/goals/:id/problems');
            const res = mockRes();
            handler(mockReq({ id: 'goal_nope' }), res);
            expect(res._status).toBe(404);
        });
    });

    // ========== Timeline ==========

    describe('GET /goals/:id/timeline', () => {
        it('returns timeline for goal', () => {
            const handler = getHandler(router, 'get', '/goals/:id/timeline');
            const res = mockRes();
            handler(mockReq({ id: 'goal_abc' }), res);
            expect(Array.isArray(res._json)).toBe(true);
        });
    });

    // ========== Escalation ==========

    describe('POST /escalations/:id/respond', () => {
        it('responds to escalation', async () => {
            goalStore.getGoal.mockReturnValue({ ...mockGoal, status: 'problem' });
            const handler = getHandler(router, 'post', '/escalations/:id/respond');
            const res = mockRes();
            await handler(mockReq({ id: 'esc_1' }, { choice: 'yes', reason: 'Approved' }), res);
            expect(goalStore.respondToEscalation).toHaveBeenCalledWith('esc_1', expect.objectContaining({ choice: 'yes' }));
        });

        it('returns 400 without choice', async () => {
            const handler = getHandler(router, 'post', '/escalations/:id/respond');
            const res = mockRes();
            await handler(mockReq({ id: 'esc_1' }, { reason: 'no choice' }), res);
            expect(res._status).toBe(400);
        });

        it('returns 404 for unknown escalation', async () => {
            goalStore.respondToEscalation.mockReturnValue(null);
            const handler = getHandler(router, 'post', '/escalations/:id/respond');
            const res = mockRes();
            await handler(mockReq({ id: 'esc_nope' }, { choice: 'yes' }), res);
            expect(res._status).toBe(404);
        });

        it('restores goal status after escalation response', async () => {
            goalStore.getGoal.mockReturnValue({ ...mockGoal, status: 'problem' });
            sessionMonitor.getMonitoredSessions.mockReturnValue(['session-123']);
            const handler = getHandler(router, 'post', '/escalations/:id/respond');
            const res = mockRes();
            await handler(mockReq({ id: 'esc_1' }, { choice: 'yes' }), res);
            expect(goalStore.updateGoal).toHaveBeenCalledWith('goal_abc', { status: 'monitoring' });
        });

        it('adds timeline entry on escalation response', async () => {
            const handler = getHandler(router, 'post', '/escalations/:id/respond');
            const res = mockRes();
            await handler(mockReq({ id: 'esc_1' }, { choice: 'approve', reason: 'LGTM' }), res);
            expect(goalStore.addTimelineEntry).toHaveBeenCalledWith(
                expect.objectContaining({
                    goalId: 'goal_abc',
                    type: 'intervention',
                    summary: 'CEO回答: approve'
                })
            );
        });
    });
});
