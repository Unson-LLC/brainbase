#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const ACTOR_ID = /^[a-z][a-z0-9_-]{2,127}$/u;

export class ServiceAuthorityFoundationError extends Error {
    constructor(code, message = code) {
        super(message);
        this.name = 'ServiceAuthorityFoundationError';
        this.code = code;
    }
}

function fail(code) {
    throw new ServiceAuthorityFoundationError(code);
}

function required(value, field, pattern = IDENTIFIER) {
    const text = String(value ?? '').trim();
    if (!text || text.length > 128 || /[\u0000-\u001f\u007f]/u.test(text) || !pattern.test(text)) {
        throw new ServiceAuthorityFoundationError('ARGUMENT_INVALID', field);
    }
    return text;
}

function optional(value, field) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    return required(value, field);
}

function expectSingle(rows, code) {
    if (!Array.isArray(rows) || rows.length !== 1) fail(code);
    return rows[0];
}

async function select(client, sql, parameters) {
    const result = await client.query(sql, parameters);
    return Array.isArray(result?.rows) ? result.rows : [];
}

function publicIdentity(row) {
    if (!row) return null;
    return {
        identity_id: row.identity_id,
        identity_revision: String(row.identity_revision),
        membership_id: row.membership_id,
        project_id: row.project_id,
        placement_id: row.placement_id,
        principal_type: row.principal_type,
        status: row.status
    };
}

export async function readServiceCompanyAuthorityFoundation({
    client,
    tenantKey,
    projectCode,
    actorId,
    workspaceId = null,
    appId = null
}) {
    if (!client?.query) fail('DATABASE_CONFIG_REQUIRED');
    const tenant_key = required(tenantKey, 'tenantKey');
    const project_code = required(projectCode, 'projectCode');
    const actor_id = required(actorId, 'actorId', ACTOR_ID);
    const workspace_id = optional(workspaceId, 'workspaceId');
    const app_id = optional(appId, 'appId');
    if ((workspace_id === null) !== (app_id === null)) fail('WORKSPACE_FILTER_INCOMPLETE');

    await client.query('BEGIN READ ONLY');
    let transactionStarted = true;
    try {
        const tenant = expectSingle(await select(client,
            `SELECT tenant_id, tenant_key, tenant_revision, status
               FROM brainbase_tenants
              WHERE tenant_key = $1
              ORDER BY tenant_revision DESC
              LIMIT 2`,
            [tenant_key]), 'TENANT_NOT_FOUND_OR_AMBIGUOUS');
        if (tenant.status !== 'active') fail('TENANT_INACTIVE');
        await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [tenant.tenant_id]);

        const organizations = await select(client,
            `SELECT organization_id
               FROM tenant_organizations
              WHERE tenant_id = $1
              ORDER BY organization_id
              LIMIT 2`,
            [tenant.tenant_id]);
        const organization = expectSingle(
            organizations,
            'ORGANIZATION_NOT_FOUND_OR_AMBIGUOUS'
        );

        const project = expectSingle(await select(client,
            `SELECT project_id, project_code
               FROM tenant_projects
              WHERE tenant_id = $1
                AND project_code = $2
              ORDER BY project_id
              LIMIT 2`,
            [tenant.tenant_id, project_code]), 'PROJECT_NOT_FOUND_OR_AMBIGUOUS');

        const connections = await select(client,
            `SELECT connection_id,
                    connection_revision,
                    installation_id,
                    workspace_id,
                    app_id,
                    granted_scopes,
                    status
               FROM workspace_connections
              WHERE tenant_id = $1
                AND provider = 'slack'
                AND status = 'active'
                AND ($2::TEXT IS NULL OR workspace_id = $2)
                AND ($3::TEXT IS NULL OR app_id = $3)
              ORDER BY connection_revision DESC
              LIMIT 2`,
            [tenant.tenant_id, workspace_id, app_id]);
        const connection = expectSingle(
            connections,
            'WORKSPACE_CONNECTION_NOT_FOUND_OR_AMBIGUOUS'
        );

        const actors = await select(client,
            `SELECT actor_id, tenant_key, canonical_project_id, status
               FROM brainbase_service_actors
              WHERE tenant_key = $1
                AND actor_id = $2
              ORDER BY actor_id
              LIMIT 2`,
            [tenant_key, actor_id]);
        const actor = actors.length === 0
            ? null
            : expectSingle(actors, 'SERVICE_ACTOR_AMBIGUOUS');

        const capabilities = actor
            ? await select(client,
                `SELECT grant_row.capability_id
                   FROM brainbase_service_actor_capabilities grant_row
                   JOIN brainbase_capabilities capability
                     ON capability.capability_id = grant_row.capability_id
                  WHERE grant_row.actor_id = $1
                    AND grant_row.tenant_key = $2
                    AND grant_row.status = 'active'
                    AND capability.status = 'active'
                  ORDER BY grant_row.capability_id`,
                [actor_id, tenant_key])
            : [];

        const registrations = actor
            ? await select(client,
                `SELECT placement_id, registration_revision, status
                   FROM tenant_service_actor_registrations
                  WHERE tenant_id = $1
                    AND actor_id = $2
                  ORDER BY registration_revision DESC
                  LIMIT 2`,
                [tenant.tenant_id, actor_id])
            : [];
        const activeRegistrations = registrations.filter((row) => row.status === 'active');
        if (activeRegistrations.length > 1) fail('SERVICE_ACTOR_REGISTRATION_AMBIGUOUS');
        const registration = activeRegistrations[0] ?? null;

        const identities = await select(client,
            `SELECT identity_id,
                    identity_revision,
                    membership_id,
                    project_id,
                    placement_id,
                    principal_type,
                    status
               FROM company_external_identities
              WHERE tenant_id = $1
                AND provider = 'service'
                AND authenticated_subject_id = $2
                AND workspace_id = $3
                AND app_id = $4
                AND project_id = $5
              ORDER BY identity_revision DESC
              LIMIT 2`,
            [
                tenant.tenant_id,
                actor_id,
                connection.workspace_id,
                connection.app_id,
                project.project_id
            ]);
        const activeIdentities = identities.filter((row) => row.status === 'active');
        if (activeIdentities.length > 1) fail('COMPANY_IDENTITY_AMBIGUOUS');
        const identity = activeIdentities[0] ?? null;

        const authorityBindings = identity
            ? await select(client,
                `SELECT binding_id,
                        binding_revision,
                        membership_id,
                        resource_ref,
                        capability_id,
                        decision,
                        allowed_effects,
                        policy_revision,
                        raci_revision,
                        status,
                        valid_from,
                        valid_until
                   FROM company_authority_bindings
                  WHERE tenant_id = $1
                    AND membership_id = $2
                    AND organization_id = $3
                    AND project_id = $4
                  ORDER BY resource_ref, capability_id, binding_revision DESC`,
                [
                    tenant.tenant_id,
                    identity.membership_id,
                    organization.organization_id,
                    project.project_id
                ])
            : [];

        await client.query('COMMIT');
        transactionStarted = false;
        return {
            ok: true,
            mode: 'read-only',
            tenant: {
                tenant_id: tenant.tenant_id,
                tenant_key: tenant.tenant_key,
                tenant_revision: String(tenant.tenant_revision),
                status: tenant.status
            },
            organization: { organization_id: organization.organization_id },
            project: {
                project_id: project.project_id,
                project_code: project.project_code
            },
            workspace_connection: {
                connection_id: connection.connection_id,
                connection_revision: String(connection.connection_revision),
                installation_id: connection.installation_id,
                workspace_id: connection.workspace_id,
                app_id: connection.app_id,
                granted_scopes: [...connection.granted_scopes].sort(),
                status: connection.status
            },
            service_actor: actor ? {
                actor_id: actor.actor_id,
                tenant_key: actor.tenant_key,
                canonical_project_id: actor.canonical_project_id,
                status: actor.status,
                placement_id: registration?.placement_id ?? null,
                registration_revision: registration?.registration_revision == null
                    ? null : String(registration.registration_revision),
                registration_status: registration?.status ?? null,
                capabilities: capabilities.map((row) => row.capability_id)
            } : null,
            company_identity: publicIdentity(identity),
            company_authority_bindings: authorityBindings.map((row) => ({
                binding_id: row.binding_id,
                binding_revision: String(row.binding_revision),
                membership_id: row.membership_id,
                resource_ref: row.resource_ref,
                capability_id: row.capability_id,
                decision: row.decision,
                allowed_effects: [...row.allowed_effects].sort(),
                policy_revision: String(row.policy_revision),
                raci_revision: String(row.raci_revision),
                status: row.status,
                valid_from: new Date(row.valid_from).toISOString(),
                valid_until: row.valid_until ? new Date(row.valid_until).toISOString() : null
            }))
        };
    } catch (error) {
        if (transactionStarted) {
            try { await client.query('ROLLBACK'); } catch { /* preserve first failure */ }
        }
        if (error instanceof ServiceAuthorityFoundationError) throw error;
        throw new ServiceAuthorityFoundationError('UPSTREAM_UNAVAILABLE');
    }
}

export async function runServiceAuthorityFoundationReadback({
    env = process.env,
    pool = null
} = {}) {
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) fail('DATABASE_CONFIG_REQUIRED');
    let client;
    try {
        client = await activePool.connect();
        return await readServiceCompanyAuthorityFoundation({
            client,
            tenantKey: env.BRAINBASE_TENANT_KEY,
            projectCode: env.BRAINBASE_PROJECT_CODE,
            actorId: env.BRAINBASE_SERVICE_ACTOR_ID,
            workspaceId: env.BRAINBASE_WORKSPACE_ID,
            appId: env.BRAINBASE_APP_ID
        });
    } finally {
        client?.release();
        if (!pool) await activePool.end();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runServiceAuthorityFoundationReadback()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.code ?? 'FOUNDATION_READBACK_FAILED'}\n`);
            process.exitCode = 1;
        });
}
