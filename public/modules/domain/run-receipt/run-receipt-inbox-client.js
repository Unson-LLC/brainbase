// @ts-check

const FILTER_KEYS = ['project_id', 'source_type', 'run_status', 'evidence_state', 'limit'];

function requireNonNegativeInteger(value, field) {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`invalid Run Receipt Inbox response: ${field}`);
    }
}

function validateResponse(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('invalid Run Receipt Inbox response: payload');
    }
    if (!Array.isArray(payload.items)) {
        throw new Error('invalid Run Receipt Inbox response: items');
    }
    requireNonNegativeInteger(payload.count, 'count');
    if (typeof payload.has_more !== 'boolean') {
        throw new Error('invalid Run Receipt Inbox response: has_more');
    }
    requireNonNegativeInteger(payload.omitted_count, 'omitted_count');
    return payload;
}

export class RunReceiptInboxClient {
    constructor({ apiFetch }) {
        if (typeof apiFetch !== 'function') throw new TypeError('apiFetch is required');
        this.apiFetch = apiFetch;
    }

    async list(filters = {}) {
        const query = new URLSearchParams();
        for (const key of FILTER_KEYS) {
            const value = filters[key];
            if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
        }
        const suffix = query.size ? `?${query.toString()}` : '';
        const response = await this.apiFetch(`/api/run-receipts/inbox${suffix}`);
        if (!response.ok) throw new Error(`Run Receipt Inbox HTTP ${response.status}`);
        return validateResponse(await response.json());
    }
}
