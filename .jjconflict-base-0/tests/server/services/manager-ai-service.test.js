import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ManagerAIService } from '../../../server/services/manager-ai-service.js';

// Mock logger
vi.mock('../../../server/utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

describe('ManagerAIService', () => {
    let service;
    const goal = {
        id: 'goal_1',
        title: 'Implement auth',
        description: 'User authentication',
        criteria: { commit: ['Tests pass'] },
        managerConfig: { autoAnswerLevel: 'moderate' }
    };

    beforeEach(() => {
        service = new ManagerAIService({ apiKey: null }); // No API key for rule-based only
    });

    // ========== Rule-Based: y/n prompts ==========

    describe('y/n prompt handling', () => {
        it('auto-answers y to y/n prompt at moderate level', async () => {
            const result = await service.answerQuestion('Proceed? (y/n)', goal);
            expect(result.canAnswer).toBe(true);
            expect(result.answer).toBe('y');
        });

        it('auto-answers y to [Y/n] prompt', async () => {
            const result = await service.answerQuestion('Install deps? [Y/n]', goal);
            expect(result.canAnswer).toBe(true);
            expect(result.answer).toBe('y');
        });

        it('auto-answers y to [yes/no] prompt', async () => {
            const result = await service.answerQuestion('Continue? [yes/no]', goal);
            expect(result.canAnswer).toBe(true);
            expect(result.answer).toBe('y');
        });

        it('escalates destructive y/n at moderate level', async () => {
            const result = await service.answerQuestion('Delete all files? (y/n)', goal);
            expect(result.canAnswer).toBe(false);
            expect(result.reason).toContain('破壊的');
        });

        it('escalates y/n with "force" keyword', async () => {
            const result = await service.answerQuestion('Force push? (y/n)', goal);
            expect(result.canAnswer).toBe(false);
        });

        it('escalates y/n with "reset" keyword', async () => {
            const result = await service.answerQuestion('Reset database? (y/n)', goal);
            expect(result.canAnswer).toBe(false);
        });

        it('does not auto-answer y/n at conservative level', async () => {
            const conservativeGoal = {
                ...goal,
                managerConfig: { autoAnswerLevel: 'conservative' }
            };
            const result = await service.answerQuestion('Install? (y/n)', conservativeGoal);
            // At conservative level, non-matched y/n prompts fall through to LLM/fallback
            // Since no API key, it falls to escalation
            expect(result.canAnswer).toBe(false);
        });
    });

    // ========== Rule-Based: Press Enter ==========

    describe('Press Enter handling', () => {
        it('auto-answers Press Enter prompts', async () => {
            const result = await service.answerQuestion('Press Enter to continue', goal);
            expect(result.canAnswer).toBe(true);
            expect(result.answer).toBe('');
        });

        it('auto-answers Press any key', async () => {
            const result = await service.answerQuestion('Press any key to proceed', goal);
            expect(result.canAnswer).toBe(true);
        });

        it('auto-answers continue?', async () => {
            const result = await service.answerQuestion('continue?', goal);
            expect(result.canAnswer).toBe(true);
        });
    });

    // ========== Rule-Based: Tool Approval ==========

    describe('Tool approval handling', () => {
        it('auto-answers non-destructive tool prompt at moderate level', async () => {
            // Note: "Allow..." with (y/n) matches the y/n handler first (before tool approval check).
            // At moderate level, non-destructive y/n → auto-answer 'y'.
            const result = await service.answerQuestion('Allow read access? (y/n)', goal);
            expect(result.canAnswer).toBe(true);
            expect(result.answer).toBe('y');
        });

        it('auto-approves tool at aggressive level', async () => {
            const aggressiveGoal = {
                ...goal,
                managerConfig: { autoAnswerLevel: 'aggressive' }
            };
            const result = await service.answerQuestion('Allow read access? (y/n)', aggressiveGoal);
            expect(result.canAnswer).toBe(true);
            expect(result.answer).toBe('y');
        });
    });

    // ========== Rule-Based: Multiple Choice ==========

    describe('Multiple choice handling', () => {
        it('escalates numbered options', async () => {
            const question = '1. PostgreSQL\n2. MySQL\n3. SQLite';
            const result = await service.answerQuestion(question, goal);
            expect(result.canAnswer).toBe(false);
            expect(result.reason).toContain('複数選択肢');
        });

        it('extracts options from numbered list', async () => {
            const question = '1. PostgreSQL\n2. MySQL\n3. SQLite';
            const result = await service.answerQuestion(question, goal);
            expect(result.suggestedOptions).toHaveLength(3);
            expect(result.suggestedOptions[0].label).toBe('PostgreSQL');
        });

        it('extracts options with dot notation', async () => {
            const question = '1) Option A\n2) Option B';
            const result = await service.answerQuestion(question, goal);
            expect(result.suggestedOptions).toHaveLength(2);
        });
    });

    // ========== Fallback ==========

    describe('Fallback behavior', () => {
        it('falls back to escalation when no rule matches and no API key', async () => {
            const result = await service.answerQuestion('What architecture do you prefer?', goal);
            expect(result.canAnswer).toBe(false);
            expect(result.reason).toContain('LLM分析不可');
        });

        it('fallback provides default options', async () => {
            const result = await service.answerQuestion('Unrecognized question?', goal);
            expect(result.suggestedOptions.length).toBeGreaterThan(0);
            expect(result.suggestedOptions.some(o => o.id === 'yes')).toBe(true);
        });
    });

    // ========== Option Extraction ==========

    describe('_extractOptions', () => {
        it('returns default options if no numbered lines', () => {
            const opts = service._extractOptions('Just some text');
            expect(opts).toHaveLength(2);
        });

        it('parses numbered list correctly', () => {
            const opts = service._extractOptions('1. Alpha\n2. Beta\n3. Gamma');
            expect(opts).toHaveLength(3);
            expect(opts[0]).toEqual({ id: '1', label: 'Alpha', description: '' });
        });
    });

    // ========== LLM Analysis ==========

    describe('LLM Analysis', () => {
        it('calls API when key is provided', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    content: [{ text: '{"canAnswer": true, "answer": "yes", "reason": "within scope"}' }]
                })
            });
            vi.stubGlobal('fetch', mockFetch);

            const svcWithKey = new ManagerAIService({ apiKey: 'test-key' });
            const result = await svcWithKey.answerQuestion('What is the best approach?', goal);

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.anthropic.com/v1/messages',
                expect.objectContaining({ method: 'POST' })
            );
            expect(result.canAnswer).toBe(true);
            expect(result.answer).toBe('yes');

            vi.unstubAllGlobals();
        });

        it('falls back to escalation on API error', async () => {
            const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
            vi.stubGlobal('fetch', mockFetch);

            const svcWithKey = new ManagerAIService({ apiKey: 'test-key' });
            const result = await svcWithKey.answerQuestion('Something complex?', goal);

            expect(result.canAnswer).toBe(false);
            vi.unstubAllGlobals();
        });

        it('falls back when LLM response is unparseable', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    content: [{ text: 'This is not JSON at all' }]
                })
            });
            vi.stubGlobal('fetch', mockFetch);

            const svcWithKey = new ManagerAIService({ apiKey: 'test-key' });
            const result = await svcWithKey.answerQuestion('Random question?', goal);

            expect(result.canAnswer).toBe(false);
            expect(result.reason).toContain('解析に失敗');

            vi.unstubAllGlobals();
        });
    });

    // ========== Deviation Analysis ==========

    describe('analyzeDeviation', () => {
        it('returns not deviated without API key', async () => {
            const result = await service.analyzeDeviation('some output', goal);
            expect(result.deviated).toBe(false);
        });
    });

    // ========== Progress Summary ==========

    describe('generateProgressSummary', () => {
        it('returns line count summary without API key', async () => {
            const summary = await service.generateProgressSummary('line1\nline2\nline3', goal);
            expect(summary).toContain('3行');
        });
    });
});
