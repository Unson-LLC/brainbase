// @ts-check
/**
 * Account Repository (in-memory, swappable to DB)
 * SPEC-account-foundation Contract-1/2/3
 */

const SCOPE_TYPES = new Set(['personal', 'org', 'project']);
const STATUSES = new Set(['connected', 'disabled', 'revoked', 'reauth_required']);
const ACTIONS = new Set(['CONNECTED', 'REAUTHORIZED', 'REVOKED', 'DEFAULT_CHANGED', 'USED_FOR_POST', 'TENANT_BOUND', 'TENANT_UNBOUND']);
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

function toIso(value) {
    if (!value) return value;
    if (value instanceof Date) return value.toISOString();
    return value;
}

function normalizeAccount(row) {
    if (!row) return null;
    return {
        ...row,
        credential_ref: row.credential_ref || null,
        oauth_client_ref: row.oauth_client_ref || null,
        capabilities: row.capabilities || [],
        metadata: row.metadata || {},
        created_at: toIso(row.created_at),
        updated_at: toIso(row.updated_at),
        last_verified_at: toIso(row.last_verified_at)
    };
}

function normalizeAudit(row) {
    if (!row) return null;
    return {
        ...row,
        occurred_at: toIso(row.occurred_at),
        context: row.context || null
    };
}

// Match PostgreSQL COLLATE "C" semantics for the ASCII account ids used here.
// Avoid localeCompare(), whose ICU/default-locale ordering can diverge from DB collation.
function compareOpaqueIds(left, right) {
    const a = String(left);
    const b = String(right);
    return a < b ? -1 : a > b ? 1 : 0;
}

function compareDefaults(a, b) {
    const priority = Number(a.priority ?? 100) - Number(b.priority ?? 100);
    if (priority !== 0) return priority;
    return compareOpaqueIds(a.account_id, b.account_id);
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
        /** @type {Map<string, any>} keyed by account_id; one integration account belongs to one tenant */
        this.accountTenants = new Map();
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

    update(id, input = {}) {
        const existing = this.accounts.get(id);
        if (!existing) throw new AccountValidationError('account not found');
        const merged = { ...existing, ...input, id };
        validateInput(merged);
        merged.updated_at = new Date().toISOString();
        this.accounts.set(id, merged);
        return { ...merged };
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

    listDefaults(subject_type, subject_id, service, purpose) {
        return Array.from(this.defaults.values())
            .filter((r) => r.subject_type === subject_type && r.subject_id === subject_id
                && r.service === service && r.purpose === purpose)
            .sort(compareDefaults)
            .map((r) => ({ ...r }));
    }

    getDefault(subject_type, subject_id, service, purpose) {
        return this.listDefaults(subject_type, subject_id, service, purpose)[0] ?? null;
    }

    async bindTenant({ tenant_id, account_id, created_by_person_id }) {
        if (typeof tenant_id !== 'string' || !tenant_id) throw new AccountValidationError('tenant_id required');
        if (!this.accounts.has(account_id)) throw new AccountValidationError('account not found for tenant binding');
        if (!created_by_person_id) throw new AccountValidationError('created_by_person_id required');
        const existing = this.accountTenants.get(account_id);
        if (existing && existing.tenant_id !== tenant_id) {
            throw new AccountValidationError('account already bound to another tenant');
        }
        if (existing) return { ...existing };
        const record = {
            tenant_id,
            account_id,
            created_by_person_id,
            created_at: new Date().toISOString()
        };
        this.accountTenants.set(account_id, record);
        this.recordAudit({
            account_id,
            actor_person_id: created_by_person_id,
            action: 'TENANT_BOUND',
            context: { tenant_id }
        });
        return { ...record };
    }

    async isBoundToTenant(tenant_id, account_id) {
        return this.accountTenants.get(account_id)?.tenant_id === tenant_id;
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

export class PgAccountRepository {
    constructor({ pool }) {
        if (!pool || typeof pool.query !== 'function') {
            throw new Error('PgAccountRepository requires a pg pool/client with query(sql, params)');
        }
        this.pool = pool;
    }

    async create(input) {
        validateInput(input);
        try {
            const { rows } = await this.pool.query(
                `INSERT INTO integration_accounts (
                    id, service, scope_type, owner_person_id, org_id, project_id,
                    display_name, external_account_id, external_handle, credential_ref,
                    oauth_client_ref, status, capabilities, rate_limit_profile_id,
                    metadata, created_by_person_id, updated_by_person_id
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, $8, $9, $10::jsonb,
                    $11::jsonb, $12, $13, $14,
                    $15::jsonb, $16, $17
                )
                RETURNING *`,
                [
                    input.id || nextId(),
                    input.service,
                    input.scope_type,
                    input.owner_person_id || null,
                    input.org_id || null,
                    input.project_id || null,
                    input.display_name,
                    input.external_account_id || null,
                    input.external_handle || null,
                    JSON.stringify(input.credential_ref),
                    input.oauth_client_ref ? JSON.stringify(input.oauth_client_ref) : null,
                    input.status || 'connected',
                    input.capabilities || [],
                    input.rate_limit_profile_id || null,
                    JSON.stringify(input.metadata || {}),
                    input.created_by_person_id,
                    input.updated_by_person_id || null
                ]
            );
            return normalizeAccount(rows[0]);
        } catch (error) {
            if (error && /credential_ref must not contain secret key/.test(error.message || '')) {
                const key = (error.message || '').split(':').at(-1)?.trim() || 'secret';
                throw new CredentialSecretLeakError(key);
            }
            throw error;
        }
    }

    async findById(id) {
        const { rows } = await this.pool.query('SELECT * FROM integration_accounts WHERE id = $1', [id]);
        return normalizeAccount(rows[0]);
    }

    async list(filter = {}) {
        const clauses = [];
        const params = [];
        const add = (sql, value) => {
            params.push(value);
            clauses.push(sql.replace('?', `$${params.length}`));
        };
        if (filter.service) add('service = ?', filter.service);
        if (filter.scope_type) add('scope_type = ?', filter.scope_type);
        if (filter.owner_person_id) add('owner_person_id = ?', filter.owner_person_id);
        if (filter.org_id) add('org_id = ?', filter.org_id);
        if (filter.project_id) add('project_id = ?', filter.project_id);
        const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
        const { rows } = await this.pool.query(`SELECT * FROM integration_accounts${where} ORDER BY created_at ASC, id ASC`, params);
        return rows.map(normalizeAccount);
    }

    async updateStatus(id, status, actor) {
        if (!STATUSES.has(status)) throw new AccountValidationError(`invalid status: ${status}`);
        const { rows } = await this.pool.query(
            `UPDATE integration_accounts
             SET status = $2, updated_by_person_id = $3, updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [id, status, actor.actor_person_id || null]
        );
        if (!rows[0]) throw new AccountValidationError('account not found');
        return normalizeAccount(rows[0]);
    }

    async update(id, input = {}) {
        const existing = await this.findById(id);
        if (!existing) throw new AccountValidationError('account not found');
        const merged = { ...existing, ...input, id };
        validateInput(merged);
        try {
            const { rows } = await this.pool.query(
                `UPDATE integration_accounts
                 SET service = $2, scope_type = $3, owner_person_id = $4, org_id = $5,
                     project_id = $6, display_name = $7, external_account_id = $8,
                     external_handle = $9, credential_ref = $10::jsonb,
                     oauth_client_ref = $11::jsonb, status = $12, capabilities = $13,
                     rate_limit_profile_id = $14, metadata = $15::jsonb,
                     updated_by_person_id = $16, updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [
                    id,
                    merged.service,
                    merged.scope_type,
                    merged.owner_person_id || null,
                    merged.org_id || null,
                    merged.project_id || null,
                    merged.display_name,
                    merged.external_account_id || null,
                    merged.external_handle || null,
                    JSON.stringify(merged.credential_ref),
                    merged.oauth_client_ref ? JSON.stringify(merged.oauth_client_ref) : null,
                    merged.status || 'connected',
                    merged.capabilities || [],
                    merged.rate_limit_profile_id || null,
                    JSON.stringify(merged.metadata || {}),
                    merged.updated_by_person_id || null
                ]
            );
            if (!rows[0]) throw new AccountValidationError('account not found');
            return normalizeAccount(rows[0]);
        } catch (error) {
            if (error && /credential_ref must not contain secret key/.test(error.message || '')) {
                const key = (error.message || '').split(':').at(-1)?.trim() || 'secret';
                throw new CredentialSecretLeakError(key);
            }
            throw error;
        }
    }

    async setDefault({ subject_type, subject_id, service, purpose, account_id, priority = 100, created_by_person_id }) {
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        await client.query('BEGIN');
        try {
            const existing = await client.query('SELECT id FROM integration_accounts WHERE id = $1', [account_id]);
            if (!existing.rows[0]) throw new AccountValidationError('account not found for default');
            await client.query(
                `DELETE FROM integration_account_defaults
                 WHERE subject_type = $1 AND subject_id = $2 AND service = $3 AND purpose = $4`,
                [subject_type, subject_id, service, purpose]
            );
            const { rows } = await client.query(
                `INSERT INTO integration_account_defaults (
                    subject_type, subject_id, service, purpose, account_id, priority, created_by_person_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *`,
                [subject_type, subject_id, service, purpose, account_id, priority, created_by_person_id]
            );
            await client.query('COMMIT');
            return { ...rows[0] };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            if (typeof client.release === 'function') client.release();
        }
    }

    async listDefaults(subject_type, subject_id, service, purpose) {
        const { rows } = await this.pool.query(
            `SELECT * FROM integration_account_defaults
             WHERE subject_type = $1 AND subject_id = $2 AND service = $3 AND purpose = $4
             ORDER BY priority ASC, account_id COLLATE "C" ASC`,
            [subject_type, subject_id, service, purpose]
        );
        return rows.map((row) => ({ ...row }));
    }

    async getDefault(subject_type, subject_id, service, purpose) {
        const rows = await this.listDefaults(subject_type, subject_id, service, purpose);
        return rows[0] ?? null;
    }

    async bindTenant({ tenant_id, account_id, created_by_person_id }) {
        if (typeof tenant_id !== 'string' || !tenant_id) throw new AccountValidationError('tenant_id required');
        if (!created_by_person_id) throw new AccountValidationError('created_by_person_id required');
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        await client.query('BEGIN');
        try {
            const account = await client.query(
                'SELECT id FROM integration_accounts WHERE id = $1',
                [account_id]
            );
            if (!account.rows[0]) throw new AccountValidationError('account not found for tenant binding');

            const existing = await client.query(
                'SELECT * FROM integration_account_tenants WHERE account_id = $1',
                [account_id]
            );
            if (existing.rows[0]) {
                if (existing.rows[0].tenant_id !== tenant_id) {
                    throw new AccountValidationError('account already bound to another tenant');
                }
                await client.query('COMMIT');
                return { ...existing.rows[0] };
            }

            const { rows } = await client.query(
                `INSERT INTO integration_account_tenants (tenant_id, account_id, created_by_person_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (tenant_id, account_id) DO NOTHING
                 RETURNING *`,
                [tenant_id, account_id, created_by_person_id]
            );
            let binding = rows[0];
            if (!binding) {
                const current = await client.query(
                    'SELECT * FROM integration_account_tenants WHERE tenant_id = $1 AND account_id = $2',
                    [tenant_id, account_id]
                );
                binding = current.rows[0];
            }
            if (!binding) throw new AccountValidationError('tenant binding could not be established');

            await client.query(
                `INSERT INTO account_audit_events (account_id, actor_person_id, action, context)
                 VALUES ($1, $2, 'TENANT_BOUND', $3::jsonb)`,
                [account_id, created_by_person_id, JSON.stringify({ tenant_id })]
            );
            await client.query('COMMIT');
            return { ...binding };
        } catch (error) {
            await client.query('ROLLBACK');
            if (error?.code === '23505') {
                throw new AccountValidationError('account already bound to another tenant');
            }
            if (error?.code === '23503') {
                throw new AccountValidationError('account not found for tenant binding');
            }
            throw error;
        } finally {
            if (typeof client.release === 'function') client.release();
        }
    }
    async isBoundToTenant(tenant_id, account_id) {
        const { rows } = await this.pool.query(
            'SELECT 1 FROM integration_account_tenants WHERE tenant_id = $1 AND account_id = $2',
            [tenant_id, account_id]
        );
        return Boolean(rows[0]);
    }

    async recordAudit({ account_id, actor_person_id, action, context }) {
        if (!ACTIONS.has(action)) throw new AccountValidationError(`invalid action: ${action}`);
        if (!actor_person_id) throw new AccountValidationError('actor_person_id required');
        const { rows } = await this.pool.query(
            `INSERT INTO account_audit_events (account_id, actor_person_id, action, context)
             VALUES ($1, $2, $3, $4::jsonb)
             RETURNING *`,
            [account_id || null, actor_person_id, action, JSON.stringify(context || null)]
        );
        return normalizeAudit(rows[0]);
    }

    async listAudit(account_id) {
        const { rows } = await this.pool.query(
            'SELECT * FROM account_audit_events WHERE account_id = $1 ORDER BY id ASC',
            [account_id]
        );
        return rows.map(normalizeAudit);
    }
}

export { SCOPE_TYPES, STATUSES, ACTIONS, FORBIDDEN_CREDENTIAL_KEYS, validateInput as validateAccountInput };
