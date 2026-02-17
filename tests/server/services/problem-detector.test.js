import { describe, it, expect, beforeEach } from 'vitest';
import { ProblemDetector } from '../../../server/services/problem-detector.js';

describe('ProblemDetector', () => {
    let detector;
    const goal = { id: 'goal_1', title: 'Test', criteria: { commit: [] } };
    const sessionId = 'session-test';

    beforeEach(() => {
        detector = new ProblemDetector({ stuckThresholdMs: 1000 });
    });

    // ========== Error Detection ==========

    describe('Error Detection', () => {
        it('detects Error pattern', () => {
            const problems = detector.analyze(['Error: something failed'], goal, sessionId);
            expect(problems.some(p => p.type === 'error')).toBe(true);
        });

        it('detects TypeError', () => {
            const problems = detector.analyze(['TypeError: Cannot read properties of undefined'], goal, sessionId);
            expect(problems.some(p => p.type === 'error')).toBe(true);
        });

        it('detects FAIL pattern', () => {
            const problems = detector.analyze(['FAIL src/foo.js'], goal, sessionId);
            expect(problems.some(p => p.type === 'error')).toBe(true);
        });

        it('detects stack trace', () => {
            const lines = [
                'Error: oops',
                '    at Object.<anonymous> (/foo/bar.js:10:5)',
                '    at Module._compile (node:internal/modules/cjs/loader:1241:14)'
            ];
            const problems = detector.analyze(lines, goal, sessionId);
            expect(problems.some(p => p.type === 'error')).toBe(true);
        });

        it('detects fatal as critical severity', () => {
            const problems = detector.analyze(['fatal: remote origin already exists'], goal, sessionId);
            const errorProblem = problems.find(p => p.type === 'error');
            expect(errorProblem.severity).toBe('critical');
        });

        it('detects UnhandledPromiseRejection as critical', () => {
            const problems = detector.analyze(['UnhandledPromiseRejection: something went wrong'], goal, sessionId);
            const errorProblem = problems.find(p => p.type === 'error');
            expect(errorProblem.severity).toBe('critical');
        });

        it('detects exit code error', () => {
            const problems = detector.analyze(['Process exited with exit code 1'], goal, sessionId);
            expect(problems.some(p => p.type === 'error')).toBe(true);
        });

        it('detects ENOENT', () => {
            const problems = detector.analyze(['ENOENT: no such file or directory'], goal, sessionId);
            expect(problems.some(p => p.type === 'error')).toBe(true);
        });

        it('detects permission denied', () => {
            const problems = detector.analyze(['Permission denied: /etc/shadow'], goal, sessionId);
            expect(problems.some(p => p.type === 'error')).toBe(true);
        });

        it('ignores lines with console.error context', () => {
            const problems = detector.analyze(['console.error("something")'], goal, sessionId);
            expect(problems.filter(p => p.type === 'error')).toHaveLength(0);
        });

        it('ignores test file references', () => {
            const problems = detector.analyze(['expected.test.Error handling'], goal, sessionId);
            expect(problems.filter(p => p.type === 'error')).toHaveLength(0);
        });

        it('returns no error for clean output', () => {
            const problems = detector.analyze(['Build succeeded', 'All tests passed'], goal, sessionId);
            expect(problems.filter(p => p.type === 'error')).toHaveLength(0);
        });

        it('error problem has suggestedActions', () => {
            const problems = detector.analyze(['Error: fail'], goal, sessionId);
            const p = problems.find(p => p.type === 'error');
            expect(p.suggestedActions.length).toBeGreaterThan(0);
        });
    });

    // ========== Stuck Detection ==========

    describe('Stuck Detection', () => {
        it('does not report stuck if threshold not reached', () => {
            // First call to register last output time
            detector.analyze(['some output'], goal, sessionId);
            // Immediately check with empty lines
            const problems = detector.analyze([], goal, sessionId);
            expect(problems.filter(p => p.type === 'stuck')).toHaveLength(0);
        });

        it('reports stuck after threshold', async () => {
            detector = new ProblemDetector({ stuckThresholdMs: 50 });
            detector.analyze(['some output'], goal, sessionId);

            await new Promise(r => setTimeout(r, 100));

            const problems = detector.analyze([], goal, sessionId);
            expect(problems.some(p => p.type === 'stuck')).toBe(true);
        });

        it('stuck problem includes elapsed time', async () => {
            detector = new ProblemDetector({ stuckThresholdMs: 50 });
            detector.analyze(['output'], goal, sessionId);
            await new Promise(r => setTimeout(r, 100));

            const problems = detector.analyze([], goal, sessionId);
            const stuck = problems.find(p => p.type === 'stuck');
            expect(stuck.description).toContain('秒間');
        });

        it('does not report stuck if no prior output', () => {
            const problems = detector.analyze([], goal, 'session-new');
            expect(problems.filter(p => p.type === 'stuck')).toHaveLength(0);
        });
    });

    // ========== Question Detection ==========

    describe('Question Detection', () => {
        it('detects y/n prompt', () => {
            const problems = detector.analyze(['Proceed? (y/n)'], goal, sessionId);
            expect(problems.some(p => p.type === 'escalation')).toBe(true);
        });

        it('detects [Y/n] prompt', () => {
            const problems = detector.analyze(['Continue? [Y/n]'], goal, sessionId);
            expect(problems.some(p => p.type === 'escalation')).toBe(true);
        });

        it('detects "Do you want to" pattern', () => {
            const problems = detector.analyze(['Do you want to continue?'], goal, sessionId);
            expect(problems.some(p => p.type === 'escalation')).toBe(true);
        });

        it('detects "Would you like to" pattern', () => {
            const problems = detector.analyze(['Would you like to install?'], goal, sessionId);
            expect(problems.some(p => p.type === 'escalation')).toBe(true);
        });

        it('detects "Press Enter" pattern', () => {
            const problems = detector.analyze(['Press Enter to continue'], goal, sessionId);
            expect(problems.some(p => p.type === 'escalation')).toBe(true);
        });

        it('detects "Please choose" pattern', () => {
            const problems = detector.analyze(['Please choose an option:'], goal, sessionId);
            expect(problems.some(p => p.type === 'escalation')).toBe(true);
        });

        it('escalation has info severity', () => {
            const problems = detector.analyze(['Continue? (y/n)'], goal, sessionId);
            const q = problems.find(p => p.type === 'escalation');
            expect(q.severity).toBe('info');
        });

        it('no question detected in normal output', () => {
            const problems = detector.analyze(['Building project...', 'Compiling files'], goal, sessionId);
            expect(problems.filter(p => p.type === 'escalation')).toHaveLength(0);
        });
    });

    // ========== Output Change Detection ==========

    describe('hasOutputChanged', () => {
        it('returns true on first call', () => {
            expect(detector.hasOutputChanged('s1', 'hello')).toBe(true);
        });

        it('returns false if content is same', () => {
            detector.hasOutputChanged('s1', 'hello');
            expect(detector.hasOutputChanged('s1', 'hello')).toBe(false);
        });

        it('returns true when content changes', () => {
            detector.hasOutputChanged('s1', 'hello');
            expect(detector.hasOutputChanged('s1', 'hello world')).toBe(true);
        });
    });

    // ========== Session Cleanup ==========

    describe('clearSession', () => {
        it('clears tracking data for session', () => {
            detector.analyze(['output'], goal, sessionId);
            detector.hasOutputChanged(sessionId, 'content');

            detector.clearSession(sessionId);

            // After clearing, hasOutputChanged should treat as new
            expect(detector.hasOutputChanged(sessionId, 'content')).toBe(true);
        });
    });
});
