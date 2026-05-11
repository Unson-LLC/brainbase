// @ts-check
/**
 * Candidate Repository (in-memory, swappable to DB-backed later)
 * SPEC-candidate-store-mvp Contract-2
 * テストでは in-memory、本番ではPostgres版に差し替え可
 */

const COGNITIVE_TYPES = new Set(['observation', 'insight', 'claim', 'preference', 'hypothesis', 'experiment', 'result']);
const VISIBILITY = new Set(['owner', 'team', 'org', 'public']);
const SENSITIVITY = new Set(['internal', 'restricted', 'confidential', 'top-secret']);
const ROLE_MIN = new Set(['member', 'gm', 'ceo']);
const AGENCY = new Set(['none', 'read-only', 'synthesize', 'write-back']);
const STATUS = new Set(['candidate', 'pending_approval', 'approved', 'rejected', 'expired', 'promoted_to_graph']);

const ALLOWED_TRANSITIONS = {
    candidate: new Set(['pending_approval', 'rejected', 'expired']),
    pending_approval: new Set(['approved', 'rejected', 'expired']),
    approved: new Set(['promoted_to_graph']),
    rejected: new Set(),
    expired: new Set(),
    promoted_to_graph: new Set()
};

export class ACLFieldMissingError extends Error {
    constructor(field) {
        super(`ACL field missing: ${field}`);
        this.name = 'ACLFieldMissingError';
        this.field = field;
    }
}

export class InvalidTransitionError extends Error {
    constructor(from, to) {
        super(`Invalid candidate status transition: ${from} -> ${to}`);
        this.name = 'InvalidTransitionError';
        this.from = from;
        this.to = to;
    }
}

export class DuplicateCandidateError extends Error {
    constructor(key) {
        super(`Duplicate candidate for source: ${key}`);
        this.name = 'DuplicateCandidateError';
    }
}

function validate(input) {
    if (!input.cognitive_type || !COGNITIVE_TYPES.has(input.cognitive_type)) {
        throw new ACLFieldMissingError('cognitive_type');
    }
    if (!input.owner_person_id) throw new ACLFieldMissingError('owner_person_id');
    if (!input.actor_person_id) throw new ACLFieldMissingError('actor_person_id');
    if (!input.visibility || !VISIBILITY.has(input.visibility)) throw new ACLFieldMissingError('visibility');
    if (!input.sensitivity || !SENSITIVITY.has(input.sensitivity)) throw new ACLFieldMissingError('sensitivity');
    if (input.role_min && !ROLE_MIN.has(input.role_min)) throw new ACLFieldMissingError('role_min');
    if (input.agency_level && !AGENCY.has(input.agency_level)) throw new ACLFieldMissingError('agency_level');
    if (!Array.isArray(input.org_ids)) throw new ACLFieldMissingError('org_ids');
    if (!input.body) throw new ACLFieldMissingError('body');
    if (!input.source_system) throw new ACLFieldMissingError('source_system');
    if (!Array.isArray(input.source_event_ids) || input.source_event_ids.length === 0) {
        throw new ACLFieldMissingError('source_event_ids');
    }
}

function duplicateKey(input) {
    return `${input.source_system}|${input.owner_person_id}|${JSON.stringify(input.source_event_ids.slice().sort())}`;
}

let candidateCounter = 0;
function nextId() {
    candidateCounter += 1;
    return `cand_${Date.now()}_${candidateCounter.toString(36)}`;
}

export class InMemoryCandidateRepository {
    constructor() {
        /** @type {Map<string, any>} */
        this.candidates = new Map();
        /** @type {Map<string, string>} */
        this.dedup = new Map();
        /** @type {Array<any>} */
        this.auditEvents = [];
        /** @type {Array<any>} */
        this.scanBlocks = [];
    }

    create(input) {
        validate(input);
        const key = duplicateKey(input);
        if (this.dedup.has(key)) {
            throw new DuplicateCandidateError(key);
        }
        const id = input.id || nextId();
        const now = new Date().toISOString();
        const record = {
            id,
            cognitive_type: input.cognitive_type,
            owner_person_id: input.owner_person_id,
            actor_person_id: input.actor_person_id,
            source_system: input.source_system,
            source_event_ids: input.source_event_ids,
            workspace: input.workspace || null,
            channel_id: input.channel_id || null,
            thread_ts: input.thread_ts || null,
            project_code: input.project_code || null,
            org_ids: input.org_ids,
            project_ids: input.project_ids || [],
            team_id: input.team_id || null,
            visibility: input.visibility,
            sensitivity: input.sensitivity,
            role_min: input.role_min || 'member',
            agency_level: input.agency_level || 'synthesize',
            recommended_subject_type: input.recommended_subject_type || null,
            recommended_owner_person_id: input.recommended_owner_person_id || null,
            promotion_status: input.promotion_status || 'candidate',
            promoted_graph_entity_id: null,
            requires_approval: input.requires_approval !== false,
            permission_snapshot: input.permission_snapshot || null,
            evidence_ids: input.evidence_ids || [],
            body: input.body,
            redaction_status: input.redaction_status || 'none',
            confidence: input.confidence ?? null,
            expires_at: input.expires_at || null,
            created_at: now,
            updated_at: now
        };
        this.candidates.set(id, record);
        this.dedup.set(key, id);
        return { ...record };
    }

    findById(id) {
        const r = this.candidates.get(id);
        return r ? { ...r } : null;
    }

    list(filter = {}) {
        const all = Array.from(this.candidates.values());
        return all.filter((r) => {
            if (filter.owner_person_id && r.owner_person_id !== filter.owner_person_id) return false;
            if (filter.promotion_status && r.promotion_status !== filter.promotion_status) return false;
            if (filter.cognitive_type && r.cognitive_type !== filter.cognitive_type) return false;
            return true;
        }).map((r) => ({ ...r }));
    }

    transition(id, nextStatus, audit) {
        const r = this.candidates.get(id);
        if (!r) throw new Error(`candidate not found: ${id}`);
        const allowed = ALLOWED_TRANSITIONS[r.promotion_status];
        if (!allowed || !allowed.has(nextStatus)) {
            throw new InvalidTransitionError(r.promotion_status, nextStatus);
        }
        const prev = r.promotion_status;
        r.promotion_status = nextStatus;
        r.updated_at = new Date().toISOString();
        this.auditEvents.push({
            id: this.auditEvents.length + 1,
            candidate_id: id,
            actor_person_id: audit.actor_person_id,
            decision_owner_person_id: audit.decision_owner_person_id || null,
            decision_reason: audit.decision_reason || null,
            decided_at: new Date().toISOString(),
            previous_status: prev,
            next_status: nextStatus,
            evidence_ids: audit.evidence_ids || null
        });
        return { ...r };
    }

    setPromotedGraphEntity(id, graphEntityId) {
        const r = this.candidates.get(id);
        if (!r) throw new Error(`candidate not found: ${id}`);
        r.promoted_graph_entity_id = graphEntityId;
        r.updated_at = new Date().toISOString();
        return { ...r };
    }

    setRedaction(id, status, newBody) {
        const r = this.candidates.get(id);
        if (!r) throw new Error(`candidate not found: ${id}`);
        r.redaction_status = status;
        if (typeof newBody === 'string') r.body = newBody;
        r.updated_at = new Date().toISOString();
        return { ...r };
    }

    listAudit(candidateId) {
        return this.auditEvents.filter((e) => e.candidate_id === candidateId).map((e) => ({ ...e }));
    }

    recordScanBlock(record) {
        const entry = { id: this.scanBlocks.length + 1, blocked_at: new Date().toISOString(), ...record };
        this.scanBlocks.push(entry);
        return { ...entry };
    }

    listScanBlocks() {
        return this.scanBlocks.map((e) => ({ ...e }));
    }
}

export { ALLOWED_TRANSITIONS, COGNITIVE_TYPES };
