import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionMonitor } from '../../../server/services/session-monitor.js';

// Mock logger
vi.mock('../../../server/utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

describe('SessionMonitor', () => {
    let monitor;
    let sessionManager;
    let problemDetector;
    let managerAI;
    let goalStore;
    let eventBus;

    const goal = {
        id: 'goal_1',
        sessionId: 'session-123',
        title: 'Test Goal',
        description: 'Test',
        criteria: { commit: ['Tests pass'] },
        managerConfig: { autoAnswerLevel: 'moderate' }
    };

    beforeEach(() => {
        sessionManager = {
            getContent: vi.fn().mockResolvedValue('session output'),
            sendInput: vi.fn().mockResolvedValue(undefined)
        };

        problemDetector = {
            hasOutputChanged: vi.fn().mockReturnValue(true),
            analyze: vi.fn().mockReturnValue([]),
            clearSession: vi.fn()
        };

        managerAI = {
            answerQuestion: vi.fn().mockResolvedValue({ canAnswer: true, answer: 'y' })
        };

        goalStore = {
            addProblem: vi.fn().mockReturnValue({ id: 'prob_1', type: 'error' }),
            addEscalation: vi.fn().mockReturnValue({ id: 'esc_1' }),
            addTimelineEntry: vi.fn().mockReturnValue({ id: 'tl_1' }),
            updateGoal: vi.fn(),
            getGoal: vi.fn().mockReturnValue(goal)
        };

        eventBus = {
            emit: vi.fn()
        };

        monitor = new SessionMonitor({
            sessionManager,
            problemDetector,
            managerAI,
            goalStore,
            eventBus,
            pollIntervalMs: 100
        });
    });

    afterEach(() => {
        monitor.stopAll();
        vi.restoreAllMocks();
    });

    describe('startMonitoring', () => {
        it('registers session for monitoring', () => {
            monitor.startMonitoring('session-123', goal);
            expect(monitor.getMonitoredSessions()).toContain('session-123');
        });

        it('adds timeline entry on start', () => {
            monitor.startMonitoring('session-123', goal);
            expect(goalStore.addTimelineEntry).toHaveBeenCalledWith(
                expect.objectContaining({
                    goalId: 'goal_1',
                    type: 'progress',
                    summary: '監視開始'
                })
            );
        });

        it('does not double-start same session', () => {
            monitor.startMonitoring('session-123', goal);
            monitor.startMonitoring('session-123', goal);
            // Should still be only 1
            expect(monitor.getMonitoredSessions()).toHaveLength(1);
        });
    });

    describe('stopMonitoring', () => {
        it('removes session from monitoring', () => {
            monitor.startMonitoring('session-123', goal);
            monitor.stopMonitoring('session-123');
            expect(monitor.getMonitoredSessions()).not.toContain('session-123');
        });

        it('adds timeline entry on stop', () => {
            monitor.startMonitoring('session-123', goal);
            monitor.stopMonitoring('session-123');

            const stopCalls = goalStore.addTimelineEntry.mock.calls.filter(
                call => call[0].summary === '監視停止'
            );
            expect(stopCalls).toHaveLength(1);
        });

        it('clears problem detector session', () => {
            monitor.startMonitoring('session-123', goal);
            monitor.stopMonitoring('session-123');
            expect(problemDetector.clearSession).toHaveBeenCalledWith('session-123');
        });

        it('handles stopping non-monitored session gracefully', () => {
            expect(() => monitor.stopMonitoring('session-nope')).not.toThrow();
        });
    });

    describe('stopAll', () => {
        it('stops all monitored sessions', () => {
            monitor.startMonitoring('s1', { ...goal, id: 'g1', sessionId: 's1' });
            monitor.startMonitoring('s2', { ...goal, id: 'g2', sessionId: 's2' });
            monitor.stopAll();
            expect(monitor.getMonitoredSessions()).toHaveLength(0);
        });
    });

    describe('_pollSession', () => {
        it('calls sessionManager.getContent', async () => {
            await monitor._pollSession('session-123', goal);
            expect(sessionManager.getContent).toHaveBeenCalledWith('session-123', 200);
        });

        it('checks if output changed', async () => {
            await monitor._pollSession('session-123', goal);
            expect(problemDetector.hasOutputChanged).toHaveBeenCalled();
        });

        it('analyzes new lines when output changed', async () => {
            sessionManager.getContent.mockResolvedValue('line1\nline2');
            await monitor._pollSession('session-123', goal);
            expect(problemDetector.analyze).toHaveBeenCalled();
        });

        it('stores problem when detected', async () => {
            problemDetector.analyze.mockReturnValue([{
                type: 'error',
                severity: 'warning',
                title: 'Error found',
                description: 'Error: test'
            }]);

            monitor.startMonitoring('session-123', goal);
            await monitor._pollSession('session-123', goal);

            expect(goalStore.addProblem).toHaveBeenCalledWith(
                expect.objectContaining({
                    goalId: 'goal_1',
                    type: 'error'
                })
            );
        });

        it('emits event on problem detection', async () => {
            problemDetector.analyze.mockReturnValue([{
                type: 'error',
                severity: 'warning',
                title: 'E',
                description: 'D'
            }]);

            monitor.startMonitoring('session-123', goal);
            await monitor._pollSession('session-123', goal);

            expect(eventBus.emit).toHaveBeenCalledWith(
                'goal:problem-detected',
                expect.objectContaining({ sessionId: 'session-123', goalId: 'goal_1' })
            );
        });

        it('updates goal status to problem on error', async () => {
            problemDetector.analyze.mockReturnValue([{
                type: 'error',
                severity: 'warning',
                title: 'E',
                description: 'D'
            }]);

            monitor.startMonitoring('session-123', goal);
            await monitor._pollSession('session-123', goal);

            expect(goalStore.updateGoal).toHaveBeenCalledWith('goal_1', { status: 'problem' });
        });

        it('handles question with Manager AI', async () => {
            problemDetector.analyze.mockReturnValue([{
                type: 'escalation',
                severity: 'info',
                title: '入力待ち',
                description: 'Continue? (y/n)'
            }]);

            monitor.startMonitoring('session-123', goal);
            await monitor._pollSession('session-123', goal);

            expect(managerAI.answerQuestion).toHaveBeenCalledWith('Continue? (y/n)', goal);
        });

        it('sends Manager AI answer to session', async () => {
            problemDetector.analyze.mockReturnValue([{
                type: 'escalation',
                severity: 'info',
                title: '入力待ち',
                description: 'Continue? (y/n)'
            }]);
            managerAI.answerQuestion.mockResolvedValue({ canAnswer: true, answer: 'y' });

            monitor.startMonitoring('session-123', goal);
            await monitor._pollSession('session-123', goal);

            expect(sessionManager.sendInput).toHaveBeenCalledWith('session-123', 'y', 'text');
        });

        it('creates escalation when Manager AI cannot answer', async () => {
            problemDetector.analyze.mockReturnValue([{
                type: 'escalation',
                severity: 'info',
                title: '入力待ち',
                description: 'Which DB?'
            }]);
            managerAI.answerQuestion.mockResolvedValue({
                canAnswer: false,
                reason: 'CEO判断必要',
                analysis: 'DB choice',
                suggestedOptions: [{ id: '1', label: 'PostgreSQL' }]
            });

            monitor.startMonitoring('session-123', goal);
            await monitor._pollSession('session-123', goal);

            expect(goalStore.addEscalation).toHaveBeenCalledWith(
                expect.objectContaining({
                    goalId: 'goal_1',
                    question: 'Which DB?'
                })
            );
            expect(eventBus.emit).toHaveBeenCalledWith(
                'goal:escalation-required',
                expect.objectContaining({ goalId: 'goal_1' })
            );
        });

        it('stops monitoring if session not found', async () => {
            sessionManager.getContent.mockRejectedValue(new Error('session not found'));
            monitor.startMonitoring('session-123', goal);

            await monitor._pollSession('session-123', goal);

            expect(monitor.getMonitoredSessions()).not.toContain('session-123');
            expect(goalStore.updateGoal).toHaveBeenCalledWith('goal_1', { status: 'failed' });
        });

        it('checks stuck when output unchanged', async () => {
            problemDetector.hasOutputChanged.mockReturnValue(false);
            problemDetector.analyze.mockReturnValue([{
                type: 'stuck',
                severity: 'warning',
                title: '進捗なし',
                description: '120秒間出力変化がありません'
            }]);

            monitor.startMonitoring('session-123', goal);
            await monitor._pollSession('session-123', goal);

            expect(problemDetector.analyze).toHaveBeenCalledWith([], goal, 'session-123');
        });
    });

    describe('Polling integration', () => {
        it('polls periodically after startMonitoring', async () => {
            monitor.startMonitoring('session-123', goal);

            // Wait for 2 poll cycles
            await new Promise(r => setTimeout(r, 250));

            expect(sessionManager.getContent.mock.calls.length).toBeGreaterThanOrEqual(2);
        });
    });
});
