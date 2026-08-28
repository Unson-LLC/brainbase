import { createHash } from 'node:crypto';

import { canonicalJson, deepFreeze } from './canonical-json.js';

const MANIFEST_VERSION = 'service-company-authority.v1';
const TENANT_ID = /^ten_[0-9A-HJKMNP-TV-Z]{26}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const ACTOR_ID = /^[a-z][a-z0-9_-]{2,127}$/u;
const REGISTRY_CAPABILITY = /^[a-z][a-z0-9_:-]{1,63}$/u;
const COMPANY_CAPABILITY = /^[a-z][a-z0-9_.:-]{1,127}$/u;
const REVISION = /^(0|[1-9][0-9]*)$/u;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const ALLOWED_EFFECTS = new Set(['read', 'write', 'external_side_effect']);
const DECISIONS = new Set(['auto', 'approval', 'human_action', 'deny']);
const ROOT_KEYS = new Set(['version', 'tenant_id', 'organization_id', 'project', 'transport', 'service_actor']);
const PROJECT_KEYS = new Set(['project_id', 'project_code']);
const TRANSPORT_KEYS = new Set(['workspace_id', 'app_id']);
const ACTOR_KEYS = new Set(['actor_id', 'placement_id', 'bindings']);
const BINDING_KEYS = new Set([
    'registry_capability', 'resource_ref', 'capability_id', 'decision', 'allowed_effects',
    'responsible_person_id', 'accountable_person_id', 'approver_person_id',
    'delegated_by_person_id', 'resource_revision', 'policy_revision', 'raci_revision',
    'stop_conditions', 'valid_from', 'valid_until'
]);
const SECRET_KEY = /(?:access|refresh)[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?value|oauth[_-]?token|bearer[_-]?token/iu;
const SECRET_VALUE = /(?:^xox[baprs]-|^sk-[A-Za-z0-9]|-----BEGIN [A-Z ]+-----)/u;

export class ServiceCompanyAuthorityProvisioningError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ServiceCompanyAuthorityProvisioningError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new ServiceCompanyAuthorityProvisioningError(code, message);
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
    if (Array.isArray(value)) {
        value.forEach(scanSecrets);
        return;
    }
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

function text(value, field, pattern = IDENTIFIER, max = 500) {
    if (typeof value !== 'string' || value.length === 0 || value.length > max
        || /[\u0000-\u001f\u007f]/u.test(value) || !pattern.test(value)) {
        fail('MANIFEST_INVALID', `${field} is invalid`);
    }
    return value;
}

function nullableText(value, field) {
    if (value === undefined || value === null) return null;
    return text(value, field);
}

function revision(value, field, { positive = false } = {}) {
    if (typeof value !== 'string' || !REVISION.test(value) || (positive && value === '0')) {
        fail('MANIFEST_INVALID', `${field} is invalid`);
    }
    return value;
}

function timestamp(value, field, { nullable = false } = {}) {
    if (nullable && (value === undefined || value === null)) return null;
    if (typeof value !== 'string' || !RFC3339_UTC.test(value) || !Number.isFinite(Date.parse(value))) {
        fail('MANIFEST_INVALID', `${field} is invalid`);
    }
    return value;
}

function stringArray(value, field, { allowed = null, max = 32 } = {}) {
    if (!Array.isArray(value) || value.length === 0 || value.length > max) {
        fail('MANIFEST_INVALID', `${field} must be a bounded non-empty array`);
    }
    const normalized = value.map((item, index) => {
        const result = text(item, `${field}[${index}]`);
        if (allowed && !allowed.has(result)) fail('MANIFEST_INVALID', `${field}[${index}] is not allowed`);
        return result;
    });
    if (new Set(normalized).size !== normalized.length) fail('MANIFEST_INVALID', `${field} contains duplicates`);
    return normalized.sort((left, right) => left.localeCompare(right));
}

function normalizeBinding(value, index) {
    const field = `service_actor.bindings[${index}]`;
    record(value, field);
    knownKeys(value, BINDING_KEYS, field);
    const decision = text(value.decision, `${field}.decision`);
    if (!DECISIONS.has(decision)) fail('MANIFEST_INVALID', `${field}.decision is invalid`);
    const allowedEffects = stringArray(value.allowed_effects, `${field}.allowed_effects`, { allowed: ALLOWED_EFFECTS });
    const validFrom = timestamp(value.valid_from, `${field}.valid_from`);
    const validUntil = timestamp(value.valid_until, `${field}.valid_until`, { nullable: true });
    if (validUntil && Date.parse(validUntil) <= Date.parse(validFrom)) {
        fail('MANIFEST_INVALID', `${field}.valid_until must be after valid_from`);
    }
    const responsiblePersonId = nullableText(value.responsible_person_id, `${field}.responsible_person_id`);
    const approverPersonId = nullableText(value.approver_person_id, `${field}.approver_person_id`);
    if (decision === 'human_action' && !responsiblePersonId) {
        fail('MANIFEST_INVALID', `${field}.responsible_person_id is required for human_action`);
    }
    if (decision === 'approval' && !approverPersonId) {
        fail('MANIFEST_INVALID', `${field}.approver_person_id is required for approval`);
    }
    const stopConditions = value.stop_conditions === undefined
        ? []
        : stringArray(value.stop_conditions, `${field}.stop_conditions`, { max: 32 });
    return {
        registry_capability: text(value.registry_capability, `${field}.registry_capability`, REGISTRY_CAPABILITY),
        resource_ref: text(value.resource_ref, `${field}.resource_ref`, /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,499}$/u),
        capability_id: text(value.capability_id, `${field}.capability_id`, COMPANY_CAPABILITY),
        decision,
        allowed_effects: allowedEffects,
        responsible_person_id: responsiblePersonId,
        accountable_person_id: nullableText(value.accountable_person_id, `${field}.accountable_person_id`),
        approver_person_id: approverPersonId,
        delegated_by_person_id: nullableText(value.delegated_by_person_id, `${field}.delegated_by_person_id`),
        resource_revision: revision(value.resource_revision, `${field}.resource_revision`),
        policy_revision: revision(value.policy_revision, `${field}.policy_revision`),
        raci_revision: revision(value.raci_revision, `${field}.raci_revision`),
        stop_conditions: stopConditions,
        valid_from: validFrom,
        valid_until: validUntil
    };
}

export function normalizeServiceCompanyAuthorityManifest(value) {
    scanSecrets(value);
    record(value, 'manifest');
    knownKeys(value, ROOT_KEYS, 'manifest');
    if (value.version !== MANIFEST_VERSION) fail('MANIFEST_INVALID', 'manifest.version is invalid');
    const project = record(value.project, 'project');
    knownKeys(project, PROJECT_KEYS, 'project');
    const transport = record(value.transport, 'transport');
    knownKeys(transport, TRANSPORT_KEYS, 'transport');
    const serviceActor = record(value.service_actor, 'service_actor');
    knownKeys(serviceActor, ACTOR_KEYS, 'service_actor');
    if (!Array.isArray(serviceActor.bindings) || serviceActor.bindings.length === 0 || serviceActor.bindings.length > 32) {
        fail('MANIFEST_INVALID', 'service_actor.bindings must be a bounded non-empty array');
    }
    const bindings = serviceActor.bindings.map(normalizeBinding);
    const naturalKeys = bindings.map((binding) => `${binding.resource_ref}\u0000${binding.capability_id}`);
    if (new Set(naturalKeys).size !== naturalKeys.length) {
        fail('MANIFEST_INVALID', 'service_actor.bindings contains duplicate resource/capability pairs');
    }
    return deepFreeze({
        version: MANIFEST_VERSION,
        tenant_id: text(value.tenant_id, 'tenant_id', TENANT_ID),
        organization_id: text(value.organization_id, 'organization_id'),
        project: {
            project_id: text(project.project_id, 'project.project_id'),
            project_code: text(project.project_code, 'project.project_code')
        },
        transport: {
            workspace_id: text(transport.workspace_id, 'transport.workspace_id'),
            app_id: text(transport.app_id, 'transport.app_id')
        },
        service_actor: {
            actor_id: text(serviceActor.actor_id, 'service_actor.actor_id', ACTOR_ID),
            placement_id: text(serviceActor.placement_id, 'service_actor.placement_id'),
            bindings
        }
    });
}

function stableId(prefix, parts) {
    return `${prefix}_${createHash('sha256').update(canonicalJson(parts)).digest('hex').slice(0, 32)}`;
}

function membershipPayload(manifest) {
    return {
        status: 'active',
        revision: '1',
        principal_type: 'service',
        actor_id: manifest.service_actor.actor_id,
        placement_id: manifest.service_actor.placement_id
    };
}

function bindingShape(row) {
    if (!row) return null;
    return {
        binding_id: row.binding_id,
        binding_revision: String(row.binding_revision),
        membership_id: row.membership_id,
        organization_id: row.organization_id,
        project_id: row.project_id,
        resource_ref: row.resource_ref,
        resource_revision: String(row.resource_revision),
        capability_id: row.capability_id,
        decision: row.decision,
        allowed_effects: [...row.allowed_effects].sort((left, right) => left.localeCompare(right)),
        responsible_person_id: row.responsible_person_id ?? null,
        accountable_person_id: row.accountable_person_id ?? null,
        approver_person_id: row.approver_person_id ?? null,
        delegated_by_person_id: row.delegated_by_person_id ?? null,
        policy_revision: String(row.policy_revision),
        raci_revision: String(row.raci_revision),
        stop_conditions: [...(row.stop_conditions ?? [])].sort((left, right) => left.localeCompare(right)),
        status: row.status,
        valid_from: new Date(row.valid_from).toISOString(),
        valid_until: row.valid_until ? new Date(row.valid_until).toISOString() : null
    };
}

function same(left, right) {
    return canonicalJson(left) === canonicalJson(right);
}

function publicMembership(row) {
    if (!row) return null;
    return {
        membership_id: row.membership_id,
        organization_id: row.organization_id,
        principal_id: row.principal_id,
        membership_payload: row.membership_payload
    };
}

function publicIdentity(row) {
    if (!row) return null;
    return {
        identity_id: row.identity_id,
        identity_revision: String(row.identity_revision),
        provider: row.provider,
        authenticated_subject_id: row.authenticated_subject_id,
        workspace_id: row.workspace_id,
        app_id: row.app_id,
        membership_id: row.membership_id,
        project_id: row.project_id,
        placement_id: row.placement_id,
        principal_type: row.principal_type,
        status: row.status
    };
}

async function rows(client, sql, parameters) {
    const result = await client.query(sql, parameters);
    return Array.isArray(result?.rows) ? result.rows : [];
}

function expectOne(values, code) {
    if (values.length !== 1) fail(code, code);
    return values[0];
}

async function readFoundation(client, manifest) {
    const tenant = expectOne(await rows(client,
        `SELECT tenant_id, tenant_key, tenant_revision, status
           FROM brainbase_tenants
          WHERE tenant_id = $1
          FOR UPDATE`,
        [manifest.tenant_id]), 'TENANT_NOT_FOUND');
    if (tenant.status !== 'active') fail('TENANT_INACTIVE', 'Tenant must be active');

    const organization = expectOne(await rows(client,
        `SELECT organization_id
           FROM tenant_organizations
          WHERE tenant_id = $1 AND organization_id = $2
          FOR SHARE`,
        [manifest.tenant_id, manifest.organization_id]), 'ORGANIZATION_NOT_FOUND');

    const project = expectOne(await rows(client,
        `SELECT project_id, project_code
           FROM tenant_projects
          WHERE tenant_id = $1 AND project_id = $2 AND project_code = $3
          FOR SHARE`,
        [manifest.tenant_id, manifest.project.project_id, manifest.project.project_code]), 'PROJECT_NOT_FOUND');

    const actor = expectOne(await rows(client,
        `SELECT actor_id, tenant_key, canonical_project_id, status
           FROM brainbase_service_actors
          WHERE actor_id = $1 AND tenant_key = $2
          FOR SHARE`,
        [manifest.service_actor.actor_id, tenant.tenant_key]), 'SERVICE_ACTOR_NOT_FOUND');
    if (actor.status !== 'active') fail('SERVICE_ACTOR_INACTIVE', 'Service actor must be active');
    if (actor.canonical_project_id !== project.project_id) {
        fail('SERVICE_ACTOR_PROJECT_MISMATCH', 'Service actor canonical project does not match the authority project');
    }

    for (const binding of manifest.service_actor.bindings) {
        const capability = await rows(client,
            `SELECT grant_row.capability_id
               FROM brainbase_service_actor_capabilities grant_row
               JOIN brainbase_capabilities capability
                 ON capability.capability_id = grant_row.capability_id
              WHERE grant_row.actor_id = $1
                AND grant_row.tenant_key = $2
                AND grant_row.capability_id = $3
                AND grant_row.status = 'active'
                AND capability.status = 'active'
              FOR SHARE OF grant_row, capability`,
            [manifest.service_actor.actor_id, tenant.tenant_key, binding.registry_capability]);
        if (capability.length !== 1) {
            fail('SERVICE_CAPABILITY_NOT_GRANTED', `Registry capability ${binding.registry_capability} is not active`);
        }
    }
    return { tenant, organization, project, actor };
}

async function readMembership(client, manifest) {
    return rows(client,
        `SELECT membership_id, organization_id, principal_id, membership_payload
           FROM tenant_memberships
          WHERE tenant_id = $1
            AND organization_id = $2
            AND principal_id = $3
          ORDER BY membership_id
          LIMIT 2
          FOR UPDATE`,
        [manifest.tenant_id, manifest.organization_id, manifest.service_actor.actor_id]);
}

async function readIdentities(client, manifest) {
    return rows(client,
        `SELECT identity_id, identity_revision, provider, authenticated_subject_id,
                workspace_id, app_id, membership_id, project_id, placement_id,
                principal_type, status
           FROM company_external_identities
          WHERE tenant_id = $1
            AND provider = 'service'
            AND authenticated_subject_id = $2
            AND workspace_id = $3
            AND app_id = $4
            AND project_id = $5
          ORDER BY identity_revision DESC
          LIMIT 2
          FOR UPDATE`,
        [
            manifest.tenant_id,
            manifest.service_actor.actor_id,
            manifest.transport.workspace_id,
            manifest.transport.app_id,
            manifest.project.project_id
        ]);
}

async function readBindings(client, manifest, membershipId, binding) {
    return rows(client,
        `SELECT binding_id, binding_revision, membership_id, organization_id,
                project_id, resource_ref, resource_revision, capability_id,
                decision, allowed_effects, responsible_person_id,
                accountable_person_id, approver_person_id, delegated_by_person_id,
                policy_revision, raci_revision, stop_conditions, status,
                valid_from, valid_until
           FROM company_authority_bindings
          WHERE tenant_id = $1
            AND membership_id = $2
            AND organization_id = $3
            AND project_id = $4
            AND resource_ref = $5
            AND capability_id = $6
          ORDER BY binding_revision DESC
          LIMIT 2
          FOR UPDATE`,
        [
            manifest.tenant_id,
            membershipId,
            manifest.organization_id,
            manifest.project.project_id,
            binding.resource_ref,
            binding.capability_id
        ]);
}

function desiredIdentity(manifest, membershipId, revisionNumber) {
    return {
        identity_id: stableId('svc_identity', [
            manifest.tenant_id,
            manifest.service_actor.actor_id,
            manifest.transport.workspace_id,
            manifest.transport.app_id,
            manifest.project.project_id,
            revisionNumber
        ]),
        identity_revision: String(revisionNumber),
        provider: 'service',
        authenticated_subject_id: manifest.service_actor.actor_id,
        workspace_id: manifest.transport.workspace_id,
        app_id: manifest.transport.app_id,
        membership_id: membershipId,
        project_id: manifest.project.project_id,
        placement_id: manifest.service_actor.placement_id,
        principal_type: 'service',
        status: 'active'
    };
}

function desiredBinding(manifest, membershipId, binding, revisionNumber) {
    return {
        binding_id: stableId('svc_binding', [
            manifest.tenant_id,
            membershipId,
            manifest.organization_id,
            manifest.project.project_id,
            binding.resource_ref,
            binding.capability_id,
            revisionNumber
        ]),
        binding_revision: String(revisionNumber),
        membership_id: membershipId,
        organization_id: manifest.organization_id,
        project_id: manifest.project.project_id,
        resource_ref: binding.resource_ref,
        resource_revision: binding.resource_revision,
        capability_id: binding.capability_id,
        decision: binding.decision,
        allowed_effects: binding.allowed_effects,
        responsible_person_id: binding.responsible_person_id,
        accountable_person_id: binding.accountable_person_id,
        approver_person_id: binding.approver_person_id,
        delegated_by_person_id: binding.delegated_by_person_id,
        policy_revision: binding.policy_revision,
        raci_revision: binding.raci_revision,
        stop_conditions: binding.stop_conditions,
        status: 'active',
        valid_from: binding.valid_from,
        valid_until: binding.valid_until
    };
}

async function preparePlan(client, manifest, tenantRevision) {
    const plan = [];
    const membershipRows = await readMembership(client, manifest);
    if (membershipRows.length > 1) fail('SERVICE_MEMBERSHIP_AMBIGUOUS', 'Multiple service memberships exist');
    const desiredMembershipPayload = membershipPayload(manifest);
    let membershipId;
    if (membershipRows.length === 1) {
        const existing = publicMembership(membershipRows[0]);
        const expected = {
            membership_id: existing.membership_id,
            organization_id: manifest.organization_id,
            principal_id: manifest.service_actor.actor_id,
            membership_payload: desiredMembershipPayload
        };
        if (!same(existing, expected)) fail('SERVICE_MEMBERSHIP_CONFLICT', 'Existing service membership differs from desired state');
        membershipId = existing.membership_id;
        plan.push({ operation: 'noop', entity: 'tenant_membership', id: membershipId });
    } else {
        membershipId = stableId('svc_membership', [manifest.tenant_id, manifest.organization_id, manifest.service_actor.actor_id]);
        await client.query(
            `INSERT INTO tenant_memberships (
                membership_id, tenant_id, tenant_revision_at_write,
                organization_id, principal_id, membership_payload
             ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
                membershipId,
                manifest.tenant_id,
                tenantRevision,
                manifest.organization_id,
                manifest.service_actor.actor_id,
                JSON.stringify(desiredMembershipPayload)
            ]
        );
        plan.push({ operation: 'create', entity: 'tenant_membership', id: membershipId });
    }

    const identityRows = await readIdentities(client, manifest);
    const activeIdentities = identityRows.filter((row) => row.status === 'active');
    if (activeIdentities.length > 1) fail('SERVICE_IDENTITY_AMBIGUOUS', 'Multiple active service identities exist');
    if (activeIdentities.length === 1) {
        const existing = publicIdentity(activeIdentities[0]);
        const expected = desiredIdentity(manifest, membershipId, Number(existing.identity_revision));
        expected.identity_id = existing.identity_id;
        if (!same(existing, expected)) fail('SERVICE_IDENTITY_CONFLICT', 'Existing active service identity differs from desired state');
        plan.push({ operation: 'noop', entity: 'company_external_identity', id: existing.identity_id });
    } else {
        const latestRevision = identityRows.length ? Number(identityRows[0].identity_revision) : 0;
        const desired = desiredIdentity(manifest, membershipId, latestRevision + 1);
        await client.query(
            `INSERT INTO company_external_identities (
                identity_id, identity_revision, tenant_id, tenant_revision_at_write,
                provider, authenticated_subject_id, workspace_id, app_id,
                membership_id, project_id, placement_id, principal_type,
                status, created_at, updated_at
             ) VALUES (
                $1, $2, $3, $4, 'service', $5, $6, $7,
                $8, $9, $10, 'service', 'active', now(), now()
             )`,
            [
                desired.identity_id,
                Number(desired.identity_revision),
                manifest.tenant_id,
                tenantRevision,
                desired.authenticated_subject_id,
                desired.workspace_id,
                desired.app_id,
                membershipId,
                desired.project_id,
                desired.placement_id
            ]
        );
        plan.push({ operation: 'create', entity: 'company_external_identity', id: desired.identity_id });
    }

    for (const binding of manifest.service_actor.bindings) {
        const bindingRows = await readBindings(client, manifest, membershipId, binding);
        const activeBindings = bindingRows.filter((row) => row.status === 'active');
        if (activeBindings.length > 1) fail('SERVICE_AUTHORITY_AMBIGUOUS', 'Multiple active service authority bindings exist');
        if (activeBindings.length === 1) {
            const existing = bindingShape(activeBindings[0]);
            const expected = desiredBinding(manifest, membershipId, binding, Number(existing.binding_revision));
            expected.binding_id = existing.binding_id;
            if (!same(existing, expected)) fail('SERVICE_AUTHORITY_CONFLICT', 'Existing service authority differs from desired state');
            plan.push({ operation: 'noop', entity: 'company_authority_binding', id: existing.binding_id,
                capability_id: binding.capability_id, resource_ref: binding.resource_ref });
            continue;
        }
        const latestRevision = bindingRows.length ? Number(bindingRows[0].binding_revision) : 0;
        const desired = desiredBinding(manifest, membershipId, binding, latestRevision + 1);
        await client.query(
            `INSERT INTO company_authority_bindings (
                binding_id, binding_revision, tenant_id, tenant_revision_at_write,
                membership_id, organization_id, project_id, resource_ref,
                resource_revision, capability_id, decision, allowed_effects,
                responsible_person_id, accountable_person_id, approver_person_id,
                delegated_by_person_id, policy_revision, raci_revision,
                stop_conditions, status, valid_from, valid_until,
                created_at, updated_at
             ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12::text[], $13, $14, $15,
                $16, $17, $18, $19::text[], 'active', $20, $21,
                now(), now()
             )`,
            [
                desired.binding_id,
                Number(desired.binding_revision),
                manifest.tenant_id,
                tenantRevision,
                membershipId,
                desired.organization_id,
                desired.project_id,
                desired.resource_ref,
                desired.resource_revision,
                desired.capability_id,
                desired.decision,
                desired.allowed_effects,
                desired.responsible_person_id,
                desired.accountable_person_id,
                desired.approver_person_id,
                desired.delegated_by_person_id,
                desired.policy_revision,
                desired.raci_revision,
                desired.stop_conditions,
                desired.valid_from,
                desired.valid_until
            ]
        );
        plan.push({ operation: 'create', entity: 'company_authority_binding', id: desired.binding_id,
            capability_id: desired.capability_id, resource_ref: desired.resource_ref });
    }
    return { membershipId, plan };
}

async function readSnapshot(client, manifest, membershipId) {
    const membershipRows = await readMembership(client, manifest);
    const identityRows = await readIdentities(client, manifest);
    const bindings = [];
    for (const binding of manifest.service_actor.bindings) {
        const bindingRows = await readBindings(client, manifest, membershipId, binding);
        const active = bindingRows.filter((row) => row.status === 'active');
        if (active.length !== 1) fail('READBACK_FAILED', 'Authority readback is incomplete or ambiguous');
        bindings.push(bindingShape(active[0]));
    }
    if (membershipRows.length !== 1) fail('READBACK_FAILED', 'Membership readback is incomplete or ambiguous');
    const activeIdentities = identityRows.filter((row) => row.status === 'active');
    if (activeIdentities.length !== 1) fail('READBACK_FAILED', 'Identity readback is incomplete or ambiguous');
    return {
        membership: publicMembership(membershipRows[0]),
        identity: publicIdentity(activeIdentities[0]),
        bindings
    };
}

export async function provisionServiceCompanyAuthority({
    client,
    manifest: rawManifest,
    actorId,
    commit = false
} = {}) {
    if (!client?.query) fail('DATABASE_CONFIG_REQUIRED', 'A PostgreSQL client is required');
    if (typeof actorId !== 'string' || actorId.trim().length === 0 || actorId.length > 128) {
        fail('ACTOR_REQUIRED', 'A bounded provisioning actor is required');
    }
    const manifest = normalizeServiceCompanyAuthorityManifest(rawManifest);
    let began = false;
    try {
        await client.query('BEGIN');
        began = true;
        await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [manifest.tenant_id]);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            `service-company-authority:${manifest.tenant_id}:${manifest.service_actor.actor_id}`
        ]);
        const foundation = await readFoundation(client, manifest);
        const beforeMembership = await readMembership(client, manifest);
        const beforeIdentities = await readIdentities(client, manifest);
        const before = {
            membership: beforeMembership.length === 1 ? publicMembership(beforeMembership[0]) : null,
            identity: beforeIdentities.filter((row) => row.status === 'active').length === 1
                ? publicIdentity(beforeIdentities.filter((row) => row.status === 'active')[0])
                : null
        };
        const { membershipId, plan } = await preparePlan(client, manifest, foundation.tenant.tenant_revision);
        const after = await readSnapshot(client, manifest, membershipId);
        if (commit) await client.query('COMMIT');
        else await client.query('ROLLBACK');
        began = false;
        return {
            persisted: commit,
            manifest_version: manifest.version,
            tenant_id: manifest.tenant_id,
            tenant_key: foundation.tenant.tenant_key,
            actor_id: manifest.service_actor.actor_id,
            project_id: manifest.project.project_id,
            project_code: manifest.project.project_code,
            applied_by: actorId,
            snapshot_before: before,
            plan,
            snapshot_after: after
        };
    } catch (error) {
        if (began) {
            try { await client.query('ROLLBACK'); } catch { /* preserve first failure */ }
        }
        if (error instanceof ServiceCompanyAuthorityProvisioningError) throw error;
        throw new ServiceCompanyAuthorityProvisioningError(
            'UPSTREAM_UNAVAILABLE',
            'Service company authority provisioning failed; inspect control-plane logs'
        );
    }
}
