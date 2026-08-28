#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../server/services/multitenant/canonical-json.js';

const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const REVISION = /^(0|[1-9][0-9]*)$/u;
const MAX_AUTHORITY_WINDOW_MS = 26 * 60 * 60 * 1000;
const REQUIRED_REGISTRY_CAPABILITY = 'create_task';
const ACTOR_ID = 'mana_autonomy_v0';

export class ManaAutonomyAuthorityManifestError extends Error {
    constructor(code, message = code) {
        super(message);
        this.name = 'ManaAutonomyAuthorityManifestError';
        this.code = code;
    }
}

function fail(code) {
    throw new ManaAutonomyAuthorityManifestError(code);
}

function record(value, code = 'FOUNDATION_INVALID') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
    return value;
}

function text(value, code, pattern = IDENTIFIER, max = 500) {
    if (typeof value !== 'string' || value.length === 0 || value.length > max
        || /[\u0000-\u001f\u007f]/u.test(value) || !pattern.test(value)) fail(code);
    return value;
}

function revision(value, code) {
    if (typeof value !== 'string' || !REVISION.test(value)) fail(code);
    return value;
}

function timestamp(value, code) {
    if (typeof value !== 'string' || !RFC3339_UTC.test(value) || !Number.isFinite(Date.parse(value))) {
        fail(code);
    }
    return value;
}

function exactActiveFoundation(rawFoundation, expectedPlacementId) {
    const foundation = record(rawFoundation);
    if (foundation.ok !== true || foundation.mode !== 'read-only') fail('FOUNDATION_INVALID');
    const tenant = record(foundation.tenant);
    const organization = record(foundation.organization);
    const project = record(foundation.project);
    const connection = record(foundation.workspace_connection);
    const actor = record(foundation.service_actor, 'SERVICE_ACTOR_REQUIRED');

    if (tenant.status !== 'active') fail('TENANT_INACTIVE');
    if (connection.status !== 'active') fail('WORKSPACE_CONNECTION_INACTIVE');
    if (actor.status !== 'active' || actor.registration_status !== 'active') {
        fail('SERVICE_ACTOR_INACTIVE');
    }
    if (actor.actor_id !== ACTOR_ID) fail('SERVICE_ACTOR_MISMATCH');
    if (actor.canonical_project_id !== project.project_id) fail('SERVICE_ACTOR_PROJECT_MISMATCH');
    if (actor.placement_id !== expectedPlacementId) fail('SERVICE_ACTOR_PLACEMENT_MISMATCH');
    if (!Array.isArray(actor.capabilities)
        || !actor.capabilities.includes(REQUIRED_REGISTRY_CAPABILITY)) {
        fail('SERVICE_CAPABILITY_REQUIRED');
    }
    return { foundation, tenant, organization, project, connection, actor };
}

export function buildManaAutonomyServiceAuthorityManifest({
    foundation: rawFoundation,
    placementId,
    accountablePersonId,
    delegatedByPersonId,
    validFrom,
    validUntil,
    resourceRevision,
    policyRevision,
    raciRevision
}) {
    const placement_id = text(placementId, 'PLACEMENT_INVALID');
    const accountable_person_id = text(accountablePersonId, 'ACCOUNTABLE_PERSON_REQUIRED');
    const delegated_by_person_id = text(delegatedByPersonId, 'DELEGATOR_REQUIRED');
    const valid_from = timestamp(validFrom, 'VALID_FROM_INVALID');
    const valid_until = timestamp(validUntil, 'VALID_UNTIL_INVALID');
    const startsAt = Date.parse(valid_from);
    const endsAt = Date.parse(valid_until);
    if (endsAt <= startsAt || endsAt - startsAt > MAX_AUTHORITY_WINDOW_MS) {
        fail('AUTHORITY_WINDOW_INVALID');
    }
    const resource_revision = revision(resourceRevision, 'RESOURCE_REVISION_INVALID');
    const policy_revision = revision(policyRevision, 'POLICY_REVISION_INVALID');
    const raci_revision = revision(raciRevision, 'RACI_REVISION_INVALID');
    const { tenant, organization, project, connection } = exactActiveFoundation(
        rawFoundation,
        placement_id
    );
    const tenantId = text(tenant.tenant_id, 'TENANT_ID_INVALID', /^ten_[0-9A-HJKMNP-TV-Z]{26}$/u);
    const organizationId = text(organization.organization_id, 'ORGANIZATION_ID_INVALID');
    const projectId = text(project.project_id, 'PROJECT_ID_INVALID');
    const projectCode = text(project.project_code, 'PROJECT_CODE_INVALID');
    const workspaceId = text(connection.workspace_id, 'WORKSPACE_ID_INVALID');
    const appId = text(connection.app_id, 'APP_ID_INVALID');

    return Object.freeze({
        version: 'service-company-authority.v1',
        tenant_id: tenantId,
        organization_id: organizationId,
        project: Object.freeze({
            project_id: projectId,
            project_code: projectCode
        }),
        transport: Object.freeze({
            workspace_id: workspaceId,
            app_id: appId
        }),
        service_actor: Object.freeze({
            actor_id: ACTOR_ID,
            placement_id,
            bindings: Object.freeze([Object.freeze({
                registry_capability: REQUIRED_REGISTRY_CAPABILITY,
                resource_ref: `project:${projectCode}`,
                capability_id: 'task.create',
                decision: 'auto',
                allowed_effects: Object.freeze(['write']),
                responsible_person_id: null,
                accountable_person_id,
                approver_person_id: null,
                delegated_by_person_id,
                resource_revision,
                policy_revision,
                raci_revision,
                stop_conditions: Object.freeze([
                    'autonomy_kill_switch_active',
                    'experiment_window_closed',
                    'task_write_budget_exhausted'
                ]),
                valid_from,
                valid_until
            })])
        })
    });
}

export async function runManaAutonomyAuthorityManifestBuild({
    argv = process.argv.slice(2),
    env = process.env,
    read = readFile
} = {}) {
    const foundationIndex = argv.indexOf('--foundation');
    const foundationPath = foundationIndex >= 0 ? argv[foundationIndex + 1] : null;
    if (!foundationPath || foundationPath.startsWith('--')) fail('FOUNDATION_PATH_REQUIRED');
    const allowed = new Set(['--foundation', foundationPath]);
    if (argv.some((value) => !allowed.has(value))) fail('ARGUMENT_INVALID');
    let foundation;
    try {
        foundation = JSON.parse(await read(foundationPath, 'utf8'));
    } catch {
        fail('FOUNDATION_READ_FAILED');
    }
    const manifest = buildManaAutonomyServiceAuthorityManifest({
        foundation,
        placementId: env.BRAINBASE_SERVICE_PLACEMENT_ID,
        accountablePersonId: env.BRAINBASE_ACCOUNTABLE_PERSON_ID,
        delegatedByPersonId: env.BRAINBASE_DELEGATED_BY_PERSON_ID,
        validFrom: env.MANA_AUTONOMY_VALID_FROM,
        validUntil: env.MANA_AUTONOMY_VALID_UNTIL,
        resourceRevision: env.BRAINBASE_RESOURCE_REVISION,
        policyRevision: env.BRAINBASE_POLICY_REVISION,
        raciRevision: env.BRAINBASE_RACI_REVISION
    });
    return {
        ok: true,
        manifest,
        canonical_json: canonicalJson(manifest)
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runManaAutonomyAuthorityManifestBuild()
        .then((result) => process.stdout.write(`${result.canonical_json}\n`))
        .catch((error) => {
            process.stderr.write(`${error.code ?? 'MANIFEST_BUILD_FAILED'}\n`);
            process.exitCode = 1;
        });
}
