// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { OWNED_OBJECT_TYPES } from '../multitenant/tenant-boundary.js';
import { assertSnsRecordAuthority, isSnsRecordInAuthority, requireSnsAuthority } from './sns-authority.js';
/**
 * SNS Posting Ledger repository.
 *
 * ADR-011: this is operational state, not Graph SSOT.
 * The in-memory implementation backs local/tests; the contract is kept narrow
 * so a Pg repository can replace it without changing routes or UI.
 */

const STATUSES = new Set([
    'review_needed',
    'approved',
    'scheduled',
    'publishing',
    'posted',
    'publish_failed',
    'skipped',
    'learning_ready',
    'deleted'
]);

const ALLOWED_TRANSITIONS = {
    review_needed: new Set(['approved', 'scheduled', 'skipped']),
    approved: new Set(['review_needed', 'scheduled', 'skipped']),
    scheduled: new Set(['review_needed', 'approved', 'publishing', 'posted', 'skipped']),
    publishing: new Set(['posted', 'publish_failed']),
    posted: new Set(['learning_ready', 'deleted']),
    publish_failed: new Set(['review_needed', 'scheduled', 'skipped']),
    skipped: new Set(['review_needed']),
    learning_ready: new Set(['posted', 'deleted']),
    deleted: new Set([])
};

const DEFAULT_TIMES_BY_SLOT = ['09:00', '12:00', '15:00', '18:00', '21:00'];
const BODY_RESERVING_STATUSES = new Set([
    'review_needed',
    'approved',
    'scheduled',
    'publishing',
    'posted',
    'learning_ready'
]);
const IMPORT_IMMUTABLE_STATUSES = new Set(['posted', 'learning_ready', 'deleted']);
const TENANT_ID = /^ten_[0-9A-HJKMNP-TV-Z]{26}$/u;
const REVISION = /^(0|[1-9][0-9]*)$/u;

export class InvalidSnsPostTransitionError extends Error {
    constructor(from, to) {
        super(`Invalid SNS post status transition: ${from} -> ${to}`);
        this.name = 'InvalidSnsPostTransitionError';
        this.from = from;
        this.to = to;
    }
}

export class SnsPostValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SnsPostValidationError';
    }
}

export class SnsPostingLedgerUnavailableError extends Error {
    constructor() {
        super('SNS Posting Ledger PostgreSQL URL is required outside explicit JSON test mode');
        this.name = 'SnsPostingLedgerUnavailableError';
        this.status = 503;
        this.code = 'sns_posting_ledger_database_required';
    }
}

export function isSnsPostingLedgerJsonTestMode(env = process.env) {
    return env.BRAINBASE_TEST_MODE === 'true'
        && env.SNS_POSTING_LEDGER_MODE === 'json_test';
}

export class SnsPostingLedgerUnavailableRepository {
    unavailable() {
        throw new SnsPostingLedgerUnavailableError();
    }

    async upsertReviewPack() { return this.unavailable(); }
    async listPosts() { return this.unavailable(); }
    async findById() { return this.unavailable(); }
    async updatePost() { return this.unavailable(); }
    async claimScheduledPost() { return this.unavailable(); }
}

function nowIso() {
    return new Date().toISOString();
}

function toIso(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

function dateOnly(value) {
    if (value instanceof Date) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    const raw = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(raw)) {
        throw new SnsPostValidationError('date must be YYYY-MM-DD');
    }
    return raw;
}

function titleFromBody(body) {
    const firstLine = String(body || '').split('\n').find((line) => line.trim()) || 'SNS draft';
    const trimmed = firstLine.trim();
    if (trimmed.length <= 28) return trimmed;
    return `${trimmed.slice(0, 27).trim()}…`;
}

function timeFromDraft(draft) {
    if (draft.time) return String(draft.time);
    const slot = Number(draft.slot_index || draft.slot || 1);
    return DEFAULT_TIMES_BY_SLOT[Math.max(0, slot - 1)] || '09:00';
}

function scheduledAtFromDraft(draft, date, time) {
    if (draft.scheduled_at) return draft.scheduled_at;
    const match = String(time || '').match(/^(\d{2}):(\d{2})$/u);
    if (!match) throw new SnsPostValidationError('time must be HH:mm');
    const [, hour, minute] = match;
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, Number(hour) - 9, Number(minute), 0, 0)).toISOString();
}

function sourceTypeFromDraft(draft) {
    if (draft.signal?.kind === 'peer_post') return 'Peer Circle';
    if (draft.signal?.kind === 'news') return 'News';
    if (draft.source_type) return draft.source_type;
    if (draft.source_url && draft.lane === 'peer_circle') return 'Peer Circle';
    if (draft.source_url) return 'News';
    return 'Personal KG';
}

function sourceFromDraft(draft) {
    return {
        type: sourceTypeFromDraft(draft),
        url: draft.signal?.url || draft.source_url || null,
        title: draft.signal?.title || draft.signal?.text || draft.lane_intent || null,
        author_handle: draft.signal?.author_handle || null,
        source_candidate_id: draft.source_candidate_id || null,
        kg_source_entity_id: draft.kg_source_entity_id || null,
        derived_from: Array.isArray(draft.derived_from) ? draft.derived_from : [],
        evidence_ids: Array.isArray(draft.evidence_ids) ? draft.evidence_ids : []
    };
}

export function normalizeSnsTenantBoundary(boundary, { required = false } = {}) {
    if (boundary === undefined) {
        if (required) {
            throw new SnsPostValidationError('tenant_boundary is required for public SNS publishing');
        }
        return null;
    }
    const tenantContext = boundary?.tenant_context;
    const tenant = tenantContext?.tenant;
    const resourceRef = boundary?.resource_ref;
    const tenantRevision = tenant?.tenant_revision;
    const valid = boundary && typeof boundary === 'object' && !Array.isArray(boundary)
        && Object.keys(boundary).length === 2
        && Object.keys(boundary).every((key) => ['tenant_context', 'resource_ref'].includes(key))
        && tenantContext && typeof tenantContext === 'object' && !Array.isArray(tenantContext)
        && Object.keys(tenantContext).length === 1 && Object.keys(tenantContext)[0] === 'tenant'
        && tenant && typeof tenant === 'object' && !Array.isArray(tenant)
        && Object.keys(tenant).length === 2
        && Object.keys(tenant).every((key) => ['tenant_id', 'tenant_revision'].includes(key))
        && typeof tenant.tenant_id === 'string' && TENANT_ID.test(tenant.tenant_id)
        && typeof tenantRevision === 'string' && REVISION.test(tenantRevision) && BigInt(tenantRevision) >= 1n
        && resourceRef && typeof resourceRef === 'object' && !Array.isArray(resourceRef)
        && Object.keys(resourceRef).length === 2
        && Object.keys(resourceRef).every((key) => ['object_type', 'resource_id'].includes(key))
        && OWNED_OBJECT_TYPES.includes(resourceRef.object_type)
        && typeof resourceRef.resource_id === 'string' && resourceRef.resource_id.length > 0;
    if (!valid) throw new SnsPostValidationError('tenant_boundary must be a canonical tenant and resource binding');
    return structuredClone(boundary);
}

function tenantBoundaryFromDraft(draft) {
    return normalizeSnsTenantBoundary(draft.tenant_boundary);
}

function evidenceFromDraft(draft) {
    const tenantBoundary = tenantBoundaryFromDraft(draft);
    return {
        persona_brain: draft.persona_brain || {},
        algorithm_fit: draft.algorithm_fit || null,
        lifelog_check: draft.lifelog_check || draft.safety?.lifelog_integrity || null,
        generation_context_evidence: draft.generation_context_evidence || null,
        graph_check: draft.graph_check || {
            status: 'ok',
            source_entity_id: draft.kg_source_entity_id || null,
            derived_from: Array.isArray(draft.derived_from) ? draft.derived_from : []
        },
        quality_gate: draft.quality_gate || {
            status: (draft.safety?.lifelog_integrity?.decision || draft.safety?.persona_affect?.decision) === 'blocked'
                ? 'blocked'
                : 'pass',
            lifelog_integrity: draft.safety?.lifelog_integrity || null,
            persona_affect: draft.safety?.persona_affect || null,
            requires_human_review: draft.safety?.requires_human_review !== false
        },
        reader_affect: draft.safety?.persona_affect?.likely_reader_feeling || draft.reader_affect || '',
        ...(tenantBoundary ? { tenant_boundary: tenantBoundary } : {})
    };
}

function idempotencyKey(record) {
    return `${record.organization_id || 'legacy'}|${record.owner_person_id || 'legacy'}|${record.account_id || 'default'}|${record.date}|${record.slot_index}`;
}

function normalizeBodyFingerprint(body) {
    return String(body || '')
        .normalize('NFKC')
        .replace(/https?:\/\/\S+/gu, '')
        .replace(/[ \t\r\n、。,.!?！？'"“”‘’「」『』（）()[\]{}:：;；・-]+/gu, '')
        .toLowerCase()
        .trim();
}

function bodyKey(record) {
    const fingerprint = normalizeBodyFingerprint(record.body);
    if (!fingerprint) return null;
    return `${record.organization_id || 'legacy'}|${record.owner_person_id || 'legacy'}|${record.account_id || 'default'}|${fingerprint}`;
}

function optionalAuthority(input) {
    if (!input || typeof input !== 'object') return null;
    const hasOrganization = input.organization_id || input.organizationId || input.tenant_id || input.tenantId;
    if (!hasOrganization) return null;
    return requireSnsAuthority(input);
}

function requiredAuthority(input, fallback = null) {
    return requireSnsAuthority(input || fallback || {});
}

async function setAuthorityContext(client, authority) {
    await client.query(
        `SELECT
            set_config('app.person_id', $1, true),
            set_config('app.actor_person_id', $2, true),
            set_config('app.organization_id', $3, true)`,
        [authority.owner_person_id, authority.actor_person_id, authority.organization_id]
    );
}

function reservesBody(record) {
    return BODY_RESERVING_STATUSES.has(record?.status);
}

function skippedImport(next, reason, existing = null) {
    return {
        id: next.id,
        date: next.date,
        slot_index: next.slot_index,
        account_id: next.account_id,
        body: next.body,
        reason,
        existing_post_id: existing?.id || null,
        existing_status: existing?.status || null,
        existing_posted_url: existing?.posted_url || null
    };
}

function normalizeRecord(record) {
    return {
        ...record,
        date: dateOnly(record.date),
        scheduled_at: toIso(record.scheduled_at),
        posted_at: toIso(record.posted_at),
        deleted_at: toIso(record.deleted_at),
        created_at: toIso(record.created_at),
        updated_at: toIso(record.updated_at),
        revisions: Array.isArray(record.revisions) ? record.revisions : [],
        metrics_snapshots: Array.isArray(record.metrics_snapshots) ? record.metrics_snapshots : [],
        source: record.source || {},
        evidence: record.evidence || {}
    };
}

function draftToRecord(draft, defaults = {}, authority = null) {
    if (!draft || typeof draft !== 'object') throw new SnsPostValidationError('draft required');
    const date = dateOnly(draft.date || defaults.date);
    const slotIndex = Number(draft.slot_index || draft.slot || 1);
    if (!Number.isInteger(slotIndex) || slotIndex < 1) throw new SnsPostValidationError('slot_index must be positive integer');
    const body = String(draft.body || '').trim();
    if (!body && draft.format !== 'peer_research_prompt') throw new SnsPostValidationError('body required');
    const accountId = defaults.account_id || draft.account_id || 'acc_x_sato';
    const time = timeFromDraft(draft);
    const now = nowIso();
    const identityPrefix = authority
        ? `${authority.organization_id}_${authority.owner_person_id}_`.replace(/[^a-z0-9_]/giu, '_')
        : '';
    return {
        id: draft.ledger_id || `sns_${identityPrefix}${date.replaceAll('-', '')}_${slotIndex}_${String(draft.lane || 'draft').replace(/[^a-z0-9_]/giu, '_')}`,
        account_id: accountId,
        account_handle: defaults.account_handle || draft.account_handle || '@AIBizNavigator',
        owner_person_id: authority?.owner_person_id || draft.owner_person_id || null,
        actor_person_id: authority?.actor_person_id || draft.actor_person_id || null,
        organization_id: authority?.organization_id || draft.organization_id || null,
        platform: draft.platform || 'x',
        date,
        slot_index: slotIndex,
        time,
        title: draft.title || titleFromBody(body || draft.lane_intent),
        status: draft.status === 'draft_review' ? 'review_needed' : (draft.status || 'review_needed'),
        lane: draft.lane || null,
        format: draft.format || 'standalone',
        body,
        scheduled_at: scheduledAtFromDraft(draft, date, time),
        posted_at: draft.posted_at || null,
        posted_url: draft.posted_url || null,
        deleted_at: draft.deleted_at || null,
        deletion_source: draft.deletion_source || null,
        deletion_reason: draft.deletion_reason || null,
        source: sourceFromDraft(draft),
        evidence: evidenceFromDraft(draft),
        memo: draft.memo || '',
        learning_candidate_id: draft.learning_candidate_id || null,
        revisions: [],
        metrics_snapshots: [],
        created_at: now,
        updated_at: now
    };
}

function assertValidStatus(status) {
    if (!STATUSES.has(status)) {
        throw new SnsPostValidationError(`invalid SNS post status: ${status}`);
    }
}

function assertTransition(from, to) {
    assertValidStatus(to);
    if (from === to) return;
    const allowed = ALLOWED_TRANSITIONS[from];
    if (!allowed?.has(to)) {
        throw new InvalidSnsPostTransitionError(from, to);
    }
}

export class InMemorySnsPostingLedgerRepository {
    constructor({ initialPosts = [], authority = null } = {}) {
        this.authority = optionalAuthority(authority);
        /** @type {Map<string, any>} */
        this.posts = new Map();
        /** @type {Map<string, string>} */
        this.keys = new Map();
        for (const post of initialPosts) {
            const normalized = normalizeRecord({ ...post });
            this.posts.set(normalized.id, normalized);
            this.keys.set(idempotencyKey(normalized), normalized.id);
        }
    }

    upsertReviewPack({ account_id, account_handle, drafts = [] }, authorityInput = null) {
        const authority = requiredAuthority(authorityInput, this.authority);
        if (!Array.isArray(drafts)) throw new SnsPostValidationError('drafts must be array');
        const created = [];
        const updated = [];
        const skipped = [];
        for (const draft of drafts) {
            const next = draftToRecord(draft, { account_id, account_handle }, authority);
            assertValidStatus(next.status);
            const key = idempotencyKey(next);
            const existingId = this.keys.get(key);
            const existing = existingId ? this.posts.get(existingId) : null;
            if (existing && IMPORT_IMMUTABLE_STATUSES.has(existing.status)) {
                skipped.push(skippedImport(next, 'immutable_status', existing));
                continue;
            }
            const duplicate = this._findDuplicateBody(next, existingId);
            if (duplicate) {
                skipped.push(skippedImport(next, 'duplicate_body', duplicate));
                continue;
            }
            if (!existingId) {
                this.posts.set(next.id, next);
                this.keys.set(key, next.id);
                created.push(normalizeRecord(next));
                continue;
            }
            const merged = {
                ...existing,
                title: next.title,
                body: next.body,
                time: next.time,
                lane: next.lane,
                format: next.format,
                scheduled_at: next.scheduled_at,
                account_handle: next.account_handle,
                source: next.source,
                evidence: next.evidence,
                updated_at: nowIso()
            };
            this.posts.set(existingId, merged);
            updated.push(normalizeRecord(merged));
        }
        return { created, updated, skipped };
    }

    listPosts({ startDate = null, endDate = null, status = null } = {}, authorityInput = null) {
        const authority = requiredAuthority(authorityInput, this.authority);
        return Array.from(this.posts.values())
            .filter((post) => isSnsRecordInAuthority(post, authority))
            .filter((post) => !startDate || post.date >= startDate)
            .filter((post) => !endDate || post.date <= endDate)
            .filter((post) => !status || post.status === status)
            .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
            .map(normalizeRecord);
    }

    findById(id, authorityInput = null) {
        const authority = requiredAuthority(authorityInput, this.authority);
        const record = this.posts.get(id);
        if (record && !isSnsRecordInAuthority(record, authority)) return null;
        return record ? normalizeRecord(record) : null;
    }

    updatePost(id, patch = {}, actor = {}) {
        const authority = requiredAuthority(actor, this.authority);
        const existing = this.posts.get(id);
        if (!existing) return null;
        assertSnsRecordAuthority(existing, authority);
        const nextStatus = patch.status || existing.status;
        assertTransition(existing.status, nextStatus);
        const now = nowIso();
        const revisions = [...existing.revisions];
        if (typeof patch.body === 'string' && patch.body !== existing.body) {
            revisions.push({
                id: `rev_${revisions.length + 1}`,
                actor_person_id: actor.actor_person_id || actor.sub || 'system',
                previous_body: existing.body,
                next_body: patch.body,
                changed_at: now
            });
        }
        const metricsSnapshots = [...existing.metrics_snapshots];
        if (patch.metrics_snapshot) {
            metricsSnapshots.push({
                ...patch.metrics_snapshot,
                captured_at: patch.metrics_snapshot.captured_at || now
            });
        }
        const updated = {
            ...existing,
            body: typeof patch.body === 'string' ? patch.body : existing.body,
            title: typeof patch.title === 'string' ? patch.title : (typeof patch.body === 'string' ? titleFromBody(patch.body) : existing.title),
            status: nextStatus,
            scheduled_at: Object.prototype.hasOwnProperty.call(patch, 'scheduled_at') ? toIso(patch.scheduled_at) : existing.scheduled_at,
            posted_url: Object.prototype.hasOwnProperty.call(patch, 'posted_url') ? patch.posted_url : existing.posted_url,
            posted_at: Object.prototype.hasOwnProperty.call(patch, 'posted_at') ? toIso(patch.posted_at) : existing.posted_at,
            deleted_at: Object.prototype.hasOwnProperty.call(patch, 'deleted_at') ? toIso(patch.deleted_at) : existing.deleted_at,
            deletion_source: Object.prototype.hasOwnProperty.call(patch, 'deletion_source') ? patch.deletion_source : existing.deletion_source,
            deletion_reason: Object.prototype.hasOwnProperty.call(patch, 'deletion_reason') ? patch.deletion_reason : existing.deletion_reason,
            memo: typeof patch.memo === 'string' ? patch.memo : existing.memo,
            learning_candidate_id: patch.learning_candidate_id || existing.learning_candidate_id,
            revisions,
            metrics_snapshots: metricsSnapshots,
            updated_at: now
        };
        this.posts.set(id, updated);
        return normalizeRecord(updated);
    }

    claimScheduledPost(id, { now = new Date() } = {}, actor = {}) {
        const authority = requiredAuthority(actor, this.authority);
        const existing = this.posts.get(id);
        if (!existing || existing.status !== 'scheduled') return null;
        assertSnsRecordAuthority(existing, authority);
        const scheduledAt = existing.scheduled_at ? new Date(existing.scheduled_at) : null;
        if (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt > now) return null;
        return this.updatePost(id, { status: 'publishing' }, authority);
    }

    _findDuplicateBody(next, allowedExistingId = null) {
        const nextBodyKey = bodyKey(next);
        if (!nextBodyKey) return null;
        for (const post of this.posts.values()) {
            if (post.id === allowedExistingId) continue;
            if (!reservesBody(post)) continue;
            if (bodyKey(post) === nextBodyKey) return normalizeRecord(post);
        }
        return null;
    }
}

export class JsonFileSnsPostingLedgerRepository extends InMemorySnsPostingLedgerRepository {
    constructor({ filePath }) {
        if (!filePath) throw new Error('JsonFileSnsPostingLedgerRepository requires filePath');
        const initialPosts = readLedgerFile(filePath);
        super({ initialPosts });
        this.filePath = filePath;
    }

    upsertReviewPack(input, authority = null) {
        const result = super.upsertReviewPack(input, authority);
        this._persist();
        return result;
    }

    updatePost(id, patch = {}, actor = {}) {
        const result = super.updatePost(id, patch, actor);
        if (result) this._persist();
        return result;
    }

    claimScheduledPost(id, options = {}, actor = {}) {
        const result = super.claimScheduledPost(id, options, actor);
        if (result) this._persist();
        return result;
    }

    _persist() {
        const dir = path.dirname(this.filePath);
        fs.mkdirSync(dir, { recursive: true });
        const posts = Array.from(this.posts.values()).map(normalizeRecord);
        const payload = {
            schema_version: '0.1.0',
            updated_at: nowIso(),
            posts
        };
        fs.writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`);
    }
}

export class PgSnsPostingLedgerRepository {
    constructor({ pool }) {
        if (!pool || typeof pool.query !== 'function') {
            throw new Error('PgSnsPostingLedgerRepository requires a pg pool/client with query(sql, params)');
        }
        this.pool = pool;
    }

    async upsertReviewPack({ account_id, account_handle, drafts = [] }, authorityInput = null) {
        const authority = requiredAuthority(authorityInput);
        if (!Array.isArray(drafts)) throw new SnsPostValidationError('drafts must be array');
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        await client.query('BEGIN');
        const created = [];
        const updated = [];
        const skipped = [];
        try {
            await setAuthorityContext(client, authority);
            for (const draft of drafts) {
                const next = draftToRecord(draft, { account_id, account_handle }, authority);
                assertValidStatus(next.status);
                const existing = await client.query(
                    `SELECT * FROM sns_posting_ledger_posts
                     WHERE account_id = $1 AND date = $2 AND slot_index = $3
                       AND ($4::text IS NULL OR (owner_person_id = $4 AND organization_id = $5))
                     FOR UPDATE`,
                    [next.account_id, next.date, next.slot_index, authority.owner_person_id, authority.organization_id]
                );
                const existingRow = existing.rows[0] ? normalizeRecord(existing.rows[0]) : null;
                if (existingRow && IMPORT_IMMUTABLE_STATUSES.has(existingRow.status)) {
                    skipped.push(skippedImport(next, 'immutable_status', existingRow));
                    continue;
                }
                const duplicate = await this._findDuplicateBody(client, next, existingRow?.id || null);
                if (duplicate) {
                    skipped.push(skippedImport(next, 'duplicate_body', duplicate));
                    continue;
                }
                if (!existingRow) {
                    const inserted = await client.query(
                        `INSERT INTO sns_posting_ledger_posts (
                            id, account_id, account_handle, owner_person_id, actor_person_id, organization_id,
                            platform, date, slot_index, time,
                            title, status, lane, format, body, scheduled_at, posted_at, posted_url,
                            deleted_at, deletion_source, deletion_reason,
                            source, evidence, memo, learning_candidate_id, revisions, metrics_snapshots,
                            created_at, updated_at
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6,
                            $7, $8, $9, $10,
                            $11, $12, $13, $14, $15, $16, $17, $18,
                            $19, $20, $21,
                            $22::jsonb, $23::jsonb, $24, $25, $26::jsonb, $27::jsonb,
                            $28, $29
                        )
                        RETURNING *`,
                        postParams(next)
                    );
                    created.push(normalizeRecord(inserted.rows[0]));
                    continue;
                }
                const updatedRow = await client.query(
                    `UPDATE sns_posting_ledger_posts
                     SET title = $2,
                         body = $3,
                         lane = $4,
                         format = $5,
                         account_handle = $6,
                         source = $7::jsonb,
                         evidence = $8::jsonb,
                         time = $9,
                         scheduled_at = $10,
                         updated_at = NOW()
                     WHERE id = $1
                     RETURNING *`,
                    [
                        existingRow.id,
                        next.title,
                        next.body,
                        next.lane,
                        next.format,
                        next.account_handle,
                        JSON.stringify(next.source),
                        JSON.stringify(next.evidence),
                        next.time,
                        next.scheduled_at
                    ]
                );
                updated.push(normalizeRecord(updatedRow.rows[0]));
            }
            await client.query('COMMIT');
            return { created, updated, skipped };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            if (typeof client.release === 'function') client.release();
        }
    }

    async listPosts({ startDate = null, endDate = null, status = null } = {}, authorityInput = null) {
        const authority = requiredAuthority(authorityInput);
        const clauses = [];
        const params = [];
        const add = (sql, value) => {
            params.push(value);
            clauses.push(sql.replace('?', `$${params.length}`));
        };
        if (startDate) add('date >= ?', startDate);
        if (endDate) add('date <= ?', endDate);
        if (status) add('status = ?', status);
        add('owner_person_id = ?', authority.owner_person_id);
        add('organization_id = ?', authority.organization_id);
        const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        await client.query('BEGIN');
        try {
            await setAuthorityContext(client, authority);
            const { rows } = await client.query(
                `SELECT * FROM sns_posting_ledger_posts${where} ORDER BY date ASC, time ASC, slot_index ASC`,
                params
            );
            await client.query('COMMIT');
            return rows.map(normalizeRecord);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            if (typeof client.release === 'function') client.release();
        }
    }

    async findById(id, authorityInput = null) {
        const authority = requiredAuthority(authorityInput);
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        await client.query('BEGIN');
        try {
            await setAuthorityContext(client, authority);
            const { rows } = await client.query(
                'SELECT * FROM sns_posting_ledger_posts WHERE id = $1 AND owner_person_id = $2 AND organization_id = $3',
                [id, authority.owner_person_id, authority.organization_id]
            );
            await client.query('COMMIT');
            return rows[0] ? normalizeRecord(rows[0]) : null;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            if (typeof client.release === 'function') client.release();
        }
    }

    async updatePost(id, patch = {}, actor = {}) {
        const authority = requiredAuthority(actor);
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        await client.query('BEGIN');
        try {
            await setAuthorityContext(client, authority);
            const { rows } = await client.query(
                'SELECT * FROM sns_posting_ledger_posts WHERE id = $1 AND owner_person_id = $2 AND organization_id = $3 FOR UPDATE',
                [id, authority.owner_person_id, authority.organization_id]
            );
            const existing = rows[0] ? normalizeRecord(rows[0]) : null;
            if (!existing) {
                await client.query('ROLLBACK');
                return null;
            }
            const nextStatus = patch.status || existing.status;
            assertTransition(existing.status, nextStatus);
            const now = nowIso();
            const revisions = [...existing.revisions];
            const nextBody = typeof patch.body === 'string' ? patch.body : existing.body;
            if (typeof patch.body === 'string' && patch.body !== existing.body) {
                revisions.push({
                    id: `rev_${revisions.length + 1}`,
                    actor_person_id: actor.actor_person_id || actor.sub || 'system',
                    previous_body: existing.body,
                    next_body: patch.body,
                    changed_at: now
                });
            }
            const metricsSnapshots = [...existing.metrics_snapshots];
            if (patch.metrics_snapshot) {
                metricsSnapshots.push({
                    ...patch.metrics_snapshot,
                    captured_at: patch.metrics_snapshot.captured_at || now
                });
            }
            const updated = await client.query(
                `UPDATE sns_posting_ledger_posts
                 SET body = $2,
                     title = $3,
                     status = $4,
                     scheduled_at = $5,
                     posted_url = $6,
                     posted_at = $7,
                     deleted_at = $8,
                     deletion_source = $9,
                     deletion_reason = $10,
                     memo = $11,
                     learning_candidate_id = $12,
                     revisions = $13::jsonb,
                     metrics_snapshots = $14::jsonb,
                     updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [
                    id,
                    nextBody,
                    typeof patch.title === 'string' ? patch.title : (typeof patch.body === 'string' ? titleFromBody(patch.body) : existing.title),
                    nextStatus,
                    Object.prototype.hasOwnProperty.call(patch, 'scheduled_at') ? toIso(patch.scheduled_at) : existing.scheduled_at,
                    Object.prototype.hasOwnProperty.call(patch, 'posted_url') ? patch.posted_url : existing.posted_url,
                    Object.prototype.hasOwnProperty.call(patch, 'posted_at') ? toIso(patch.posted_at) : existing.posted_at,
                    Object.prototype.hasOwnProperty.call(patch, 'deleted_at') ? toIso(patch.deleted_at) : existing.deleted_at,
                    Object.prototype.hasOwnProperty.call(patch, 'deletion_source') ? patch.deletion_source : existing.deletion_source,
                    Object.prototype.hasOwnProperty.call(patch, 'deletion_reason') ? patch.deletion_reason : existing.deletion_reason,
                    typeof patch.memo === 'string' ? patch.memo : existing.memo,
                    patch.learning_candidate_id || existing.learning_candidate_id,
                    JSON.stringify(revisions),
                    JSON.stringify(metricsSnapshots)
                ]
            );
            await client.query('COMMIT');
            return normalizeRecord(updated.rows[0]);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            if (typeof client.release === 'function') client.release();
        }
    }

    async claimScheduledPost(id, { now = new Date() } = {}, actor = {}) {
        const authority = requiredAuthority(actor);
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        await client.query('BEGIN');
        try {
            await setAuthorityContext(client, authority);
            const { rows } = await client.query(
                `SELECT * FROM sns_posting_ledger_posts
                 WHERE id = $1
                   AND status = 'scheduled'
                   AND scheduled_at <= $2
                   AND ($3::text IS NULL OR (owner_person_id = $3 AND organization_id = $4))
                 FOR UPDATE`,
                [id, now instanceof Date ? now.toISOString() : String(now), authority.owner_person_id, authority.organization_id]
            );
            if (!rows[0]) {
                await client.query('ROLLBACK');
                return null;
            }
            const existing = normalizeRecord(rows[0]);
            assertTransition(existing.status, 'publishing');
            const claimedResult = await client.query(
                `UPDATE sns_posting_ledger_posts
                 SET status = 'publishing',
                     updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [id]
            );
            await client.query('COMMIT');
            return normalizeRecord(claimedResult.rows[0]);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            if (typeof client.release === 'function') client.release();
        }
    }

    async _findDuplicateBody(client, next, allowedExistingId = null) {
        const nextBodyKey = bodyKey(next);
        if (!nextBodyKey) return null;
        const { rows } = await client.query(
            `SELECT * FROM sns_posting_ledger_posts
             WHERE account_id = $1
               AND status = ANY($2::text[])
             FOR UPDATE`,
            [next.account_id, Array.from(BODY_RESERVING_STATUSES)]
        );
        for (const row of rows) {
            const post = normalizeRecord(row);
            if (post.id === allowedExistingId) continue;
            if (bodyKey(post) === nextBodyKey) return post;
        }
        return null;
    }
}

function postParams(post) {
    return [
        post.id,
        post.account_id,
        post.account_handle,
        post.owner_person_id,
        post.actor_person_id,
        post.organization_id,
        post.platform,
        post.date,
        post.slot_index,
        post.time,
        post.title,
        post.status,
        post.lane,
        post.format,
        post.body,
        post.scheduled_at,
        post.posted_at,
        post.posted_url,
        post.deleted_at,
        post.deletion_source,
        post.deletion_reason,
        JSON.stringify(post.source),
        JSON.stringify(post.evidence),
        post.memo,
        post.learning_candidate_id,
        JSON.stringify(post.revisions),
        JSON.stringify(post.metrics_snapshots),
        post.created_at,
        post.updated_at
    ];
}

function readLedgerFile(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.posts)) return parsed.posts;
    return [];
}

export function summarizeSnsPosts(posts) {
    const byStatus = {};
    for (const status of STATUSES) byStatus[status] = 0;
    for (const post of posts) {
        byStatus[post.status] = (byStatus[post.status] || 0) + 1;
    }
    return {
        total: posts.length,
        by_status: byStatus,
        review_needed: byStatus.review_needed,
        scheduled: byStatus.scheduled,
        publishing: byStatus.publishing,
        posted: byStatus.posted,
        publish_failed: byStatus.publish_failed,
        learning_ready: byStatus.learning_ready,
        deleted: byStatus.deleted
    };
}

export { STATUSES as SNS_POST_STATUSES };
