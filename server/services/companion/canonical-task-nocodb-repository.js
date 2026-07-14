import crypto from 'crypto';

const STATUS_TO_NOCO = Object.freeze({ pending: '未着手', in_progress: '進行中', waiting: '待ち', completed: '完了' });
const NOCO_TO_STATUS = Object.freeze(Object.fromEntries(Object.entries(STATUS_TO_NOCO).map(([key, value]) => [value, key])));
const PRIORITY_TO_NOCO = Object.freeze({ low: '低', medium: '中', high: '高', urgent: '緊急' });
const NOCO_TO_PRIORITY = Object.freeze(Object.fromEntries(Object.entries(PRIORITY_TO_NOCO).map(([key, value]) => [value, key])));

function parseJson(value, fallback) {
    if (value == null || value === '') return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return fallback; }
}

function recordId(record) {
    return record?.Id ?? record?.ID ?? record?.id ?? record?.RecordId ?? record?.recordId;
}

function fieldsOf(record) {
    return record?.fields && typeof record.fields === 'object' ? { ...record.fields, Id: recordId(record) } : record;
}

function isoOrNull(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSourceReference(reference) {
    const source = reference && typeof reference === 'object' ? reference : {};
    const type = String(source.type || 'unknown');
    const sourceId = source.id
        || source.output_id
        || source.step_id
        || source.capture_id
        || source.candidate_id
        || crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0, 24);

    return {
        type,
        id: String(sourceId),
        url: typeof source.url === 'string' && source.url ? source.url : null
    };
}

function normalizeSourceReferences(value) {
    const references = parseJson(value, []);
    return Array.isArray(references) ? references.map(normalizeSourceReference) : [];
}

function encodeCursor(offset) {
    return Buffer.from(JSON.stringify({ v: 1, offset }), 'utf8').toString('base64url');
}

export function decodeCanonicalTaskCursor(cursor) {
    if (!cursor) return 0;
    try {
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (value?.v !== 1 || !Number.isInteger(value.offset) || value.offset < 0) throw new Error();
        return value.offset;
    } catch {
        const error = new Error('Invalid cursor');
        error.code = 'validation_failed';
        error.status = 422;
        error.fieldErrors = { cursor: ['invalid_cursor'] };
        throw error;
    }
}

export class CanonicalTaskNocoDBRepository {
    constructor({ storeConfig, fetchImpl = fetch, baseUrl = process.env.NOCODB_URL || 'https://noco.unson.jp', apiToken = process.env.NOCODB_TOKEN, idSecret } = {}) {
        if (!storeConfig) throw new Error('Canonical Task store config is required');
        this.storeConfig = storeConfig;
        this.fetch = fetchImpl;
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.apiToken = apiToken;
        this.idSecret = idSecret || process.env.CANONICAL_TASK_ID_SECRET || process.env.AUTH_SESSION_SECRET || storeConfig.identityHash;
    }

    headers(json = false) {
        if (!this.apiToken) {
            const error = new Error('NocoDB token is not configured');
            error.code = 'task_store_unavailable';
            error.status = 503;
            throw error;
        }
        return { 'xc-token': this.apiToken, ...(json ? { 'Content-Type': 'application/json' } : {}) };
    }

    async request(path, options = {}) {
        const response = await this.fetch(`${this.baseUrl}${path}`, {
            ...options,
            headers: { ...this.headers(Boolean(options.body)), ...(options.headers || {}) }
        });
        if (response.status === 404) return null;
        if (!response.ok) {
            const error = new Error(`NocoDB Task store failed: ${response.status}`);
            error.code = 'task_store_unavailable';
            error.status = 503;
            throw error;
        }
        if (response.status === 204) return null;
        return response.json();
    }

    encodeId(id) {
        const payload = Buffer.from(JSON.stringify({
            v: this.storeConfig.schemaVersion,
            b: this.storeConfig.baseId,
            t: this.storeConfig.tableId,
            r: String(id)
        }), 'utf8').toString('base64url');
        const signature = crypto.createHmac('sha256', this.idSecret).update(payload).digest('base64url');
        return `ct1.${payload}.${signature}`;
    }

    decodeId(taskId) {
        try {
            const [prefix, payload, signature] = String(taskId).split('.');
            const expected = crypto.createHmac('sha256', this.idSecret).update(payload).digest('base64url');
            if (prefix !== 'ct1' || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error();
            const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
            if (decoded.v !== this.storeConfig.schemaVersion || decoded.b !== this.storeConfig.baseId || decoded.t !== this.storeConfig.tableId || !decoded.r) throw new Error();
            return decoded.r;
        } catch {
            const error = new Error('Task not found');
            error.code = 'task_not_found';
            error.status = 404;
            throw error;
        }
    }

    normalize(record) {
        if (!record) return null;
        const fields = fieldsOf(record);
        const id = recordId(fields);
        if (id == null) return null;
        const warnings = [];
        let status = NOCO_TO_STATUS[fields['ステータス']] || fields.status;
        let priority = NOCO_TO_PRIORITY[fields['優先度']] || fields.priority;
        if (!['pending', 'in_progress', 'waiting', 'completed'].includes(status)) {
            warnings.push({ code: 'unknown_status', message: `Unknown Task status: ${fields['ステータス'] || status || ''}` });
            status = String(fields['ステータス'] || status || 'unknown');
        }
        if (!['low', 'medium', 'high', 'urgent'].includes(priority)) {
            warnings.push({ code: 'unknown_priority', message: `Unknown Task priority: ${fields['優先度'] || priority || ''}` });
            priority = String(fields['優先度'] || priority || 'unknown');
        }
        const assigneePersonId = fields['担当者PersonID'] || fields.assignee_person_id || null;
        if (!assigneePersonId && (fields['担当者'] || fields.assignee_display_name)) {
            warnings.push({ code: 'assignee_unresolved', message: 'Legacy assignee has no Graph person ID' });
        }
        const task = {
            id: this.encodeId(id),
            version: Number(fields['バージョン'] ?? fields.version ?? 1),
            title: String(fields['タイトル'] ?? fields.title ?? ''),
            description: fields['説明'] ?? fields.description ?? null,
            status,
            priority,
            assignee_person_id: assigneePersonId,
            assignee_display_name: fields['担当者'] || fields.assignee_display_name || null,
            due_at: isoOrNull(fields['期限'] ?? fields.due_at),
            waiting_on: fields['待ち理由'] ?? fields.waiting_on ?? null,
            review_at: isoOrNull(fields['レビュー日時'] ?? fields.review_at),
            completed_at: isoOrNull(fields['完了日時'] ?? fields.completed_at),
            source_refs: normalizeSourceReferences(fields['ソース参照'] ?? fields.source_refs),
            created_at: isoOrNull(fields['CreatedAt'] ?? fields['作成日時'] ?? fields.created_at) || new Date(0).toISOString(),
            updated_at: isoOrNull(fields['UpdatedAt'] ?? fields['更新日時'] ?? fields.updated_at) || new Date(0).toISOString(),
            web_url: `${this.baseUrl}/dashboard/#/nc/${this.storeConfig.baseId}/${this.storeConfig.tableId}`,
            normalization_warnings: warnings
        };
        Object.defineProperty(task, '_payload_fingerprint', {
            value: fields['Payload Fingerprint'] || fields.payload_fingerprint || null,
            enumerable: false
        });
        return task;
    }

    async allRecords() {
        const data = await this.request(`/api/v2/tables/${this.storeConfig.tableId}/records?limit=1000`);
        return Array.isArray(data?.list) ? data.list : (Array.isArray(data) ? data : []);
    }

    async list({ statuses = [], priorities = [], assigneePersonId, dueAfter, dueBefore, cursor, limit = 50 } = {}) {
        const offset = decodeCanonicalTaskCursor(cursor);
        const items = (await this.allRecords()).map((record) => this.normalize(record)).filter(Boolean).filter((task) => {
            if (statuses.length && !statuses.includes(task.status)) return false;
            if (priorities.length && !priorities.includes(task.priority)) return false;
            if (assigneePersonId !== undefined && task.assignee_person_id !== assigneePersonId) return false;
            if (dueAfter && (!task.due_at || task.due_at < dueAfter)) return false;
            if (dueBefore && (!task.due_at || task.due_at > dueBefore)) return false;
            return true;
        });
        const page = items.slice(offset, offset + limit);
        return { items: page, totalCount: items.length, nextCursor: offset + limit < items.length ? encodeCursor(offset + limit) : null };
    }

    async get(taskId) {
        const id = this.decodeId(taskId);
        const records = await this.allRecords();
        return this.normalize(records.find((record) => String(recordId(fieldsOf(record))) === String(id)) || null);
    }

    async findByIdempotencyKey(key) {
        const records = await this.allRecords();
        return this.normalize(records.find((record) => fieldsOf(record)['冪等キー'] === key) || null);
    }

    toFields(input) {
        const fields = {};
        const assign = (key, value) => { if (value !== undefined) fields[key] = value; };
        assign('タイトル', input.title);
        assign('説明', input.description);
        assign('ステータス', input.status ? STATUS_TO_NOCO[input.status] : undefined);
        assign('優先度', input.priority ? PRIORITY_TO_NOCO[input.priority] : undefined);
        assign('担当者PersonID', input.assignee_person_id);
        assign('担当者', input.assignee_display_name);
        assign('期限', input.due_at);
        assign('待ち理由', input.waiting_on);
        assign('レビュー日時', input.review_at);
        assign('完了日時', input.completed_at);
        assign('ソース参照', input.source_refs === undefined ? undefined : JSON.stringify(input.source_refs));
        assign('バージョン', input.version);
        assign('冪等キー', input.idempotency_key);
        assign('Payload Fingerprint', input.payload_fingerprint);
        assign('最終操作キー', input.last_operation_key);
        assign('最終操作Fingerprint', input.last_operation_fingerprint);
        return fields;
    }

    async create(input) {
        const data = await this.request(`/api/v2/tables/${this.storeConfig.tableId}/records`, {
            method: 'POST', body: JSON.stringify(this.toFields(input))
        });
        const record = Array.isArray(data?.list) ? data.list[0] : (Array.isArray(data) ? data[0] : data);
        if (recordId(fieldsOf(record)) == null) {
            const replay = await this.findByIdempotencyKey(input.idempotency_key);
            if (replay) return replay;
        }
        return this.normalize(record);
    }

    async update(taskId, input) {
        const id = this.decodeId(taskId);
        const data = await this.request(`/api/v2/tables/${this.storeConfig.tableId}/records`, {
            method: 'PATCH', body: JSON.stringify({ Id: /^\d+$/.test(id) ? Number(id) : id, ...this.toFields(input) })
        });
        const record = Array.isArray(data?.list) ? data.list[0] : (Array.isArray(data) ? data[0] : data);
        return this.normalize(record) || this.get(taskId);
    }

    async delete(taskId) {
        const id = this.decodeId(taskId);
        await this.request(`/api/v2/tables/${this.storeConfig.tableId}/records`, {
            method: 'DELETE', body: JSON.stringify({ Id: /^\d+$/.test(id) ? Number(id) : id })
        });
    }
}
