// @ts-check
import { SnsReadonlyCurator } from '../../../server/services/sns/sns-readonly-curator.js';
import { makeService } from '../../candidate-store/_helpers.js';

export function mockGraphReader(entities) {
    return { listRecentEntities: async () => entities };
}

export function makeCurator({ entities = [], dailyLimit = 30 } = {}) {
    const { service: candidateService } = makeService();
    const curator = new SnsReadonlyCurator({
        graphReader: mockGraphReader(entities),
        candidateService,
        dailyLimit
    });
    return { curator, candidateService };
}

export function sourceInsight(id = 'ent1', overrides = {}) {
    return {
        id,
        cognitive_type: 'insight',
        body: '今日はcodexへ委譲した。自分の集中力を保ちやすいと感じた。',
        category: 'work_log',
        derived_from: ['cand_obs_1'],
        agency_level: 'synthesize',
        sensitivity: 'internal',
        ...overrides
    };
}

export function sourceDecision(id = 'dec1', overrides = {}) {
    return {
        id,
        cognitive_type: 'decision',
        body: '今日はAI agencyをvisibilityと別軸にすると決めた。',
        category: 'work_log',
        derived_from: ['ins_1', 'ins_2'],
        agency_level: 'synthesize',
        sensitivity: 'internal',
        ...overrides
    };
}

export function viewer(sub = 'sato_keigo', overrides = {}) {
    return {
        sub,
        owner_person_id: sub,
        actor_person_id: sub,
        organization_id: 'unson',
        role: 'ceo',
        workspace: 'unson',
        org_ids: ['unson'],
        interests: ['codex', 'agency'],
        ...overrides
    };
}
