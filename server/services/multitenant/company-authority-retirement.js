import { createHash } from 'node:crypto';

import { canonicalJson, deepFreeze } from './canonical-json.js';

const VERSION = 'company-authority-retirement.v1';
const TENANT_ID = /^ten_[0-9A-HJKMNP-TV-Z]{26}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const ROOT_KEYS = new Set([
    'version', 'tenant_id', 'tenant_key', 'organization_id', 'project_id',
    'memberships', 'external_identities', 'active_bindings'
]);
const MEMBERSHIP_KEYS = new Set(['membership_id', 'principal_id', 'expected_revision']);
const IDENTITY_KEYS = new Set([
    'identity_id', 'identity_revision', 'membership_id', 'provider',
    'authenticated_subject_id', 'workspace_id', 'app_id', 'project_id', 'placement_id'
]);
const BINDING_KEYS = new Set([
    'binding_id', 'binding_revision', 'membership_id', 'organization_id',
    'project_id', 'resource_ref', 'capability_id'
]);
const SECRET_KEY = /(?:access|refresh)[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?value|oauth[_-]?(?:token|code)|bearer[_-]?token/iu;
const SECRET_VALUE = /(?:^xox[baprs]-|^sk-[A-Za-z0-9]|^gh[pousr]_[A-Za-z0-9_]{20,}|^ya29\.[A-Za-z0-9_-]{20,}|^AKIA[A-Z0-9]{16}$|^Bearer\s+\S{20,}|-----BEGIN [A-Z ]+-----)/u;

export class CompanyAuthorityRetirementError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'CompanyAuthorityRetirementError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new CompanyAuthorityRetirementError(code, message);
}

function record(value, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('MANIFEST_INVALID', `${field} must be an object`);
    }
    return value;
}

function knownKeys(value, allowed, field) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) fail('MANIFEST_FIELD_FORBIDDEN', `${field}.${key} is not allowed`);
    }
}

function scanSecrets(value) {
    if (Array.isArray(value)) return value.forEach(scanSecrets);
    if (!value || typeof value !== 'object') {
        if (typeof value === 'string' && SECRET_VALUE.test(value)) {
            fail('MANIFEST_SECRET_FORBIDDEN', 'Manifest contains secret material');
        }
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        if (SECRET_KEY.test(key)) fail('MANIFEST_SECRET_FORBIDDEN', 'Manifest contains a secret field');
        scanSecrets(child);
    }
}

function text(value, field, pattern = IDENTIFIER, max = 255) {
    if (typeof value !== 'string' || value.length === 0 || value.length > max
        || /[\u0000-\u001f\u007f]/u.test(value) || (pattern && !pattern.test(value))) {
        fail('MANIFEST_INVALID', `${field} is invalid`);
    }
    return value;
}

function positiveRevision(value, field) {
    const normalized = String(value ?? '');
    if (!/^[1-9][0-9]*$/u.test(normalized)) fail('MANIFEST_INVALID', `${field} is invalid`);
    return normalized;
}

function unique(items, key, field) {
    if (new Set(items.map((item) => item[key])).size !== items.length) {
        fail('MANIFEST_INVALID', `${field} contains duplicate ${key}`);
    }
}

function normalizeMembership(value, index) {
    const field = `memberships[${index}]`;
    record(value, field);
    knownKeys(value, MEMBERSHIP_KEYS, field);
    return {
        membership_id: text(value.membership_id, `${field}.membership_id`),
        principal_id: text(value.principal_id, `${field}.principal_id`),
        expected_revision: positiveRevision(value.expected_revision, `${field}.expected_revision`)
    };
}

function normalizeIdentity(value, index) {
    const field = `external_identities[${index}]`;
    record(value, field);
    knownKeys(value, IDENTITY_KEYS, field);
    const provider = text(value.provider, `${field}.provider`);
    if (provider !== 'slack') fail('MANIFEST_INVALID', `${field}.provider must be slack`);
    return {
        identity_id: text(value.identity_id, `${field}.identity_id`),
        identity_revision: positiveRevision(value.identity_revision, `${field}.identity_revision`),
        membership_id: text(value.membership_id, `${field}.membership_id`),
        provider,
        authenticated_subject_id: text(value.authenticated_subject_id, `${field}.authenticated_subject_id`),
        workspace_id: text(value.workspace_id, `${field}.workspace_id`),
        app_id: text(value.app_id, `${field}.app_id`),
        project_id: text(value.project_id, `${field}.project_id`),
        placement_id: text(value.placement_id, `${field}.placement_id`)
    };
}

function normalizeBinding(value, index) {
    const field = `active_bindings[${index}]`;
    record(value, field);
    knownKeys(value, BINDING_KEYS, field);
    return {
        binding_id: text(value.binding_id, `${field}.binding_id`),
        binding_revision: positiveRevision(value.binding_revision, `${field}.binding_revision`),
        membership_id: text(value.membership_id, `${field}.membership_id`),
        organization_id: text(value.organization_id, `${field}.organization_id`),
        project_id: text(value.project_id, `${field}.project_id`),
        resource_ref: text(value.resource_ref, `${field}.resource_ref`),
        capability_id: text(value.capability_id, `${field}.capability_id`)
    };
}

export function normalizeCompanyAuthorityRetirementManifest(value) {
    scanSecrets(value);
    record(value, 'manifest');
    knownKeys(value, ROOT_KEYS, 'manifest');
    if (value.version !== VERSION) fail('MANIFEST_INVALID', 'manifest.version is invalid');
    if (!Array.isArray(value.memberships) || value.memberships.length === 0 || value.memberships.length > 32) {
        fail('MANIFEST_INVALID', 'memberships must be a bounded non-empty array');
    }
    if (!Array.isArray(value.external_identities) || value.external_identities.length === 0
        || value.external_identities.length > 64) {
        fail('MANIFEST_INVALID', 'external_identities must be a bounded non-empty array');
    }
    if (!Array.isArray(value.active_bindings) || value.active_bindings.length > 128) {
        fail('MANIFEST_INVALID', 'active_bindings must be a bounded array');
    }
    const memberships = value.memberships.map(normalizeMembership)
        .sort((left, right) => left.membership_id.localeCompare(right.membership_id));
    const externalIdentities = value.external_identities.map(normalizeIdentity)
        .sort((left, right) => left.identity_id.localeCompare(right.identity_id));
    const activeBindings = value.active_bindings.map(normalizeBinding)
        .sort((left, right) => left.binding_id.localeCompare(right.binding_id));
    unique(memberships, 'membership_id', 'memberships');
    unique(externalIdentities, 'identity_id', 'external_identities');
    unique(activeBindings, 'binding_id', 'active_bindings');
    const membershipIds = new Set(memberships.map(({ membership_id: id }) => id));
    const projectId = text(value.project_id, 'project_id');
    for (const [index, identity] of externalIdentities.entries()) {
        if (!membershipIds.has(identity.membership_id)) {
            fail('MANIFEST_SCOPE_MISMATCH', `external_identities[${index}] has an undeclared membership`);
        }
        if (identity.project_id !== projectId) {
            fail('MANIFEST_SCOPE_MISMATCH', `external_identities[${index}] has a different project`);
        }
    }
    for (const [index, binding] of activeBindings.entries()) {
        if (!membershipIds.has(binding.membership_id)
            || binding.organization_id !== text(value.organization_id, 'organization_id')
            || binding.project_id !== projectId) {
            fail('MANIFEST_SCOPE_MISMATCH', `active_bindings[${index}] crosses the declared scope`);
        }
    }
    return deepFreeze({
        version: VERSION,
        tenant_id: text(value.tenant_id, 'tenant_id', TENANT_ID),
        tenant_key: text(value.tenant_key, 'tenant_key', /^[a-z][a-z0-9-]{1,62}$/u, 63),
        organization_id: text(value.organization_id, 'organization_id'),
        project_id: projectId,
        memberships,
        external_identities: externalIdentities,
        active_bindings: activeBindings
    });
}

export function companyAuthorityRetirementSha256(manifest) {
    return createHash('sha256').update(canonicalJson(manifest)).digest('hex');
}

function operationId(manifest, idempotencyKey) {
    return `op_${createHash('sha256').update(canonicalJson({
        tenant_key: manifest.tenant_key,
        idempotency_key: idempotencyKey,
        desired_state_sha256: companyAuthorityRetirementSha256(manifest)
    })).digest('hex').slice(0, 32)}`;
}

function sortedIds(rows, key) {
    return rows.map((row) => row[key]).sort((left, right) => left.localeCompare(right));
}

function requireExactIds(actualRows, expectedIds, key, code) {
    if (canonicalJson(sortedIds(actualRows, key)) !== canonicalJson([...expectedIds].sort())) {
        fail(code, 'Active authority rows differ from the manifest');
    }
}

function sameIdentity(row, expected) {
    return row.identity_id === expected.identity_id
        && String(row.identity_revision) === expected.identity_revision
        && row.membership_id === expected.membership_id
        && row.provider === expected.provider
        && row.authenticated_subject_id === expected.authenticated_subject_id
        && row.workspace_id === expected.workspace_id
        && row.app_id === expected.app_id
        && row.project_id === expected.project_id
        && row.placement_id === expected.placement_id
        && row.status === 'active';
}

function sameBinding(row, expected) {
    return row.binding_id === expected.binding_id
        && String(row.binding_revision) === expected.binding_revision
        && row.membership_id === expected.membership_id
        && row.organization_id === expected.organization_id
        && row.project_id === expected.project_id
        && row.resource_ref === expected.resource_ref
        && row.capability_id === expected.capability_id
        && row.status === 'active';
}

async function readAndValidateCurrentState(client, manifest) {
    const tenant = (await client.query(
        `SELECT tenant_id, tenant_key, status FROM brainbase_tenants
          WHERE tenant_id = $1 FOR UPDATE`, [manifest.tenant_id])).rows[0];
    if (!tenant || tenant.tenant_key !== manifest.tenant_key) {
        fail('TENANT_MISMATCH', 'Tenant ID and key do not identify one tenant');
    }
    if (tenant.status !== 'active') fail('TENANT_INACTIVE', 'Tenant must be active');

    const organization = (await client.query(
        `SELECT organization_id FROM tenant_organizations
          WHERE tenant_id = $1 AND organization_id = $2 FOR SHARE`,
        [manifest.tenant_id, manifest.organization_id])).rows;
    if (organization.length !== 1) fail('ORGANIZATION_NOT_FOUND', 'Organization was not found in the tenant');
    const project = (await client.query(
        `SELECT project_id FROM tenant_projects
          WHERE tenant_id = $1 AND project_id = $2 FOR SHARE`,
        [manifest.tenant_id, manifest.project_id])).rows;
    if (project.length !== 1) fail('PROJECT_NOT_FOUND', 'Project was not found in the tenant');

    const membershipIds = manifest.memberships.map(({ membership_id: id }) => id);
    const memberships = (await client.query(
        `SELECT membership_id, organization_id, principal_id,
                membership_payload->>'status' AS status,
                membership_payload->>'revision' AS revision
           FROM tenant_memberships
          WHERE tenant_id = $1 AND membership_id = ANY($2::text[])
          ORDER BY membership_id FOR UPDATE`, [manifest.tenant_id, membershipIds])).rows;
    requireExactIds(memberships, membershipIds, 'membership_id', 'MEMBERSHIP_SET_MISMATCH');
    for (const expected of manifest.memberships) {
        const row = memberships.find(({ membership_id: id }) => id === expected.membership_id);
        if (row.organization_id !== manifest.organization_id || row.principal_id !== expected.principal_id
            || row.status !== 'active' || String(row.revision) !== expected.expected_revision) {
            fail('MEMBERSHIP_STATE_MISMATCH', 'Membership state differs from the manifest');
        }
    }

    const identities = (await client.query(
        `SELECT identity_id, identity_revision, membership_id, provider,
                authenticated_subject_id, workspace_id, app_id, project_id,
                placement_id, status
           FROM company_external_identities
          WHERE tenant_id = $1 AND membership_id = ANY($2::text[]) AND status = 'active'
          ORDER BY identity_id FOR UPDATE`, [manifest.tenant_id, membershipIds])).rows;
    requireExactIds(identities, manifest.external_identities.map(({ identity_id: id }) => id),
        'identity_id', 'ACTIVE_IDENTITY_SET_MISMATCH');
    for (const expected of manifest.external_identities) {
        const row = identities.find(({ identity_id: id }) => id === expected.identity_id);
        if (!row || !sameIdentity(row, expected)) {
            fail('IDENTITY_STATE_MISMATCH', 'External identity state differs from the manifest');
        }
    }

    const bindings = (await client.query(
        `SELECT binding_id, binding_revision, membership_id, organization_id,
                project_id, resource_ref, capability_id, status
           FROM company_authority_bindings
          WHERE tenant_id = $1 AND membership_id = ANY($2::text[]) AND status = 'active'
          ORDER BY binding_id FOR UPDATE`, [manifest.tenant_id, membershipIds])).rows;
    requireExactIds(bindings, manifest.active_bindings.map(({ binding_id: id }) => id),
        'binding_id', 'ACTIVE_BINDING_SET_MISMATCH');
    for (const expected of manifest.active_bindings) {
        const row = bindings.find(({ binding_id: id }) => id === expected.binding_id);
        if (!row || !sameBinding(row, expected)) {
            fail('BINDING_STATE_MISMATCH', 'Authority binding state differs from the manifest');
        }
    }
    return { memberships, identities, bindings };
}

async function readRetiredState(client, manifest) {
    const membershipIds = manifest.memberships.map(({ membership_id: id }) => id);
    const identityIds = manifest.external_identities.map(({ identity_id: id }) => id);
    const memberships = (await client.query(
        `SELECT membership_id, membership_payload->>'status' AS status,
                membership_payload->>'revision' AS revision
           FROM tenant_memberships
          WHERE tenant_id = $1 AND membership_id = ANY($2::text[])
          ORDER BY membership_id`, [manifest.tenant_id, membershipIds])).rows;
    const identities = (await client.query(
        `SELECT identity_id, status FROM company_external_identities
          WHERE tenant_id = $1 AND identity_id = ANY($2::text[])
          ORDER BY identity_id`, [manifest.tenant_id, identityIds])).rows;
    const bindingIds = manifest.active_bindings.map(({ binding_id: id }) => id);
    const bindings = bindingIds.length === 0 ? [] : (await client.query(
        `SELECT binding_id, status FROM company_authority_bindings
          WHERE tenant_id = $1 AND binding_id = ANY($2::text[])
          ORDER BY binding_id`, [manifest.tenant_id, bindingIds])).rows;
    const remainingActiveIdentities = (await client.query(
        `SELECT identity_id FROM company_external_identities
          WHERE tenant_id = $1 AND membership_id = ANY($2::text[]) AND status = 'active'`,
        [manifest.tenant_id, membershipIds])).rows;
    const remainingActiveBindings = (await client.query(
        `SELECT binding_id FROM company_authority_bindings
          WHERE tenant_id = $1 AND membership_id = ANY($2::text[]) AND status = 'active'`,
        [manifest.tenant_id, membershipIds])).rows;

    requireExactIds(memberships, membershipIds, 'membership_id', 'RETIREMENT_READBACK_FAILED');
    requireExactIds(identities, identityIds, 'identity_id', 'RETIREMENT_READBACK_FAILED');
    requireExactIds(bindings, bindingIds, 'binding_id', 'RETIREMENT_READBACK_FAILED');
    for (const expected of manifest.memberships) {
        const row = memberships.find(({ membership_id: id }) => id === expected.membership_id);
        if (row.status !== 'inactive' || String(row.revision) !== String(BigInt(expected.expected_revision) + 1n)) {
            fail('RETIREMENT_READBACK_FAILED', 'Membership retirement was not read back exactly');
        }
    }
    if (identities.some(({ status }) => status !== 'revoked')
        || bindings.some(({ status }) => status !== 'revoked')
        || remainingActiveIdentities.length !== 0 || remainingActiveBindings.length !== 0) {
        fail('RETIREMENT_READBACK_FAILED', 'Authority retirement was only partially applied');
    }

    const routes = [];
    for (const identity of manifest.external_identities) {
        const result = await client.query(
            `SELECT tenant_id, connection_id
               FROM public.resolve_company_authority_route($1, $2, $3, $4, NULL, $5)`,
            [identity.provider, identity.authenticated_subject_id, identity.workspace_id,
                identity.app_id, identity.project_id]);
        if (result.rows.length !== 0) {
            fail('RUNTIME_ROUTE_STILL_ACTIVE', 'A retired external identity still resolves at runtime');
        }
        routes.push({ identity_id: identity.identity_id, route_count: 0 });
    }
    return { memberships, external_identities: identities, authority_bindings: bindings, runtime_routes: routes };
}

export async function readbackCompanyAuthorityRetirement({
    client,
    manifest: inputManifest,
    idempotencyKey
}) {
    const manifest = normalizeCompanyAuthorityRetirementManifest(inputManifest);
    const normalizedKey = text(idempotencyKey, 'idempotency_key', /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,254}$/u);
    const desiredStateSha256 = companyAuthorityRetirementSha256(manifest);
    const operationIdValue = operationId(manifest, normalizedKey);
    let transactionStarted = false;
    try {
        await client.query('BEGIN READ ONLY');
        transactionStarted = true;
        await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [manifest.tenant_id]);
        const readback = await readRetiredState(client, manifest);
        const operation = (await client.query(
            `SELECT operation_id, tenant_key, idempotency_key, desired_state_sha256,
                    status, receipt_payload
               FROM tenant_provisioning_operations
              WHERE operation_id = $1 AND tenant_key = $2 AND idempotency_key = $3`,
            [operationIdValue, manifest.tenant_key, normalizedKey])).rows;
        if (operation.length !== 1) {
            fail('RETIREMENT_LEDGER_READBACK_FAILED', 'Retirement operation ledger row was not read back exactly');
        }
        const ledger = operation[0];
        if (ledger.desired_state_sha256 !== desiredStateSha256 || ledger.status !== 'applied'
            || !ledger.receipt_payload
            || ledger.receipt_payload.operation_id !== operationIdValue
            || ledger.receipt_payload.desired_state_sha256 !== desiredStateSha256
            || ledger.receipt_payload.outcome !== 'succeeded') {
            fail('RETIREMENT_LEDGER_READBACK_FAILED', 'Retirement operation ledger receipt is incomplete or inconsistent');
        }
        await client.query('COMMIT');
        transactionStarted = false;
        return {
            ...readback,
            operation: {
                operation_id: ledger.operation_id,
                status: ledger.status,
                desired_state_sha256: ledger.desired_state_sha256,
                receipt: ledger.receipt_payload
            }
        };
    } catch (error) {
        if (transactionStarted) {
            try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
        }
        throw error;
    }
}

export async function retireCompanyAuthority({
    client,
    manifest: inputManifest,
    idempotencyKey,
    actorId,
    commit = false,
    now = new Date()
}) {
    const manifest = normalizeCompanyAuthorityRetirementManifest(inputManifest);
    const normalizedKey = text(idempotencyKey, 'idempotency_key', /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,254}$/u);
    const normalizedActor = text(actorId, 'actor_id');
    const desiredStateSha256 = companyAuthorityRetirementSha256(manifest);
    const operationIdValue = operationId(manifest, normalizedKey);
    let transactionStarted = false;
    try {
        await client.query('BEGIN');
        transactionStarted = true;
        await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [manifest.tenant_id]);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [manifest.tenant_id]);

        if (commit) {
            const existing = (await client.query(
                `SELECT operation_id, desired_state_sha256, status, receipt_payload
                   FROM tenant_provisioning_operations
                  WHERE tenant_key = $1 AND idempotency_key = $2 FOR UPDATE`,
                [manifest.tenant_key, normalizedKey])).rows[0] ?? null;
            if (existing) {
                if (existing.desired_state_sha256 !== desiredStateSha256) {
                    fail('IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to a different manifest');
                }
                if (existing.status !== 'applied' || !existing.receipt_payload) {
                    fail('OPERATION_NOT_TERMINAL', 'Existing retirement operation is not safely replayable');
                }
                await client.query('ROLLBACK');
                transactionStarted = false;
                return { persisted: true, replayed: true, receipt: existing.receipt_payload };
            }
        }

        const current = await readAndValidateCurrentState(client, manifest);
        if (commit) {
            await client.query(
                `INSERT INTO tenant_provisioning_operations (
                    operation_id, tenant_key, idempotency_key, desired_state_sha256,
                    status, actor_principal_id, attempt, created_at, updated_at
                 ) VALUES ($1, $2, $3, $4, 'claimed', $5, 1, $6, $6)`,
                [operationIdValue, manifest.tenant_key, normalizedKey, desiredStateSha256, normalizedActor, now]);
        }

        const identityIds = manifest.external_identities.map(({ identity_id: id }) => id);
        const identityUpdate = await client.query(
            `UPDATE company_external_identities SET status = 'revoked', updated_at = $3
              WHERE tenant_id = $1 AND identity_id = ANY($2::text[]) AND status = 'active'`,
            [manifest.tenant_id, identityIds, now]);
        if (identityUpdate.rowCount !== identityIds.length) {
            fail('IDENTITY_UPDATE_MISMATCH', 'Not every declared external identity was revoked');
        }

        const bindingIds = manifest.active_bindings.map(({ binding_id: id }) => id);
        if (bindingIds.length > 0) {
            const bindingUpdate = await client.query(
                `UPDATE company_authority_bindings SET status = 'revoked', updated_at = $3
                  WHERE tenant_id = $1 AND binding_id = ANY($2::text[]) AND status = 'active'`,
                [manifest.tenant_id, bindingIds, now]);
            if (bindingUpdate.rowCount !== bindingIds.length) {
                fail('BINDING_UPDATE_MISMATCH', 'Not every declared authority binding was revoked');
            }
        }

        for (const membership of manifest.memberships) {
            const nextRevision = String(BigInt(membership.expected_revision) + 1n);
            const result = await client.query(
                `UPDATE tenant_memberships
                    SET membership_payload = jsonb_set(
                        jsonb_set(membership_payload, '{status}', to_jsonb('inactive'::text), true),
                        '{revision}', to_jsonb($6::text), true
                    )
                  WHERE tenant_id = $1 AND membership_id = $2 AND organization_id = $3
                    AND principal_id = $4 AND membership_payload->>'status' = 'active'
                    AND membership_payload->>'revision' = $5`,
                [manifest.tenant_id, membership.membership_id, manifest.organization_id,
                    membership.principal_id, membership.expected_revision, nextRevision]);
            if (result.rowCount !== 1) {
                fail('MEMBERSHIP_UPDATE_MISMATCH', 'A declared membership was not retired');
            }
        }

        const transactionReadback = await readRetiredState(client, manifest);
        const receipt = {
            schema_version: 'company-authority-retirement-receipt.v1',
            operation_id: operationIdValue,
            tenant_id: manifest.tenant_id,
            tenant_key: manifest.tenant_key,
            organization_id: manifest.organization_id,
            project_id: manifest.project_id,
            actor_principal_id: normalizedActor,
            desired_state_sha256: desiredStateSha256,
            outcome: 'succeeded',
            retired_membership_ids: manifest.memberships.map(({ membership_id: id }) => id),
            revoked_external_identity_ids: identityIds,
            revoked_binding_ids: bindingIds,
            runtime_route_count: 0,
            observed_counts_before: {
                memberships: current.memberships.length,
                active_external_identities: current.identities.length,
                active_authority_bindings: current.bindings.length
            },
            completed_at: now.toISOString()
        };
        if (commit) {
            const result = await client.query(
                `UPDATE tenant_provisioning_operations
                    SET status = 'applied', receipt_payload = $2::jsonb,
                        completed_at = $3, updated_at = $3
                  WHERE operation_id = $1 AND status = 'claimed'`,
                [operationIdValue, JSON.stringify(receipt), now]);
            if (result.rowCount !== 1) fail('OPERATION_UPDATE_MISMATCH', 'Retirement receipt was not persisted');
        }
        await client.query(commit ? 'COMMIT' : 'ROLLBACK');
        transactionStarted = false;
        return { persisted: commit, replayed: false, receipt, transaction_readback: transactionReadback };
    } catch (error) {
        if (transactionStarted) {
            try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
        }
        if (error instanceof CompanyAuthorityRetirementError) throw error;
        throw new CompanyAuthorityRetirementError(
            'AUTHORITY_RETIREMENT_FAILED', 'Company authority retirement failed; inspect operator logs'
        );
    }
}
