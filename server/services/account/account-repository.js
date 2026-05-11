// @ts-check
/**
 * Account Repository (in-memory, swappable to DB)
 * SPEC-account-foundation Contract-1/2/3
 */

const SCOPE_TYPES = new Set(['personal', 'org', 'project']);
const STATUSES = new Set(['connected', 'disabled', 'revoked', 'reauth_required']);
const ACTIONS = new Set(['CONNECTED', 'REAUTHORIZED', 'REVOKED', 'DEFAULT_CHANGED', 'USED_FOR_POST']);
const FORBIDDEN_CREDENTIAL_KEYS = new Set(['access_token', 'refresh_token', 'api_key', 'password', 'secret', 'token']);

export class AccountValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AccountValidationError';
    }
}

export class CredentialSecretLeakError extends Error {
    constructor(key) {
        super(`credential_ref must not contain secret key: ${key}`);
        this.name = 'CredentialSecretLeakError';
        this.key = key;
    }
}

function validateCredentialRef(credentialRef) {
    if (!credentialRef || typeof credentialRef !== 'object') {
        throw new AccountValidationError('credential_ref required');
    }
    for (const k of Object.keys(credentialRef)) {
        if (FORBIDDEN_CREDENTIAL_KEYS.has(k)) {
            throw new CredentialSecretLeakError(k);
        }
    }
    if (!credentialRef.provider || !credentialRef.path) {
        throw new AccountValidationError('credential_ref must include {provider, path}');
    }
}

function validateInput(input) {
    if (!input.service) throw new AccountValidationError('service required');
    if (!SCOPE_TYPES.has(input.scope_type)) throw new AccountValidationError('invalid scope_type');
    if (input.scope_type === 'personal' && !input.owner_person_id) {
        throw new AccountValidationError('owner_person_id required for scope_type=personal');
    }
    if (input.scope_type === 'org' && !input.org_id) {
        throw new AccountValidationError('org_id required for scope_type=org');
    }
    if (input.scope_type === 'project' && !input.project_id) {
        throw new AccountValidationError('project_id required for scope_type=project');
    }
    if (!input.display_name) throw new AccountValidationError('display_name required');
    if (!input.created_by_person_id) throw new AccountValidationError('created_by_person_id required');
    validateCredentialRef(input.credential_ref);
}

let counter = 0;
function nextId() {
    counter += 1;
    return `acc_${Date.now()}_${counter.toString(36)}`;
}

export class InMemoryAccountRepository {
    constructor() {
        /** @type {Map<string, any>} */
        this.accounts = new Map();
        /** @type {Map<string, any>} keyed by `${subject_type}:${subject_id}:${service}:${purpose}:${account_id}` */
        this.defaults = new Map();
        /** @type {Array<any>} */
        this.auditEvents = [];
    }

    create(input) {
        validateInput(input);
        const id = input.id || nextId();
        const now = new Date().toISOString();
        const record = {
            id,
            service: input.service,
            scope_type: input.scope_type,
            owner_person_id: input.owner_person_id || null,
            org_id: input.org_id || null,
            project_id: input.project_id || null,
            display_name: input.display_name,
            external_account_id: input.external_account_id || null,
            external_handle: input.external_handle || null,
            credential_ref: input.credential_ref,
            oauth_client_ref: input.oauth_client_ref || null,
            status: input.status || 'connected',
            capabilities: input.capabilities || [],
            rate_limit_profile_id: input.rate_limit_profile_id || null,
            metadata: input.metadata || {},
            created_by_person_id: input.created_by_person_id,
            updated_by_person_id: input.updated_by_person_id || null,
            created_at: now,
            updated_at: now,
            last_verified_at: null
        };
        this.accounts.set(id, record);
        return { ...record };
    }

    findById(id) {
        const r = this.accounts.get(id);
        return r ? { ...r } : null;
    }

    list(filter = {}) {
        return Array.from(this.accounts.values()).filter((r) => {
            if (filter.service && r.service !== filter.service) return false;
            if (filter.scope_type && r.scope_type !== filter.scope_type) return false;
            if (filter.owner_person_id && r.owner_person_id !== filter.owner_person_id) return false;
            if (filter.org_id && r.org_id !== filter.org_id) return false;
            if (filter.project_id && r.project_id !== filter.project_id) return false;
            return true;
        }).map((r) => ({ ...r }));
    }

    updateStatus(id, status, actor) {
        if (!STATUSES.has(status)) throw new AccountValidationError(`invalid status: ${status}`);
        const r = this.accounts.get(id);
        if (!r) throw new AccountValidationError('account not found');
        r.status = status;
        r.updated_at = new Date().toISOString();
        r.updated_by_person_id = actor.actor_person_id || null;
        return { ...r };
    }

    setDefault({ subject_type, subject_id, service, purpose, account_id, priority = 100, created_by_person_id }) {
        if (!this.accounts.has(account_id)) {
            throw new AccountValidationError('account not found for default');
        }
        const key = `${subject_type}:${subject_id}:${service}:${purpose}:${account_id}`;
        // Replace any existing defaults for same (subject_type, subject_id, service, purpose)
        for (const k of Array.from(this.defaults.keys())) {
            if (k.startsWith(`${subject_type}:${subject_id}:${service}:${purpose}:`)) {
                this.defaults.delete(k);
            }
        }
        const record = { subject_type, subject_id, service, purpose, account_id, priority, created_by_person_id };
        this.defaults.set(key, record);
        return { ...record };
    }

    getDefault(subject_type, subject_id, service, purpose) {
        for (const r of this.defaults.values()) {
            if (r.subject_type === subject_type && r.subject_id === subject_id &&
                r.service === service && r.purpose === purpose) {
                return { ...r };
            }
        }
        return null;
    }

    recordAudit({ account_id, actor_person_id, action, context }) {
        if (!ACTIONS.has(action)) throw new AccountValidationError(`invalid action: ${action}`);
        if (!actor_person_id) throw new AccountValidationError('actor_person_id required');
        const entry = {
            id: this.auditEvents.length + 1,
            account_id: account_id || null,
            actor_person_id,
            action,
            context: context || null,
            occurred_at: new Date().toISOString()
        };
        this.auditEvents.push(entry);
        return { ...entry };
    }

    listAudit(account_id) {
        return this.auditEvents.filter((e) => e.account_id === account_id).map((e) => ({ ...e }));
    }
}

export { SCOPE_TYPES, STATUSES, ACTIONS, FORBIDDEN_CREDENTIAL_KEYS };
