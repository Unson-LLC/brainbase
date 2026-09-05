import { createHash } from 'node:crypto';

import { canonicalJson, deepFreeze } from './canonical-json.js';
import { isCanonicalId } from './ids.js';

const VERSION = 'human-company-authority.v1';
const TENANT_ID = /^ten_[0-9A-HJKMNP-TV-Z]{26}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const ROLES = new Set(['member', 'gm', 'ceo']);
const TENANT_ROLES = new Set(['member', 'tenant_admin']);
const ROOT_KEYS = new Set(['version', 'tenant_id', 'organization', 'project', 'transport', 'humans']);
const ORGANIZATION_KEYS = new Set(['organization_id', 'graph_organization_id', 'display_name']);
const PROJECT_KEYS = new Set(['project_id', 'project_code']);
const TRANSPORT_KEYS = new Set(['provider', 'workspace_id', 'app_id']);
const HUMAN_KEYS = new Set([
    'person_id', 'person_name', 'slack_user_id', 'login_role', 'project_codes',
    'clearance', 'tenant_role', 'placement_id'
]);
const SECRET_KEY = /(?:access|refresh)[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?value|oauth[_-]?(?:token|code)|bearer[_-]?token/iu;
const SECRET_VALUE = /(?:^xox[baprs]-|^sk-[A-Za-z0-9]|^gh[pousr]_[A-Za-z0-9_]{20,}|^ya29\.[A-Za-z0-9_-]{20,}|^AKIA[A-Z0-9]{16}$|^Bearer\s+\S{20,}|^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$|-----BEGIN [A-Z ]+-----)/u;

export class HumanCompanyAuthorityProvisioningError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'HumanCompanyAuthorityProvisioningError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new HumanCompanyAuthorityProvisioningError(code, message);
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

function strings(value, field) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
        fail('MANIFEST_INVALID', `${field} must be a bounded non-empty array`);
    }
    const normalized = value.map((item, index) => text(item, `${field}[${index}]`));
    if (new Set(normalized).size !== normalized.length) fail('MANIFEST_INVALID', `${field} contains duplicates`);
    return normalized.sort((left, right) => left.localeCompare(right));
}

function normalizeHuman(value, index) {
    const field = `humans[${index}]`;
    record(value, field);
    knownKeys(value, HUMAN_KEYS, field);
    const loginRole = text(value.login_role, `${field}.login_role`);
    const tenantRole = text(value.tenant_role, `${field}.tenant_role`);
    if (!ROLES.has(loginRole)) fail('MANIFEST_INVALID', `${field}.login_role is invalid`);
    if (!TENANT_ROLES.has(tenantRole)) fail('MANIFEST_INVALID', `${field}.tenant_role is invalid`);
    const personId = text(value.person_id, `${field}.person_id`);
    if (!isCanonicalId(personId, 'per')) fail('MANIFEST_INVALID', `${field}.person_id is invalid`);
    return {
        person_id: personId,
        person_name: text(value.person_name, `${field}.person_name`, null, 200),
        slack_user_id: text(value.slack_user_id, `${field}.slack_user_id`),
        login_role: loginRole,
        project_codes: strings(value.project_codes, `${field}.project_codes`),
        clearance: strings(value.clearance, `${field}.clearance`),
        tenant_role: tenantRole,
        placement_id: text(value.placement_id, `${field}.placement_id`)
    };
}

export function normalizeHumanCompanyAuthorityManifest(value) {
    scanSecrets(value);
    record(value, 'manifest');
    knownKeys(value, ROOT_KEYS, 'manifest');
    if (value.version !== VERSION) fail('MANIFEST_INVALID', 'manifest.version is invalid');
    const organization = record(value.organization, 'organization');
    const project = record(value.project, 'project');
    const transport = record(value.transport, 'transport');
    knownKeys(organization, ORGANIZATION_KEYS, 'organization');
    knownKeys(project, PROJECT_KEYS, 'project');
    knownKeys(transport, TRANSPORT_KEYS, 'transport');
    if (transport.provider !== 'slack') fail('MANIFEST_INVALID', 'transport.provider must be slack');
    if (!Array.isArray(value.humans) || value.humans.length === 0 || value.humans.length > 32) {
        fail('MANIFEST_INVALID', 'humans must be a bounded non-empty array');
    }
    const humans = value.humans.map(normalizeHuman);
    const projectCode = text(project.project_code, 'project.project_code');
    for (const [index, human] of humans.entries()) {
        if (human.project_codes.length !== 1 || human.project_codes[0] !== projectCode) {
            fail('MANIFEST_PROJECT_SCOPE_MISMATCH',
                `humans[${index}].project_codes must contain only the declared tenant project`);
        }
    }
    for (const key of ['person_id', 'slack_user_id', 'placement_id']) {
        if (new Set(humans.map((human) => human[key])).size !== humans.length) {
            fail('MANIFEST_INVALID', `humans contains duplicate ${key}`);
        }
    }
    return deepFreeze({
        version: VERSION,
        tenant_id: text(value.tenant_id, 'tenant_id', TENANT_ID),
        organization: {
            organization_id: text(organization.organization_id, 'organization.organization_id'),
            graph_organization_id: text(organization.graph_organization_id, 'organization.graph_organization_id'),
            display_name: text(organization.display_name, 'organization.display_name', null, 200)
        },
        project: {
            project_id: text(project.project_id, 'project.project_id'),
            project_code: projectCode
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

function organizationPayload(manifest) {
    return {
        status: 'active',
        graph_organization_id: manifest.organization.graph_organization_id,
        display_name: manifest.organization.display_name
    };
}

function membershipPayload(manifest, human) {
    return {
        status: 'active',
        revision: '1',
        principal_type: 'person',
        role: human.login_role,
        tenant_role: human.tenant_role,
        slack_user_id: human.slack_user_id,
        slack_workspace_id: manifest.transport.workspace_id,
        project_codes: human.project_codes,
        clearance: human.clearance,
        placement_id: human.placement_id
    };
}

function publicOrganization(row) {
    return row ? {
        organization_id: row.organization_id,
        organization_payload: row.organization_payload
    } : null;
}

function publicPerson(row) {
    return row ? { person_id: row.id, person_name: row.name, status: row.status } : null;
}

function publicGrant(row) {
    return row ? {
        grant_id: row.id,
        person_id: row.person_id,
        person_name: row.person_name,
        slack_user_id: row.slack_user_id,
        slack_workspace_id: row.slack_workspace_id,
        role: row.role,
        project_codes: [...row.project_codes].sort((a, b) => a.localeCompare(b)),
        clearance: [...row.clearance].sort((a, b) => a.localeCompare(b)),
        active: row.active
    } : null;
}

function publicMembership(row) {
    return row ? {
        membership_id: row.membership_id,
        organization_id: row.organization_id,
        principal_id: row.principal_id,
        membership_payload: row.membership_payload
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

async function readFoundation(client, manifest) {
    const tenant = exactlyOne(await rows(client,
        `SELECT tenant_id, tenant_key, tenant_revision, status
           FROM brainbase_tenants WHERE tenant_id = $1 FOR UPDATE`,
        [manifest.tenant_id]), 'TENANT_NOT_FOUND', 'Tenant was not found');
    if (tenant.status !== 'active') fail('TENANT_INACTIVE', 'Tenant must be active');
    const project = exactlyOne(await rows(client,
        `SELECT project_id, project_code FROM tenant_projects
          WHERE tenant_id = $1 AND project_id = $2 AND project_code = $3 FOR SHARE`,
        [manifest.tenant_id, manifest.project.project_id, manifest.project.project_code]),
    'PROJECT_NOT_FOUND', 'Project was not found in the tenant');
    const graphOrganization = exactlyOne(await rows(client,
        `SELECT id, name FROM organizations
          WHERE id = $1 FOR SHARE`,
        [manifest.organization.graph_organization_id]),
    'GRAPH_ORGANIZATION_NOT_FOUND', 'Graph organization was not found');
    const connections = await rows(client,
        `SELECT connection_id, connection_revision, provider, workspace_id, app_id, status
           FROM workspace_connections
          WHERE tenant_id = $1 AND provider = $2 AND workspace_id = $3 AND app_id = $4
            AND status = 'active'
          ORDER BY connection_revision DESC LIMIT 2 FOR SHARE`,
        [manifest.tenant_id, manifest.transport.provider,
            manifest.transport.workspace_id, manifest.transport.app_id]);
    const workspaceConnection = exactlyOne(connections,
        connections.length === 0 ? 'WORKSPACE_CONNECTION_NOT_FOUND' : 'WORKSPACE_CONNECTION_AMBIGUOUS',
        connections.length === 0
            ? 'Active workspace connection was not found in the tenant'
            : 'Multiple active workspace connections were found in the tenant');
    return { tenant, project, graphOrganization, workspaceConnection };
}

async function readOrganization(client, manifest) {
    return rows(client,
        `SELECT organization_id, organization_payload FROM tenant_organizations
          WHERE tenant_id = $1 AND organization_id = $2 FOR UPDATE`,
        [manifest.tenant_id, manifest.organization.organization_id]);
}

async function prepareOrganization(client, manifest, tenantRevision, plan) {
    const found = await readOrganization(client, manifest);
    if (found.length > 1) fail('ORGANIZATION_AMBIGUOUS', 'Multiple tenant organizations exist');
    const desired = {
        organization_id: manifest.organization.organization_id,
        organization_payload: organizationPayload(manifest)
    };
    if (found.length === 1) {
        if (!same(publicOrganization(found[0]), desired)) {
            fail('ORGANIZATION_CONFLICT', 'Existing tenant organization differs from desired state');
        }
        plan.push({ operation: 'noop', entity: 'tenant_organization', id: desired.organization_id });
        return;
    }
    try {
        await client.query(
            `INSERT INTO tenant_organizations (
                organization_id, tenant_id, tenant_revision_at_write, organization_payload
             ) VALUES ($1, $2, $3, $4::jsonb)`,
            [desired.organization_id, manifest.tenant_id, tenantRevision, JSON.stringify(desired.organization_payload)]
        );
    } catch (error) {
        if (error?.code === '23505') {
            fail('ORGANIZATION_CROSS_TENANT_CONFLICT', 'Organization ID is already owned outside this tenant');
        }
        throw error;
    }
    plan.push({ operation: 'create', entity: 'tenant_organization', id: desired.organization_id });
}

async function readPerson(client, human) {
    return rows(client, 'SELECT id, name, status FROM people WHERE id = $1 FOR UPDATE', [human.person_id]);
}

async function preparePerson(client, human, plan) {
    const found = await readPerson(client, human);
    if (found.length > 1) fail('PERSON_AMBIGUOUS', 'Multiple people exist');
    const desired = { person_id: human.person_id, person_name: human.person_name, status: 'active' };
    if (found.length === 1) {
        if (!same(publicPerson(found[0]), desired)) fail('PERSON_CONFLICT', 'Existing person differs from desired state');
        plan.push({ operation: 'noop', entity: 'person', id: human.person_id });
        return;
    }
    await client.query('INSERT INTO people (id, name, status) VALUES ($1, $2, \'active\')',
        [human.person_id, human.person_name]);
    plan.push({ operation: 'create', entity: 'person', id: human.person_id });
}

async function readGrant(client, manifest, human) {
    return rows(client,
        `SELECT id, person_id, person_name, slack_user_id, slack_workspace_id,
                role, project_codes, clearance, active
           FROM auth_grants
          WHERE slack_user_id = $1 AND slack_workspace_id = $2
          ORDER BY id LIMIT 2 FOR UPDATE`,
        [human.slack_user_id, manifest.transport.workspace_id]);
}

function desiredGrant(manifest, human, id) {
    return {
        grant_id: id,
        person_id: human.person_id,
        person_name: human.person_name,
        slack_user_id: human.slack_user_id,
        slack_workspace_id: manifest.transport.workspace_id,
        role: human.login_role,
        project_codes: human.project_codes,
        clearance: human.clearance,
        active: true
    };
}

async function prepareGrant(client, manifest, human, plan) {
    const found = await readGrant(client, manifest, human);
    if (found.length > 1) fail('AUTH_GRANT_AMBIGUOUS', 'Multiple login grants exist');
    if (found.length === 1) {
        const desired = desiredGrant(manifest, human, found[0].id);
        if (!same(publicGrant(found[0]), desired)) fail('AUTH_GRANT_CONFLICT', 'Existing login grant differs from desired state');
        plan.push({ operation: 'noop', entity: 'auth_grant', id: found[0].id });
        return found[0].id;
    }
    const id = stableId('grant', [manifest.transport.workspace_id, human.slack_user_id]);
    await client.query(
        `INSERT INTO auth_grants (
            id, person_id, person_name, slack_user_id, slack_workspace_id,
            role, project_codes, clearance, active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::text[], true)`,
        [id, human.person_id, human.person_name, human.slack_user_id,
            manifest.transport.workspace_id, human.login_role, human.project_codes, human.clearance]
    );
    plan.push({ operation: 'create', entity: 'auth_grant', id });
    return id;
}

async function readMembership(client, manifest, human) {
    return rows(client,
        `SELECT membership_id, organization_id, principal_id, membership_payload
           FROM tenant_memberships
          WHERE tenant_id = $1 AND organization_id = $2 AND principal_id = $3
          ORDER BY membership_id LIMIT 2 FOR UPDATE`,
        [manifest.tenant_id, manifest.organization.organization_id, human.person_id]);
}

async function prepareMembership(client, manifest, human, tenantRevision, plan) {
    const found = await readMembership(client, manifest, human);
    if (found.length > 1) fail('MEMBERSHIP_AMBIGUOUS', 'Multiple tenant memberships exist');
    const payload = membershipPayload(manifest, human);
    if (found.length === 1) {
        const desired = {
            membership_id: found[0].membership_id,
            organization_id: manifest.organization.organization_id,
            principal_id: human.person_id,
            membership_payload: payload
        };
        if (!same(publicMembership(found[0]), desired)) fail('MEMBERSHIP_CONFLICT', 'Existing membership differs from desired state');
        plan.push({ operation: 'noop', entity: 'tenant_membership', id: found[0].membership_id });
        return found[0].membership_id;
    }
    const id = stableId('human_membership', [manifest.tenant_id, manifest.organization.organization_id, human.person_id]);
    await client.query(
        `INSERT INTO tenant_memberships (
            membership_id, tenant_id, tenant_revision_at_write,
            organization_id, principal_id, membership_payload
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [id, manifest.tenant_id, tenantRevision, manifest.organization.organization_id,
            human.person_id, JSON.stringify(payload)]
    );
    plan.push({ operation: 'create', entity: 'tenant_membership', id });
    return id;
}

async function readActiveIdentities(client, manifest, human) {
    return rows(client,
        `SELECT identity_id, identity_revision, provider, authenticated_subject_id,
                workspace_id, app_id, membership_id, project_id, placement_id,
                principal_type, status
           FROM company_external_identities
          WHERE tenant_id = $1 AND provider = 'slack'
            AND authenticated_subject_id = $2 AND workspace_id = $3
            AND app_id = $4 AND project_id = $5 AND status = 'active'
          ORDER BY identity_revision DESC LIMIT 2 FOR UPDATE`,
        [manifest.tenant_id, human.slack_user_id, manifest.transport.workspace_id,
            manifest.transport.app_id, manifest.project.project_id]);
}

async function readMaximumIdentityRevision(client, manifest, human) {
    const found = exactlyOne(await rows(client,
        `SELECT COALESCE(MAX(identity_revision), 0)::text AS max_revision
           FROM company_external_identities
          WHERE tenant_id = $1 AND provider = 'slack'
            AND authenticated_subject_id = $2 AND workspace_id = $3
            AND app_id = $4 AND project_id = $5`,
        [manifest.tenant_id, human.slack_user_id, manifest.transport.workspace_id,
            manifest.transport.app_id, manifest.project.project_id]),
    'EXTERNAL_IDENTITY_REVISION_READ_FAILED', 'External identity revision could not be read');
    return Number(found.max_revision);
}

function desiredIdentity(manifest, human, membershipId, revision, id = null) {
    return {
        identity_id: id ?? stableId('human_identity', [manifest.tenant_id, human.slack_user_id,
            manifest.transport.workspace_id, manifest.transport.app_id, manifest.project.project_id, revision]),
        identity_revision: String(revision),
        provider: 'slack',
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

async function prepareIdentity(client, manifest, human, membershipId, tenantRevision, plan) {
    const active = await readActiveIdentities(client, manifest, human);
    if (active.length > 1) fail('EXTERNAL_IDENTITY_AMBIGUOUS', 'Multiple active external identities exist');
    if (active.length === 1) {
        const desired = desiredIdentity(manifest, human, membershipId, active[0].identity_revision, active[0].identity_id);
        if (!same(publicIdentity(active[0]), desired)) fail('EXTERNAL_IDENTITY_CONFLICT', 'Existing external identity differs from desired state');
        plan.push({ operation: 'noop', entity: 'company_external_identity', id: active[0].identity_id });
        return active[0].identity_id;
    }
    const revision = await readMaximumIdentityRevision(client, manifest, human) + 1;
    const desired = desiredIdentity(manifest, human, membershipId, revision);
    await client.query(
        `INSERT INTO company_external_identities (
            identity_id, identity_revision, tenant_id, tenant_revision_at_write,
            provider, authenticated_subject_id, workspace_id, app_id,
            membership_id, project_id, placement_id, principal_type,
            status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 'slack', $5, $6, $7, $8, $9, $10, 'person', 'active', now(), now())`,
        [desired.identity_id, revision, manifest.tenant_id, tenantRevision,
            human.slack_user_id, manifest.transport.workspace_id, manifest.transport.app_id,
            membershipId, manifest.project.project_id, human.placement_id]
    );
    plan.push({ operation: 'create', entity: 'company_external_identity', id: desired.identity_id });
    return desired.identity_id;
}

async function readSnapshot(client, manifest, human) {
    const people = await readPerson(client, human);
    const grants = await readGrant(client, manifest, human);
    const memberships = await readMembership(client, manifest, human);
    const activeIdentities = await readActiveIdentities(client, manifest, human);
    if (people.length !== 1 || grants.length !== 1 || memberships.length !== 1 || activeIdentities.length !== 1) {
        fail('READBACK_FAILED', 'Human access readback is incomplete or ambiguous');
    }
    return {
        person: publicPerson(people[0]),
        login_grant: publicGrant(grants[0]),
        membership: publicMembership(memberships[0]),
        external_identity: publicIdentity(activeIdentities[0])
    };
}

export async function provisionHumanCompanyAuthority({ client, manifest: rawManifest, actorId, commit = false } = {}) {
    if (!client?.query) fail('DATABASE_CONFIG_REQUIRED', 'A PostgreSQL client is required');
    if (typeof actorId !== 'string' || actorId.trim().length === 0 || actorId.length > 128) {
        fail('ACTOR_REQUIRED', 'A bounded provisioning actor is required');
    }
    const manifest = normalizeHumanCompanyAuthorityManifest(rawManifest);
    let began = false;
    try {
        await client.query('BEGIN');
        began = true;
        await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [manifest.tenant_id]);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            `human-company-authority:${manifest.tenant_id}:${manifest.organization.organization_id}`
        ]);
        const foundation = await readFoundation(client, manifest);
        const beforeOrganization = await readOrganization(client, manifest);
        const before = { organization: beforeOrganization.length === 1 ? publicOrganization(beforeOrganization[0]) : null, humans: [] };
        for (const human of manifest.humans) {
            const [people, grants, memberships, identities] = await Promise.all([
                readPerson(client, human), readGrant(client, manifest, human),
                readMembership(client, manifest, human), readActiveIdentities(client, manifest, human)
            ]);
            before.humans.push({
                person_id: human.person_id,
                person: people.length === 1 ? publicPerson(people[0]) : null,
                login_grant: grants.length === 1 ? publicGrant(grants[0]) : null,
                membership: memberships.length === 1 ? publicMembership(memberships[0]) : null,
                external_identity: identities.length === 1 ? publicIdentity(identities[0]) : null
            });
        }
        const plan = [];
        await prepareOrganization(client, manifest, foundation.tenant.tenant_revision, plan);
        for (const human of manifest.humans) {
            await preparePerson(client, human, plan);
            await prepareGrant(client, manifest, human, plan);
            const membershipId = await prepareMembership(client, manifest, human, foundation.tenant.tenant_revision, plan);
            await prepareIdentity(client, manifest, human, membershipId, foundation.tenant.tenant_revision, plan);
        }
        const after = {
            organization: publicOrganization(exactlyOne(await readOrganization(client, manifest),
                'READBACK_FAILED', 'Organization readback is incomplete or ambiguous')),
            humans: []
        };
        for (const human of manifest.humans) {
            after.humans.push({ person_id: human.person_id, ...await readSnapshot(client, manifest, human) });
        }
        if (commit) await client.query('COMMIT');
        else await client.query('ROLLBACK');
        began = false;
        return {
            persisted: commit,
            manifest_version: manifest.version,
            tenant_id: manifest.tenant_id,
            tenant_key: foundation.tenant.tenant_key,
            organization_id: manifest.organization.organization_id,
            project_id: manifest.project.project_id,
            project_code: manifest.project.project_code,
            applied_by: actorId,
            snapshot_before: before,
            plan,
            snapshot_after: after
        };
    } catch (error) {
        if (began) {
            try { await client.query('ROLLBACK'); } catch { /* preserve the first error */ }
        }
        if (error instanceof HumanCompanyAuthorityProvisioningError) throw error;
        throw new HumanCompanyAuthorityProvisioningError(
            'UPSTREAM_UNAVAILABLE',
            'Human company authority provisioning failed; inspect control-plane logs'
        );
    }
}

export async function readbackHumanCompanyAuthority({ client, manifest: rawManifest } = {}) {
    if (!client?.query) fail('DATABASE_CONFIG_REQUIRED', 'A PostgreSQL client is required');
    const manifest = normalizeHumanCompanyAuthorityManifest(rawManifest);
    let began = false;
    try {
        await client.query('BEGIN');
        began = true;
        await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [manifest.tenant_id]);
        await readFoundation(client, manifest);
        const organization = publicOrganization(exactlyOne(await readOrganization(client, manifest),
            'READBACK_FAILED', 'Organization readback is incomplete or ambiguous'));
        const humans = [];
        for (const human of manifest.humans) {
            humans.push({ person_id: human.person_id, ...await readSnapshot(client, manifest, human) });
        }
        await client.query('ROLLBACK');
        began = false;
        return { organization, humans };
    } catch (error) {
        if (began) {
            try { await client.query('ROLLBACK'); } catch { /* preserve the first error */ }
        }
        if (error instanceof HumanCompanyAuthorityProvisioningError) throw error;
        throw new HumanCompanyAuthorityProvisioningError(
            'UPSTREAM_UNAVAILABLE',
            'Human company authority readback failed; inspect control-plane logs'
        );
    }
}
