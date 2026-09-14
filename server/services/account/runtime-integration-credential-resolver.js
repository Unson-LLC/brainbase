// @ts-check

/**
 * Resolve a provider-specific integration credential for runtime use without
 * exposing credential material. This intentionally stops at the opaque
 * credential reference: the tenant credential store / broker remains the only
 * component allowed to materialize secrets.
 */

export class RuntimeIntegrationCredentialError extends Error {
    constructor(code, { status = 403, details = {} } = {}) {
        super(code);
        this.name = 'RuntimeIntegrationCredentialError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

const FREEE_SERVICE = 'freee';
const READ_CAPABILITY = 'read';
const DEFAULT_PURPOSE = 'runtime_read';
const OPAQUE_CREDENTIAL_PROVIDER = 'brainbase-credential-store';
// Canonical cloudflare-tenant-credential-store refs are opaque identifiers
// directly under credref://bbcs/. Nested paths and traversal-like segments are
// deliberately rejected here; provider identity is checked again by the broker.
const CREDENTIAL_REF = /^credref:\/\/bbcs\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function invalid(code, options) {
    throw new RuntimeIntegrationCredentialError(code, options);
}

function strings(value) {
    return Array.isArray(value)
        ? [...new Set(value.filter((entry) => typeof entry === 'string' && entry.length > 0))]
        : [];
}

function compareOpaqueIds(left, right) {
    const a = String(left);
    const b = String(right);
    return a < b ? -1 : a > b ? 1 : 0;
}

function normalizedContext(context) {
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
        invalid('INTEGRATION_CONTEXT_INVALID', { status: 400 });
    }
    const actorPersonId = context.actor_person_id;
    if (typeof actorPersonId !== 'string' || !actorPersonId) {
        invalid('INTEGRATION_CONTEXT_INVALID', { status: 400, details: { field: 'actor_person_id' } });
    }
    return {
        actor_person_id: actorPersonId,
        project_ids: strings(context.project_ids),
        organization_ids: strings(context.organization_ids)
    };
}

function accountScope(account) {
    if (account.scope_type === 'personal' && typeof account.owner_person_id === 'string' && account.owner_person_id) {
        return { account_scope_type: 'personal', account_scope_id: account.owner_person_id };
    }
    if (account.scope_type === 'org' && typeof account.org_id === 'string' && account.org_id) {
        return { account_scope_type: 'org', account_scope_id: account.org_id };
    }
    if (account.scope_type === 'project' && typeof account.project_id === 'string' && account.project_id) {
        return { account_scope_type: 'project', account_scope_id: account.project_id };
    }
    invalid('INTEGRATION_ACCOUNT_SCOPE_MISMATCH');
}

function assertAccountScope(account, authorized) {
    // The default subject answers "which account is preferred in this context";
    // it does not redefine the account's own scope. Verify account scope
    // independently against the already-authorized tenant context.
    const scope = accountScope(account);
    if (scope.account_scope_type === 'personal' && scope.account_scope_id !== authorized.actor_person_id) {
        invalid('INTEGRATION_ACCOUNT_SCOPE_MISMATCH');
    }
    if (scope.account_scope_type === 'org' && !authorized.organization_ids.includes(scope.account_scope_id)) {
        invalid('INTEGRATION_ACCOUNT_SCOPE_MISMATCH');
    }
    if (scope.account_scope_type === 'project' && !authorized.project_ids.includes(scope.account_scope_id)) {
        invalid('INTEGRATION_ACCOUNT_SCOPE_MISMATCH');
    }
    return scope;
}

function opaqueCredentialRef(account) {
    const ref = account?.credential_ref;
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)
        || ref.provider !== OPAQUE_CREDENTIAL_PROVIDER
        || typeof ref.path !== 'string' || !CREDENTIAL_REF.test(ref.path)) {
        invalid('INTEGRATION_CREDENTIAL_REF_INVALID', { status: 503 });
    }
    return ref.path;
}

async function selectDefaultAtSpecificity(accountRepository, subjects, service, purpose) {
    const matches = [];
    for (const subject of subjects) {
        const defaults = await accountRepository.listDefaults(
            subject.subject_type,
            subject.subject_id,
            service,
            purpose
        );
        for (const selected of defaults) matches.push({ subject, selected });
    }

    // Match deterministic C/ASCII-style ordering used by the PostgreSQL repository.
    matches.sort((a, b) => (
        compareOpaqueIds(a.subject.subject_id, b.subject.subject_id)
        || compareOpaqueIds(a.selected.account_id, b.selected.account_id)
    ));

    const byAccountId = new Map();
    for (const match of matches) {
        const accountId = match.selected?.account_id;
        if (typeof accountId !== 'string' || !accountId) {
            invalid('INTEGRATION_ACCOUNT_INVALID', { status: 409 });
        }
        if (!byAccountId.has(accountId)) byAccountId.set(accountId, match);
    }

    if (byAccountId.size > 1) {
        invalid('INTEGRATION_ACCOUNT_AMBIGUOUS', {
            status: 409,
            details: {
                service,
                purpose,
                subject_type: subjects[0]?.subject_type,
                candidate_count: byAccountId.size
            }
        });
    }
    return byAccountId.values().next().value ?? null;
}

/**
 * @param {{
 *   accountRepository: { listDefaults: Function, findById: Function },
 *   context: { actor_person_id: string, organization_ids?: string[], project_ids?: string[] },
 *   service?: string,
 *   purpose?: string,
 *   requiredCapability?: string
 * }} input
 */
export async function resolveRuntimeIntegrationCredential({
    accountRepository,
    context,
    service = FREEE_SERVICE,
    purpose = DEFAULT_PURPOSE,
    requiredCapability = READ_CAPABILITY
}) {
    if (!accountRepository || typeof accountRepository.listDefaults !== 'function'
        || typeof accountRepository.findById !== 'function') {
        throw new Error('runtime integration account repository is required');
    }
    if (service !== FREEE_SERVICE) {
        invalid('INTEGRATION_SERVICE_UNSUPPORTED', { status: 400, details: { service } });
    }

    const authorized = normalizedContext(context);
    const specificityGroups = [
        authorized.project_ids.map((subject_id) => ({ subject_type: 'project', subject_id })),
        authorized.organization_ids.map((subject_id) => ({ subject_type: 'org', subject_id })),
        [{ subject_type: 'personal', subject_id: authorized.actor_person_id }]
    ];

    let match = null;
    for (const subjects of specificityGroups) {
        match = await selectDefaultAtSpecificity(accountRepository, subjects, service, purpose);
        if (match) break;
    }

    if (!match) {
        invalid('INTEGRATION_ACCOUNT_NOT_CONNECTED', {
            status: 404,
            details: { service, purpose }
        });
    }

    const { subject, selected } = match;
    const account = await accountRepository.findById(selected.account_id);
    if (!account || account.service !== service) {
        invalid('INTEGRATION_ACCOUNT_INVALID', { status: 409 });
    }
    const scope = assertAccountScope(account, authorized);
    if (account.status !== 'connected') {
        invalid(account.status === 'reauth_required'
            ? 'INTEGRATION_REAUTH_REQUIRED'
            : 'INTEGRATION_ACCOUNT_UNAVAILABLE', { status: 403 });
    }
    const capabilities = strings(account.capabilities);
    if (!capabilities.includes(requiredCapability)) {
        invalid('INTEGRATION_CAPABILITY_SCOPE_MISMATCH', {
            status: 403,
            details: { required_capability: requiredCapability }
        });
    }

    return Object.freeze({
        service,
        purpose,
        account_id: account.id,
        default_subject_type: subject.subject_type,
        default_subject_id: subject.subject_id,
        ...scope,
        credential_ref: opaqueCredentialRef(account),
        credential_mode: 'customer_oauth',
        capabilities: Object.freeze([...capabilities])
    });
}

export const FREEE_RUNTIME_INTEGRATION = Object.freeze({
    service: FREEE_SERVICE,
    purpose: DEFAULT_PURPOSE,
    required_capability: READ_CAPABILITY,
    credential_provider: OPAQUE_CREDENTIAL_PROVIDER
});
