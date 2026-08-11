// @ts-check

const LEGACY_TASK_MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class CanonicalTaskApiRequiredError extends Error {
    constructor() {
        super('Canonical Task mutations require the Companion Task API');
        this.name = 'CanonicalTaskApiRequiredError';
        this.code = 'canonical_task_api_required';
        this.statusCode = 409;
    }
}

export class CanonicalTaskStoreConfigUnavailableError extends Error {
    constructor() {
        super('Canonical Task store configuration is unavailable');
        this.name = 'CanonicalTaskStoreConfigUnavailableError';
        this.code = 'canonical_task_store_config_unavailable';
        this.statusCode = 503;
    }
}

/**
 * Guards the browser's legacy NocoDB Task request boundary. Canonical writes
 * are routed by the canonical repository and must never reach this adapter.
 */
export class NocoDBBrowserAdapter {
    /** @param {{canonicalTaskStoreConfig?: {baseId?: string, project?: string}|null}} [options] */
    constructor({ canonicalTaskStoreConfig = null } = {}) {
        this.canonicalTaskStoreConfig = canonicalTaskStoreConfig;
    }

    /**
     * @template T
     * @param {T & {method?: string, baseId?: string, projectId?: string}} request
     * @returns {T}
     */
    guardLegacyTaskRequest(request) {
        const method = String(request?.method || 'GET').toUpperCase();
        if (!LEGACY_TASK_MUTATION_METHODS.has(method)) {
            return request;
        }

        const canonicalBaseId = this.canonicalTaskStoreConfig?.baseId;
        const canonicalProject = this.canonicalTaskStoreConfig?.project;
        if (typeof canonicalBaseId !== 'string' || !canonicalBaseId
            || typeof canonicalProject !== 'string' || !canonicalProject) {
            throw new CanonicalTaskStoreConfigUnavailableError();
        }
        if (request.baseId === canonicalBaseId || request.projectId === canonicalProject) {
            throw new CanonicalTaskApiRequiredError();
        }
        return request;
    }
}
