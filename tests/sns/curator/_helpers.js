// @ts-check
import { SnsReadonlyCurator } from '../../../server/services/sns/sns-readonly-curator.js';
import { makeService } from '../../candidate-store/_helpers.js';

export function mockGraphReader(entities) {
    return { listRecentEntities: async () => entities };
}

export function makeCurator({ entities = [], dailyLimit = 30, personaBrainProvider = undefined } = {}) {
    const { service: candidateService } = makeService();
    const curator = new SnsReadonlyCurator({
        graphReader: mockGraphReader(entities),
        candidateService,
        dailyLimit,
        personaBrainProvider
    });
    return { curator, candidateService };
}

export function sourceInsight(id = 'ent1', overrides = {}) {
    return {
        id,
        cognitive_type: 'insight',
        body: '気づいた: codex委譲は集中力を保ちやすい',
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
        body: 'AI agencyは visibility と別軸にする',
        derived_from: ['ins_1', 'ins_2'],
        agency_level: 'synthesize',
        sensitivity: 'internal',
        ...overrides
    };
}

export function viewer(sub = 'sato_keigo', overrides = {}) {
    return {
        sub,
        role: 'ceo',
        workspace: 'unson',
        org_ids: ['unson'],
        interests: ['codex', 'agency'],
        ...overrides
    };
}
