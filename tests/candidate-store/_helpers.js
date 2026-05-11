// @ts-check
import { InMemoryCandidateRepository } from '../../server/services/candidate-store/candidate-repository.js';
import { PromotionGateService } from '../../server/services/candidate-store/promotion-gate-service.js';
import { PrivatePreferencePolicy } from '../../server/services/candidate-store/auto-promote-policy/private-preference.js';

export function makeService({ withPolicy = false, dailyLimit = 50, graphWriter = null } = {}) {
    const repository = new InMemoryCandidateRepository();
    const autoPromotePolicies = [];
    let policy = null;
    if (withPolicy) {
        policy = new PrivatePreferencePolicy({ dailyLimit });
        autoPromotePolicies.push(policy);
    }
    const service = new PromotionGateService({ repository, graphWriter, autoPromotePolicies });
    return { repository, service, policy };
}

export function baseDraft(overrides = {}) {
    return {
        cognitive_type: 'observation',
        body: 'Z.aiのAPIが期待値より速い',
        owner_person_id: 'sato_keigo',
        actor_person_id: 'sato_keigo',
        source_system: 'brainbase',
        source_event_ids: ['session:abc:1'],
        workspace: 'unson',
        project_code: 'brainbase',
        org_ids: ['unson'],
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: 'member',
        agency_level: 'synthesize',
        requires_approval: true,
        redaction_status: 'none',
        ...overrides
    };
}

export function approver(actorId = 'sato_keigo') {
    return { actor_person_id: actorId };
}

export function preferenceDraft(overrides = {}) {
    return baseDraft({
        cognitive_type: 'preference',
        body: '圧縮品質は0.7派',
        recommended_subject_type: 'person',
        requires_approval: false,
        ...overrides
    });
}
