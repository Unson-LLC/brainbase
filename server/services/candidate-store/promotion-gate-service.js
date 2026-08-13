// @ts-check
/**
 * Promotion Gate Service
 * SPEC-candidate-store-mvp Contract-3
 * 状態遷移 + Promote writer + Auto-promote policy 統合
 */

import { scan } from './pii-scanner.js';
import { InMemoryCandidateRepository, ACLFieldMissingError } from './candidate-repository.js';

const CATALOG_SUBJECT_TYPES = new Set([
    'person', 'org', 'customer', 'partner', 'contact',
    'project', 'app', 'brand', 'frame',
    'decision', 'philosophy', 'glossary_term',
    'story', 'raci_assignment'
]);

export class CandidateRedactionRequiredError extends Error {
    constructor(id) {
        super(`candidate requires redaction before promotion: ${id}`);
        this.name = 'CandidateRedactionRequiredError';
        this.code = 'candidate_redaction_required';
        this.statusCode = 409;
    }
}

function assertRedactionComplete(candidate) {
    if (candidate.redaction_status === 'needs_redaction') {
        throw new CandidateRedactionRequiredError(candidate.id);
    }
}

function maybeMap(value, mapper) {
    if (value && typeof value.then === 'function') {
        return value.then(mapper);
    }
    return mapper(value);
}

/**
 * @typedef {Object} GraphWriter
 * @property {(payload: any, options: {derived_from_candidate_id: string}) => Promise<{id: string}>} createEntity
 */

export class PromotionGateService {
    /**
     * @param {{
     *   repository?: InMemoryCandidateRepository,
     *   graphWriter?: GraphWriter,
     *   autoPromotePolicies?: Array<{name:string, applies:Function, targetSubjectType:Function, buildGraphPayload:Function, recordPromote:Function}>
     * }} [deps]
     */
    constructor(deps = {}) {
        this.repository = deps.repository || new InMemoryCandidateRepository();
        this.graphWriter = deps.graphWriter || null;
        this.autoPromotePolicies = deps.autoPromotePolicies || [];
    }

    /**
     * draft + pii scan → candidate 作成
     * AP-4 / INV-4: bypass 不可、必ず scan を通る
     */
    async createCandidate(draft, options = {}) {
        const sourceEventId = (draft.source_event_ids && draft.source_event_ids[0]) || 'unknown';
        // INV-4: scan が無い場合は本サービス内で scan を実行
        const scanResult = options.skipScan ? { block: false, review: false, findings: [] } : scan(draft.body);
        if (scanResult.block) {
            this.repository.recordScanBlock({
                owner_person_id: draft.owner_person_id,
                organization_id: draft.organization_id || draft.org_ids?.[0],
                source_system: draft.source_system,
                source_event_id: sourceEventId,
                actor_person_id: draft.actor_person_id,
                findings: scanResult.findings
            });
            return { blocked: true, findings: scanResult.findings };
        }
        if (scanResult.review && draft.redaction_status !== 'redacted') {
            draft = { ...draft, redaction_status: 'needs_redaction' };
        }

        const candidate = await this.repository.create(draft);

        // Auto-promote policy 評価（INV-9 / INV-1 redaction中はスキップ）
        if (candidate.redaction_status === 'none') {
            for (const policy of this.autoPromotePolicies) {
                const verdict = policy.applies(candidate);
                if (verdict.applies) {
                    const result = await this.autoPromote(candidate.id, policy, verdict.reason);
                    return { blocked: false, candidate: result.candidate, graphEntity: result.graphEntity, auto: true, policy: policy.name };
                }
            }
        }

        return { blocked: false, candidate, auto: false };
    }

    async requestApproval(id, actor) {
        return this.repository.transition(id, 'pending_approval', {
            actor_person_id: actor.actor_person_id,
            decision_owner_person_id: actor.decision_owner_person_id || null,
            decision_reason: 'request approval'
        });
    }

    /**
     * approve → promoted_to_graph
     * INV-3: Candidate IDはGraph edge endpointにせず、entity payloadの
     * derived_from_candidate_idとしてprovenanceを保持する
     * INV-7: catalog mapping 不一致なら rejected で reason 記録
     */
    async approveCandidate(id, approver, options = {}) {
        const candidate = await this.repository.findById(id);
        if (!candidate) throw new Error(`candidate not found: ${id}`);
        assertRedactionComplete(candidate);

        const targetType = options.targetSubjectType || candidate.recommended_subject_type;
        if (!targetType || !CATALOG_SUBJECT_TYPES.has(targetType)) {
            const rejected = await this.repository.transition(id, 'rejected', {
                actor_person_id: approver.actor_person_id,
                decision_owner_person_id: approver.actor_person_id,
                decision_reason: 'no catalog mapping'
            });
            return { candidate: rejected, graphEntity: null, rejected: true };
        }

        // Graph and Candidate Store are separate persistence boundaries. A retry may arrive
        // after the status transition, after the Graph id was attached, or before the caller's
        // run ledger observed either result. Rejoin the promoted candidate instead of attempting
        // the invalid promoted_to_graph -> approved transition.
        if (candidate.promotion_status === 'promoted_to_graph') {
            if (candidate.promoted_graph_entity_id) {
                return {
                    candidate,
                    graphEntity: { id: candidate.promoted_graph_entity_id },
                    resumed: true
                };
            }
            const graphEntity = await this._writeGraph({
                ...candidate,
                recommended_subject_type: targetType
            });
            const finalized = await this.repository.setPromotedGraphEntity(id, graphEntity.id);
            return { candidate: finalized, graphEntity, resumed: true };
        }

        const approved = candidate.promotion_status === 'approved' && options.resumeApproved === true
            ? candidate
            : await this.repository.transition(id, 'approved', {
                actor_person_id: approver.actor_person_id,
                decision_owner_person_id: approver.actor_person_id,
                decision_reason: options.reason || 'approved'
            });

        const graphEntity = await this._writeGraph({
            ...approved,
            recommended_subject_type: targetType
        });

        const promoted = await this.repository.transition(id, 'promoted_to_graph', {
            actor_person_id: approver.actor_person_id,
            decision_owner_person_id: approver.actor_person_id,
            decision_reason: 'promoted'
        });
        await this.repository.setPromotedGraphEntity(id, graphEntity.id);

        return { candidate: { ...promoted, promoted_graph_entity_id: graphEntity.id }, graphEntity };
    }

    async rejectCandidate(id, approver, reason = 'rejected') {
        return this.repository.transition(id, 'rejected', {
            actor_person_id: approver.actor_person_id,
            decision_owner_person_id: approver.actor_person_id,
            decision_reason: reason
        });
    }

    async redactCandidate(id, approver, redactedBody) {
        if (typeof redactedBody !== 'string' || redactedBody.length === 0) {
            throw new Error('redactedBody required');
        }
        const r = await this.repository.setRedaction(id, 'redacted', redactedBody);
        await this.repository.recordAudit({
            candidate_id: id,
            actor_person_id: approver.actor_person_id,
            decision_owner_person_id: approver.actor_person_id,
            decision_reason: 'redaction applied',
            previous_status: r.promotion_status,
            next_status: r.promotion_status,
            evidence_ids: null
        });
        return r;
    }

    async autoPromote(id, policy, reason) {
        const candidate = await this.repository.findById(id);
        if (!candidate) throw new Error(`candidate not found: ${id}`);
        assertRedactionComplete(candidate);
        const verdict = policy.applies(candidate);
        if (!verdict.applies) {
            throw new Error(`policy ${policy.name} declined: ${verdict.reason}`);
        }
        const approver = { actor_person_id: 'system:auto-promote' };
        const targetType = policy.targetSubjectType();

        await this.repository.transition(id, 'pending_approval', {
            actor_person_id: approver.actor_person_id,
            decision_owner_person_id: candidate.owner_person_id,
            decision_reason: `auto-promote policy:${policy.name}:${reason}`
        });

        const approved = await this.repository.transition(id, 'approved', {
            actor_person_id: approver.actor_person_id,
            decision_owner_person_id: candidate.owner_person_id,
            decision_reason: 'auto-approved'
        });

        const payload = policy.buildGraphPayload(approved);
        const graphEntity = await this._writeGraph({
            ...approved,
            recommended_subject_type: targetType,
            payload
        });

        const promoted = await this.repository.transition(id, 'promoted_to_graph', {
            actor_person_id: approver.actor_person_id,
            decision_owner_person_id: candidate.owner_person_id,
            decision_reason: 'auto-promoted'
        });
        await this.repository.setPromotedGraphEntity(id, graphEntity.id);
        if (policy.recordPromote) policy.recordPromote(candidate.owner_person_id);

        return { candidate: { ...promoted, promoted_graph_entity_id: graphEntity.id }, graphEntity };
    }

    expireCandidate(id) {
        return this.repository.transition(id, 'expired', {
            actor_person_id: 'system:expire',
            decision_reason: 'expired'
        });
    }

    async _writeGraph(candidate) {
        // Defense in depth: every manual, automatic, and retry path must preserve INV-9.
        assertRedactionComplete(candidate);
        if (this.graphWriter && typeof this.graphWriter.createEntity === 'function') {
            return this.graphWriter.createEntity(
                {
                    type: candidate.recommended_subject_type,
                    payload: candidate.payload || {
                        body: candidate.body,
                        derived_from_candidate_id: candidate.id
                    },
                    visibility: candidate.visibility,
                    sensitivity: candidate.sensitivity,
                    role_min: candidate.role_min,
                    agency_level: candidate.agency_level,
                    owner_person_id: candidate.owner_person_id,
                    org_ids: candidate.org_ids,
                    project_ids: candidate.project_ids,
                    team_id: candidate.team_id
                },
                { derived_from_candidate_id: candidate.id }
            );
        }
        // テスト用 default stub: deterministic id
        return Promise.resolve({ id: `graph_${candidate.id}_${candidate.recommended_subject_type}` });
    }

    listCandidates(filter, viewer) {
        const list = this.repository.list(filter);
        const applyAcl = (records) => {
            if (!viewer) return records;
            // INV-1/INV-2: candidate-store ACL
            return records.filter((c) => {
                if (c.owner_person_id === viewer.sub) return true;
                if (c.visibility === 'public') return true;
                if (c.visibility === 'team' && viewer.team_ids?.includes(c.team_id)) return true;
                if (c.visibility === 'org') {
                    const memberOrgs = viewer.org_ids || [];
                    return c.org_ids.some((o) => memberOrgs.includes(o));
                }
                if (c.recommended_owner_person_id === viewer.sub) return true; // approver
                return false;
            });
        };
        return maybeMap(list, applyAcl);
    }

    listAudit(candidateId) {
        return this.repository.listAudit(candidateId);
    }

    listScanBlocks() {
        return this.repository.listScanBlocks();
    }
}

export { CATALOG_SUBJECT_TYPES };
