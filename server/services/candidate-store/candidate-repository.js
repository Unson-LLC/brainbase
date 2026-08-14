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
const STATUS = new Set(['candidate', 'gate_classified', 'pending_approval', 'auto_promoted', 'approved', 'rejected', 'expired', 'promoted_to_graph']);
const PERSONAL_KG_TYPES = ['observation', 'insight', 'claim', 'preference', 'hypothesis', 'experiment', 'result'];
const PROCESSING_STAGES = ['received', 'queued', 'extracted', 'resolved', 'indexed', 'retrievable'];
const PROCESSING_STAGE_INDEX = new Map(PROCESSING_STAGES.map((stage, index) => [stage, index]));
const SEMANTIC_STATES = new Set(['active', 'superseded', 'contradicted', 'quarantined', 'retracted', 'expired']);
const TARGET_TIERS = new Set(['ledger', 'episode', 'personal_kg', 'graph', 'skill_candidate']);

const ALLOWED_TRANSITIONS = {
    candidate: new Set(['gate_classified', 'pending_approval', 'auto_promoted', 'rejected', 'expired']),
    gate_classified: new Set(['pending_approval', 'auto_promoted', 'rejected', 'expired']),
    pending_approval: new Set(['approved', 'rejected', 'expired']),
    auto_promoted: new Set(['promoted_to_graph', 'rejected', 'expired']),
    approved: new Set(['promoted_to_graph', 'rejected', 'expired']),
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
    const processingStage = input.processing_stage || 'received';
    if (!PROCESSING_STAGE_INDEX.has(processingStage)) throw new Error('processing_stage is invalid');
    const semanticState = input.semantic_state || 'active';
    if (!SEMANTIC_STATES.has(semanticState)) throw new Error('semantic_state is invalid');
    const targetTier = input.target_tier || 'ledger';
    if (!TARGET_TIERS.has(targetTier)) throw new Error('target_tier is invalid');
    if (targetTier === 'graph' && !(typeof input.recommended_subject_id === 'string' && input.recommended_subject_id.trim())) {
        throw new Error('recommended_subject_id is required for graph target_tier');
    }
}

function assertProcessingStage(stage) {
    if (!PROCESSING_STAGE_INDEX.has(stage)) throw new Error('processing_stage is invalid');
}

function assertSemanticState(state) {
    if (!SEMANTIC_STATES.has(state)) throw new Error('semantic_state is invalid');
}

function escapeLikePattern(value) {
    return String(value).replace(/[\\%_]/g, '\\$&');
}

function toIso(value) {
    if (!value) return value;
    if (value instanceof Date) return value.toISOString();
    return value;
}

function normalizeCandidate(row) {
    if (!row) return null;
    return {
        ...row,
        source_event_ids: row.source_event_ids || [],
        org_ids: row.org_ids || [],
        project_ids: row.project_ids || [],
        evidence_ids: row.evidence_ids || [],
        permission_snapshot: row.permission_snapshot || null,
        created_at: toIso(row.created_at),
        updated_at: toIso(row.updated_at),
        expires_at: toIso(row.expires_at)
    };
}

function normalizeAudit(row) {
    if (!row) return null;
    return {
        ...row,
        decided_at: toIso(row.decided_at),
        evidence_ids: row.evidence_ids || null
    };
}

function requireCandidateAccess(access) {
    const personId = access?.personId || access?.person_id;
    const organizationId = access?.organizationId || access?.organization_id || access?.tenantId;
    if (!personId || !organizationId) {
        const error = new Error('candidate repository requires person and organization access context');
        error.code = 'candidate_access_context_required';
        throw error;
    }
    return { personId, organizationId };
}

function scopedCandidateRepository(repository, client) {
    return {
        create: (input) => repository.create(input, { client }),
        findById: (id) => repository.findById(id, { client }),
        findByEventId: (id, options = {}) => repository.findByEventId(id, { ...options, client }),
        list: (filter = {}) => repository.list(filter, { client }),
        listPersonalKg: (filter = {}) => repository.listPersonalKg(filter, { client }),
        summarizePersonalKg: (filter = {}) => repository.summarizePersonalKg(filter, { client }),
        searchPersonalKg: (filter = {}) => repository.searchPersonalKg(filter, { client }),
        transitionWithAudit: (id, nextStatus, audit, options = {}) => repository.transitionWithAudit(
            id, nextStatus, audit, { ...options, client }
        )
    };
}

function clampLimit(value, fallback = 50, max = 500) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), max) : fallback;
}

function allowedRolesFor(role) {
    if (role === 'ceo') return ['member', 'gm', 'ceo'];
    if (role === 'gm') return ['member', 'gm'];
    return ['member'];
}

function personalKgMemoryLayerSql() {
    return `COALESCE(
        permission_snapshot->'oyasumi_meeting_personal_kg'->>'memory_layer',
        permission_snapshot->'personal_kg'->>'memory_layer',
        permission_snapshot->'seed'->>'memory_layer',
        permission_snapshot->>'memory_layer',
        'personal_kg_core'
    )`;
}

function personalKgSnsReadySql() {
    const layer = personalKgMemoryLayerSql();
    return `(COALESCE(permission_snapshot->>'sns_ready', 'false') = 'true'
        OR (${layer} = 'sns_ready'
            AND COALESCE(
                permission_snapshot->'oyasumi_meeting_personal_kg'->>'projection_allowed',
                permission_snapshot->'personal_kg'->>'projection_allowed',
                permission_snapshot->'seed'->>'projection_allowed',
                permission_snapshot->>'projection_allowed',
                'true'
            ) <> 'false'))`;
}

function buildPersonalKgWhere(filter = {}) {
    const clauses = [];
    const params = [];
    const add = (sql, value) => {
        params.push(value);
        clauses.push(sql.replace('?', `$${params.length}`));
    };
    const owner = filter.owner_person_id || filter.ownerPersonId;
    if (!owner) throw new Error('owner_person_id is required');
    add('owner_person_id = ?', owner);
    clauses.push(`semantic_state = 'active'`);
    clauses.push(`visibility IN ('owner', 'private')`);
    add('cognitive_type = ANY(?::text[])', Array.isArray(filter.cognitive_types) && filter.cognitive_types.length ? filter.cognitive_types : PERSONAL_KG_TYPES);
    if (!filter.bypass_acl && !filter.owner_read) {
        add('(role_min IS NULL OR role_min = ANY(?::text[]))', allowedRolesFor(filter.role));
        add('(sensitivity IS NULL OR sensitivity = ANY(?::text[]))', Array.isArray(filter.clearance) && filter.clearance.length ? filter.clearance : ['internal']);
    }
    if (filter.promotion_status) add('promotion_status = ?', filter.promotion_status);
    if (filter.cognitive_type) add('cognitive_type = ?', filter.cognitive_type);
    if (filter.redaction_status) add('redaction_status = ?', filter.redaction_status);
    if (filter.memory_layer) add(`${personalKgMemoryLayerSql()} = ?`, filter.memory_layer);
    return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

function normalizeScanBlock(row) {
    if (!row) return null;
    return {
        ...row,
        blocked_at: toIso(row.blocked_at)
    };
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
        const id = input.id || nextId();
        if (this.candidates.has(id) || this.dedup.has(key)) {
            throw new DuplicateCandidateError(key);
        }
        const now = new Date().toISOString();
        const record = {
            id,
            cognitive_type: input.cognitive_type,
            owner_person_id: input.owner_person_id,
            organization_id: input.organization_id || input.org_ids?.[0] || null,
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
            recommended_subject_id: input.recommended_subject_id || null,
            processing_stage: input.processing_stage || 'received',
            semantic_state: input.semantic_state || 'active',
            target_tier: input.target_tier || 'ledger',
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

    findByEventId(eventId) {
        const candidate = Array.from(this.candidates.values())
            .find((row) => row.source_event_ids.includes(eventId));
        return candidate ? { ...candidate } : null;
    }

    list(filter = {}) {
        const all = Array.from(this.candidates.values());
        let rows = all.filter((r) => {
            if (filter.id && r.id !== filter.id) return false;
            if (filter.owner_person_id && r.owner_person_id !== filter.owner_person_id) return false;
            if (filter.source_system && r.source_system !== filter.source_system) return false;
            if (filter.source_event_prefix && !r.source_event_ids.some((eventId) => eventId.startsWith(filter.source_event_prefix))) return false;
            if (filter.visibility && r.visibility !== filter.visibility) return false;
            if (filter.sensitivity && r.sensitivity !== filter.sensitivity) return false;
            if (filter.project_code && r.project_code !== filter.project_code) return false;
            if (filter.promotion_status && r.promotion_status !== filter.promotion_status) return false;
            if (filter.cognitive_type && r.cognitive_type !== filter.cognitive_type) return false;
            if (filter.recommended_subject_type && r.recommended_subject_type !== filter.recommended_subject_type) return false;
            return true;
        });
        if (filter.order_by === 'created_at') {
            const direction = filter.order_direction === 'desc' ? -1 : 1;
            rows = rows.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) * direction);
        }
        if (filter.limit) rows = rows.slice(0, clampLimit(filter.limit));
        return rows.map((r) => ({ ...r }));
    }

    transitionProcessingStage(id, nextStage) {
        assertProcessingStage(nextStage);
        const candidate = this.candidates.get(id);
        if (!candidate) throw new Error(`candidate not found: ${id}`);
        if (PROCESSING_STAGE_INDEX.get(nextStage) < PROCESSING_STAGE_INDEX.get(candidate.processing_stage)) {
            throw new InvalidTransitionError(candidate.processing_stage, nextStage);
        }
        candidate.processing_stage = nextStage;
        candidate.updated_at = new Date().toISOString();
        return { ...candidate };
    }

    updateSemanticState(id, nextState) {
        assertSemanticState(nextState);
        const candidate = this.candidates.get(id);
        if (!candidate) throw new Error(`candidate not found: ${id}`);
        candidate.semantic_state = nextState;
        candidate.updated_at = new Date().toISOString();
        return { ...candidate };
    }

    transition(id, nextStatus, audit) {
        return this.transitionWithAudit(id, nextStatus, audit).candidate;
    }

    transitionWithAudit(id, nextStatus, audit, options = {}) {
        const r = this.candidates.get(id);
        if (!r) throw new Error(`candidate not found: ${id}`);
        const allowed = ALLOWED_TRANSITIONS[r.promotion_status];
        if (!allowed || !allowed.has(nextStatus)) {
            throw new InvalidTransitionError(r.promotion_status, nextStatus);
        }
        const prev = r.promotion_status;
        r.promotion_status = nextStatus;
        if (typeof options.requires_approval === 'boolean') {
            r.requires_approval = options.requires_approval;
        }
        if (options.promoted_graph_entity_id) {
            r.promoted_graph_entity_id = options.promoted_graph_entity_id;
        }
        r.updated_at = new Date().toISOString();
        const auditEvent = {
            id: this.auditEvents.length + 1,
            candidate_id: id,
            actor_person_id: audit.actor_person_id,
            decision_owner_person_id: audit.decision_owner_person_id || null,
            decision_reason: audit.decision_reason || null,
            decided_at: new Date().toISOString(),
            previous_status: prev,
            next_status: nextStatus,
            evidence_ids: audit.evidence_ids || null
        };
        this.auditEvents.push(auditEvent);
        return { candidate: { ...r }, audit: { ...auditEvent } };
    }

    recordAudit(record) {
        const entry = {
            id: this.auditEvents.length + 1,
            candidate_id: record.candidate_id,
            actor_person_id: record.actor_person_id,
            decision_owner_person_id: record.decision_owner_person_id || null,
            decision_reason: record.decision_reason || null,
            decided_at: new Date().toISOString(),
            previous_status: record.previous_status,
            next_status: record.next_status,
            evidence_ids: record.evidence_ids || null
        };
        this.auditEvents.push(entry);
        return { ...entry };
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

    searchPersonalKg({ owner_person_id, query, tokens = [], cognitive_types = [], limit = 10 }) {
        const phrase = String(query).toLocaleLowerCase();
        const normalizedTokens = tokens.map((token) => String(token).toLocaleLowerCase());
        return Array.from(this.candidates.values())
            .filter((candidate) => {
                const body = typeof candidate.body === 'string' ? candidate.body : '';
                const normalizedBody = body.toLocaleLowerCase();
                const matchesText = normalizedBody.includes(phrase)
                    || (normalizedTokens.length > 1 && normalizedTokens.every((token) => normalizedBody.includes(token)));
                return candidate.owner_person_id === owner_person_id
                    && candidate.semantic_state === 'active'
                    && ['owner', 'private'].includes(candidate.visibility)
                    && candidate.redaction_status === 'none'
                    && candidate.promotion_status !== 'rejected'
                    && body.length > 0
                    && matchesText
                    && (cognitive_types.length === 0 || cognitive_types.includes(candidate.cognitive_type));
            })
            .sort((left, right) => {
                const leftExact = left.body.toLocaleLowerCase().includes(phrase) ? 0 : 1;
                const rightExact = right.body.toLocaleLowerCase().includes(phrase) ? 0 : 1;
                if (leftExact !== rightExact) return leftExact - rightExact;
                const confidence = (right.confidence ?? -Infinity) - (left.confidence ?? -Infinity);
                if (confidence !== 0) return confidence;
                return String(right.created_at).localeCompare(String(left.created_at));
            })
            .slice(0, clampLimit(limit, 10, 50))
            .map((candidate) => normalizeCandidate(candidate));
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

export class PgCandidateRepository {
    constructor({ pool }) {
        if (!pool || typeof pool.query !== 'function') {
            throw new Error('PgCandidateRepository requires a pg pool/client with query(sql, params)');
        }
        this.pool = pool;
    }

    async create(input, { client } = {}) {
        validate(input);
        const queryable = client || this.pool;
        try {
            const key = duplicateKey(input);
            const id = input.id || nextId();
            const duplicate = await queryable.query(
                `SELECT id
                 FROM memory_candidates
                 WHERE id = $1
                    OR (source_system = $2
                        AND owner_person_id = $3
                        AND source_event_ids::text = $4)
                 LIMIT 1`,
                [id, input.source_system, input.owner_person_id, JSON.stringify(input.source_event_ids.slice().sort())]
            );
            if (duplicate.rows.length > 0) {
                throw new DuplicateCandidateError(key);
            }
            const { rows } = await queryable.query(
                `INSERT INTO memory_candidates (
                    id, cognitive_type, owner_person_id, organization_id, actor_person_id, source_system, source_event_ids,
                    workspace, channel_id, thread_ts, project_code, org_ids, project_ids, team_id,
                    visibility, sensitivity, role_min, agency_level, recommended_subject_type,
                    recommended_owner_person_id, promotion_status, promoted_graph_entity_id,
                    requires_approval, permission_snapshot, evidence_ids, body, redaction_status,
                    confidence, expires_at, recommended_subject_id, processing_stage, semantic_state,
                    target_tier
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7::jsonb,
                    $8, $9, $10, $11, $12, $13, $14,
                    $15, $16, $17, $18, $19,
                    $20, $21, $22,
                    $23, $24::jsonb, $25::jsonb, $26, $27,
                    $28, $29, $30, $31, $32, $33
                )
                RETURNING *`,
                [
                    id,
                    input.cognitive_type,
                    input.owner_person_id,
                    input.organization_id || input.org_ids?.[0] || '__quarantine__',
                    input.actor_person_id,
                    input.source_system,
                    JSON.stringify(input.source_event_ids),
                    input.workspace || null,
                    input.channel_id || null,
                    input.thread_ts || null,
                    input.project_code || null,
                    input.org_ids,
                    input.project_ids || [],
                    input.team_id || null,
                    input.visibility,
                    input.sensitivity,
                    input.role_min || 'member',
                    input.agency_level || 'synthesize',
                    input.recommended_subject_type || null,
                    input.recommended_owner_person_id || null,
                    input.promotion_status || 'candidate',
                    null,
                    input.requires_approval !== false,
                    JSON.stringify(input.permission_snapshot || null),
                    JSON.stringify(input.evidence_ids || []),
                    input.body,
                    input.redaction_status || 'none',
                    input.confidence ?? null,
                    input.expires_at || null,
                    input.recommended_subject_id || null,
                    input.processing_stage || 'received',
                    input.semantic_state || 'active',
                    input.target_tier || 'ledger'
                ]
            );
            return normalizeCandidate(rows[0]);
        } catch (error) {
            if (error && error.code === '23505') {
                throw new DuplicateCandidateError(duplicateKey(input));
            }
            throw error;
        }
    }

    async findById(id, { client } = {}) {
        const { rows } = await (client || this.pool).query('SELECT * FROM memory_candidates WHERE id = $1', [id]);
        return normalizeCandidate(rows[0]);
    }

    async findByEventId(eventId, { client, projectCode } = {}) {
        const params = [JSON.stringify([eventId])];
        const projectClause = projectCode ? ` AND project_code = $${params.push(projectCode)}` : '';
        const { rows } = await (client || this.pool).query(
            `SELECT * FROM memory_candidates
             WHERE source_event_ids @> $1::jsonb
             ${projectClause}
             ORDER BY created_at ASC, id ASC
             LIMIT 1`,
            params
        );
        return normalizeCandidate(rows[0]);
    }

    async list(filter = {}, { client } = {}) {
        const clauses = [];
        const params = [];
        const add = (sql, value) => {
            params.push(value);
            clauses.push(sql.replace('?', `$${params.length}`));
        };
        if (filter.id) add('id = ?', filter.id);
        if (filter.owner_person_id) add('owner_person_id = ?', filter.owner_person_id);
        if (filter.source_system) add('source_system = ?', filter.source_system);
        if (filter.source_event_prefix) add(
            'EXISTS (SELECT 1 FROM jsonb_array_elements_text(source_event_ids) AS source_event(event_id) WHERE starts_with(event_id, ?))',
            filter.source_event_prefix
        );
        if (filter.visibility) add('visibility = ?', filter.visibility);
        if (filter.sensitivity) add('sensitivity = ?', filter.sensitivity);
        if (filter.project_code) add('project_code = ?', filter.project_code);
        if (filter.promotion_status) add('promotion_status = ?', filter.promotion_status);
        if (filter.cognitive_type) add('cognitive_type = ?', filter.cognitive_type);
        if (filter.recommended_subject_type) add('recommended_subject_type = ?', filter.recommended_subject_type);
        const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
        const orderDirection = filter.order_direction === 'desc' ? 'DESC' : 'ASC';
        const orderBy = filter.order_by === 'created_at' ? `created_at ${orderDirection}, id ${orderDirection}` : 'created_at ASC, id ASC';
        let sql = `SELECT * FROM memory_candidates${where} ORDER BY ${orderBy}`;
        if (filter.limit) {
            params.push(clampLimit(filter.limit));
            sql += ` LIMIT $${params.length}`;
        }
        const { rows } = await (client || this.pool).query(sql, params);
        return rows.map(normalizeCandidate);
    }

    async transitionProcessingStage(id, nextStage, { client: externalClient } = {}) {
        assertProcessingStage(nextStage);
        const client = externalClient
            || (typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool);
        if (!externalClient) await client.query('BEGIN');
        try {
            const { rows } = await client.query('SELECT * FROM memory_candidates WHERE id = $1 FOR UPDATE', [id]);
            const current = rows[0];
            if (!current) throw new Error(`candidate not found: ${id}`);
            if (PROCESSING_STAGE_INDEX.get(nextStage) < PROCESSING_STAGE_INDEX.get(current.processing_stage)) {
                throw new InvalidTransitionError(current.processing_stage, nextStage);
            }
            if (nextStage === current.processing_stage) {
                if (!externalClient) await client.query('COMMIT');
                return normalizeCandidate(current);
            }
            const updated = await client.query(
                'UPDATE memory_candidates SET processing_stage = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
                [id, nextStage]
            );
            if (!externalClient) await client.query('COMMIT');
            return normalizeCandidate(updated.rows[0]);
        } catch (error) {
            if (!externalClient) await client.query('ROLLBACK');
            throw error;
        } finally {
            if (!externalClient && typeof client.release === 'function') client.release();
        }
    }

    async updateSemanticState(id, nextState, { client } = {}) {
        assertSemanticState(nextState);
        const { rows } = await (client || this.pool).query(
            'UPDATE memory_candidates SET semantic_state = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
            [id, nextState]
        );
        if (!rows[0]) throw new Error(`candidate not found: ${id}`);
        return normalizeCandidate(rows[0]);
    }

    async listPersonalKg(filter = {}, { client } = {}) {
        const { where, params } = buildPersonalKgWhere(filter);
        params.push(clampLimit(filter.limit, 50, 500));
        const layerSql = personalKgMemoryLayerSql();
        const snsReadySql = personalKgSnsReadySql();
        const { rows } = await (client || this.pool).query(
            `SELECT *, ${layerSql} AS memory_layer, ${snsReadySql} AS sns_ready
             FROM memory_candidates
             ${where}
             ORDER BY created_at DESC, id DESC
             LIMIT $${params.length}`,
            params
        );
        return rows.map(normalizeCandidate);
    }

    async summarizePersonalKg(filter = {}, { client } = {}) {
        const { where, params } = buildPersonalKgWhere(filter);
        const layerSql = personalKgMemoryLayerSql();
        const snsReadySql = personalKgSnsReadySql();
        const { rows } = await (client || this.pool).query(
            `WITH filtered AS (
                SELECT *, ${layerSql} AS memory_layer, ${snsReadySql} AS sns_ready
                FROM memory_candidates
                ${where}
             ),
             cognitive_counts AS (
                SELECT COALESCE(cognitive_type, 'unknown') AS key, COUNT(*)::int AS value FROM filtered GROUP BY 1
             ),
             promotion_counts AS (
                SELECT COALESCE(promotion_status, 'unknown') AS key, COUNT(*)::int AS value FROM filtered GROUP BY 1
             ),
             redaction_counts AS (
                SELECT COALESCE(redaction_status, 'unknown') AS key, COUNT(*)::int AS value FROM filtered GROUP BY 1
             ),
             source_counts AS (
                SELECT COALESCE(source_system, 'unknown') AS key, COUNT(*)::int AS value FROM filtered GROUP BY 1
             ),
             layer_counts AS (
                SELECT COALESCE(memory_layer, 'unknown') AS key, COUNT(*)::int AS value FROM filtered GROUP BY 1
             )
             SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE promotion_status NOT IN ('rejected', 'expired'))::int AS active_count,
                COUNT(*) FILTER (WHERE memory_layer = 'personal_kg_core')::int AS core_count,
                COUNT(*) FILTER (WHERE sns_ready = true)::int AS sns_ready_count,
                COUNT(*) FILTER (WHERE requires_approval = true OR promotion_status = 'pending_approval')::int AS review_count,
                COUNT(*) FILTER (WHERE redaction_status = 'needs_redaction')::int AS needs_redaction_count,
                COUNT(*) FILTER (WHERE agency_level = 'none')::int AS agency_none_count,
                MAX(COALESCE(updated_at, created_at)) AS latest_seen_at,
                COALESCE((SELECT jsonb_object_agg(key, value) FROM cognitive_counts), '{}'::jsonb) AS counts_by_cognitive_type,
                COALESCE((SELECT jsonb_object_agg(key, value) FROM promotion_counts), '{}'::jsonb) AS counts_by_promotion_status,
                COALESCE((SELECT jsonb_object_agg(key, value) FROM redaction_counts), '{}'::jsonb) AS counts_by_redaction_status,
                COALESCE((SELECT jsonb_object_agg(key, value) FROM source_counts), '{}'::jsonb) AS counts_by_source_system,
                COALESCE((SELECT jsonb_object_agg(key, value) FROM layer_counts), '{}'::jsonb) AS counts_by_memory_layer
             FROM filtered`,
            params
        );
        const row = rows[0] || {};
        return {
            total: row.total || 0,
            returned_count: 0,
            limit: 0,
            truncated: false,
            active_count: row.active_count || 0,
            core_count: row.core_count || 0,
            sns_ready_count: row.sns_ready_count || 0,
            review_count: row.review_count || 0,
            needs_redaction_count: row.needs_redaction_count || 0,
            agency_none_count: row.agency_none_count || 0,
            counts_by_cognitive_type: row.counts_by_cognitive_type || {},
            counts_by_promotion_status: row.counts_by_promotion_status || {},
            counts_by_redaction_status: row.counts_by_redaction_status || {},
            counts_by_source_system: row.counts_by_source_system || {},
            counts_by_memory_layer: row.counts_by_memory_layer || {},
            latest_seen_at: toIso(row.latest_seen_at) || null
        };
    }

    async transition(id, nextStatus, audit) {
        const result = await this.transitionWithAudit(id, nextStatus, audit);
        return result.candidate;
    }

    async transitionWithAudit(id, nextStatus, audit, options = {}) {
        const ownsTransaction = !options.client;
        const client = options.client || (typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool);
        try {
            if (ownsTransaction) await client.query('BEGIN');
            const { rows } = await client.query('SELECT * FROM memory_candidates WHERE id = $1 FOR UPDATE', [id]);
            const current = rows[0];
            if (!current) throw new Error(`candidate not found: ${id}`);
            const allowed = ALLOWED_TRANSITIONS[current.promotion_status];
            if (!allowed || !allowed.has(nextStatus)) {
                throw new InvalidTransitionError(current.promotion_status, nextStatus);
            }
            const prev = current.promotion_status;
            const updated = await client.query(
                `UPDATE memory_candidates
                 SET promotion_status = $2,
                     requires_approval = COALESCE($3::boolean, requires_approval),
                     promoted_graph_entity_id = COALESCE($4::text, promoted_graph_entity_id),
                     updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [id, nextStatus, options.requires_approval ?? null, options.promoted_graph_entity_id || null]
            );
            const auditEvent = await this._recordAuditWith(client, {
                candidate_id: id,
                actor_person_id: audit.actor_person_id,
                decision_owner_person_id: audit.decision_owner_person_id || null,
                decision_reason: audit.decision_reason || null,
                previous_status: prev,
                next_status: nextStatus,
                evidence_ids: audit.evidence_ids || null
            });
            if (ownsTransaction) await client.query('COMMIT');
            return {
                candidate: normalizeCandidate(updated.rows[0]),
                audit: auditEvent
            };
        } catch (error) {
            if (ownsTransaction) await client.query('ROLLBACK');
            throw error;
        } finally {
            if (ownsTransaction && typeof client.release === 'function') client.release();
        }
    }

    async searchPersonalKg({ owner_person_id, query, tokens = [], cognitive_types = [], limit = 10 }, { client } = {}) {
        const phrasePattern = `%${escapeLikePattern(query)}%`;
        const tokenPatterns = tokens.length > 1
            ? tokens.map((token) => `%${escapeLikePattern(token)}%`)
            : [];
        const values = [owner_person_id, phrasePattern];
        let sql = `SELECT id, cognitive_type, body, confidence, source_system, created_at
                   FROM memory_candidates
                   WHERE owner_person_id = $1
                     AND semantic_state = 'active'
                     AND visibility IN ('owner', 'private')
                     AND redaction_status = 'none'
                     AND promotion_status <> 'rejected'
                     AND body IS NOT NULL AND length(body) > 0
                     AND (body ILIKE $2 ESCAPE '\\'`;
        if (tokenPatterns.length > 0) {
            const tokenClauses = tokenPatterns.map((pattern) => {
                values.push(pattern);
                return `body ILIKE $${values.length} ESCAPE '\\'`;
            });
            sql += ` OR (${tokenClauses.join(' AND ')})`;
        }
        sql += ')';
        if (cognitive_types.length > 0) {
            values.push(cognitive_types);
            sql += ` AND cognitive_type = ANY($${values.length}::text[])`;
        }
        values.push(clampLimit(limit, 10, 50));
        sql += ` ORDER BY CASE WHEN body ILIKE $2 ESCAPE '\\' THEN 0 ELSE 1 END,
                         confidence DESC NULLS LAST,
                         created_at DESC
                 LIMIT $${values.length}`;
        const { rows } = await (client || this.pool).query(sql, values);
        return rows.map(normalizeCandidate);
    }

    async transaction(work, { access } = {}) {
        const { personId, organizationId } = requireCandidateAccess(access);
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        await client.query('BEGIN');
        try {
            await client.query('SELECT set_config($1, $2, true)', ['app.person_id', personId]);
            await client.query('SELECT set_config($1, $2, true)', ['app.organization_id', organizationId]);
            await client.query('SELECT set_config($1, $2, true)', ['app.project_codes', (access.projectCodes || []).join(',')]);
            await client.query('SELECT set_config($1, $2, true)', ['app.role', access.role || 'member']);
            await client.query('SELECT set_config($1, $2, true)', ['app.clearance', (access.clearance || ['internal']).join(',')]);
            const result = await work(scopedCandidateRepository(this, client));
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            if (typeof client.release === 'function') client.release();
        }
    }

    async setPromotedGraphEntity(id, graphEntityId) {
        const { rows } = await this.pool.query(
            'UPDATE memory_candidates SET promoted_graph_entity_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
            [id, graphEntityId]
        );
        if (!rows[0]) throw new Error(`candidate not found: ${id}`);
        return normalizeCandidate(rows[0]);
    }

    async setRedaction(id, status, newBody) {
        const { rows } = await this.pool.query(
            `UPDATE memory_candidates
             SET redaction_status = $2,
                 body = CASE WHEN $3::text IS NULL THEN body ELSE $3 END,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [id, status, typeof newBody === 'string' ? newBody : null]
        );
        if (!rows[0]) throw new Error(`candidate not found: ${id}`);
        return normalizeCandidate(rows[0]);
    }

    async recordAudit(record) {
        return this._recordAuditWith(this.pool, record);
    }

    async _recordAuditWith(client, record) {
        const { rows } = await client.query(
            `INSERT INTO promotion_audit_events (
                candidate_id, actor_person_id, decision_owner_person_id, decision_reason,
                previous_status, next_status, evidence_ids
            ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            RETURNING *`,
            [
                record.candidate_id,
                record.actor_person_id,
                record.decision_owner_person_id || null,
                record.decision_reason || null,
                record.previous_status,
                record.next_status,
                JSON.stringify(record.evidence_ids || null)
            ]
        );
        return normalizeAudit(rows[0]);
    }

    async listAudit(candidateId) {
        const { rows } = await this.pool.query(
            'SELECT * FROM promotion_audit_events WHERE candidate_id = $1 ORDER BY id ASC',
            [candidateId]
        );
        return rows.map(normalizeAudit);
    }

    async recordScanBlock(record) {
        const { rows } = await this.pool.query(
            `INSERT INTO candidate_scan_blocks (
                owner_person_id, organization_id, source_system, source_event_id, actor_person_id, findings
             ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             RETURNING *`,
            [
                record.owner_person_id,
                record.organization_id,
                record.source_system,
                record.source_event_id,
                record.actor_person_id,
                JSON.stringify(record.findings || [])
            ]
        );
        return normalizeScanBlock(rows[0]);
    }

    async listScanBlocks() {
        const { rows } = await this.pool.query('SELECT * FROM candidate_scan_blocks ORDER BY id ASC');
        return rows.map(normalizeScanBlock);
    }
}

export { ALLOWED_TRANSITIONS, COGNITIVE_TYPES, validate as validateCandidateInput };
