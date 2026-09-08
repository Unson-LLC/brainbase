// @ts-check
/**
 * Personal Knowledge Graph Reader
 * SPEC-personal-kg-sns-seed-mvp
 *
 * MVPでは個人KGを「owner-visible candidate-store cognitive memory」のread modelとして扱う。
 * 書き込み・promote・投稿は行わず、SNS curator の graphReader contract に合わせて source entity を返す。
 */

import {
    isPersonalKgCandidateInScope,
    requirePersonalKgIdentity
} from './personal-kg-identity.js';

const SNS_SOURCE_SYSTEMS = new Set(['sns-curator', 'sns-lifelog-curator']);
const EXCLUDED_STATUSES = new Set(['rejected', 'expired']);
const ALLOWED_COGNITIVE_TYPES = new Set([
    'insight',
    'claim',
    'preference',
    'hypothesis',
    'experiment',
    'result'
]);

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function isAfterSince(candidate, since) {
    if (!since) return true;
    const createdAt = Date.parse(candidate.created_at);
    const cutoff = Date.parse(since);
    if (Number.isNaN(createdAt) || Number.isNaN(cutoff)) return true;
    return createdAt >= cutoff;
}

function toSourceEntity(candidate) {
    return {
        id: `candidate:${candidate.id}`,
        source_candidate_id: candidate.id,
        cognitive_type: candidate.cognitive_type,
        body: candidate.body,
        derived_from: asArray(candidate.source_event_ids),
        source_event_ids: asArray(candidate.source_event_ids),
        evidence_ids: asArray(candidate.evidence_ids),
        agency_level: candidate.agency_level,
        sensitivity: candidate.sensitivity,
        owner_person_id: candidate.owner_person_id,
        organization_id: candidate.organization_id || null,
        visibility: candidate.visibility,
        org_ids: asArray(candidate.org_ids),
        project_ids: asArray(candidate.project_ids),
        team_id: candidate.team_id || null,
        created_at: candidate.created_at,
        category: candidate.permission_snapshot?.seed?.category
            || candidate.permission_snapshot?.oyasumi_meeting_personal_kg?.category
            || null,
        lifelog_ready: candidate.permission_snapshot?.oyasumi_meeting_personal_kg?.memory_layer === 'sns_ready',
        reuse_count: candidate.permission_snapshot?.sns?.reuse_count || 0
    };
}

export class PersonalKnowledgeGraphReader {
    /**
     * @param {{ candidateService: { listCandidates: Function } }} deps
     */
    constructor({ candidateService }) {
        if (!candidateService || typeof candidateService.listCandidates !== 'function') {
            throw new Error('candidateService required');
        }
        this.candidateService = candidateService;
    }

    /**
     * SnsReadonlyCurator graphReader contract.
     * @param {{ since?: string, viewer: object }} options
     * @returns {Promise<Array<any>>}
     */
    async listRecentEntities({ since, viewer }) {
        const identity = requirePersonalKgIdentity(viewer);

        const candidates = await this.candidateService.listCandidates({}, identity);
        return candidates
            .filter((candidate) => isPersonalKgCandidateInScope(candidate, identity))
            .filter((candidate) => candidate.visibility === 'owner')
            .filter((candidate) => !SNS_SOURCE_SYSTEMS.has(candidate.source_system))
            .filter((candidate) => ALLOWED_COGNITIVE_TYPES.has(candidate.cognitive_type))
            .filter((candidate) => candidate.agency_level !== 'none')
            .filter((candidate) => candidate.redaction_status === 'none')
            .filter((candidate) => !EXCLUDED_STATUSES.has(candidate.promotion_status))
            .filter((candidate) => isAfterSince(candidate, since))
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
            .map(toSourceEntity);
    }
}

export { ALLOWED_COGNITIVE_TYPES };
