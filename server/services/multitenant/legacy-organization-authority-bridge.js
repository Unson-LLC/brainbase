import { createHash } from 'node:crypto';

const VERSION = 'legacy-organization-authority-bridge.v1';
const TENANT_ID = /^ten_[0-9A-HJKMNP-TV-Z]{26}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const KEYS = new Set(['version', 'tenant_id', 'organization_id', 'tenant_organization_id', 'project_id', 'project_code', 'person_id', 'slack_user_id', 'slack_workspace_id']);
const SECRET_KEY = /(?:token|secret|private[_-]?key|oauth|credential)/iu;

export class LegacyOrganizationAuthorityBridgeError extends Error {
    constructor(code, message) { super(message); this.name = 'LegacyOrganizationAuthorityBridgeError'; this.code = code; }
}

function fail(code, message) { throw new LegacyOrganizationAuthorityBridgeError(code, message); }
function text(value, field, pattern = ID) {
    if (typeof value !== 'string' || !pattern.test(value)) fail('MANIFEST_INVALID', `${field} is invalid`);
    return value;
}
function stableId(parts) { return `legacy_membership_${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)}`; }
async function rows(client, sql, params = []) { return (await client.query(sql, params)).rows ?? []; }
function one(found, code, message) { if (found.length !== 1) fail(code, message); return found[0]; }

export function normalizeLegacyOrganizationAuthorityBridgeManifest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('MANIFEST_INVALID', 'manifest must be an object');
    for (const key of Object.keys(value)) {
        if (!KEYS.has(key)) fail(SECRET_KEY.test(key) ? 'MANIFEST_SECRET_FORBIDDEN' : 'MANIFEST_FIELD_FORBIDDEN', `${key} is not allowed`);
    }
    if (value.version !== VERSION) fail('MANIFEST_INVALID', 'version is invalid');
    return Object.freeze({
        version: VERSION,
        tenant_id: text(value.tenant_id, 'tenant_id', TENANT_ID),
        organization_id: text(value.organization_id, 'organization_id'),
        tenant_organization_id: text(value.tenant_organization_id, 'tenant_organization_id', TENANT_ID),
        project_id: text(value.project_id, 'project_id'),
        project_code: text(value.project_code, 'project_code'),
        person_id: text(value.person_id, 'person_id'),
        slack_user_id: text(value.slack_user_id, 'slack_user_id'),
        slack_workspace_id: text(value.slack_workspace_id, 'slack_workspace_id')
    });
}

function membershipPayload(manifest, grant) {
    return {
        status: 'active', revision: '1', principal_type: 'person', role: grant.role,
        tenant_role: grant.role === 'ceo' ? 'tenant_admin' : 'member',
        slack_user_id: manifest.slack_user_id, slack_workspace_id: manifest.slack_workspace_id,
        project_codes: [...grant.project_codes].sort(), clearance: [...grant.clearance].sort(),
        placement_id: `legacy-slack:${manifest.slack_workspace_id}:${manifest.slack_user_id}`
    };
}

async function foundation(client, manifest, lock = 'FOR UPDATE') {
    const tenant = one(await rows(client, `SELECT tenant_id, tenant_key, tenant_revision, status FROM brainbase_tenants WHERE tenant_id=$1 ${lock}`, [manifest.tenant_id]), 'TENANT_NOT_FOUND', 'Tenant was not found');
    if (tenant.status !== 'active') fail('TENANT_INACTIVE', 'Tenant must be active');
    one(await rows(client, 'SELECT id FROM organizations WHERE id=$1 FOR SHARE', [manifest.organization_id]), 'GRAPH_ORGANIZATION_NOT_FOUND', 'Graph organization was not found');
    one(await rows(client, 'SELECT id, code FROM projects WHERE id=$1 AND code=$2 AND organization_id=$3 FOR SHARE', [manifest.project_id, manifest.project_code, manifest.organization_id]), 'GRAPH_PROJECT_OWNERSHIP_MISMATCH', 'Graph project does not belong to the declared organization');
    one(await rows(client, 'SELECT id FROM people WHERE id=$1 AND status=\'active\' FOR SHARE', [manifest.person_id]), 'PERSON_NOT_FOUND', 'Active person was not found');
    const grant = one(await rows(client, `SELECT id, person_id, role, project_codes, clearance FROM auth_grants WHERE slack_user_id=$1 AND slack_workspace_id=$2 AND organization_id=$3 AND active=true ORDER BY id LIMIT 2 FOR SHARE`, [manifest.slack_user_id, manifest.slack_workspace_id, manifest.organization_id]), 'AUTH_GRANT_NOT_UNIQUE', 'Exactly one active auth grant is required');
    if (grant.person_id !== manifest.person_id || !grant.project_codes.includes(manifest.project_code)) fail('AUTH_GRANT_SCOPE_MISMATCH', 'Auth grant does not authorize the declared person and project');
    return { tenant, grant };
}

async function ensureProject(client, manifest, tenant, plan) {
    const existing = await rows(client, 'SELECT project_id, tenant_id, project_code, project_payload FROM tenant_projects WHERE project_id=$1 OR (tenant_id=$2 AND project_code=$3) FOR UPDATE', [manifest.project_id, manifest.tenant_id, manifest.project_code]);
    const desired = { project_id: manifest.project_id, tenant_id: manifest.tenant_id, project_code: manifest.project_code, project_payload: { source: 'canonical_graph_project', project_code: manifest.project_code } };
    if (existing.length) {
        const current = existing[0];
        const sameOwnership = existing.length === 1
            && current.project_id === desired.project_id
            && current.tenant_id === desired.tenant_id
            && current.project_code === desired.project_code
            && current.project_payload?.project_code === desired.project_payload.project_code;
        if (!sameOwnership) fail('TENANT_PROJECT_CONFLICT', 'Tenant project projection conflicts with desired state');
        plan.push({ operation: 'noop', entity: 'tenant_project', id: manifest.project_id }); return;
    }
    await client.query('INSERT INTO tenant_projects (project_id, tenant_id, tenant_revision_at_write, project_code, project_payload) VALUES ($1,$2,$3,$4,$5::jsonb)', [manifest.project_id, manifest.tenant_id, tenant.tenant_revision, manifest.project_code, JSON.stringify(desired.project_payload)]);
    plan.push({ operation: 'create', entity: 'tenant_project', id: manifest.project_id });
}

async function ensureOrganization(client, manifest, tenant, plan) {
    const existing = await rows(client, 'SELECT organization_id, tenant_id, organization_payload FROM tenant_organizations WHERE organization_id IN ($1,$2) FOR UPDATE', [manifest.tenant_organization_id, manifest.organization_id]);
    const desired = { organization_id: manifest.tenant_organization_id, tenant_id: manifest.tenant_id, organization_payload: { status: 'active', graph_organization_id: manifest.organization_id } };
    const canonical = existing.filter((entry) => entry.organization_id === manifest.tenant_organization_id);
    const legacyAlias = manifest.organization_id === manifest.tenant_organization_id
        ? []
        : existing.filter((entry) => entry.organization_id === manifest.organization_id);
    if (canonical.length > 1 || legacyAlias.length > 1) fail('TENANT_ORGANIZATION_CONFLICT', 'Tenant organization projection is ambiguous');
    if (legacyAlias.length && legacyAlias[0].tenant_id !== manifest.tenant_id) {
        fail('TENANT_ORGANIZATION_CONFLICT', 'Legacy organization alias belongs to another tenant');
    }
    if (canonical.length) {
        const current = canonical[0];
        const sameOwnership = current.organization_id === desired.organization_id
            && current.tenant_id === desired.tenant_id
            && (!current.organization_payload?.status || current.organization_payload.status === 'active')
            && (!current.organization_payload?.graph_organization_id || current.organization_payload.graph_organization_id === manifest.organization_id);
        if (!sameOwnership) fail('TENANT_ORGANIZATION_CONFLICT', 'Tenant organization projection conflicts with desired state');
        if (current.organization_payload?.graph_organization_id === manifest.organization_id || legacyAlias.length === 1) {
            plan.push({ operation: 'noop', entity: 'tenant_organization', id: manifest.tenant_organization_id }); return;
        }
        await client.query('UPDATE tenant_organizations SET organization_payload=organization_payload || $2::jsonb WHERE organization_id=$1', [manifest.tenant_organization_id, JSON.stringify(desired.organization_payload)]);
        plan.push({ operation: 'update', entity: 'tenant_organization', id: manifest.tenant_organization_id }); return;
    }
    const payload = legacyAlias.length === 1 ? { status: 'active' } : desired.organization_payload;
    await client.query('INSERT INTO tenant_organizations (organization_id, tenant_id, tenant_revision_at_write, organization_payload) VALUES ($1,$2,$3,$4::jsonb)', [manifest.tenant_organization_id, manifest.tenant_id, tenant.tenant_revision, JSON.stringify(payload)]);
    plan.push({ operation: 'create', entity: 'tenant_organization', id: manifest.tenant_organization_id });
}

async function ensureMembership(client, manifest, tenant, grant, plan) {
    const existing = await rows(client, 'SELECT membership_id, tenant_id, organization_id, principal_id, membership_payload FROM tenant_memberships WHERE tenant_id=$1 AND organization_id=$2 AND principal_id=$3 FOR UPDATE', [manifest.tenant_id, manifest.tenant_organization_id, manifest.person_id]);
    const desired = { membership_id: stableId([manifest.tenant_id, manifest.tenant_organization_id, manifest.person_id]), tenant_id: manifest.tenant_id, organization_id: manifest.tenant_organization_id, principal_id: manifest.person_id, membership_payload: membershipPayload(manifest, grant) };
    if (existing.length) {
        const current = existing[0];
        const payload = current?.membership_payload;
        const expectedTenantRole = grant.role === 'ceo' ? 'tenant_admin' : 'member';
        const sameAuthority = existing.length === 1
            && current.tenant_id === manifest.tenant_id
            && current.organization_id === manifest.tenant_organization_id
            && current.principal_id === manifest.person_id
            && payload?.status === 'active'
            && (!payload.principal_type || payload.principal_type === 'person')
            && payload.tenant_role === expectedTenantRole
            && Array.isArray(payload.project_codes)
            && payload.project_codes.includes(manifest.project_code)
            && Array.isArray(payload.clearance)
            && payload.clearance.length > 0
            && payload.clearance.every((entry) => grant.clearance.includes(entry));
        if (!sameAuthority) fail('TENANT_MEMBERSHIP_CONFLICT', 'Tenant membership conflicts with desired state');
        plan.push({ operation: 'noop', entity: 'tenant_membership', id: current.membership_id }); return;
    }
    await client.query('INSERT INTO tenant_memberships (membership_id, tenant_id, tenant_revision_at_write, organization_id, principal_id, membership_payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [desired.membership_id, manifest.tenant_id, tenant.tenant_revision, manifest.tenant_organization_id, manifest.person_id, JSON.stringify(desired.membership_payload)]);
    plan.push({ operation: 'create', entity: 'tenant_membership', id: desired.membership_id });
}

export async function provisionLegacyOrganizationAuthorityBridge({ client, manifest: raw, actorId, commit = false } = {}) {
    if (!client?.query) fail('DATABASE_CONFIG_REQUIRED', 'A PostgreSQL client is required');
    if (!actorId || typeof actorId !== 'string') fail('ACTOR_REQUIRED', 'A provisioning actor is required');
    const manifest = normalizeLegacyOrganizationAuthorityBridgeManifest(raw);
    let began = false;
    try {
        await client.query('BEGIN'); began = true;
        await client.query("SELECT set_config('brainbase.tenant_id',$1,true)", [manifest.tenant_id]);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`legacy-org-bridge:${manifest.tenant_id}:${manifest.organization_id}`]);
        const { tenant, grant } = await foundation(client, manifest);
        const plan = [];
        await ensureProject(client, manifest, tenant, plan);
        await ensureOrganization(client, manifest, tenant, plan);
        await ensureMembership(client, manifest, tenant, grant, plan);
        const readback = await readbackRows(client, manifest);
        await client.query(commit ? 'COMMIT' : 'ROLLBACK'); began = false;
        return { persisted: commit, applied_by: actorId, plan, readback };
    } catch (error) {
        if (began) { try { await client.query('ROLLBACK'); } catch {} }
        if (error instanceof LegacyOrganizationAuthorityBridgeError) throw error;
        throw new LegacyOrganizationAuthorityBridgeError('UPSTREAM_UNAVAILABLE', 'Legacy organization bridge failed; inspect control-plane logs');
    }
}

async function readbackRows(client, manifest) {
    const resolved = one(await rows(client, 'SELECT tenant_id, organization_id FROM resolve_active_tenant_for_organization($1)', [manifest.organization_id]), 'TENANT_RESOLUTION_FAILED', 'Legacy organization does not resolve to one active tenant');
    const project = one(await rows(client, 'SELECT project_id, project_code FROM tenant_projects WHERE tenant_id=$1 AND project_id=$2', [manifest.tenant_id, manifest.project_id]), 'READBACK_FAILED', 'Tenant project readback failed');
    const membership = one(await rows(client, 'SELECT membership_id, principal_id, membership_payload FROM tenant_memberships WHERE tenant_id=$1 AND organization_id=$2 AND principal_id=$3', [manifest.tenant_id, manifest.tenant_organization_id, manifest.person_id]), 'READBACK_FAILED', 'Tenant membership readback failed');
    return { resolved_tenant: resolved, project, membership };
}

export async function readbackLegacyOrganizationAuthorityBridge({ client, manifest: raw } = {}) {
    const manifest = normalizeLegacyOrganizationAuthorityBridgeManifest(raw);
    await foundation(client, manifest, 'FOR SHARE');
    return readbackRows(client, manifest);
}
