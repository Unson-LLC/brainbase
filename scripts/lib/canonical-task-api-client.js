import crypto from 'node:crypto';

const STATUS = Object.freeze({
    '未着手': 'pending',
    '進行中': 'in_progress',
    '待ち': 'waiting',
    '完了': 'completed',
    pending: 'pending',
    in_progress: 'in_progress',
    waiting: 'waiting',
    completed: 'completed'
});
const PRIORITY = Object.freeze({
    '低': 'low',
    '中': 'medium',
    '高': 'high',
    '緊急': 'urgent',
    low: 'low',
    medium: 'medium',
    high: 'high',
    urgent: 'urgent'
});

function requiredToken() {
    const token = process.env.BRAINBASE_CANONICAL_TASK_TOKEN || process.env.BRAINBASE_AUTH_TOKEN;
    if (!token) throw new Error('BRAINBASE_CANONICAL_TASK_TOKEN or BRAINBASE_AUTH_TOKEN is required');
    return token;
}

function operationKey(namespace, value) {
    const digest = crypto.createHash('sha256').update(`${namespace}\0${value}`).digest('hex');
    return `operational-script-${namespace}-${digest}`;
}

export class CanonicalTaskApiClient {
    constructor({
        baseUrl = process.env.BRAINBASE_API_URL || 'http://localhost:31013',
        token = requiredToken(),
        fetchImpl = fetch
    } = {}) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.token = token;
        this.fetch = fetchImpl;
    }

    async request(path, { method = 'GET', body, idempotencyKey } = {}) {
        const response = await this.fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${this.token}`,
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        const text = await response.text();
        const payload = text ? JSON.parse(text) : null;
        if (!response.ok) {
            const error = new Error(payload?.message || `Canonical Task API failed: ${response.status}`);
            error.code = payload?.code || payload?.error || 'canonical_task_api_failed';
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    async listTasks() {
        const items = [];
        let cursor = null;
        do {
            const query = new URLSearchParams({ limit: '50' });
            if (cursor) query.set('cursor', cursor);
            const page = await this.request(`/api/companion/tasks?${query}`);
            items.push(...(page.items || []));
            cursor = page.next_cursor || null;
        } while (cursor);
        return items;
    }

    createTask(task, namespace) {
        const title = String(task.title || '').trim();
        return this.request('/api/companion/tasks', {
            method: 'POST',
            idempotencyKey: operationKey(namespace, title),
            body: {
                title,
                description: task.description || null,
                status: STATUS[task.status] || 'pending',
                priority: PRIORITY[task.priority] || 'medium',
                source_refs: [{ type: 'operational_script', id: `${namespace}:${operationKey(namespace, title).slice(-24)}`, url: null }]
            }
        });
    }

    transitionTask(task, status, namespace) {
        const toStatus = STATUS[status];
        if (!toStatus) throw new Error(`Unsupported Canonical Task status: ${status}`);
        return this.request(`/api/companion/tasks/${encodeURIComponent(task.id)}/transitions`, {
            method: 'POST',
            idempotencyKey: operationKey(namespace, `${task.id}:${task.version}:${toStatus}`),
            body: { expected_version: task.version, to_status: toStatus }
        });
    }
}

export { PRIORITY as CANONICAL_TASK_PRIORITIES, STATUS as CANONICAL_TASK_STATUSES };
