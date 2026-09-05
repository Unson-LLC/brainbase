import { createHash } from 'node:crypto';

import { canonicalJson, deepFreeze } from './canonical-json.js';
import { isCanonicalId } from './ids.js';

const VERSION = 'brainbase-two-user-access.v1';
const TARGET = deepFreeze({
    tenant_id: 'ten_01M0HMA228ES64N4TFX846V8T8', tenant_key: 'unson-business', organization_id: 'ten_01M0HMA228ES64N4TFX846V8T8',
    project_code: 'brainbase', project_id: 'prj_01KGCS8CAJKKDWACPNK1E5WX8H',
    workspace_id: 'T0882T8N9UH', app_id: 'A0BPM2J33SN', connection_id: 'wsc_01M0HRK94FG2Y8DMBFYJHYT14K',
    installation_id: 'slack_T0882T8N9UH_A0BPM2J33SN',
    sato: { person_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5', slack_user_id: 'U088D1HBY6L', placement_id: 'unson-sato' },
    umeda: { person_id: 'per_01KGYC7NPPE3FTW6SF3K5MCVWK', slack_user_id: 'U0BKP8D3KPD', placement_id: 'unson-umeda' },
    denied_person_ids: ['per_umeda_haruka']
});

export class TenantProjectAccessProvisioningError extends Error {
    constructor(code, message) { super(message); this.name = 'TenantProjectAccessProvisioningError'; this.code = code; }
}

function fail(code, message) { throw new TenantProjectAccessProvisioningError(code, message); }
function exactlyOne(rows, code, message) { if (!Array.isArray(rows) || rows.length !== 1) fail(code, message); return rows[0]; }
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function stableId(prefix, parts) { return `${prefix}_${createHash('sha256').update(canonicalJson(parts)).digest('hex').slice(0, 32)}`; }
function requireActor(actorId) { if (typeof actorId !== 'string' || actorId.trim().length === 0 || actorId.length > 128) fail('ACTOR_REQUIRED', 'A bounded provisioning actor is required'); }
async function rows(client, sql, parameters = []) { return (await client.query(sql, parameters))?.rows ?? []; }

/** This provisioner has no caller-configurable scope: only the approved T088 two-person boundary exists. */
export function normalizeTenantProjectAccessManifest(value = undefined) {
    if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 0)) fail('MANIFEST_FIELD_FORBIDDEN', 'This provisioner has no caller-configurable target fields');
    return TARGET;
}

async function readTenant(client, lock = 'FOR UPDATE') {
    const tenant = exactlyOne(await rows(client, `SELECT tenant_id, tenant_key, tenant_revision, status FROM brainbase_tenants WHERE tenant_id = $1 AND tenant_key = $2 ${lock}`, [TARGET.tenant_id, TARGET.tenant_key]), 'TENANT_NOT_FOUND', 'Target tenant was not found');
    if (tenant.status !== 'active') fail('TENANT_INACTIVE', 'Target tenant must be active');
    return tenant;
}
async function resolveProject(projectResolver) {
    const found = await projectResolver.resolveCanonicalProject({ tenant_key: TARGET.tenant_key, project_code: TARGET.project_code });
    if (!found || found.matches !== 1 || found.project_id !== TARGET.project_id) fail('PROJECT_UNAVAILABLE', 'The approved Brainbase project was not resolved exactly once');
}
async function ensureProject(client, tenant, plan) {
    const byCode = await rows(client, 'SELECT project_id, tenant_id, project_code FROM tenant_projects WHERE tenant_id = $1 AND project_code = $2 FOR UPDATE', [tenant.tenant_id, TARGET.project_code]);
    const byId = await rows(client, 'SELECT project_id, tenant_id, project_code FROM tenant_projects WHERE project_id = $1 FOR UPDATE', [TARGET.project_id]);
    for (const binding of [...byCode, ...byId]) {
        if (binding.tenant_id !== tenant.tenant_id) fail('PROJECT_TENANT_CONFLICT', 'Brainbase project belongs to another tenant');
        if (binding.project_id !== TARGET.project_id || binding.project_code !== TARGET.project_code) fail('PROJECT_CODE_CONFLICT', 'Brainbase project binding conflicts with current state');
    }
    if (byCode.length === 1 && byId.length === 1) { plan.push({ operation: 'noop', entity: 'tenant_project', id: TARGET.project_id }); return; }
    const inserted = await client.query(`INSERT INTO tenant_projects (project_id, tenant_id, tenant_revision_at_write, project_code, project_payload) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT DO NOTHING RETURNING project_id`, [TARGET.project_id, tenant.tenant_id, Number(tenant.tenant_revision), TARGET.project_code, JSON.stringify({ source: 'approved_two_user_access', project_code: TARGET.project_code })]);
    if (inserted.rowCount === 1) { plan.push({ operation: 'create', entity: 'tenant_project', id: TARGET.project_id }); return; }
    const codeAfter = await rows(client, 'SELECT project_id, tenant_id, project_code FROM tenant_projects WHERE tenant_id = $1 AND project_code = $2 FOR UPDATE', [tenant.tenant_id, TARGET.project_code]);
    const idAfter = await rows(client, 'SELECT project_id, tenant_id, project_code FROM tenant_projects WHERE project_id = $1 FOR UPDATE', [TARGET.project_id]);
    if (codeAfter.length !== 1 || idAfter.length !== 1 || codeAfter[0].project_id !== TARGET.project_id || idAfter[0].tenant_id !== tenant.tenant_id) fail('PROJECT_BINDING_CONFLICT', 'Brainbase project binding changed concurrently');
    plan.push({ operation: 'noop', entity: 'tenant_project', id: TARGET.project_id });
}
async function requireConnection(client, tenant, plan) {
    const connection = exactlyOne(await rows(client, `SELECT connection_id, connection_revision, installation_id, status, credential_ref FROM workspace_connections WHERE tenant_id = $1 AND connection_id = $2 AND provider = 'slack' AND workspace_id = $3 AND app_id = $4 FOR UPDATE`, [tenant.tenant_id, TARGET.connection_id, TARGET.workspace_id, TARGET.app_id]), 'WORKSPACE_CONNECTION_REQUIRED', 'The approved Slack workspace connection must already exist');
    if (connection.status !== 'active' || connection.installation_id !== TARGET.installation_id || !connection.credential_ref) fail('WORKSPACE_CONNECTION_CONFLICT', 'The approved Slack workspace connection is not active and exact');
    exactlyOne(await rows(client, 'SELECT credential_ref FROM credential_broker_refs WHERE credential_ref = $1 AND tenant_id = $2 AND connection_id = $3 AND connection_revision = $4 FOR SHARE', [connection.credential_ref, tenant.tenant_id, connection.connection_id, connection.connection_revision]), 'CREDENTIAL_BROKER_REF_REQUIRED', 'The approved workspace connection has no exact credential broker reference');
    plan.push({ operation: 'noop', entity: 'workspace_connection', id: connection.connection_id });
    return connection;
}
async function requirePerson(client, { person_id: personId }) {
    if (TARGET.denied_person_ids.includes(personId)) fail('LEGACY_PERSON_FORBIDDEN', 'Legacy person records are never writable by this provisioner');
    if (!isCanonicalId(personId, 'per')) fail('PERSON_CONFLICT', 'Person is not canonical');
    const person = exactlyOne(await rows(client, 'SELECT id, name, status FROM people WHERE id = $1 FOR SHARE', [personId]), 'PERSON_NOT_FOUND', 'Canonical person was not found');
    if (person.status !== 'active') fail('PERSON_CONFLICT', 'Canonical person is not active');
    return person;
}
function membershipPayload(person) { return { status: 'active', revision: '1', principal_type: 'person', role: 'member', tenant_role: 'member', slack_user_id: person.slack_user_id, slack_workspace_id: TARGET.workspace_id, project_codes: [TARGET.project_code], clearance: ['internal'], placement_id: person.placement_id }; }
function appendProject(codes) { if (!Array.isArray(codes)) fail('AUTH_GRANT_CONFLICT', 'Existing project codes are invalid'); return codes.includes(TARGET.project_code) ? codes : [...codes, TARGET.project_code]; }
function requireSatoMembershipPayload(payload, person, { requireBrainbase = false } = {}) {
    const approvedCodes = ['mana', TARGET.project_code];
    if (!payload || payload.status !== 'active' || payload.role !== 'tenant_admin' || !same(payload.clearance, ['internal']) || payload.slack_user_id !== person.slack_user_id || payload.slack_workspace_id !== TARGET.workspace_id || (requireBrainbase ? !same(payload.project_codes, approvedCodes) : (!same(payload.project_codes, ['mana']) && !same(payload.project_codes, approvedCodes)))) fail('SATO_MEMBERSHIP_SCOPE_CONFLICT', 'Sato membership is not the approved preserved scope');
}
function requireUmedaMembershipPayload(payload, person) {
    if (!payload || payload.principal_type !== 'person' || payload.role !== 'member' || payload.tenant_role !== 'member' || payload.slack_user_id !== person.slack_user_id || payload.slack_workspace_id !== TARGET.workspace_id || !same(payload.project_codes, [TARGET.project_code]) || !same(payload.clearance, ['internal']) || payload.placement_id !== person.placement_id) fail('UMEDA_MEMBERSHIP_NOT_LEAST_PRIVILEGE', 'Umeda membership is not the approved minimal scope');
}
async function ensureMembership(client, tenant, person, { profile }) {
    const memberships = await rows(client, 'SELECT membership_id, membership_payload FROM tenant_memberships WHERE tenant_id = $1 AND organization_id = $2 AND principal_id = $3 FOR UPDATE', [tenant.tenant_id, TARGET.organization_id, person.person_id]);
    if (memberships.length > 1) fail('MEMBERSHIP_AMBIGUOUS', 'Multiple memberships exist');
    if (profile === 'sato' && memberships.length === 0) fail('SATO_MEMBERSHIP_REQUIRED', 'Sato preserved membership was not found');
    if (memberships.length === 1) {
        const membership = memberships[0]; const payload = membership.membership_payload ?? {};
        if (profile === 'sato') requireSatoMembershipPayload(payload, person);
        else requireUmedaMembershipPayload(payload, person);
        const codes = appendProject(payload.project_codes ?? []);
        if (!same(codes, payload.project_codes ?? [])) await client.query('UPDATE tenant_memberships SET membership_payload = $2::jsonb WHERE membership_id = $1', [membership.membership_id, JSON.stringify({ ...payload, project_codes: codes })]);
        return { id: membership.membership_id, operation: codes.length === (payload.project_codes ?? []).length ? 'noop' : 'additive_update' };
    }
    const id = stableId('human_membership', [tenant.tenant_id, TARGET.organization_id, person.person_id]);
    await client.query('INSERT INTO tenant_memberships (membership_id, tenant_id, tenant_revision_at_write, organization_id, principal_id, membership_payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb)', [id, tenant.tenant_id, Number(tenant.tenant_revision), TARGET.organization_id, person.person_id, JSON.stringify(membershipPayload(person))]);
    return { id, operation: 'create' };
}
async function ensureIdentity(client, tenant, person, membershipId, plan) {
    const identities = await rows(client, `SELECT identity_id, membership_id, placement_id, principal_type, status FROM company_external_identities WHERE tenant_id = $1 AND provider = 'slack' AND authenticated_subject_id = $2 AND workspace_id = $3 AND app_id = $4 AND project_id = $5 AND status = 'active' FOR UPDATE`, [tenant.tenant_id, person.slack_user_id, TARGET.workspace_id, TARGET.app_id, TARGET.project_id]);
    if (identities.length > 1) fail('EXTERNAL_IDENTITY_AMBIGUOUS', 'Multiple active external identities exist');
    if (identities.length === 1) { const identity = identities[0]; if (identity.membership_id !== membershipId || identity.placement_id !== person.placement_id || identity.principal_type !== 'person') fail('EXTERNAL_IDENTITY_CONFLICT', 'Existing external identity differs from the approved principal'); plan.push({ operation: 'noop', entity: 'company_external_identity', id: identity.identity_id }); return; }
    const max = exactlyOne(await rows(client, `SELECT COALESCE(MAX(identity_revision), 0)::text AS max_revision FROM company_external_identities WHERE tenant_id = $1 AND provider = 'slack' AND authenticated_subject_id = $2 AND workspace_id = $3 AND app_id = $4 AND project_id = $5`, [tenant.tenant_id, person.slack_user_id, TARGET.workspace_id, TARGET.app_id, TARGET.project_id]), 'EXTERNAL_IDENTITY_REVISION_READ_FAILED', 'Identity revision could not be read');
    const revision = Number(max.max_revision) + 1; const id = stableId('human_identity', [tenant.tenant_id, person.slack_user_id, TARGET.workspace_id, TARGET.app_id, TARGET.project_id, revision]);
    await client.query(`INSERT INTO company_external_identities (identity_id, identity_revision, tenant_id, tenant_revision_at_write, provider, authenticated_subject_id, workspace_id, app_id, membership_id, project_id, placement_id, principal_type, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'slack', $5, $6, $7, $8, $9, $10, 'person', 'active', now(), now())`, [id, revision, tenant.tenant_id, Number(tenant.tenant_revision), person.slack_user_id, TARGET.workspace_id, TARGET.app_id, membershipId, TARGET.project_id, person.placement_id]);
    plan.push({ operation: 'create', entity: 'company_external_identity', id });
}
async function ensureSato(client, tenant, plan) {
    const person = { person_id: TARGET.sato.person_id, ...TARGET.sato };
    person.person_name = (await requirePerson(client, person)).name;
    await ensureMinimalGrant(client, person, 'Sato', plan, { personAlreadyVerified: true });
    const membership = await ensureMembership(client, tenant, person, { profile: 'sato' });
    plan.push({ operation: membership.operation, entity: 'tenant_membership', id: membership.id });
    await ensureIdentity(client, tenant, person, membership.id, plan);
}
async function ensureUmeda(client, tenant, plan) {
    const person = { person_id: TARGET.umeda.person_id, ...TARGET.umeda };
    person.person_name = (await requirePerson(client, person)).name;
    await ensureMinimalGrant(client, person, 'Umeda', plan, { personAlreadyVerified: true });
    const membership = await ensureMembership(client, tenant, person, { profile: 'umeda' }); plan.push({ operation: membership.operation, entity: 'tenant_membership', id: membership.id }); await ensureIdentity(client, tenant, person, membership.id, plan);
}
async function ensureMinimalGrant(client, person, label, plan, { personAlreadyVerified = false } = {}) {
    if (!personAlreadyVerified) person.person_name = (await requirePerson(client, person)).name;
    const grants = await rows(client, 'SELECT id, person_id, person_name, slack_user_id, slack_workspace_id, role, project_codes, clearance, active FROM auth_grants WHERE slack_user_id = $1 AND slack_workspace_id = $2 FOR UPDATE', [person.slack_user_id, TARGET.workspace_id]);
    if (grants.length > 1) fail('AUTH_GRANT_AMBIGUOUS', `${label} has multiple Slack grants`);
    if (grants.length === 1) { const grant = grants[0]; if (TARGET.denied_person_ids.includes(grant.person_id)) fail('LEGACY_PERSON_FORBIDDEN', 'Legacy person records are never writable by this provisioner'); if (!grant.active || grant.person_id !== person.person_id || grant.person_name !== person.person_name || grant.role !== 'member' || !same(grant.project_codes, [TARGET.project_code]) || !same(grant.clearance, ['internal'])) fail('AUTH_GRANT_NOT_LEAST_PRIVILEGE', `${label} grant is not the approved minimal scope`); plan.push({ operation: 'noop', entity: 'auth_grant', id: grant.id }); }
    else { const id = stableId('grant', [TARGET.workspace_id, person.slack_user_id]); await client.query(`INSERT INTO auth_grants (id, person_id, person_name, slack_user_id, slack_workspace_id, role, project_codes, clearance, active) VALUES ($1, $2, $3, $4, $5, 'member', $6::text[], $7::text[], true)`, [id, person.person_id, person.person_name, person.slack_user_id, TARGET.workspace_id, [TARGET.project_code], ['internal']]); plan.push({ operation: 'create', entity: 'auth_grant', id }); }
}
async function preflightPrincipal(client, tenant, principal, profile) {
    const person = { ...principal, person_name: (await requirePerson(client, principal)).name };
    const grants = await rows(client, 'SELECT id, person_id, person_name, role, project_codes, clearance, active FROM auth_grants WHERE slack_user_id = $1 AND slack_workspace_id = $2 FOR UPDATE', [person.slack_user_id, TARGET.workspace_id]);
    if (grants.length > 1) fail('AUTH_GRANT_AMBIGUOUS', 'Approved principal has multiple Slack grants');
    if (grants.length === 1) {
        const grant = grants[0];
        if (TARGET.denied_person_ids.includes(grant.person_id)) fail('LEGACY_PERSON_FORBIDDEN', 'Legacy person records are never writable by this provisioner');
        if (!grant.active || grant.person_id !== person.person_id || grant.person_name !== person.person_name || grant.role !== 'member' || !same(grant.project_codes, [TARGET.project_code]) || !same(grant.clearance, ['internal'])) fail('AUTH_GRANT_NOT_LEAST_PRIVILEGE', 'Existing grant is not the approved minimal scope');
    }
    const memberships = await rows(client, 'SELECT membership_id, membership_payload FROM tenant_memberships WHERE tenant_id = $1 AND organization_id = $2 AND principal_id = $3 FOR UPDATE', [tenant.tenant_id, TARGET.organization_id, person.person_id]);
    if (memberships.length > 1) fail('MEMBERSHIP_AMBIGUOUS', 'Approved principal has multiple memberships');
    if (profile === 'sato' && memberships.length === 0) fail('SATO_MEMBERSHIP_REQUIRED', 'Sato preserved membership was not found');
    if (memberships.length === 1) {
        const payload = memberships[0].membership_payload ?? {};
        if (profile === 'sato') requireSatoMembershipPayload(payload, person);
        else requireUmedaMembershipPayload(payload, person);
    }
    const identities = await rows(client, `SELECT identity_id, membership_id, placement_id, principal_type FROM company_external_identities WHERE tenant_id = $1 AND provider = 'slack' AND authenticated_subject_id = $2 AND workspace_id = $3 AND app_id = $4 AND project_id = $5 AND status = 'active' FOR UPDATE`, [tenant.tenant_id, person.slack_user_id, TARGET.workspace_id, TARGET.app_id, TARGET.project_id]);
    if (identities.length > 1) fail('EXTERNAL_IDENTITY_AMBIGUOUS', 'Approved principal has multiple active external identities');
    if (identities.length === 1 && (memberships.length !== 1 || identities[0].membership_id !== memberships[0].membership_id || identities[0].placement_id !== person.placement_id || identities[0].principal_type !== 'person')) fail('EXTERNAL_IDENTITY_CONFLICT', 'Existing external identity is not the approved target tuple');
}

/** Adds only Brainbase/T088 project access for the approved Sato and Umeda principals. */
export async function provisionTenantProjectAccess({ client, manifest, actorId, projectResolver, commit = false } = {}) {
    if (!client?.query) fail('DATABASE_CONFIG_REQUIRED', 'A PostgreSQL client is required'); if (!projectResolver?.resolveCanonicalProject) fail('PROJECT_RESOLVER_REQUIRED', 'A canonical project resolver is required'); requireActor(actorId); normalizeTenantProjectAccessManifest(manifest);
    let began = false;
    try {
        await resolveProject(projectResolver); await client.query('BEGIN'); began = true; await client.query("SET LOCAL lock_timeout = '5s'"); await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [TARGET.tenant_id]); await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [TARGET.tenant_key]);
        const tenant = await readTenant(client); const plan = [];
        exactlyOne(await rows(client, 'SELECT organization_id FROM tenant_organizations WHERE tenant_id = $1 AND organization_id = $2 FOR SHARE', [tenant.tenant_id, TARGET.organization_id]), 'ORGANIZATION_NOT_FOUND', 'Approved tenant organization was not found');
        const connection = await requireConnection(client, tenant, plan);
        await preflightPrincipal(client, tenant, { person_id: TARGET.sato.person_id, ...TARGET.sato }, 'sato');
        await preflightPrincipal(client, tenant, { person_id: TARGET.umeda.person_id, ...TARGET.umeda }, 'umeda');
        await ensureProject(client, tenant, plan); await ensureSato(client, tenant, plan); await ensureUmeda(client, tenant, plan);
        await client.query(commit ? 'COMMIT' : 'ROLLBACK'); began = false;
        return { persisted: Boolean(commit), actor_id: actorId, plan, readback: { tenant_id: tenant.tenant_id, project_id: TARGET.project_id, connection_id: connection.connection_id, humans: [{ slack_user_id: TARGET.sato.slack_user_id }, { person_id: TARGET.umeda.person_id, slack_user_id: TARGET.umeda.slack_user_id }] } };
    } catch (error) { if (began) { try { await client.query('ROLLBACK'); } catch { /* primary error wins */ } } if (error instanceof TenantProjectAccessProvisioningError) throw error; throw new TenantProjectAccessProvisioningError('PROVISIONING_FAILED', 'Tenant project access provisioning failed; inspect control-plane logs'); }
}

/** Separate-client committed readback with the same forced-RLS tenant context. */
export async function readbackTenantProjectAccess({ client, manifest = undefined, projectId = TARGET.project_id } = {}) {
    if (!client?.query) fail('DATABASE_CONFIG_REQUIRED', 'A PostgreSQL client is required'); normalizeTenantProjectAccessManifest(manifest); if (projectId !== TARGET.project_id) fail('PROJECT_UNAVAILABLE', 'Readback target is fixed to Brainbase');
    let began = false;
    try {
        await client.query('BEGIN'); began = true; await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [TARGET.tenant_id]); const tenant = await readTenant(client, 'FOR SHARE');
        exactlyOne(await rows(client, 'SELECT project_id FROM tenant_projects WHERE tenant_id = $1 AND project_id = $2 AND project_code = $3 FOR SHARE', [tenant.tenant_id, TARGET.project_id, TARGET.project_code]), 'READBACK_FAILED', 'Brainbase project binding was not found');
        await requireConnection(client, tenant, []);
        for (const [profile, person] of [['sato', { person_id: TARGET.sato.person_id, ...TARGET.sato }], ['umeda', { person_id: TARGET.umeda.person_id, ...TARGET.umeda }]]) {
            person.person_name = (await requirePerson(client, person)).name;
            const grant = exactlyOne(await rows(client, 'SELECT id, person_id, person_name, role, project_codes, clearance FROM auth_grants WHERE slack_user_id = $1 AND slack_workspace_id = $2 AND active = true FOR SHARE', [person.slack_user_id, TARGET.workspace_id]), 'READBACK_FAILED', 'Approved active grant was not found');
            if (grant.person_id !== person.person_id || grant.person_name !== person.person_name || grant.role !== 'member' || !same(grant.project_codes, [TARGET.project_code]) || !same(grant.clearance, ['internal'])) fail('READBACK_FAILED', 'Grant crossed the approved minimum boundary');
            const membership = exactlyOne(await rows(client, 'SELECT membership_id, membership_payload FROM tenant_memberships WHERE tenant_id = $1 AND organization_id = $2 AND principal_id = $3 FOR SHARE', [tenant.tenant_id, TARGET.organization_id, person.person_id]), 'READBACK_FAILED', 'Approved membership was not found');
            const payload = membership.membership_payload ?? {};
            try { if (profile === 'sato') requireSatoMembershipPayload(payload, person, { requireBrainbase: true }); else requireUmedaMembershipPayload(payload, person); } catch { fail('READBACK_FAILED', 'Membership crossed the approved boundary'); }
            const identity = exactlyOne(await rows(client, `SELECT identity_id, membership_id, placement_id, principal_type FROM company_external_identities WHERE tenant_id = $1 AND provider = 'slack' AND authenticated_subject_id = $2 AND workspace_id = $3 AND app_id = $4 AND project_id = $5 AND status = 'active' FOR SHARE`, [tenant.tenant_id, person.slack_user_id, TARGET.workspace_id, TARGET.app_id, TARGET.project_id]), 'READBACK_FAILED', 'Approved external identity was not found');
            if (identity.membership_id !== membership.membership_id || identity.placement_id !== person.placement_id || identity.principal_type !== 'person') fail('READBACK_FAILED', 'External identity crossed the approved target tuple');
        }
        await client.query('COMMIT'); began = false; return { tenant_id: tenant.tenant_id, project_id: TARGET.project_id, connection_id: TARGET.connection_id, sato_person_id: TARGET.sato.person_id, umeda_person_id: TARGET.umeda.person_id };
    } catch (error) { if (began) { try { await client.query('ROLLBACK'); } catch { /* primary error wins */ } } if (error instanceof TenantProjectAccessProvisioningError) throw error; throw new TenantProjectAccessProvisioningError('READBACK_FAILED', 'Tenant project access readback failed; inspect control-plane logs'); }
}

export { TARGET as TWO_USER_ACCESS_TARGET };
