import { describe, expect, it, vi } from 'vitest';

import { LearningService } from '../../../server/services/learning-service.js';

function legacyPayload(overrides = {}) {
    return {
        candidate_id: 'memcand_legacy_1',
        owner_person_id: 'sato_keigo',
        actor_person_id: 'sato_keigo',
        source_system: 'meeting_source',
        source_event_ids: ['meeting:decision:1'],
        project_code: 'brainbase',
        subject_type: 'decision',
        subject_id: 'decision_stable_1',
        visibility: 'org',
        role_min: 'member',
        sensitivity: 'internal',
        memory: { body: '料金方針を決定した', rationale: '会議で合意した' },
        ...overrides
    };
}

function canonicalCandidate(overrides = {}) {
    return {
        id: 'memcand_legacy_1',
        owner_person_id: 'sato_keigo',
        actor_person_id: 'sato_keigo',
        source_system: 'meeting_source',
        source_event_ids: ['meeting:decision:1'],
        project_code: 'brainbase',
        recommended_subject_type: 'decision',
        recommended_subject_id: 'decision_stable_1',
        visibility: 'org',
        role_min: 'member',
        sensitivity: 'internal',
        promotion_status: 'candidate',
        processing_stage: 'received',
        semantic_state: 'active',
        target_tier: 'ledger',
        body: '料金方針を決定した',
        permission_snapshot: {},
        evidence_ids: [],
        ...overrides
    };
}

function makeCompatibilityService(candidateRepository) {
    const pool = {
        query: vi.fn(async (sql) => {
            if (/\bmemory_candidates\b/i.test(sql)) {
                throw new Error('LearningService must not query memory_candidates directly');
            }
            return { rows: [], rowCount: 0 };
        })
    };
    return {
        pool,
        service: new LearningService({ pool, candidateRepository })
    };
}

describe('LearningService Candidate Store compatibility adapter', () => {
    it('createMemoryCandidateをcandidateRepository.createへ委譲し旧形状で返す', async () => {
        const candidateRepository = {
            create: vi.fn(async () => canonicalCandidate()),
            findById: vi.fn(),
            list: vi.fn()
        };
        const { pool, service } = makeCompatibilityService(candidateRepository);

        const created = await service.createMemoryCandidate(legacyPayload());

        expect(candidateRepository.create).toHaveBeenCalledWith(expect.objectContaining({
            id: 'memcand_legacy_1',
            recommended_subject_type: 'decision',
            recommended_subject_id: 'decision_stable_1',
            body: '料金方針を決定した'
        }));
        expect(created).toMatchObject({
            candidate_id: 'memcand_legacy_1',
            subject_type: 'decision',
            subject_id: 'decision_stable_1',
            memory: { body: '料金方針を決定した' }
        });
        expect(pool.query.mock.calls.some(([sql]) => /\bmemory_candidates\b/i.test(sql))).toBe(false);
    });

    it('getMemoryCandidateをcandidateRepository.findByIdへ委譲する', async () => {
        const candidateRepository = {
            create: vi.fn(),
            findById: vi.fn(async () => canonicalCandidate()),
            list: vi.fn()
        };
        const { pool, service } = makeCompatibilityService(candidateRepository);

        const candidate = await service.getMemoryCandidate('memcand_legacy_1');

        expect(candidateRepository.findById).toHaveBeenCalledWith('memcand_legacy_1');
        expect(candidate).toMatchObject({
            subject_type: 'decision',
            subject_id: 'decision_stable_1',
            memory: { body: '料金方針を決定した' }
        });
        expect(pool.query.mock.calls.some(([sql]) => /\bmemory_candidates\b/i.test(sql))).toBe(false);
    });

    it('listMemoryCandidatesをcandidateRepository.listへ委譲し互換filterを正規化する', async () => {
        const candidateRepository = {
            create: vi.fn(),
            findById: vi.fn(),
            list: vi.fn(async () => [canonicalCandidate()])
        };
        const { pool, service } = makeCompatibilityService(candidateRepository);

        const candidates = await service.listMemoryCandidates({
            owner_person_id: 'sato_keigo',
            status: 'candidate',
            subject_type: 'decision'
        });

        expect(candidateRepository.list).toHaveBeenCalledWith(expect.objectContaining({
            owner_person_id: 'sato_keigo',
            promotion_status: 'candidate',
            recommended_subject_type: 'decision'
        }));
        expect(candidates[0]).toMatchObject({
            subject_type: 'decision',
            subject_id: 'decision_stable_1'
        });
        expect(pool.query.mock.calls.some(([sql]) => /\bmemory_candidates\b/i.test(sql))).toBe(false);
    });
});

describe('LearningService Graph promotion identity', () => {
    it('recommended_subject_idをGraph IDに使いderived_from_candidate_idをpayloadへ保持する', async () => {
        const client = {
            query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
            release: vi.fn()
        };
        const pool = {
            query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
            connect: vi.fn(async () => client)
        };
        const ontologyRegistry = {
            hasCurrent: () => false,
            resolve: () => ({ kernel: { getType: vi.fn() } })
        };
        const service = new LearningService({ pool, ontologyRegistry });
        vi.spyOn(service, 'ensureSchema').mockResolvedValue();
        vi.spyOn(service, 'getMemoryCandidate').mockResolvedValue({
            ...legacyPayload(),
            id: 'memcand_legacy_1',
            recommended_subject_id: 'decision_stable_1',
            promotion_status: 'approved',
            redaction_status: 'none',
            permission_snapshot: {},
            evidence_ids: []
        });
        vi.spyOn(service, '_transitionMemoryCandidate').mockResolvedValue({ success: true });

        const result = await service.promoteMemoryCandidateToGraph('memcand_legacy_1', {
            actor_person_id: 'sato_keigo',
            access: { role: 'member', projectCodes: ['brainbase'] }
        });

        const graphInsert = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO graph_entities'));
        expect(graphInsert).toBeTruthy();
        expect(graphInsert[1][0]).toBe('decision_stable_1');
        expect(JSON.parse(graphInsert[1][3])).toMatchObject({
            derived_from_candidate_id: 'memcand_legacy_1'
        });
        expect(result.graph_entity.id).toBe('decision_stable_1');
    });

    it('recommended_subject_id欠落時はGraph書込み前に拒否する', async () => {
        const pool = {
            query: vi.fn(),
            connect: vi.fn()
        };
        const ontologyRegistry = {
            hasCurrent: () => false,
            resolve: () => ({ kernel: { getType: vi.fn() } })
        };
        const service = new LearningService({ pool, ontologyRegistry });
        vi.spyOn(service, 'ensureSchema').mockResolvedValue();
        vi.spyOn(service, 'getMemoryCandidate').mockResolvedValue({
            ...legacyPayload({ subject_id: null }),
            id: 'memcand_without_stable_id',
            recommended_subject_id: null,
            promotion_status: 'approved',
            redaction_status: 'none',
            permission_snapshot: {},
            evidence_ids: []
        });

        await expect(service.promoteMemoryCandidateToGraph('memcand_without_stable_id', {
            actor_person_id: 'sato_keigo',
            access: { role: 'member', projectCodes: ['brainbase'] }
        })).rejects.toThrow('recommended_subject_id');
        expect(pool.connect).not.toHaveBeenCalled();
    });
});
