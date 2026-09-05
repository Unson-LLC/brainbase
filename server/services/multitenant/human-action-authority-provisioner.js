import { createHash } from 'node:crypto';

import { canonicalJson, deepFreeze } from './canonical-json.js';
import { isCanonicalId } from './ids.js';

const VERSION = 'human-company-action-authority.v1';
const TENANT_ID = /^ten_[0-9A-HJKMNP-TV-Z]{26}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const RESOURCE_REF = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,499}$/u;
const REVISION = /^(0|[1-9][0-9]*)$/u;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const DECISIONS = new Set(['auto', 'approval', 'human_action', 'deny']);
const EFFECTS = new Set(['read', 'write', 'external_side_effect']);
const ROOT_KEYS = new Set(['version', 'tenant_id', 'organization_id', 'project', 'transport', 'humans']);
const PROJECT_KEYS = new Set(['project_id', 'project_code']);
const TRANSPORT_KEYS = new Set(['provider', 'workspace_id', 'app_id']);
const HUMAN_KEYS = new Set([
    'person_id', 'slack_user_id', 'membership_id', 'membership_revision',
    'identity_id', 'identity_revision', 'placement_id', 'membership_placement_id',
    'expected_project_codes', 'bindings'
]);
const BINDING_KEYS = new Set([
    'resource_ref', 'capability_id', 'decision', 'allowed_effects',
    'responsible_person_id', 'accountable_person_id', 'approver_person_id',
    'delegated_by_person_id', 'resource_revision', 'policy_revision', 'raci_revision',
    'stop_conditions', 'valid_from', 'valid_until'
]);
const SECRET_KEY = /(?:access|refresh)[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?value|oauth[_-]?(?:token|code)|bearer[_-]?token/iu;
const SECRET_VALUE = /(?:^xox[baprs]-|^sk-[A-Za-z0-9]|^gh[pousr]_[A-Za-z0-9_]{20,}|^Bearer\s+\S{20,}|-----BEGIN [A-Z ]+-----)/u;

export class HumanActionAuthorityProvisioningError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'HumanActionAuthorityProvisioningError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new HumanActionAuthorityProvisioningError(code, message);
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
        || /[\u0000-\u001f\u007f]/u.test(value) || (pattern && !pattern.test(value))) {
        fail('MANIFEST_INVALID', `${field} is invalid`);
    }
    return value;
}

function nullableText(value, field) {
    return value == null ? null : text(value, field);
}

function revision(value, field, { positive = false } = {}) {
    if (typeof value !== 'string' || !REVISION.test(value) || (positive && value === '0')) {
        fail('MANIFEST_INVALID', `${field} is invalid`);
    }
    return value;
}

function safeRevisionNumber(value, field) {
    const normalized = String(value);
    if (!REVISION.test(normalized)) {
        fail('AUTHORITY_REVISION_INVALID', `${field} is invalid`);
    }
    const parsed = Number(normalized);
    if (!Number.isSafeInteger(parsed)) {
        fail('AUTHORITY_REVISION_INVALID', `${field} exceeds the safe integer range`);
    }
    return parsed;
}

function incrementRevision(value, field) {
    const parsed = safeRevisionNumber(value, field);
    if (parsed === Number.MAX_SAFE_INTEGER) {
        fail('AUTHORITY_REVISION_INVALID', `${field} cannot be incremented safely`);
    }
    return parsed + 1;
}

function timestamp(value, field, { nullable = false } = {}) {
    if (nullable && value == null) return null;
    if (typeof value !== 'string' || !RFC3339_UTC.test(value) || !Number.isFinite(Date.parse(value))) {
        fail('MANIFEST_INVALID', `${field} is invalid`);
    }
    return new Date(value).toISOString();
}

function stringArray(value, field, { allowed = null, allowEmpty = false } = {}) {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 32) {
        fail('MANIFEST_INVALID', `${field} must be a bounded array`);
    }
    const normalized = value.map((item, index) => {
        const result = text(item, `${field}[${index}]`);
        if (allowed && !allowed.has(result)) fail('MANIFEST_INVALID', `${field}[${index}] is not allowed`);
        return result;
    });
    if (new Set(normalized).size !== normalized.length) fail('MANIFEST_INVALID', `${field} contains duplicates`);
    return normalized.sort((left, right) => left.localeCompare(right));
}

function normalizeBinding(value, humanIndex, bindingIndex) {
    const field = `humans[${humanIndex}].bindings[${bindingIndex}]`;
    record(value, field);
    knownKeys(value, BINDING_KEYS, field);
    const decision = text(value.decision, `${field}.decision`);
    if (!DECISIONS.has(decision)) fail('MANIFEST_INVALID', `${field}.decision is invalid`);
    const responsiblePersonId = nullableText(value.responsible_person_id, `${field}.responsible_person_id`);
    const approverPersonId = nullableText(value.approver_person_id, `${field}.approver_person_id`);
    if (decision === 'human_action' && !responsiblePersonId) {
        fail('MANIFEST_INVALID', `${field}.responsible_person_id is required for human_action`);
    }
    if (decision === 'approval' && !approverPersonId) {
        fail('MANIFEST_INVALID', `${field}.approver_person_id is required for approval`);
    }
    const validFrom = timestamp(value.valid_from, `${field}.valid_from`);
    const validUntil = timestamp(value.valid_until, `${field}.valid_until`, { nullable: true });
    if (validUntil && Date.parse(validUntil) <= Date.parse(validFrom)) {
        fail('MANIFEST_INVALID', `${field}.valid_until must be after valid_from`);
    }
    return {
        resource_ref: text(value.resource_ref, `${field}.resource_ref`, RESOURCE_REF),
        capability_id: text(value.capability_id, `${field}.capability_id`),
        decision,
        allowed_effects: stringArray(value.allowed_effects, `${field}.allowed_effects`, { allowed: EFFECTS }),
        responsible_person_id: responsiblePersonId,
        accountable_person_id: nullableText(value.accountable_person_id, `${field}.accountable_person_id`),
        approver_person_id: approverPersonId,
        delegated_by_person_id: nullableText(value.delegated_by_person_id, `${field}.delegated_by_person_id`),
        resource_revision: revision(value.resource_revision, `${field}.resource_revision`),
        policy_revision: revision(value.policy_revision, `${field}.policy_revision`),
        raci_revision: revision(value.raci_revision, `${field}.raci_revision`),
        stop_conditions: value.stop_conditions === undefined
            ? [] : stringArray(value.stop_conditions, `${field}.stop_conditions`, { allowEmpty: true }),
        valid_from: validFrom,
        valid_until: validUntil
    };
}

function normalizeHuman(value, index) {
    const field = `humans[${index}]`;
    record(value, field);
    knownKeys(value, HUMAN_KEYS, field);
    if (!Object.hasOwn(value, 'membership_placement_id')) {
        fail('MANIFEST_INVALID', `${field}.membership_placement_id is required`);
    }
    const personId = text(value.person_id, `${field}.person_id`);
    if (!isCanonicalId(personId, 'per')) fail('MANIFEST_INVALID', `${field}.person_id is invalid`);
    if (!Array.isArray(value.bindings) || value.bindings.length === 0 || value.bindings.length > 32) {
        fail('MANIFEST_INVALID', `${field}.bindings must be a bounded non-empty array`);
    }
    const bindings = value.bindings.map((binding, bindingIndex) => normalizeBinding(binding, index, bindingIndex));
    const naturalKeys = bindings.map((binding) => `${binding.resource_ref}\u0000${binding.capability_id}`);
    if (new Set(naturalKeys).size !== naturalKeys.length) {
        fail('MANIFEST_INVALID', `${field}.bindings contains duplicate resource/capability pairs`);
    }
    return {
        person_id: personId,
        slack_user_id: text(value.slack_user_id, `${field}.slack_user_id`),
        membership_id: text(value.membership_id, `${field}.membership_id`),
        membership_revision: revision(value.membership_revision, `${field}.membership_revision`, { positive: true }),
        identity_id: text(value.identity_id, `${field}.identity_id`),
        identity_revision: revision(value.identity_revision, `${field}.identity_revision`, { positive: true }),
        placement_id: text(value.placement_id, `${field}.placement_id`),
        membership_placement_id: value.membership_placement_id === null
            ? null : text(value.membership_placement_id, `${field}.membership_placement_id`),
        expected_project_codes: stringArray(
            value.expected_project_codes, `${field}.expected_project_codes`
        ),
        bindings
    };
}

export function normalizeHumanActionAuthorityManifest(value) {
    scanSecrets(value);
    record(value, 'manifest');
    knownKeys(value, ROOT_KEYS, 'manifest');
    if (value.version !== VERSION) fail('MANIFEST_INVALID', 'manifest.version is invalid');
    const project = record(value.project, 'project');
    const transport = record(value.transport, 'transport');
    knownKeys(project, PROJECT_KEYS, 'project');
    knownKeys(transport, TRANSPORT_KEYS, 'transport');
    if (transport.provider !== 'slack') fail('MANIFEST_INVALID', 'transport.provider must be slack');
    if (!Array.isArray(value.humans) || value.humans.length === 0 || value.humans.length > 32) {
        fail('MANIFEST_INVALID', 'humans must be a bounded non-empty array');
    }
    const humans = value.humans.map(normalizeHuman);
    for (const key of ['person_id', 'slack_user_id', 'membership_id', 'identity_id']) {
        if (new Set(humans.map((human) => human[key])).size !== humans.length) {
            fail('MANIFEST_INVALID', `humans contains duplicate ${key}`);
        }
    }
    return deepFreeze({
        version: VERSION,
        tenant_id: text(value.tenant_id, 'tenant_id', TENANT_ID),
        organization_id: text(value.organization_id, 'organization_id'),
        project: {
            project_id: text(project.project_id, 'project.project_id'),
            project_code: text(project.project_code, 'project.project_code')
        },
        transport: {
            provider: 'slack',
            workspace_id: text(transport.workspace_id, 'transport.workspace_id'),
            app_id: text(transport.app_id, 'transport.app_id')
        },
        humans
    });
}

function stableId(prefix, parts) {
    return `${prefix}_${createHash('sha256').update(canonicalJson(parts)).digest('hex').slice(0, 32)}`;
}

function same(left, right) {
    return canonicalJson(left) === canonicalJson(right);
}

async function rows(client, sql, parameters = []) {
    const result = await client.query(sql, parameters);
    return Array.isArray(result?.rows) ? result.rows : [];
}

function exactlyOne(values, code, message) {
    if (values.length !== 1) fail(code, message);
    return values[0];
}

function membershipRevision(payload) {
    return payload?.revision == null ? null : String(payload.revision);
}

function membershipPlacement(payload) {
    return payload?.placement_id ?? null;
}

function canonicalProjectCodes(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 32
        || value.some((item) => typeof item !== 'string'
            || item.length === 0 || item.length > 500
            || /[\u0000-\u001f\u007f]/u.test(item) || !IDENTIFIER.test(item))) {
        return null;
    }
    if (new Set(value).size !== value.length) return null;
    return [...value].sort((left, right) => left.localeCompare(right));
}

function sameProjectCodes(actual, expected) {
    const actualCanonical = canonicalProjectCodes(actual);
    return actualCanonical !== null && same(actualCanonical, expected);
}

function publicMembership(row) {
    const payload = row?.membership_payload;
    return row ? {
        membership_id: row.membership_id,
        organization_id: row.organization_id,
        principal_id: row.principal_id,
        membership_payload: {
            status: payload?.status ?? null,
            revision: membershipRevision(payload),
            principal_type: payload?.principal_type ?? null,
            slack_user_id: payload?.slack_user_id ?? null,
            slack_workspace_id: payload?.slack_workspace_id ?? null,
            project_codes: Array.isArray(payload?.project_codes) ? [...payload.project_codes] : null,
            placement_id: membershipPlacement(payload)
        }
    } : null;
}

function publicIdentity(row) {
    return row ? {
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
    } : null;
}

function bindingShape(row) {
    return row ? {
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
    } : null;
}

async function readFoundation(client, manifest) {
    const tenant = exactlyOne(await rows(client,
        `SELECT tenant_id, tenant_key, tenant_revision, status
           FROM brainbase_tenants WHERE tenant_id = $1 FOR UPDATE`,
        [manifest.tenant_id]), 'TENANT_NOT_FOUND', 'Tenant was not found');
    if (tenant.status !== 'active') fail('TENANT_INACTIVE', 'Tenant must be active');
    const organization = exactlyOne(await rows(client,
        `SELECT organization_id, organization_payload FROM tenant_organizations
          WHERE tenant_id = $1 AND organization_id = $2 FOR SHARE`,
        [manifest.tenant_id, manifest.organization_id]),
    'ORGANIZATION_NOT_FOUND', 'Organization was not found in the tenant');
    if (organization.organization_payload?.status !== 'active') {
        fail('ORGANIZATION_INACTIVE', 'Organization must be active');
    }
    exactlyOne(await rows(client,
        `SELECT project_id, project_code FROM tenant_projects
          WHERE tenant_id = $1 AND project_id = $2 AND project_code = $3 FOR SHARE`,
        [manifest.tenant_id, manifest.project.project_id, manifest.project.project_code]),
    'PROJECT_NOT_FOUND', 'Project was not found in the tenant');
    const connections = await rows(client,
        `SELECT connection_id, connection_revision, provider, workspace_id, app_id, status
           FROM workspace_connections
          WHERE tenant_id = $1 AND provider = 'slack' AND workspace_id = $2 AND app_id = $3
            AND status = 'active'
          ORDER BY connection_revision DESC LIMIT 2 FOR SHARE`,
        [manifest.tenant_id, manifest.transport.workspace_id, manifest.transport.app_id]);
    exactlyOne(connections,
        connections.length === 0 ? 'WORKSPACE_CONNECTION_NOT_FOUND' : 'WORKSPACE_CONNECTION_AMBIGUOUS',
        'An exact active workspace connection is required');
    return tenant;
}

async function readHumanFoundation(client, manifest, human) {
    const memberships = await rows(client,
        `SELECT membership_id, organization_id, principal_id, membership_payload
           FROM tenant_memberships
          WHERE tenant_id = $1 AND membership_id = $2 AND organization_id = $3
          ORDER BY membership_id LIMIT 2 FOR SHARE`,
        [manifest.tenant_id, human.membership_id, manifest.organization_id]);
    const membership = exactlyOne(memberships, 'MEMBERSHIP_NOT_FOUND', 'Declared membership was not found');
    const payload = membership.membership_payload;
    if (membership.principal_id !== human.person_id || payload?.status !== 'active'
        || payload?.principal_type !== 'person'
        || membershipRevision(payload) !== human.membership_revision
        || payload?.slack_user_id !== human.slack_user_id
        || payload?.slack_workspace_id !== manifest.transport.workspace_id
        || membershipPlacement(payload) !== human.membership_placement_id
        || !sameProjectCodes(payload?.project_codes, human.expected_project_codes)) {
        fail('MEMBERSHIP_CONFLICT', 'Declared active human membership differs from current state');
    }
    const identities = await rows(client,
        `SELECT identity_id, identity_revision, provider, authenticated_subject_id,
                workspace_id, app_id, membership_id, project_id, placement_id,
                principal_type, status
           FROM company_external_identities
          WHERE tenant_id = $1 AND provider = 'slack'
            AND authenticated_subject_id = $2 AND workspace_id = $3
            AND app_id = $4 AND project_id = $5 AND status = 'active'
          ORDER BY identity_revision DESC LIMIT 2 FOR SHARE`,
        [manifest.tenant_id, human.slack_user_id, manifest.transport.workspace_id,
            manifest.transport.app_id, manifest.project.project_id]);
    const identity = exactlyOne(identities,
        identities.length === 0 ? 'EXTERNAL_IDENTITY_NOT_FOUND' : 'EXTERNAL_IDENTITY_AMBIGUOUS',
        'An exact active Slack identity is required');
    const expectedIdentity = {
        identity_id: human.identity_id,
        identity_revision: human.identity_revision,
        provider: 'slack',
        authenticated_subject_id: human.slack_user_id,
        workspace_id: manifest.transport.workspace_id,
        app_id: manifest.transport.app_id,
        membership_id: human.membership_id,
        project_id: manifest.project.project_id,
        placement_id: human.placement_id,
        principal_type: 'person',
        status: 'active'
    };
    if (!same(publicIdentity(identity), expectedIdentity)) {
        fail('EXTERNAL_IDENTITY_CONFLICT', 'Declared active Slack identity differs from current state');
    }
    return { membership: publicMembership(membership), identity: publicIdentity(identity) };
}

async function readActiveBindings(client, manifest, human, binding) {
    return rows(client,
        `SELECT binding_id, binding_revision, membership_id, organization_id,
                project_id, resource_ref, resource_revision, capability_id,
                decision, allowed_effects, responsible_person_id,
                accountable_person_id, approver_person_id, delegated_by_person_id,
                policy_revision, raci_revision, stop_conditions, status,
                valid_from, valid_until
           FROM company_authority_bindings
          WHERE tenant_id = $1 AND membership_id = $2 AND organization_id = $3
            AND project_id = $4 AND resource_ref = $5 AND capability_id = $6
            AND status = 'active'
          ORDER BY binding_revision DESC LIMIT 2 FOR UPDATE`,
        [manifest.tenant_id, human.membership_id, manifest.organization_id,
            manifest.project.project_id, binding.resource_ref, binding.capability_id]);
}

async function readMaximumBindingRevision(client, manifest, human, binding) {
    const row = exactlyOne(await rows(client,
        `SELECT COALESCE(MAX(binding_revision), 0)::text AS max_revision
           FROM company_authority_bindings
          WHERE tenant_id = $1 AND membership_id = $2 AND organization_id = $3
            AND project_id = $4 AND resource_ref = $5 AND capability_id = $6`,
        [manifest.tenant_id, human.membership_id, manifest.organization_id,
            manifest.project.project_id, binding.resource_ref, binding.capability_id]),
    'AUTHORITY_REVISION_READ_FAILED', 'Authority revision could not be read');
    return safeRevisionNumber(row.max_revision, 'company_authority_bindings.binding_revision');
}

function desiredBinding(manifest, human, binding, bindingRevision, bindingId = null) {
    return {
        binding_id: bindingId ?? stableId('human_binding', [manifest.tenant_id, human.membership_id,
            manifest.organization_id, manifest.project.project_id, binding.resource_ref,
            binding.capability_id, bindingRevision]),
        binding_revision: String(bindingRevision),
        membership_id: human.membership_id,
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

async function prepareBinding(client, manifest, human, binding, tenantRevision, plan) {
    const active = await readActiveBindings(client, manifest, human, binding);
    if (active.length > 1) fail('HUMAN_AUTHORITY_AMBIGUOUS', 'Multiple active human authority bindings exist');
    if (active.length === 1) {
        const existing = bindingShape(active[0]);
        const existingRevision = safeRevisionNumber(
            existing.binding_revision, 'company_authority_bindings.binding_revision'
        );
        const expected = desiredBinding(manifest, human, binding, existingRevision, existing.binding_id);
        if (!same(existing, expected)) fail('HUMAN_AUTHORITY_CONFLICT', 'Existing human authority differs from desired state');
        plan.push({ operation: 'noop', entity: 'company_authority_binding', id: existing.binding_id,
            person_id: human.person_id, capability_id: binding.capability_id, resource_ref: binding.resource_ref });
        return;
    }
    const nextRevision = incrementRevision(
        await readMaximumBindingRevision(client, manifest, human, binding),
        'company_authority_bindings.binding_revision'
    );
    const desired = desiredBinding(manifest, human, binding, nextRevision);
    await client.query(
        `INSERT INTO company_authority_bindings (
            binding_id, binding_revision, tenant_id, tenant_revision_at_write,
            membership_id, organization_id, project_id, resource_ref,
            resource_revision, capability_id, decision, allowed_effects,
            responsible_person_id, accountable_person_id, approver_person_id,
            delegated_by_person_id, policy_revision, raci_revision,
            stop_conditions, status, valid_from, valid_until, created_at, updated_at
         ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[],
            $13, $14, $15, $16, $17, $18, $19::text[], 'active', $20, $21, now(), now()
         )`,
        [desired.binding_id, nextRevision, manifest.tenant_id, tenantRevision,
            human.membership_id, manifest.organization_id, manifest.project.project_id,
            desired.resource_ref, desired.resource_revision, desired.capability_id,
            desired.decision, desired.allowed_effects, desired.responsible_person_id,
            desired.accountable_person_id, desired.approver_person_id,
            desired.delegated_by_person_id, desired.policy_revision, desired.raci_revision,
            desired.stop_conditions, desired.valid_from, desired.valid_until]
    );
    plan.push({ operation: 'create', entity: 'company_authority_binding', id: desired.binding_id,
        person_id: human.person_id, capability_id: binding.capability_id, resource_ref: binding.resource_ref });
}

async function readHumanSnapshot(client, manifest, human) {
    const foundation = await readHumanFoundation(client, manifest, human);
    const bindings = [];
    for (const binding of human.bindings) {
        const active = await readActiveBindings(client, manifest, human, binding);
        if (active.length !== 1) fail('READBACK_FAILED', 'Human authority readback is incomplete or ambiguous');
        const actual = bindingShape(active[0]);
        const actualRevision = safeRevisionNumber(
            actual.binding_revision, 'company_authority_bindings.binding_revision'
        );
        const expected = desiredBinding(manifest, human, binding, actualRevision, actual.binding_id);
        if (!same(actual, expected)) fail('READBACK_FAILED', 'Human authority readback differs from declared state');
        bindings.push(actual);
    }
    return { person_id: human.person_id, ...foundation, bindings };
}

export async function readbackHumanActionAuthority({ client, manifest: rawManifest } = {}) {
    if (!client?.query) fail('DATABASE_CONFIG_REQUIRED', 'A PostgreSQL client is required');
    const manifest = normalizeHumanActionAuthorityManifest(rawManifest);
    await client.query('BEGIN');
    try {
        await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [manifest.tenant_id]);
        const tenant = await readFoundation(client, manifest);
        const humans = [];
        for (const human of manifest.humans) humans.push(await readHumanSnapshot(client, manifest, human));
        await client.query('ROLLBACK');
        return { tenant_id: manifest.tenant_id, tenant_key: tenant.tenant_key,
            project_id: manifest.project.project_id, project_code: manifest.project.project_code, humans };
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* preserve first failure */ }
        if (error instanceof HumanActionAuthorityProvisioningError) throw error;
        throw new HumanActionAuthorityProvisioningError(
            'UPSTREAM_UNAVAILABLE', 'Human action authority readback failed; inspect control-plane logs'
        );
    }
}

export async function provisionHumanActionAuthority({ client, manifest: rawManifest, actorId, commit = false } = {}) {
    if (!client?.query) fail('DATABASE_CONFIG_REQUIRED', 'A PostgreSQL client is required');
    if (typeof actorId !== 'string' || actorId.trim().length === 0 || actorId.length > 128) {
        fail('ACTOR_REQUIRED', 'A bounded provisioning actor is required');
    }
    const manifest = normalizeHumanActionAuthorityManifest(rawManifest);
    let began = false;
    try {
        await client.query('BEGIN');
        began = true;
        await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [manifest.tenant_id]);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            `human-action-authority:${manifest.tenant_id}:${manifest.organization_id}:${manifest.project.project_id}`
        ]);
        const tenant = await readFoundation(client, manifest);
        const before = [];
        for (const human of manifest.humans) {
            const foundation = await readHumanFoundation(client, manifest, human);
            const bindings = [];
            for (const binding of human.bindings) {
                const active = await readActiveBindings(client, manifest, human, binding);
                bindings.push(active.length === 1 ? bindingShape(active[0]) : null);
            }
            before.push({ person_id: human.person_id, ...foundation, bindings });
        }
        const plan = [];
        for (const human of manifest.humans) {
            for (const binding of human.bindings) {
                await prepareBinding(client, manifest, human, binding, tenant.tenant_revision, plan);
            }
        }
        const after = [];
        for (const human of manifest.humans) after.push(await readHumanSnapshot(client, manifest, human));
        if (commit) await client.query('COMMIT');
        else await client.query('ROLLBACK');
        began = false;
        return {
            persisted: commit,
            manifest_version: manifest.version,
            tenant_id: manifest.tenant_id,
            tenant_key: tenant.tenant_key,
            organization_id: manifest.organization_id,
            project_id: manifest.project.project_id,
            project_code: manifest.project.project_code,
            applied_by: actorId,
            snapshot_before: { humans: before },
            plan,
            snapshot_after: { humans: after }
        };
    } catch (error) {
        if (began) {
            try { await client.query('ROLLBACK'); } catch { /* preserve first failure */ }
        }
        if (error instanceof HumanActionAuthorityProvisioningError) throw error;
        throw new HumanActionAuthorityProvisioningError(
            'UPSTREAM_UNAVAILABLE', 'Human action authority provisioning failed; inspect control-plane logs'
        );
    }
}
