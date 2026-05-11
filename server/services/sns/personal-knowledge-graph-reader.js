// @ts-check
/**
 * Personal Knowledge Graph Reader
 * SPEC-personal-kg-sns-seed-mvp
 *
 * MVPでは個人KGを「owner-visible candidate-store cognitive memory」のread modelとして扱う。
 * 書き込み・promote・投稿は行わず、SNS curator の graphReader contract に合わせて source entity を返す。
 */

const SNS_SOURCE_SYSTEM = 'sns-curator';
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
        visibility: candidate.visibility,
        org_ids: asArray(candidate.org_ids),
        project_ids: asArray(candidate.project_ids),
        team_id: candidate.team_id || null,
        created_at: candidate.created_at,
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
     * @param {{ since?: string, viewer: { sub: string } }} options
     * @returns {Promise<Array<any>>}
     */
    async listRecentEntities({ since, viewer }) {
        if (!viewer || !viewer.sub) {
            throw new Error('viewer.sub required');
        }

        const candidates = await this.candidateService.listCandidates({}, viewer);
        return candidates
            .filter((candidate) => candidate.owner_person_id === viewer.sub)
            .filter((candidate) => candidate.visibility === 'owner')
            .filter((candidate) => candidate.source_system !== SNS_SOURCE_SYSTEM)
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
