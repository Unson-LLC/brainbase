import { createHash } from 'node:crypto';

import { canonicalJson, deepFreeze } from './canonical-json.js';

const VERSION = 'tenant-project-identity.v1';
const TENANT_ID = /^ten_[0-9A-HJKMNP-TV-Z]{26}$/u;
const PROJECT_ID = /^prj_[0-9A-HJKMNP-TV-Z]{26}$/u;
const CONNECTION_ID = /^wsc_[0-9A-HJKMNP-TV-Z]{26}$/u;
const PERSON_ID = /^per_[0-9A-HJKMNP-TV-Z]{26}$/u;
const REVISION = /^[1-9][0-9]*$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const ROOT_KEYS = new Set([
    'version', 'tenant_id', 'tenant_key', 'organization_id', 'project', 'transport', 'humans'
]);
const PROJECT_KEYS = new Set(['project_id', 'project_code']);
const TRANSPORT_KEYS = new Set([
    'provider', 'workspace_id', 'app_id', 'connection_id', 'installation_id'
]);
const HUMAN_KEYS = new Set([
    'person_id', 'slack_user_id', 'membership_id', 'membership_revision',
    'expected_project_codes', 'expected_role', 'expected_tenant_role',
    'expected_clearance', 'placement_id', 'membership_repairs'
]);
const ROLES = new Set(['member', 'gm', 'ceo', 'tenant_admin']);
const TENANT_ROLES = new Set(['member', 'tenant_admin']);
const MEMBERSHIP_REPAIR_KEYS = new Set(['tenant_role', 'principal_type']);
const SECRET_KEY = /(?:access|refresh)[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?value|oauth[_-]?(?:token|code)|bearer[_-]?token/iu;
const SECRET_VALUE = /(?:^xox[baprs]-|^sk-[A-Za-z0-9]|^gh[pousr]_[A-Za-z0-9_]{20,}|^ya29\.[A-Za-z0-9_-]{20,}|^AKIA[A-Z0-9]{16}$|^Bearer\s+\S{20,}|^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$|-----BEGIN [A-Z ]+-----)/u;
const SAFE_UPSTREAM_CODE = /^[A-Z0-9]{5}$/u;
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const SAFE_OPERATION = /^[a-z][a-z0-9_:-]{0,127}$/u;

export class TenantProjectIdentityProvisioningError extends Error {
    constructor(code, message, { operation = null, upstreamCode = null, upstreamName = null } = {}) {
        super(message);
        this.name = 'TenantProjectIdentityProvisioningError';
        this.code = code;
        if (operation && SAFE_OPERATION.test(operation)) this.operation = operation;
        if (upstreamCode && SAFE_UPSTREAM_CODE.test(upstreamCode)) this.upstream_code = upstreamCode;
        if (upstreamName && SAFE_ERROR_NAME.test(upstreamName)) this.upstream_name = upstreamName;
    }
}

function fail(code, message) {
    throw new TenantProjectIdentityProvisioningError(code, message);
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

function stringArray(value, field, { allowEmpty = false } = {}) {
    if (!Array.isArray(value) || value.length > 32 || (!allowEmpty && value.length === 0)) {
        fail('MANIFEST_INVALID', `${field} must be a bounded ${allowEmpty ? 'array' : 'non-empty array'}`);
    }
    const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`));
    if (new Set(normalized).size !== normalized.length) fail('MANIFEST_INVALID', `${field} contains duplicates`);
    return normalized;
}

function nullableText(value, field) {
    return value === null ? null : text(value, field);
}

/**
 * A membership repair is deliberately restricted to filling a declared null or
 * missing field. A non-null current value is never overwritten by this provisioner.
 */
function normalizeMembershipRepairs(value, field) {
    if (value === undefined) return {};
    record(value, field);
    knownKeys(value, MEMBERSHIP_REPAIR_KEYS, field);
    const repairs = {};
    for (const key of MEMBERSHIP_REPAIR_KEYS) {
        if (value[key] === undefined) continue;
        const repair = record(value[key], `${field}.${key}`);
        knownKeys(repair, new Set(['from', 'from_missing', 'to']), `${field}.${key}`);
        if (!Object.hasOwn(repair, 'to')) {
            fail('MANIFEST_INVALID', `${field}.${key} requires to`);
        }
        const fromMissing = repair.from_missing === undefined ? false : repair.from_missing;
        if (typeof fromMissing !== 'boolean') {
            fail('MANIFEST_INVALID', `${field}.${key}.from_missing must be boolean`);
        }
        if (fromMissing) {
            if (Object.hasOwn(repair, 'from')) {
                fail('MANIFEST_INVALID', `${field}.${key} cannot include from when from_missing is true`);
            }
        } else if (!Object.hasOwn(repair, 'from')) {
            fail('MANIFEST_INVALID', `${field}.${key} requires from or from_missing`);
        }
        const from = fromMissing ? null : nullableText(repair.from, `${field}.${key}.from`);
        if (!fromMissing && from !== null) {
            fail('MANIFEST_INVALID', `${field}.${key}.from must be null`);
        }
        const allowed = key === 'tenant_role' ? TENANT_ROLES : new Set(['person']);
        const to = text(repair.to, `${field}.${key}.to`);
        if (!allowed.has(to)) {
            fail('MANIFEST_INVALID', `${field}.${key}.to is invalid`);
        }
        repairs[key] = fromMissing ? { from_missing: true, to } : { from, to };
    }
    return repairs;
}

function normalizeHuman(value, index) {
    const field = `humans[${index}]`;
    record(value, field);
    knownKeys(value, HUMAN_KEYS, field);
    const personId = text(value.person_id, `${field}.person_id`, PERSON_ID);
    const membershipRevision = text(value.membership_revision, `${field}.membership_revision`, REVISION, 20);
    const expectedRole = text(value.expected_role, `${field}.expected_role`);
    if (!ROLES.has(expectedRole)) fail('MANIFEST_INVALID', `${field}.expected_role is invalid`);
    if (!Object.hasOwn(value, 'expected_tenant_role')) {
        fail('MANIFEST_INVALID', `${field}.expected_tenant_role is required`);
    }
    const expectedTenantRole = value.expected_tenant_role === null
        ? null : text(value.expected_tenant_role, `${field}.expected_tenant_role`);
    if (expectedTenantRole !== null && !TENANT_ROLES.has(expectedTenantRole)) {
        fail('MANIFEST_INVALID', `${field}.expected_tenant_role is invalid`);
    }
    const membershipRepairs = normalizeMembershipRepairs(value.membership_repairs, `${field}.membership_repairs`);
    return {
        person_id: personId,
        slack_user_id: text(value.slack_user_id, `${field}.slack_user_id`),
        membership_id: text(value.membership_id, `${field}.membership_id`),
        membership_revision: membershipRevision,
        expected_project_codes: stringArray(value.expected_project_codes, `${field}.expected_project_codes`),
        expected_role: expectedRole,
        expected_tenant_role: expectedTenantRole,
        expected_clearance: stringArray(value.expected_clearance, `${field}.expected_clearance`),
        placement_id: text(value.placement_id, `${field}.placement_id`),
        membership_repairs: membershipRepairs
    };
}

/**
 * Normalize an additive tenant projection manifest.
 *
 * The manifest deliberately has no auth_grants or Graph organization fields.
 * Login grants and Graph ownership are separate authority boundaries; this
 * operation only projects an already approved tenant project onto an existing
 * tenant membership and creates the matching Slack identity tuple.
 */
export function normalizeTenantProjectIdentityManifest(value) {
    scanSecrets(value);
    record(value, 'manifest');
    knownKeys(value, ROOT_KEYS, 'manifest');
    if (value.version !== VERSION) fail('MANIFEST_INVALID', 'manifest.version is invalid');
    const project = record(value.project, 'project');
    const transport = record(value.transport, 'transport');
    knownKeys(project, PROJECT_KEYS, 'project');
    knownKeys(transport, TRANSPORT_KEYS, 'transport');
    const projectId = text(value.project.project_id, 'project.project_id', PROJECT_ID);
    const projectCode = text(value.project.project_code, 'project.project_code');
    if (value.transport.provider !== 'slack') fail('MANIFEST_INVALID', 'transport.provider must be slack');
    const connectionId = text(value.transport.connection_id, 'transport.connection_id', CONNECTION_ID);
    if (!Array.isArray(value.humans) || value.humans.length === 0 || value.humans.length > 32) {
        fail('MANIFEST_INVALID', 'humans must be a bounded non-empty array');
    }
    const humans = value.humans.map(normalizeHuman);
    const personIds = new Set(humans.map((entry) => entry.person_id));
    const slackUserIds = new Set(humans.map((entry) => entry.slack_user_id));
    const membershipIds = new Set(humans.map((entry) => entry.membership_id));
    for (const [index, human] of humans.entries()) {
        if (personIds.size !== humans.length
            || slackUserIds.size !== humans.length
            || membershipIds.size !== humans.length) {
            fail('MANIFEST_INVALID', `humans contains duplicate principal at index ${index}`);
        }
    }
    return deepFreeze({
        version: VERSION,
        tenant_id: text(value.tenant_id, 'tenant_id', TENANT_ID),
        tenant_key: text(value.tenant_key, 'tenant_key'),
        organization_id: text(value.organization_id, 'organization_id'),
        project: { project_id: projectId, project_code: projectCode },
        transport: {
            provider: 'slack',
            workspace_id: text(value.transport.workspace_id, 'transport.workspace_id'),
            app_id: text(value.transport.app_id, 'transport.app_id'),
            connection_id: connectionId,
            installation_id: text(value.transport.installation_id, 'transport.installation_id')
        },
        humans
    });
}

function same(left, right) {
    return canonicalJson(left) === canonicalJson(right);
}

function stableId(prefix, parts) {
    return `${prefix}_${createHash('sha256').update(canonicalJson(parts)).digest('hex').slice(0, 32)}`;
}

function requireActor(actorId) {
    if (typeof actorId !== 'string' || actorId.trim().length === 0 || actorId.length > 128) {
        fail('ACTOR_REQUIRED', 'A bounded provisioning actor is required');
    }
}

function wrapUnexpectedError(error, operation, code, message) {
    const upstreamCode = typeof error?.code === 'string' && SAFE_UPSTREAM_CODE.test(error.code)
        ? error.code : null;
    const upstreamName = typeof error?.name === 'string' && SAFE_ERROR_NAME.test(error.name)
        ? error.name : null;
    return new TenantProjectIdentityProvisioningError(code, message, {
        operation,
        upstreamCode,
        upstreamName
    });
}

function annotateKnownError(error, operation) {
    if (error instanceof TenantProjectIdentityProvisioningError) {
        if (!error.operation && SAFE_OPERATION.test(operation)) error.operation = operation;
        return error;
    }
    return wrapUnexpectedError(
        error,
        operation,
        'PROVISIONING_FAILED',
        'Tenant project identity provisioning failed; inspect control-plane logs'
    );
}

async function rows(client, sql, parameters = []) {
    return (await client.query(sql, parameters))?.rows ?? [];
}

function exactlyOne(values, code, message) {
    if (!Array.isArray(values) || values.length !== 1) fail(code, message);
    return values[0];
}

async function resolveProject(projectResolver, manifest) {
    const found = await projectResolver.resolveCanonicalProject({
        tenant_key: manifest.tenant_key,
        project_code: manifest.project.project_code
    });
    if (!found || found.matches !== 1 || found.project_id !== manifest.project.project_id) {
        fail('PROJECT_UNAVAILABLE', 'The canonical project was not resolved exactly once');
    }
}

async function readTenant(client, manifest, lock = 'FOR UPDATE') {
    const tenant = exactlyOne(await rows(client,
        `SELECT tenant_id, tenant_key, tenant_revision, status
           FROM brainbase_tenants
          WHERE tenant_id = $1 AND tenant_key = $2 ${lock}`,
        [manifest.tenant_id, manifest.tenant_key]),
    'TENANT_NOT_FOUND', 'The target tenant was not found');
    if (tenant.status !== 'active') fail('TENANT_INACTIVE', 'The target tenant is not active');
    return tenant;
}

async function readOrganization(client, manifest, lock = 'FOR SHARE') {
    const organizations = await rows(client,
        `SELECT organization_id, tenant_id, organization_payload
           FROM tenant_organizations
          WHERE tenant_id = $1 AND organization_id = $2 ${lock}`,
        [manifest.tenant_id, manifest.organization_id]);
    if (organizations.length === 1 && organizations[0].organization_payload?.status !== 'active') {
        fail('ORGANIZATION_INACTIVE', 'The target tenant organization is not active');
    }
    return organizations;
}

async function readConnection(client, manifest, lock = 'FOR SHARE') {
    const connection = exactlyOne(await rows(client,
        `SELECT connection_id, connection_revision, provider, installation_id,
                workspace_id, app_id, status, credential_ref
           FROM workspace_connections
          WHERE tenant_id = $1 AND connection_id = $2
            AND provider = $3 AND workspace_id = $4 AND app_id = $5
            AND status = 'active' ${lock}`,
        [manifest.tenant_id, manifest.transport.connection_id, manifest.transport.provider,
            manifest.transport.workspace_id, manifest.transport.app_id]),
    'WORKSPACE_CONNECTION_REQUIRED', 'The approved Slack workspace connection was not found');
    if (connection.installation_id !== manifest.transport.installation_id || !connection.credential_ref) {
        fail('WORKSPACE_CONNECTION_CONFLICT', 'The Slack workspace connection does not match the manifest');
    }
    const broker = exactlyOne(await rows(client,
        `SELECT credential_ref
           FROM credential_broker_refs
          WHERE credential_ref = $1 AND tenant_id = $2
            AND connection_id = $3 AND connection_revision = $4 ${lock}`,
        [connection.credential_ref, manifest.tenant_id, connection.connection_id,
            connection.connection_revision]),
    'CREDENTIAL_BROKER_REF_REQUIRED', 'The workspace connection has no exact credential broker reference');
    return { ...connection, credential_ref: broker.credential_ref };
}

async function readProject(client, manifest, lock = 'FOR SHARE') {
    return rows(client,
        `SELECT project_id, tenant_id, project_code, project_payload
           FROM tenant_projects
          WHERE tenant_id = $1 AND project_id = $2 AND project_code = $3 ${lock}`,
        [manifest.tenant_id, manifest.project.project_id, manifest.project.project_code]);
}

async function readPerson(client, human, lock = 'FOR SHARE') {
    return rows(client,
        `SELECT id, name, status
           FROM people
          WHERE id = $1 ${lock}`,
        [human.person_id]);
}

async function readMembership(client, manifest, human, lock = 'FOR UPDATE') {
    return rows(client,
        `SELECT membership_id, tenant_id, organization_id, principal_id, membership_payload
           FROM tenant_memberships
          WHERE tenant_id = $1 AND organization_id = $2 AND principal_id = $3
          ORDER BY membership_id LIMIT 2 ${lock}`,
        [manifest.tenant_id, manifest.organization_id, human.person_id]);
}

function expectedProjectCodes(human, projectCode) {
    return human.expected_project_codes.includes(projectCode)
        ? [...human.expected_project_codes]
        : [...human.expected_project_codes, projectCode];
}

function membershipFieldMatches(payload, field, expected, repair, { final = false } = {}) {
    const present = Object.hasOwn(payload, field);
    if (!present) return Boolean(repair?.from_missing && !final);
    const actual = payload[field];
    if (!repair) return actual === expected;
    if (final) return actual === repair.to;
    if (repair.from_missing) return actual === repair.to;
    return actual === repair.from || actual === repair.to;
}

function assertMembership(manifest, human, membershipRows, { final = false } = {}) {
    if (membershipRows.length === 0) fail('MEMBERSHIP_REQUIRED', 'The approved existing tenant membership was not found');
    if (membershipRows.length > 1) fail('MEMBERSHIP_AMBIGUOUS', 'Multiple tenant memberships exist for the approved person');
    const membership = membershipRows[0];
    if (membership.membership_id !== human.membership_id
        || membership.tenant_id !== manifest.tenant_id
        || membership.organization_id !== manifest.organization_id
        || membership.principal_id !== human.person_id) {
        fail('MEMBERSHIP_CONFLICT', 'The existing membership does not match the manifest');
    }
    const payload = membership.membership_payload ?? {};
    const expectedCodes = expectedProjectCodes(human, manifest.project.project_code);
    const repairs = human.membership_repairs;
    const projectCodesMatch = final
        ? same(payload.project_codes, expectedCodes)
        : same(payload.project_codes, human.expected_project_codes)
            || same(payload.project_codes, expectedCodes);
    if (payload.status !== 'active'
        || String(payload.revision) !== human.membership_revision
        || payload.role !== human.expected_role
        || !membershipFieldMatches(payload, 'tenant_role', human.expected_tenant_role,
            repairs.tenant_role, { final })
        || payload.slack_user_id !== human.slack_user_id
        || payload.slack_workspace_id !== manifest.transport.workspace_id
        || !projectCodesMatch
        || !same(payload.clearance, human.expected_clearance)
        || !membershipFieldMatches(payload, 'principal_type', 'person', repairs.principal_type, { final })) {
        fail('MEMBERSHIP_SCOPE_CONFLICT', 'The existing membership is outside the declared additive scope');
    }
    return membership;
}

async function readActiveIdentity(client, manifest, human, lock = 'FOR UPDATE') {
    return rows(client,
        `SELECT identity_id, identity_revision, tenant_id, provider,
                authenticated_subject_id, workspace_id, app_id, membership_id,
                project_id, placement_id, principal_type, status
           FROM company_external_identities
          WHERE tenant_id = $1 AND provider = $2
            AND authenticated_subject_id = $3 AND workspace_id = $4
            AND app_id = $5 AND project_id = $6 AND status = 'active'
          ORDER BY identity_revision DESC LIMIT 2 ${lock}`,
        [manifest.tenant_id, manifest.transport.provider, human.slack_user_id,
            manifest.transport.workspace_id, manifest.transport.app_id, manifest.project.project_id]);
}

function assertIdentity(manifest, human, identityRows, membershipId) {
    if (identityRows.length > 1) fail('EXTERNAL_IDENTITY_AMBIGUOUS', 'Multiple active Slack identities exist');
    if (identityRows.length === 0) return null;
    const identity = identityRows[0];
    if (identity.membership_id !== membershipId
        || identity.tenant_id !== manifest.tenant_id
        || identity.provider !== manifest.transport.provider
        || identity.authenticated_subject_id !== human.slack_user_id
        || identity.workspace_id !== manifest.transport.workspace_id
        || identity.app_id !== manifest.transport.app_id
        || identity.project_id !== manifest.project.project_id
        || identity.placement_id !== human.placement_id
        || identity.principal_type !== 'person'
        || identity.status !== 'active') {
        fail('EXTERNAL_IDENTITY_CONFLICT', 'The existing Slack identity does not match the manifest');
    }
    return identity;
}

async function readMaximumIdentityRevision(client, manifest, human) {
    const row = exactlyOne(await rows(client,
        `SELECT COALESCE(MAX(identity_revision), 0)::text AS max_revision
           FROM company_external_identities
          WHERE tenant_id = $1 AND provider = $2
            AND authenticated_subject_id = $3 AND workspace_id = $4
            AND app_id = $5 AND project_id = $6`,
        [manifest.tenant_id, manifest.transport.provider, human.slack_user_id,
            manifest.transport.workspace_id, manifest.transport.app_id, manifest.project.project_id]),
    'EXTERNAL_IDENTITY_REVISION_READ_FAILED', 'The Slack identity revision could not be read');
    const revision = Number(row.max_revision);
    if (!Number.isSafeInteger(revision) || revision < 0) {
        fail('EXTERNAL_IDENTITY_REVISION_READ_FAILED', 'The Slack identity revision is invalid');
    }
    return revision;
}

function publicPerson(row) {
    return { person_id: row.id, person_name: row.name, status: row.status };
}

function publicProject(row) {
    return row ? { project_id: row.project_id, tenant_id: row.tenant_id, project_code: row.project_code } : null;
}

function publicMembership(row) {
    if (!row) return null;
    const payload = row.membership_payload ?? {};
    const membershipPayload = {
        status: payload.status ?? null,
        revision: payload.revision == null ? null : String(payload.revision),
        role: payload.role ?? null
    };
    const optionalFields = [
        ['tenant_role', (value) => value ?? null],
        ['principal_type', (value) => value ?? null],
        ['slack_user_id', (value) => value ?? null],
        ['slack_workspace_id', (value) => value ?? null],
        ['project_codes', (value) => Array.isArray(value) ? [...value] : null],
        ['clearance', (value) => Array.isArray(value) ? [...value] : null],
        ['placement_id', (value) => value ?? null]
    ];
    for (const [field, normalize] of optionalFields) {
        if (Object.hasOwn(payload, field)) membershipPayload[field] = normalize(payload[field]);
    }
    return {
        membership_id: row.membership_id,
        tenant_id: row.tenant_id,
        organization_id: row.organization_id,
        principal_id: row.principal_id,
        membership_payload: membershipPayload
    };
}

function publicIdentity(row) {
    return row ? {
        identity_id: row.identity_id,
        identity_revision: String(row.identity_revision),
        tenant_id: row.tenant_id,
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

async function readHumanState(client, manifest, human, { final = false, lock = 'FOR UPDATE' } = {}) {
    const person = exactlyOne(await readPerson(client, human, lock), 'PERSON_NOT_FOUND', 'The canonical person was not found');
    if (person.status !== 'active') fail('PERSON_INACTIVE', 'The canonical person is not active');
    const membership = assertMembership(manifest, human, await readMembership(client, manifest, human, lock), { final });
    const identity = assertIdentity(manifest, human, await readActiveIdentity(client, manifest, human, lock), membership.membership_id);
    if (final && !identity) fail('READBACK_FAILED', 'The Slack identity readback is incomplete');
    return { person, membership, identity };
}

async function ensureProject(client, manifest, tenant, plan) {
    const byCode = await rows(client,
        `SELECT project_id, tenant_id, project_code
           FROM tenant_projects
          WHERE tenant_id = $1 AND project_code = $2 FOR UPDATE`,
        [tenant.tenant_id, manifest.project.project_code]);
    const byId = await rows(client,
        `SELECT project_id, tenant_id, project_code
           FROM tenant_projects
          WHERE project_id = $1 FOR UPDATE`,
        [manifest.project.project_id]);
    if (byCode.length > 1 || byId.length > 1) fail('PROJECT_BINDING_AMBIGUOUS', 'Multiple tenant project bindings exist');
    for (const binding of [...byCode, ...byId]) {
        if (binding.tenant_id !== tenant.tenant_id) fail('PROJECT_TENANT_CONFLICT', 'The project belongs to another tenant');
        if (binding.project_id !== manifest.project.project_id || binding.project_code !== manifest.project.project_code) {
            fail('PROJECT_CODE_CONFLICT', 'The project binding conflicts with the manifest');
        }
    }
    if (byCode.length === 1 && byId.length === 1) {
        plan.push({ operation: 'noop', entity: 'tenant_project', id: manifest.project.project_id });
        return byCode[0];
    }
    const inserted = await client.query(
        `INSERT INTO tenant_projects (
            project_id, tenant_id, tenant_revision_at_write, project_code, project_payload
         ) VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT DO NOTHING RETURNING project_id, tenant_id, project_code`,
        [manifest.project.project_id, tenant.tenant_id, Number(tenant.tenant_revision),
            manifest.project.project_code, JSON.stringify({
                source: 'approved_meeting_minutes_projection',
                project_code: manifest.project.project_code
            })]
    );
    if (inserted.rowCount === 1) {
        plan.push({ operation: 'create', entity: 'tenant_project', id: manifest.project.project_id });
        return inserted.rows?.[0] ?? {
            project_id: manifest.project.project_id,
            tenant_id: tenant.tenant_id,
            project_code: manifest.project.project_code
        };
    }
    const codeAfter = await rows(client,
        `SELECT project_id, tenant_id, project_code
           FROM tenant_projects
          WHERE tenant_id = $1 AND project_code = $2 FOR UPDATE`,
        [tenant.tenant_id, manifest.project.project_code]);
    const idAfter = await rows(client,
        `SELECT project_id, tenant_id, project_code
           FROM tenant_projects
          WHERE project_id = $1 FOR UPDATE`,
        [manifest.project.project_id]);
    if (codeAfter.length !== 1 || idAfter.length !== 1
        || codeAfter[0].project_id !== manifest.project.project_id
        || idAfter[0].tenant_id !== tenant.tenant_id
        || idAfter[0].project_code !== manifest.project.project_code) {
        fail('PROJECT_BINDING_CONFLICT', 'The project binding changed concurrently');
    }
    plan.push({ operation: 'noop', entity: 'tenant_project', id: manifest.project.project_id });
    return codeAfter[0];
}

async function ensureMembership(client, manifest, human, plan) {
    const current = assertMembership(manifest, human, await readMembership(client, manifest, human, 'FOR UPDATE'));
    const existingCodes = current.membership_payload.project_codes;
    const desiredCodes = existingCodes.includes(manifest.project.project_code)
        ? existingCodes : [...existingCodes, manifest.project.project_code];
    const payload = { ...current.membership_payload };
    let changed = !same(existingCodes, desiredCodes);
    if (changed) payload.project_codes = desiredCodes;
    for (const [field, repair] of Object.entries(human.membership_repairs)) {
        const present = Object.hasOwn(payload, field);
        const declaredSource = repair.from_missing
            ? !present
            : present && payload[field] === repair.from;
        if (declaredSource) {
            payload[field] = repair.to;
            changed = true;
        } else if (!present || payload[field] !== repair.to) {
            fail('MEMBERSHIP_SCOPE_CONFLICT', 'The existing membership repair field does not match the manifest');
        }
    }
    if (!changed) {
        plan.push({ operation: 'noop', entity: 'tenant_membership', id: current.membership_id });
        return current;
    }
    await client.query(
        `UPDATE tenant_memberships
            SET membership_payload = $2::jsonb
          WHERE tenant_id = $3 AND membership_id = $1`,
        [current.membership_id, JSON.stringify(payload), manifest.tenant_id]
    );
    plan.push({ operation: 'additive_update', entity: 'tenant_membership', id: current.membership_id });
    return { ...current, membership_payload: payload };
}

async function ensureIdentity(client, manifest, human, membershipId, tenantRevision, plan) {
    const active = await readActiveIdentity(client, manifest, human, 'FOR UPDATE');
    const existing = assertIdentity(manifest, human, active, membershipId);
    if (existing) {
        plan.push({ operation: 'noop', entity: 'company_external_identity', id: existing.identity_id });
        return existing;
    }
    const revision = await readMaximumIdentityRevision(client, manifest, human) + 1;
    const identityId = stableId('human_identity', [
        manifest.tenant_id, manifest.transport.provider, human.slack_user_id,
        manifest.transport.workspace_id, manifest.transport.app_id,
        manifest.project.project_id, revision
    ]);
    await client.query(
        `INSERT INTO company_external_identities (
            identity_id, identity_revision, tenant_id, tenant_revision_at_write,
            provider, authenticated_subject_id, workspace_id, app_id,
            membership_id, project_id, placement_id, principal_type,
            status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'person', 'active', now(), now())`,
        [identityId, revision, manifest.tenant_id, tenantRevision,
            manifest.transport.provider, human.slack_user_id, manifest.transport.workspace_id,
            manifest.transport.app_id, membershipId, manifest.project.project_id, human.placement_id]
    );
    plan.push({ operation: 'create', entity: 'company_external_identity', id: identityId });
    return {
        identity_id: identityId,
        identity_revision: revision,
        tenant_id: manifest.tenant_id,
        provider: manifest.transport.provider,
        authenticated_subject_id: human.slack_user_id,
        workspace_id: manifest.transport.workspace_id,
        app_id: manifest.transport.app_id,
        membership_id: membershipId,
        project_id: manifest.project.project_id,
        placement_id: human.placement_id,
        principal_type: 'person',
        status: 'active'
    };
}

async function readSnapshot(client, manifest, { tenant, connection, final = true } = {}) {
    const project = exactlyOne(await readProject(client, manifest, 'FOR SHARE'), 'READBACK_FAILED', 'Tenant project readback is incomplete');
    const humans = [];
    for (const human of manifest.humans) {
        const state = await readHumanState(client, manifest, human, { final, lock: 'FOR SHARE' });
        humans.push({
            person: publicPerson(state.person),
            membership: publicMembership(state.membership),
            external_identity: publicIdentity(state.identity)
        });
    }
    return {
        tenant_id: tenant.tenant_id,
        tenant_key: tenant.tenant_key,
        organization_id: manifest.organization_id,
        project: publicProject(project),
        connection: {
            connection_id: connection.connection_id,
            connection_revision: String(connection.connection_revision),
            provider: connection.provider,
            installation_id: connection.installation_id,
            workspace_id: connection.workspace_id,
            app_id: connection.app_id,
            status: connection.status
        },
        humans
    };
}

/**
 * Add one or more approved project projections to existing tenant memberships.
 * This function intentionally never reads or writes auth_grants.
 */
export async function provisionTenantProjectIdentity({
    client, manifest: rawManifest, actorId, projectResolver, commit = false
} = {}) {
    if (!client?.query) fail('DATABASE_CONFIG_REQUIRED', 'A PostgreSQL client is required');
    if (!projectResolver?.resolveCanonicalProject) fail('PROJECT_RESOLVER_REQUIRED', 'A canonical project resolver is required');
    requireActor(actorId);
    const manifest = normalizeTenantProjectIdentityManifest(rawManifest);
    let began = false;
    let operation = 'project_resolve';
    try {
        await resolveProject(projectResolver, manifest);
        operation = 'transaction_begin';
        await client.query('BEGIN');
        began = true;
        operation = 'lock_timeout';
        await client.query("SET LOCAL lock_timeout = '5s'");
        operation = 'tenant_context';
        await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [manifest.tenant_id]);
        operation = 'advisory_lock';
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
            `tenant-project-identity:${manifest.tenant_id}:${manifest.project.project_id}`
        ]);
        operation = 'tenant_read';
        const tenant = await readTenant(client, manifest);
        operation = 'organization_read';
        const organization = exactlyOne(await readOrganization(client, manifest, 'FOR UPDATE'),
            'ORGANIZATION_NOT_FOUND', 'The existing tenant organization was not found');
        operation = 'workspace_connection_read';
        const connection = await readConnection(client, manifest, 'FOR UPDATE');
        operation = 'project_read';
        const beforeProjectRows = await readProject(client, manifest, 'FOR SHARE');
        if (beforeProjectRows.length > 1) {
            fail('PROJECT_BINDING_AMBIGUOUS', 'Multiple tenant project bindings exist');
        }
        const beforeProject = beforeProjectRows[0] ?? null;
        const beforeHumans = [];
        for (const [index, human] of manifest.humans.entries()) {
            operation = `human_read_${index}`;
            const state = await readHumanState(client, manifest, human, { final: false, lock: 'FOR UPDATE' });
            beforeHumans.push({
                person: publicPerson(state.person),
                membership: publicMembership(state.membership),
                external_identity: publicIdentity(state.identity)
            });
        }
        const plan = [];
        operation = 'project_ensure';
        await ensureProject(client, manifest, tenant, plan);
        for (const [index, human] of manifest.humans.entries()) {
            operation = `membership_ensure_${index}`;
            const membership = await ensureMembership(client, manifest, human, plan);
            operation = `identity_ensure_${index}`;
            await ensureIdentity(client, manifest, human, membership.membership_id,
                tenant.tenant_revision, plan);
        }
        operation = 'readback';
        const snapshotAfter = await readSnapshot(client, manifest, { tenant, connection, final: true });
        operation = 'transaction_commit';
        await client.query(commit ? 'COMMIT' : 'ROLLBACK');
        began = false;
        return {
            persisted: Boolean(commit),
            manifest_version: manifest.version,
            applied_by: actorId,
            tenant_id: tenant.tenant_id,
            tenant_key: tenant.tenant_key,
            organization_id: organization.organization_id,
            project_id: manifest.project.project_id,
            project_code: manifest.project.project_code,
            snapshot_before: { tenant_id: tenant.tenant_id, project: publicProject(beforeProject), humans: beforeHumans },
            plan,
            snapshot_after: snapshotAfter
        };
    } catch (error) {
        if (began) {
            try { await client.query('ROLLBACK'); } catch { /* preserve the first failure */ }
        }
        throw annotateKnownError(error, operation);
    }
}

/** Read the committed tenant projection in a separate RLS transaction. */
export async function readbackTenantProjectIdentity({ client, manifest: rawManifest } = {}) {
    if (!client?.query) fail('DATABASE_CONFIG_REQUIRED', 'A PostgreSQL client is required');
    const manifest = normalizeTenantProjectIdentityManifest(rawManifest);
    let began = false;
    let operation = 'transaction_begin';
    try {
        await client.query('BEGIN');
        began = true;
        operation = 'tenant_context';
        await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [manifest.tenant_id]);
        operation = 'tenant_read';
        const tenant = await readTenant(client, manifest, 'FOR SHARE');
        operation = 'organization_read';
        const organization = exactlyOne(await readOrganization(client, manifest, 'FOR SHARE'),
            'READBACK_FAILED', 'Tenant organization readback is incomplete');
        operation = 'workspace_connection_read';
        const connection = await readConnection(client, manifest, 'FOR SHARE');
        operation = 'readback';
        const snapshot = await readSnapshot(client, manifest, { tenant, connection, final: true });
        operation = 'transaction_rollback';
        await client.query('ROLLBACK');
        began = false;
        return { ...snapshot, organization_id: organization.organization_id };
    } catch (error) {
        if (began) {
            try { await client.query('ROLLBACK'); } catch { /* preserve the first failure */ }
        }
        if (error instanceof TenantProjectIdentityProvisioningError) {
            if (!error.operation && SAFE_OPERATION.test(operation)) error.operation = operation;
            throw error;
        }
        throw wrapUnexpectedError(
            error,
            operation,
            'READBACK_FAILED',
            'Tenant project identity readback failed; inspect control-plane logs'
        );
    }
}

export { VERSION as TENANT_PROJECT_IDENTITY_MANIFEST_VERSION };
