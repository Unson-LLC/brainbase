import crypto from 'crypto';

import { decodeCanonicalTaskCursor } from './canonical-task-nocodb-repository.js';

const STATUSES = new Set(['pending', 'in_progress', 'waiting', 'completed']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const MUTABLE_COLUMNS = Object.freeze({
    title: 'title',
    description: 'description',
    status: 'status',
    priority: 'priority',
    assignee_person_id: 'assignee_person_id',
    assignee_display_name: 'assignee_display_name',
    due_at: 'due_at',
    waiting_on: 'waiting_on',
    review_at: 'review_at',
    completed_at: 'completed_at',
    source_refs: 'source_refs',
    version: 'version',
    idempotency_key: 'idempotency_key',
    payload_fingerprint: 'payload_fingerprint',
    last_operation_key: 'last_operation_key',
    last_operation_fingerprint: 'last_operation_fingerprint'
});

function encodeCursor(offset) {
    return Buffer.from(JSON.stringify({ v: 1, offset }), 'utf8').toString('base64url');
}

function isoOrNull(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSourceReferences(value) {
    if (Array.isArray(value)) return { references: value, warnings: [] };
    if (value == null) return { references: [], warnings: [] };
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (Array.isArray(parsed)) return { references: parsed, warnings: [] };
    } catch {
        // Report invalid persisted data to the caller instead of hiding it.
    }
    return {
        references: [],
        warnings: [{ code: 'invalid_source_refs_shape', message: 'Task source references must be an array' }]
    };
}

function notFound() {
    const error = new Error('Task not found');
    error.code = 'task_not_found';
    error.status = 404;
    return error;
}

function unavailable(error) {
    if (error?.code === 'task_not_found' || error?.code === 'validation_failed') return error;
    const wrapped = new Error('PostgreSQL Task store is unavailable');
    wrapped.code = 'task_store_unavailable';
    wrapped.status = 503;
    wrapped.cause = error;
    return wrapped;
}

export class CanonicalTaskPostgresRepository {
    constructor({
        pool,
        storeConfig,
        idSecret,
        webBaseUrl = process.env.BRAINBASE_PUBLIC_URL || process.env.BRAINBASE_BASE_URL || null
    } = {}) {
        if (!pool) throw new Error('Canonical Task PostgreSQL pool is required');
        if (!storeConfig) throw new Error('Canonical Task store config is required');
        this.pool = pool;
        this.storeConfig = storeConfig;
        this.idSecret = idSecret || process.env.CANONICAL_TASK_ID_SECRET || process.env.AUTH_SESSION_SECRET;
        if (!this.idSecret) throw new Error('Canonical Task opaque ID secret is not configured');
        this.webBaseUrl = webBaseUrl;
    }

    sign(payload) {
        return crypto.createHmac('sha256', this.idSecret).update(payload).digest('base64url');
    }

    encodePayload(value) {
        const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
        return `ct1.${payload}.${this.sign(payload)}`;
    }

    encodeId(id) {
        return this.encodePayload({ v: this.storeConfig.schemaVersion, s: 'postgres', r: String(id) });
    }

    encodeLegacyId(id) {
        return this.encodePayload({
            v: this.storeConfig.schemaVersion,
            b: this.storeConfig.baseId,
            t: this.storeConfig.tableId,
            r: String(id)
        });
    }

    decodeId(taskId) {
        try {
            const [prefix, payload, signature] = String(taskId).split('.');
            const expected = this.sign(payload);
            if (prefix !== 'ct1' || !signature) throw new Error();
            const actualBytes = Buffer.from(signature);
            const expectedBytes = Buffer.from(expected);
            if (actualBytes.length !== expectedBytes.length
                || !crypto.timingSafeEqual(actualBytes, expectedBytes)) throw new Error();
            const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
            if (decoded.v !== this.storeConfig.schemaVersion || !decoded.r) throw new Error();
            if (decoded.s === 'postgres') return { column: 'id', value: decoded.r };
            if (decoded.b === this.storeConfig.baseId && decoded.t === this.storeConfig.tableId) {
                return { column: 'legacy_nocodb_id', value: String(decoded.r) };
            }
            throw new Error();
        } catch {
            throw notFound();
        }
    }

    normalize(row) {
        if (!row) return null;
        const warnings = [];
        let status = row.status;
        let priority = row.priority;
        if (!STATUSES.has(status)) {
            warnings.push({ code: 'unknown_status', message: `Unknown Task status: ${status || ''}` });
            status = String(status || 'unknown');
        }
        if (!PRIORITIES.has(priority)) {
            warnings.push({ code: 'unknown_priority', message: `Unknown Task priority: ${priority || ''}` });
            priority = String(priority || 'unknown');
        }
        if (!row.assignee_person_id && row.assignee_display_name) {
            warnings.push({ code: 'assignee_unresolved', message: 'Legacy assignee has no Graph person ID' });
        }
        const sourceReferences = normalizeSourceReferences(row.source_refs);
        warnings.push(...sourceReferences.warnings);
        const id = row.legacy_nocodb_id
            ? this.encodeLegacyId(row.legacy_nocodb_id)
            : this.encodeId(row.id);
        const task = {
            id,
            version: Number(row.version ?? 1),
            title: String(row.title ?? ''),
            description: row.description ?? null,
            status,
            priority,
            assignee_person_id: row.assignee_person_id ?? null,
            assignee_display_name: row.assignee_display_name ?? null,
            due_at: isoOrNull(row.due_at),
            waiting_on: row.waiting_on ?? null,
            review_at: isoOrNull(row.review_at),
            completed_at: isoOrNull(row.completed_at),
            source_refs: sourceReferences.references,
            created_at: isoOrNull(row.created_at) || new Date(0).toISOString(),
            updated_at: isoOrNull(row.updated_at) || new Date(0).toISOString(),
            web_url: this.webBaseUrl
                ? new URL(`/api/companion/tasks/${encodeURIComponent(id)}`, this.webBaseUrl).toString()
                : null,
            normalization_warnings: warnings
        };
        Object.defineProperties(task, {
            _payload_fingerprint: { value: row.payload_fingerprint ?? null, enumerable: false },
            _last_operation_key: { value: row.last_operation_key ?? null, enumerable: false },
            _last_operation_fingerprint: { value: row.last_operation_fingerprint ?? null, enumerable: false }
        });
        return task;
    }

    async query(text, values = []) {
        try {
            return await this.pool.query(text, values);
        } catch (error) {
            throw unavailable(error);
        }
    }

    async list({
        statuses = [],
        priorities = [],
        assigneePersonId,
        dueAfter,
        dueBefore,
        cursor,
        limit = 50
    } = {}) {
        const offset = decodeCanonicalTaskCursor(cursor);
        const conditions = [];
        const values = [];
        const add = (sql, value) => {
            values.push(value);
            conditions.push(sql.replace('?', `$${values.length}`));
        };
        if (statuses.length) add('status = ANY(?::text[])', statuses);
        if (priorities.length) add('priority = ANY(?::text[])', priorities);
        if (assigneePersonId !== undefined) add('assignee_person_id IS NOT DISTINCT FROM ?', assigneePersonId);
        if (dueAfter) add('due_at >= ?::timestamptz', dueAfter);
        if (dueBefore) add('due_at <= ?::timestamptz', dueBefore);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const countResult = await this.query(`SELECT COUNT(*)::integer AS count FROM canonical_tasks ${where}`, values);
        const pageValues = [...values, limit, offset];
        const rows = await this.query(
            `SELECT * FROM canonical_tasks ${where}
             ORDER BY created_at ASC, id ASC
             LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
            pageValues
        );
        const totalCount = Number(countResult.rows[0]?.count || 0);
        return {
            items: rows.rows.map((row) => this.normalize(row)),
            totalCount,
            countStatus: 'exact',
            readStatus: 'complete',
            nextCursor: offset + rows.rows.length < totalCount ? encodeCursor(offset + rows.rows.length) : null
        };
    }

    async get(taskId) {
        const locator = this.decodeId(taskId);
        const result = await this.query(
            `SELECT * FROM canonical_tasks WHERE ${locator.column} = $1 LIMIT 1`,
            [locator.value]
        );
        return this.normalize(result.rows[0] || null);
    }

    async findByIdempotencyKey(key) {
        const result = await this.query(
            'SELECT * FROM canonical_tasks WHERE idempotency_key = $1 LIMIT 1',
            [key]
        );
        return this.normalize(result.rows[0] || null);
    }

    async create(input) {
        const id = crypto.randomUUID();
        const result = await this.query(
            `INSERT INTO canonical_tasks (
                id, title, description, status, priority, assignee_person_id,
                assignee_display_name, due_at, waiting_on, review_at, completed_at,
                source_refs, version, idempotency_key, payload_fingerprint,
                last_operation_key, last_operation_fingerprint
             ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                $12::jsonb, $13, $14, $15, $16, $17
             )
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [
                id, input.title, input.description ?? null, input.status, input.priority,
                input.assignee_person_id ?? null, input.assignee_display_name ?? null,
                input.due_at ?? null, input.waiting_on ?? null, input.review_at ?? null,
                input.completed_at ?? null, JSON.stringify(input.source_refs ?? []),
                input.version ?? 1, input.idempotency_key, input.payload_fingerprint ?? null,
                input.last_operation_key ?? null, input.last_operation_fingerprint ?? null
            ]
        );
        if (result.rows[0]) return this.normalize(result.rows[0]);
        return this.findByIdempotencyKey(input.idempotency_key);
    }

    async update(taskId, input) {
        const locator = this.decodeId(taskId);
        const entries = Object.entries(MUTABLE_COLUMNS)
            .filter(([field]) => input[field] !== undefined);
        if (!entries.length) return this.get(taskId);
        const values = entries.map(([field]) =>
            field === 'source_refs' ? JSON.stringify(input[field]) : input[field]);
        const assignments = entries.map(([field, column], index) =>
            `${column} = $${index + 1}${field === 'source_refs' ? '::jsonb' : ''}`);
        values.push(locator.value);
        const result = await this.query(
            `UPDATE canonical_tasks
             SET ${assignments.join(', ')}, updated_at = NOW()
             WHERE ${locator.column} = $${values.length}
             RETURNING *`,
            values
        );
        if (!result.rows[0]) throw notFound();
        return this.normalize(result.rows[0]);
    }

    async delete(taskId) {
        const locator = this.decodeId(taskId);
        await this.query(`DELETE FROM canonical_tasks WHERE ${locator.column} = $1`, [locator.value]);
    }
}
