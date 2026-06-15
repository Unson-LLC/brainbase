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
const PERSONAL_KG_TYPES = ['observation', 'insight', 'claim', 'preference', 'hypothesis', 'experiment', 'result'];

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
    clauses.push(`visibility IN ('owner', 'private')`);
    add('cognitive_type = ANY(?::text[])', Array.isArray(filter.cognitive_types) && filter.cognitive_types.length ? filter.cognitive_types : PERSONAL_KG_TYPES);
    if (!filter.bypass_acl) {
        add('role_min = ANY(?::text[])', allowedRolesFor(filter.role));
        add('sensitivity = ANY(?::text[])', Array.isArray(filter.clearance) && filter.clearance.length ? filter.clearance : ['internal']);
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
        let rows = all.filter((r) => {
            if (filter.owner_person_id && r.owner_person_id !== filter.owner_person_id) return false;
            if (filter.promotion_status && r.promotion_status !== filter.promotion_status) return false;
            if (filter.cognitive_type && r.cognitive_type !== filter.cognitive_type) return false;
            return true;
        });
        if (filter.order_by === 'created_at') {
            const direction = filter.order_direction === 'desc' ? -1 : 1;
            rows = rows.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) * direction);
        }
        if (filter.limit) rows = rows.slice(0, clampLimit(filter.limit));
        return rows.map((r) => ({ ...r }));
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

    async create(input) {
        validate(input);
        try {
            const key = duplicateKey(input);
            const duplicate = await this.pool.query(
                `SELECT id
                 FROM memory_candidates
                 WHERE source_system = $1
                   AND owner_person_id = $2
                   AND source_event_ids::text = $3
                 LIMIT 1`,
                [input.source_system, input.owner_person_id, JSON.stringify(input.source_event_ids.slice().sort())]
            );
            if (duplicate.rows.length > 0) {
                throw new DuplicateCandidateError(key);
            }
            const { rows } = await this.pool.query(
                `INSERT INTO memory_candidates (
                    id, cognitive_type, owner_person_id, actor_person_id, source_system, source_event_ids,
                    workspace, channel_id, thread_ts, project_code, org_ids, project_ids, team_id,
                    visibility, sensitivity, role_min, agency_level, recommended_subject_type,
                    recommended_owner_person_id, promotion_status, promoted_graph_entity_id,
                    requires_approval, permission_snapshot, evidence_ids, body, redaction_status,
                    confidence, expires_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6::jsonb,
                    $7, $8, $9, $10, $11, $12, $13,
                    $14, $15, $16, $17, $18,
                    $19, $20, $21,
                    $22, $23::jsonb, $24::jsonb, $25, $26,
                    $27, $28
                )
                RETURNING *`,
                [
                    input.id || nextId(),
                    input.cognitive_type,
                    input.owner_person_id,
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
                    input.expires_at || null
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

    async findById(id) {
        const { rows } = await this.pool.query('SELECT * FROM memory_candidates WHERE id = $1', [id]);
        return normalizeCandidate(rows[0]);
    }

    async list(filter = {}) {
        const clauses = [];
        const params = [];
        const add = (sql, value) => {
            params.push(value);
            clauses.push(sql.replace('?', `$${params.length}`));
        };
        if (filter.owner_person_id) add('owner_person_id = ?', filter.owner_person_id);
        if (filter.promotion_status) add('promotion_status = ?', filter.promotion_status);
        if (filter.cognitive_type) add('cognitive_type = ?', filter.cognitive_type);
        const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
        const orderDirection = filter.order_direction === 'desc' ? 'DESC' : 'ASC';
        const orderBy = filter.order_by === 'created_at' ? `created_at ${orderDirection}, id ${orderDirection}` : 'created_at ASC, id ASC';
        let sql = `SELECT * FROM memory_candidates${where} ORDER BY ${orderBy}`;
        if (filter.limit) {
            params.push(clampLimit(filter.limit));
            sql += ` LIMIT $${params.length}`;
        }
        const { rows } = await this.pool.query(sql, params);
        return rows.map(normalizeCandidate);
    }

    async listPersonalKg(filter = {}) {
        const { where, params } = buildPersonalKgWhere(filter);
        params.push(clampLimit(filter.limit, 50, 500));
        const layerSql = personalKgMemoryLayerSql();
        const snsReadySql = personalKgSnsReadySql();
        const { rows } = await this.pool.query(
            `SELECT *, ${layerSql} AS memory_layer, ${snsReadySql} AS sns_ready
             FROM memory_candidates
             ${where}
             ORDER BY created_at DESC, id DESC
             LIMIT $${params.length}`,
            params
        );
        return rows.map(normalizeCandidate);
    }

    async summarizePersonalKg(filter = {}) {
        const { where, params } = buildPersonalKgWhere(filter);
        const layerSql = personalKgMemoryLayerSql();
        const snsReadySql = personalKgSnsReadySql();
        const { rows } = await this.pool.query(
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
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        await client.query('BEGIN');
        try {
            const { rows } = await client.query('SELECT * FROM memory_candidates WHERE id = $1 FOR UPDATE', [id]);
            const current = rows[0];
            if (!current) throw new Error(`candidate not found: ${id}`);
            const allowed = ALLOWED_TRANSITIONS[current.promotion_status];
            if (!allowed || !allowed.has(nextStatus)) {
                throw new InvalidTransitionError(current.promotion_status, nextStatus);
            }
            const prev = current.promotion_status;
            const updated = await client.query(
                'UPDATE memory_candidates SET promotion_status = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
                [id, nextStatus]
            );
            await this._recordAuditWith(client, {
                candidate_id: id,
                actor_person_id: audit.actor_person_id,
                decision_owner_person_id: audit.decision_owner_person_id || null,
                decision_reason: audit.decision_reason || null,
                previous_status: prev,
                next_status: nextStatus,
                evidence_ids: audit.evidence_ids || null
            });
            await client.query('COMMIT');
            return normalizeCandidate(updated.rows[0]);
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
            `INSERT INTO candidate_scan_blocks (source_system, source_event_id, actor_person_id, findings)
             VALUES ($1, $2, $3, $4::jsonb)
             RETURNING *`,
            [record.source_system, record.source_event_id, record.actor_person_id, JSON.stringify(record.findings || [])]
        );
        return normalizeScanBlock(rows[0]);
    }

    async listScanBlocks() {
        const { rows } = await this.pool.query('SELECT * FROM candidate_scan_blocks ORDER BY id ASC');
        return rows.map(normalizeScanBlock);
    }
}

export { ALLOWED_TRANSITIONS, COGNITIVE_TYPES, validate as validateCandidateInput };
