#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Pool } = pg;

export const PERSONAL_PROJECTS_TARGET = Object.freeze({
    version: 'sato-personal-projects.v1',
    tenant_id: 'ten_01M1RV1MAAQNAXJJZGF6XXS4MY',
    tenant_key: 'sato-personal',
    tenant_display_name: '佐藤個人',
    organization_id: 'sato-personal',
    organization_entity_id: 'org_sato_personal',
    person_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
    person_name: '佐藤',
    slack_user_id: 'U07LNUP582X',
    slack_workspace_id: 'T07LL5WV7N1',
    source_organization_id: 'unson',
    project_codes: Object.freeze(['fx', 'keiba']),
    projects: Object.freeze([
        Object.freeze({ code: 'fx', id: 'project_fx', name: 'FX' }),
        Object.freeze({ code: 'keiba', id: 'project_keiba', name: '競馬' })
    ])
});

export class SatoPersonalProvisioningError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'SatoPersonalProvisioningError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new SatoPersonalProvisioningError(code, message);
}

export function parseProvisionSatoPersonalArgs(argv = [], env = process.env) {
    const modes = ['check', 'dry-run', 'apply'].filter((mode) => argv.includes(`--${mode}`));
    if (modes.length !== 1) fail('ARGUMENT_INVALID', 'Specify exactly one of --check, --dry-run, or --apply');
    const mode = modes[0];
    const allowed = new Set([`--${mode}`]);
    if (mode === 'apply') allowed.add('--approve-apply');
    if (argv.some((argument) => !allowed.has(argument))) fail('ARGUMENT_INVALID', 'Unsupported argument');
    if (mode === 'apply' && !argv.includes('--approve-apply')) {
        fail('APPLY_APPROVAL_REQUIRED', 'Apply requires --approve-apply');
    }
    const actorId = String(env.BRAINBASE_PROVISIONING_ACTOR ?? '').trim();
    if (mode === 'apply' && !actorId) fail('ACTOR_REQUIRED', 'ACTOR_REQUIRED: BRAINBASE_PROVISIONING_ACTOR is required');
    if (actorId.length > 128) fail('ACTOR_INVALID', 'Provisioning actor is too long');
    return { mode, actorId: actorId || mode };
}

const stableId = (prefix, parts) => `${prefix}_${createHash('sha256')
    .update(JSON.stringify(parts)).digest('hex').slice(0, 32)}`;

async function rows(client, sql, values = []) {
    return (await client.query(sql, values)).rows;
}

function exactlyOne(values, code, message) {
    if (values.length !== 1) fail(code, message);
    return values[0];
}

function sameSet(left, right) {
    return [...left].sort().join('\n') === [...right].sort().join('\n');
}

async function setProvisioningContext(client) {
    const target = PERSONAL_PROJECTS_TARGET;
    await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [target.tenant_id]);
    await client.query("SELECT set_config('app.organization_id', $1, true)", [target.organization_id]);
    await client.query("SELECT set_config('app.role', 'ceo', true)");
    await client.query("SELECT set_config('app.project_codes', $1, true)", [target.project_codes.join(',')]);
    await client.query("SELECT set_config('app.clearance', 'internal,restricted', true)");
}

async function preflight(client) {
    const target = PERSONAL_PROJECTS_TARGET;
    const person = exactlyOne(await rows(client,
        'SELECT id, name, status FROM people WHERE id=$1 FOR SHARE', [target.person_id]),
    'PERSON_NOT_FOUND', 'Canonical Sato person was not resolved exactly once');
    if (person.status !== 'active') fail('PERSON_INACTIVE', 'Canonical Sato person is inactive');

    const tenantById = await rows(client,
        'SELECT tenant_id, tenant_key, status, display_name FROM brainbase_tenants WHERE tenant_id=$1 FOR UPDATE',
        [target.tenant_id]);
    const tenantByKey = await rows(client,
        'SELECT tenant_id, tenant_key, status, display_name FROM brainbase_tenants WHERE tenant_key=$1 FOR UPDATE',
        [target.tenant_key]);
    for (const tenant of [...tenantById, ...tenantByKey]) {
        if (tenant.tenant_id !== target.tenant_id || tenant.tenant_key !== target.tenant_key) {
            fail('TENANT_CONFLICT', 'Personal tenant id or key is already owned');
        }
        if (!['provisioning', 'active'].includes(tenant.status) || tenant.display_name !== target.tenant_display_name) {
            fail('TENANT_CONFLICT', 'Existing personal tenant differs from the approved target');
        }
    }

    const organizations = await rows(client,
        'SELECT id, name, workspace_id, projects FROM organizations WHERE id=$1 FOR UPDATE',
        [target.organization_id]);
    if (organizations[0] && (organizations[0].name !== target.tenant_display_name
        || organizations[0].workspace_id !== null
        || !sameSet(organizations[0].projects ?? [], target.project_codes))) {
        fail('ORGANIZATION_CONFLICT', 'Existing personal organization differs from the approved target');
    }

    const claims = await rows(client,
        'SELECT project_code, organization_id FROM project_code_claims WHERE project_code=ANY($1::text[]) FOR UPDATE',
        [target.project_codes]);
    if (claims.some((claim) => claim.organization_id !== target.organization_id)) {
        fail('PROJECT_CODE_CONFLICT', 'A personal project code is owned by another organization');
    }
    const projects = await rows(client,
        'SELECT id, code, name, organization_id FROM projects WHERE code=ANY($1::text[]) OR id=ANY($2::text[]) FOR UPDATE',
        [target.project_codes, target.projects.map((project) => project.id)]);
    for (const project of projects) {
        const approved = target.projects.find((candidate) => candidate.code === project.code);
        if (!approved || project.id !== approved.id || project.name !== approved.name
            || project.organization_id !== target.organization_id) {
            fail('PROJECT_CONFLICT', 'Existing personal project differs from the approved target');
        }
    }

    const foreignGrants = await rows(client,
        `SELECT id, organization_id, project_codes FROM auth_grants
          WHERE organization_id NOT IN ($1,$2) AND project_codes && $3::text[] FOR UPDATE`,
        [target.source_organization_id, target.organization_id, target.project_codes]);
    if (foreignGrants.length > 0) {
        fail('FOREIGN_GRANT_CONFLICT', 'Personal project access exists outside the approved source grant');
    }
    const sourceGrant = exactlyOne(await rows(client,
        `SELECT id, person_id, slack_user_id, slack_workspace_id, project_codes
           FROM auth_grants
          WHERE organization_id=$1 AND slack_user_id=$2 AND slack_workspace_id=$3 AND active=true
          FOR UPDATE`,
        [target.source_organization_id, target.slack_user_id, target.slack_workspace_id]),
    'SOURCE_GRANT_NOT_FOUND', 'Active Unson grant was not resolved exactly once');
    if (sourceGrant.person_id !== target.person_id) fail('SOURCE_GRANT_CONFLICT', 'Unson grant belongs to another person');

    const personalGrants = await rows(client,
        `SELECT id, person_id, person_name, slack_user_id, slack_workspace_id, role,
                project_codes, clearance, active
           FROM auth_grants WHERE organization_id=$1 FOR UPDATE`, [target.organization_id]);
    if (personalGrants.length > 1) fail('PERSONAL_GRANT_AMBIGUOUS', 'Multiple personal organization grants exist');
    if (personalGrants[0] && (personalGrants[0].person_id !== target.person_id
        || personalGrants[0].slack_user_id !== target.slack_user_id
        || personalGrants[0].slack_workspace_id !== target.slack_workspace_id)) {
        fail('PERSONAL_GRANT_CONFLICT', 'Existing personal organization grant belongs to another identity');
    }
    return { person, sourceGrant, alreadyProvisioned: Boolean(personalGrants[0]) };
}

async function applyTarget(client, context, actorId) {
    const target = PERSONAL_PROJECTS_TARGET;
    await client.query(
        `INSERT INTO brainbase_tenants
           (tenant_id, tenant_key, tenant_revision, status, display_name, created_at, updated_at)
         VALUES ($1,$2,1,'active',$3,now(),now())
         ON CONFLICT (tenant_id) DO UPDATE SET status='active', updated_at=now()
           WHERE brainbase_tenants.tenant_key=EXCLUDED.tenant_key
             AND brainbase_tenants.display_name=EXCLUDED.display_name`,
        [target.tenant_id, target.tenant_key, target.tenant_display_name]);
    await client.query(
        `INSERT INTO brainbase_tenant_revisions
           (tenant_id, tenant_revision, tenant_key, status, display_name, created_at, updated_at, recorded_at)
         VALUES ($1,1,$2,'active',$3,now(),now(),now())
         ON CONFLICT (tenant_id, tenant_revision) DO UPDATE SET status='active', updated_at=now()
           WHERE brainbase_tenant_revisions.tenant_key=EXCLUDED.tenant_key
             AND brainbase_tenant_revisions.display_name=EXCLUDED.display_name`,
        [target.tenant_id, target.tenant_key, target.tenant_display_name]);
    await client.query(
        `INSERT INTO organizations (id,name,workspace_id,projects)
         VALUES ($1,$2,NULL,$3::text[])
         ON CONFLICT (id) DO UPDATE SET projects=EXCLUDED.projects
           WHERE organizations.name=EXCLUDED.name AND organizations.workspace_id IS NULL`,
        [target.organization_id, target.tenant_display_name, target.project_codes]);
    await client.query(
        `INSERT INTO tenant_organizations
           (organization_id,tenant_id,tenant_revision_at_write,organization_payload)
         VALUES ($1,$2,1,$3::jsonb)
         ON CONFLICT (organization_id) DO UPDATE SET organization_payload=EXCLUDED.organization_payload
           WHERE tenant_organizations.tenant_id=EXCLUDED.tenant_id`,
        [target.organization_id, target.tenant_id, JSON.stringify({
            name: target.tenant_display_name, type: 'personal', source: target.version
        })]);
    for (const project of target.projects) {
        await client.query('SELECT claim_project_code($1,$2)', [project.code, target.organization_id]);
        await client.query(
            `INSERT INTO projects (id,code,name,organization_id) VALUES ($1,$2,$3,$4)
             ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name
               WHERE projects.id=EXCLUDED.id AND projects.organization_id=EXCLUDED.organization_id`,
            [project.id, project.code, project.name, target.organization_id]);
    }

    await client.query(
        `INSERT INTO graph_entities
           (id,entity_type,project_id,payload,role_min,sensitivity,lifecycle_status,version,created_at,updated_at)
         VALUES ($1,'org',$2,$3::jsonb,'member','restricted','active',1,now(),now())
         ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload, updated_at=now()
           WHERE graph_entities.entity_type='org' AND graph_entities.project_id=EXCLUDED.project_id`,
        [target.organization_entity_id, target.projects[0].id, JSON.stringify({
            name: target.tenant_display_name, organization_id: target.organization_id, type: 'personal'
        })]);

    for (const project of target.projects) {
        await client.query(
            `INSERT INTO project_registry
               (project_code,organization_id,display_name,kind,catalog_version,session_select,
                organization_entity_id,owner_person_id,repository)
             VALUES ($1,$2,$3,'internal',1,true,$4,$5,'{"mode":"none"}'::jsonb)
             ON CONFLICT (project_code) DO UPDATE SET updated_at=now()
               WHERE project_registry.organization_id=EXCLUDED.organization_id
                 AND project_registry.display_name=EXCLUDED.display_name
                 AND project_registry.catalog_version=EXCLUDED.catalog_version`,
            [project.code, target.organization_id, project.name, target.organization_entity_id, target.person_id]);
        await client.query(
            `INSERT INTO graph_entities
               (id,entity_type,project_id,payload,role_min,sensitivity,lifecycle_status,version,created_at,updated_at)
             VALUES ($1,'project',$2,$3::jsonb,'member','restricted','active',1,now(),now())
             ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload, updated_at=now()
               WHERE graph_entities.entity_type='project' AND graph_entities.project_id=EXCLUDED.project_id`,
            [project.code, project.id, JSON.stringify({
                name: project.name,
                catalog_project_id: project.code,
                catalog_version: 1,
                source_ref: `project-catalog:${project.code}@1`
            })]);
        await client.query(
            `INSERT INTO tenant_projects
               (project_id,tenant_id,tenant_revision_at_write,project_code,project_payload)
             VALUES ($1,$2,1,$3,$4::jsonb)
             ON CONFLICT (project_id) DO UPDATE SET project_payload=EXCLUDED.project_payload
               WHERE tenant_projects.tenant_id=EXCLUDED.tenant_id
                 AND tenant_projects.project_code=EXCLUDED.project_code`,
            [project.id, target.tenant_id, project.code,
                JSON.stringify({ source: target.version, project_code: project.code })]);
    }

    const membershipId = stableId('membership', [target.tenant_id, target.person_id]);
    await client.query(
        `INSERT INTO tenant_memberships
           (membership_id,tenant_id,tenant_revision_at_write,organization_id,principal_id,membership_payload)
         VALUES ($1,$2,1,$3,$4,$5::jsonb)
         ON CONFLICT (membership_id) DO UPDATE SET membership_payload=EXCLUDED.membership_payload
           WHERE tenant_memberships.tenant_id=EXCLUDED.tenant_id
             AND tenant_memberships.organization_id=EXCLUDED.organization_id
             AND tenant_memberships.principal_id=EXCLUDED.principal_id`,
        [membershipId, target.tenant_id, target.organization_id, target.person_id, JSON.stringify({
            status: 'active', principal_type: 'person', role: 'tenant_admin', tenant_role: 'tenant_admin',
            slack_user_id: target.slack_user_id, slack_workspace_id: target.slack_workspace_id,
            project_codes: target.project_codes, clearance: ['internal', 'restricted']
        })]);

    const grantId = stableId('grant', [target.organization_id, target.slack_user_id, target.slack_workspace_id]);
    await client.query(
        `INSERT INTO auth_grants
           (id,person_id,person_name,slack_user_id,slack_workspace_id,organization_id,
            role,project_codes,clearance,active,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'ceo',$7::text[],$8::text[],true,now(),now())
         ON CONFLICT (slack_user_id,slack_workspace_id,organization_id) DO UPDATE SET
           person_id=EXCLUDED.person_id, person_name=EXCLUDED.person_name, role=EXCLUDED.role,
           project_codes=EXCLUDED.project_codes, clearance=EXCLUDED.clearance, active=true, updated_at=now()`,
        [grantId, target.person_id, context.person.name, target.slack_user_id,
            target.slack_workspace_id, target.organization_id, target.project_codes, ['internal', 'restricted']]);
    await client.query(
        `UPDATE auth_grants
            SET project_codes=ARRAY(
                SELECT code FROM unnest(project_codes) code WHERE NOT (code=ANY($2::text[]))
            ), updated_at=now()
          WHERE id=$1`, [context.sourceGrant.id, target.project_codes]);
    await client.query(
        `INSERT INTO auth_audit_logs
           (id,person_id,slack_user_id,slack_workspace_id,event_type,metadata,created_at)
         VALUES ($1,$2,$3,$4,'PERSONAL_TENANT_PROVISIONED',$5::jsonb,now())
         ON CONFLICT (id) DO NOTHING`,
        [stableId('audit', [target.version]), target.person_id, target.slack_user_id,
            target.slack_workspace_id, JSON.stringify({ actor_id: actorId, organization_id: target.organization_id,
                tenant_id: target.tenant_id, project_codes: target.project_codes })]);
}

async function readback(client) {
    const target = PERSONAL_PROJECTS_TARGET;
    const tenant = exactlyOne(await rows(client,
        `SELECT tenant_id,tenant_key,status,display_name FROM brainbase_tenants
          WHERE tenant_id=$1 AND tenant_key=$2`, [target.tenant_id, target.tenant_key]),
    'READBACK_TENANT_FAILED', 'Personal tenant readback failed');
    const organization = exactlyOne(await rows(client,
        `SELECT o.id,o.name,o.workspace_id,o.projects,
                tor.tenant_id AS tenant_organization_tenant_id,
                ge.entity_type AS graph_entity_type,ge.project_id AS graph_project_id
           FROM organizations o
           JOIN tenant_organizations tor ON tor.organization_id=o.id
           JOIN graph_entities ge ON ge.id=$2
          WHERE o.id=$1`, [target.organization_id, target.organization_entity_id]),
    'READBACK_ORGANIZATION_FAILED', 'Personal organization readback failed');
    const projects = await rows(client,
        `SELECT p.code,p.organization_id,pr.project_code AS registry_code,tp.tenant_id,ge.id AS graph_id
           FROM projects p
           JOIN project_registry pr ON pr.project_code=p.code AND pr.organization_id=p.organization_id
           JOIN tenant_projects tp ON tp.project_id=p.id
           JOIN graph_entities ge ON ge.id=p.code AND ge.project_id=p.id AND ge.entity_type='project'
          WHERE p.code=ANY($1::text[]) ORDER BY p.code`, [target.project_codes]);
    const membership = exactlyOne(await rows(client,
        `SELECT membership_id,membership_payload FROM tenant_memberships
          WHERE tenant_id=$1 AND organization_id=$2 AND principal_id=$3`,
        [target.tenant_id, target.organization_id, target.person_id]),
    'READBACK_MEMBERSHIP_FAILED', 'Personal membership readback failed');
    const personalGrant = exactlyOne(await rows(client,
        `SELECT organization_id,project_codes,active FROM auth_grants
          WHERE organization_id=$1 AND slack_user_id=$2 AND slack_workspace_id=$3`,
        [target.organization_id, target.slack_user_id, target.slack_workspace_id]),
    'READBACK_PERSONAL_GRANT_FAILED', 'Personal grant readback failed');
    const sourceGrant = exactlyOne(await rows(client,
        `SELECT organization_id,project_codes,active FROM auth_grants
          WHERE organization_id=$1 AND slack_user_id=$2 AND slack_workspace_id=$3`,
        [target.source_organization_id, target.slack_user_id, target.slack_workspace_id]),
    'READBACK_SOURCE_GRANT_FAILED', 'Unson grant readback failed');
    if (tenant.status !== 'active'
        || organization.name !== target.tenant_display_name || organization.workspace_id !== null
        || !sameSet(organization.projects, target.project_codes)
        || organization.tenant_organization_tenant_id !== target.tenant_id
        || organization.graph_entity_type !== 'org'
        || organization.graph_project_id !== target.projects[0].id
        || projects.length !== target.projects.length
        || projects.some((project) => project.organization_id !== target.organization_id
            || project.tenant_id !== target.tenant_id || project.registry_code !== project.code
            || project.graph_id !== project.code)
        || !sameSet(personalGrant.project_codes, target.project_codes)
        || sourceGrant.project_codes.some((code) => target.project_codes.includes(code))
        || !sameSet(membership.membership_payload?.project_codes ?? [], target.project_codes)) {
        fail('READBACK_MISMATCH', 'Post-transaction personal tenant readback did not match the approved target');
    }
    return {
        tenant,
        project_codes: projects.map((project) => project.code),
        membership_id: membership.membership_id,
        personal_grant_project_codes: personalGrant.project_codes,
        unson_excludes_personal_projects: true
    };
}

export async function runProvisionSatoPersonal({
    argv = process.argv.slice(2), env = process.env, pool = null
} = {}) {
    const args = parseProvisionSatoPersonalArgs(argv, env);
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    if (!pool && !databaseUrl) fail('DATABASE_CONFIG_REQUIRED', 'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required');
    const activePool = pool ?? new Pool({ connectionString: databaseUrl });
    const client = await activePool.connect();
    try {
        await client.query('BEGIN');
        await setProvisioningContext(client);
        const context = await preflight(client);
        if (args.mode !== 'check') await applyTarget(client, context, args.actorId);
        const result = args.mode === 'check'
            ? { preflight: 'passed', already_provisioned: context.alreadyProvisioned }
            : await readback(client);
        if (args.mode === 'apply') await client.query('COMMIT');
        else await client.query('ROLLBACK');
        if (args.mode !== 'apply') return { ok: true, mode: args.mode, persisted: false, ...result };
        const postCommitClient = await activePool.connect();
        try {
            await postCommitClient.query('BEGIN');
            await setProvisioningContext(postCommitClient);
            const postCommitReadback = await readback(postCommitClient);
            await postCommitClient.query('COMMIT');
            return { ok: true, mode: 'apply', persisted: true, post_commit_readback: postCommitReadback };
        } catch (error) {
            try { await postCommitClient.query('ROLLBACK'); } catch { /* preserve the primary error */ }
            throw error;
        } finally {
            postCommitClient.release();
        }
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* preserve the primary error */ }
        throw error;
    } finally {
        client.release();
        if (!pool) await activePool.end();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runProvisionSatoPersonal()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.code ?? 'SATO_PERSONAL_PROVISIONING_FAILED'}: ${error.message}\n`);
            process.exitCode = 1;
        });
}
