import { describe, expect, it, vi } from 'vitest';

import { RoutineLivenessService } from '../../../server/services/routine-runtime/liveness-service.js';

function dailyExpectation(automationId, hour, graceMinutes = 20) {
    return {
        routine: automationId.replace('brainbase-', ''),
        automation_id: automationId,
        source_type: 'codex_automations',
        project_id: 'brainbase',
        timezone: 'Asia/Tokyo',
        schedule: { kind: 'daily', hour, minute: 0 },
        grace_minutes: graceMinutes,
        required_artifacts: ['routine_summary']
    };
}

function receipt(overrides = {}) {
    return {
        source_status: 'success',
        evidence_state: 'confirmed',
        finished_at: '2026-08-12T21:01:00.000Z',
        evidence_refs: [{ kind: 'artifact_ref', ref: 'brainbase:routine/summary', label: 'routine summary' }],
        ...overrides
    };
}

function queryServiceWith(historyByAutomation = {}) {
    return {
        listHistory: vi.fn(async ({ sourceIdentity }) => ({
            items: historyByAutomation[sourceIdentity] || [],
            count: (historyByAutomation[sourceIdentity] || []).length
        }))
    };
}

describe('RoutineLivenessService', () => {
    it('judgment knowledge event Dead Letterを朝の最上位例外へ統合し絶対pathを隠す', async () => {
        const service = new RoutineLivenessService({
            expectations: [dailyExpectation('brainbase-missing', 3)],
            runReceiptQueryService: queryServiceWith(),
            listDeadLetters: async () => [],
            listKnowledgeEventDeadLetters: async () => [{
                code: 'knowledge_event_dead_letter',
                event_id: 'kev_dead_1',
                path: '/private/brainbase/knowledge-event-dead-letter/codex-judgment/kev_dead_1.json',
                created_at: '2026-08-12T21:59:00.000Z'
            }],
            now: () => new Date('2026-08-12T22:00:00.000Z')
        });

        await expect(service.listExceptions({ limit: 1 })).resolves.toEqual([{
            code: 'knowledge_event_dead_letter',
            event_id: 'kev_dead_1',
            path: 'kev_dead_1.json',
            created_at: '2026-08-12T21:59:00.000Z'
        }]);
    });

    it('judgment knowledge event outbox例外を朝の例外へ統合する', async () => {
        const listKnowledgeEventOutboxExceptions = vi.fn(async () => [{
            code: 'knowledge_event_outbox',
            event_id: 'kev_judgment_1',
            path: '/var/judgment-event-outbox/kev_judgment_1.json',
            created_at: '2026-08-12T20:00:00.000Z'
        }]);
        const service = new RoutineLivenessService({
            expectations: [],
            runReceiptQueryService: queryServiceWith(),
            listDeadLetters: async () => [],
            listKnowledgeEventOutboxExceptions,
            now: () => new Date('2026-08-12T22:00:00.000Z')
        });

        await expect(service.listExceptions({ limit: 3 })).resolves.toEqual([{
            code: 'knowledge_event_outbox',
            event_id: 'kev_judgment_1',
            path: 'kev_judgment_1.json',
            created_at: '2026-08-12T20:00:00.000Z'
        }]);
        expect(listKnowledgeEventOutboxExceptions).toHaveBeenCalledOnce();
    });

    it('猶予時刻ちょうどはmissingにせず、1ms超過後にmissing_receiptにする', async () => {
        const expectation = dailyExpectation('brainbase-ohayo', 6, 20);
        const atBoundary = new RoutineLivenessService({
            expectations: [expectation],
            runReceiptQueryService: queryServiceWith(),
            listDeadLetters: async () => [],
            now: () => new Date('2026-08-12T21:20:00.000Z')
        });
        const afterBoundary = new RoutineLivenessService({
            expectations: [expectation],
            runReceiptQueryService: queryServiceWith(),
            listDeadLetters: async () => [],
            now: () => new Date('2026-08-12T21:20:00.001Z')
        });

        await expect(atBoundary.listExceptions()).resolves.toEqual([]);
        await expect(afterBoundary.listExceptions()).resolves.toEqual([
            expect.objectContaining({
                code: 'missing_receipt',
                automation_id: 'brainbase-ohayo',
                scheduled_at: '2026-08-12T21:00:00.000Z',
                grace_deadline_at: '2026-08-12T21:20:00.000Z'
            })
        ]);
    });

    it('期限内の最新Receiptはmissingにしない', async () => {
        const expectation = dailyExpectation('brainbase-ohayo', 6, 20);
        const service = new RoutineLivenessService({
            expectations: [expectation],
            runReceiptQueryService: queryServiceWith({
                'brainbase-ohayo': [receipt()]
            }),
            listDeadLetters: async () => [],
            now: () => new Date('2026-08-12T21:20:00.001Z')
        });

        await expect(service.listExceptions()).resolves.toEqual([]);
    });

    it('success/confirmedでも必須routine_summary証跡がなければrequired_artifact_missingにする', async () => {
        const expectation = dailyExpectation('brainbase-ohayo', 6, 20);
        const service = new RoutineLivenessService({
            expectations: [expectation],
            runReceiptQueryService: queryServiceWith({
                'brainbase-ohayo': [receipt({
                    evidence_refs: [{ kind: 'log_ref', ref: 'cloudwatch:run/123', label: 'execution log' }]
                })]
            }),
            listDeadLetters: async () => [],
            now: () => new Date('2026-08-12T21:10:00.000Z')
        });

        await expect(service.listExceptions()).resolves.toEqual([
            expect.objectContaining({
                code: 'required_artifact_missing',
                automation_id: 'brainbase-ohayo',
                source_status: 'success',
                evidence_state: 'confirmed',
                missing_required_artifacts: ['routine_summary']
            })
        ]);
    });

    it('Dead Letter、missing、blockedの順に並べ、期限超過降順で上位3件に制限する', async () => {
        const expectations = [
            dailyExpectation('brainbase-dead', 6),
            dailyExpectation('brainbase-missing-old', 3),
            dailyExpectation('brainbase-missing-new', 5),
            dailyExpectation('brainbase-blocked', 2)
        ];
        const service = new RoutineLivenessService({
            expectations,
            runReceiptQueryService: queryServiceWith({
                'brainbase-dead': [receipt()],
                'brainbase-blocked': [receipt({
                    source_status: 'blocked',
                    evidence_state: 'unconfirmed',
                    finished_at: '2026-08-12T17:01:00.000Z'
                })]
            }),
            listDeadLetters: async () => [{
                automation_id: 'brainbase-dead',
                created_at: '2026-08-12T21:02:00.000Z',
                path: '/var/dead-letter/rr1_dead.json'
            }],
            now: () => new Date('2026-08-12T22:00:00.000Z')
        });

        const exceptions = await service.listExceptions();

        expect(exceptions).toHaveLength(3);
        expect(exceptions.map(({ code, automation_id: automationId }) => [code, automationId])).toEqual([
            ['dead_letter', 'brainbase-dead'],
            ['missing_receipt', 'brainbase-missing-old'],
            ['missing_receipt', 'brainbase-missing-new']
        ]);
        expect(exceptions.some(({ automation_id: automationId }) => automationId === 'brainbase-blocked')).toBe(false);
    });

    it.each([
        ['blocked', 'confirmed'],
        ['failed', 'confirmed'],
        ['waiting_human', 'confirmed'],
        ['success', 'no_data'],
        ['success', 'unconfirmed']
    ])('%s/%sの最新Receiptをblocked_receiptとして報告する', async (sourceStatus, evidenceState) => {
        const expectation = dailyExpectation('brainbase-ohayo', 6, 20);
        const service = new RoutineLivenessService({
            expectations: [expectation],
            runReceiptQueryService: queryServiceWith({
                'brainbase-ohayo': [receipt({ source_status: sourceStatus, evidence_state: evidenceState })]
            }),
            listDeadLetters: async () => [],
            now: () => new Date('2026-08-12T21:10:00.000Z')
        });

        await expect(service.listExceptions()).resolves.toEqual([
            expect.objectContaining({
                code: 'blocked_receipt',
                automation_id: 'brainbase-ohayo',
                source_status: sourceStatus,
                evidence_state: evidenceState
            })
        ]);
    });
});
