import { describe, expect, it, vi } from 'vitest';

import {
    KnowledgeCycleAccessDeniedError,
    KnowledgeCycleNotFoundError,
    KnowledgeCycleQueryService
} from '../../server/services/knowledge-cycle-query-service.js';

function createService({ event = null, candidate = null } = {}) {
    const eventRepository = {
        findById: vi.fn(async () => event),
        saveReceipt: vi.fn()
    };
    const candidateRepository = {
        findByEventId: vi.fn(async () => candidate)
    };
    return {
        eventRepository,
        service: new KnowledgeCycleQueryService({ eventRepository, candidateRepository })
    };
}

describe('KnowledgeCycleQueryService', () => {
    it('stage historyと候補状態からknowledge_cycle_receipt.v1を都度生成する', async () => {
        const stageHistory = [
            ['received', '2026-08-13T01:01:00.000Z'],
            ['queued', '2026-08-13T01:01:01.000Z'],
            ['extracted', '2026-08-13T01:01:02.000Z'],
            ['resolved', '2026-08-13T01:01:03.000Z'],
            ['indexed', '2026-08-13T01:01:04.000Z'],
            ['retrievable', '2026-08-13T01:01:05.000Z']
        ].map(([stage, occurred_at]) => ({ stage, occurred_at }));
        const { service, eventRepository } = createService({
            event: { event_id: 'kev_1', project_code: 'brainbase', stage_history: stageHistory },
            candidate: { id: 'cand_1', processing_stage: 'retrievable', semantic_state: 'active' }
        });

        const receipt = await service.getCycle('kev_1');

        expect(receipt).toEqual({
            schema_version: 'knowledge_cycle_receipt.v1',
            event_id: 'kev_1',
            candidate_id: 'cand_1',
            processing_stage: 'retrievable',
            semantic_state: 'active',
            failure_reason: null,
            retrievable_at: '2026-08-13T01:01:05.000Z',
            stage_history: stageHistory
        });
        expect(eventRepository.saveReceipt).not.toHaveBeenCalled();
    });

    it('隔離理由をreceiptに表示する', async () => {
        const { service } = createService({
            event: { event_id: 'kev_quarantined', project_code: 'brainbase', stage_history: [{ stage: 'resolved', occurred_at: '2026-08-13T01:02:00.000Z' }] },
            candidate: {
                id: 'cand_quarantined',
                processing_stage: 'resolved',
                semantic_state: 'quarantined',
                quarantine_reason: 'decision_authority_missing'
            }
        });

        await expect(service.getCycle('kev_quarantined')).resolves.toMatchObject({
            semantic_state: 'quarantined',
            failure_reason: 'decision_authority_missing',
            retrievable_at: null
        });
    });

    it('存在しないevent_idはKnowledgeCycleNotFoundErrorにする', async () => {
        const { service } = createService();

        await expect(service.getCycle('kev_missing')).rejects.toBeInstanceOf(KnowledgeCycleNotFoundError);
    });

    it('queryのproject_codeとeventのproject_codeが違えばaccessが両方を含んでも拒否する', async () => {
        const { service } = createService({
            event: { event_id: 'kev_other', project_code: 'other', stage_history: [] }
        });

        await expect(service.getCycle('kev_other', {
            projectCode: 'brainbase',
            access: { projectCodes: ['brainbase', 'other'] }
        })).rejects.toBeInstanceOf(KnowledgeCycleAccessDeniedError);
    });
});
