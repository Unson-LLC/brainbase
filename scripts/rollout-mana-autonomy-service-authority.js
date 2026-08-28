#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import {
    buildManaAutonomyServiceAuthorityManifest
} from './build-mana-autonomy-service-authority-manifest.js';
import {
    readServiceCompanyAuthorityFoundation
} from './read-service-company-authority-foundation.js';
import {
    provisionServiceCompanyAuthority
} from '../server/services/multitenant/service-company-authority-provisioner.js';

export class ManaAutonomyAuthorityRolloutError extends Error {
    constructor(code, message = code) {
        super(message);
        this.name = 'ManaAutonomyAuthorityRolloutError';
        this.code = code;
    }
}

function fail(code) {
    throw new ManaAutonomyAuthorityRolloutError(code);
}

export function parseManaAutonomyAuthorityRolloutArgs(argv = [], env = process.env) {
    const modes = ['dry-run', 'apply'].filter((mode) => argv.includes(`--${mode}`));
    if (modes.length !== 1) fail('ARGUMENT_INVALID');
    const mode = modes[0];
    const allowed = new Set([`--${mode}`]);
    if (mode === 'apply') allowed.add('--approve-apply');
    if (argv.some((value) => !allowed.has(value))) fail('ARGUMENT_INVALID');
    if (mode === 'apply' && !argv.includes('--approve-apply')) fail('APPLY_APPROVAL_REQUIRED');
    const actor = String(env.BRAINBASE_PROVISIONING_ACTOR ?? '').trim();
    if (mode === 'apply' && !actor) fail('PROVISIONING_ACTOR_REQUIRED');
    return { mode, actor: actor || 'dry-run' };
}

function foundationInput(env) {
    return {
        tenantKey: env.BRAINBASE_TENANT_KEY,
        organizationId: env.BRAINBASE_ORGANIZATION_ID,
        projectCode: env.BRAINBASE_PROJECT_CODE,
        actorId: env.BRAINBASE_SERVICE_ACTOR_ID,
        workspaceId: env.BRAINBASE_WORKSPACE_ID,
        appId: env.BRAINBASE_APP_ID
    };
}

function manifestInput(env, foundation) {
    return {
        foundation,
        placementId: env.BRAINBASE_SERVICE_PLACEMENT_ID,
        accountablePersonId: env.BRAINBASE_ACCOUNTABLE_PERSON_ID,
        delegatedByPersonId: env.BRAINBASE_DELEGATED_BY_PERSON_ID,
        validFrom: env.MANA_AUTONOMY_VALID_FROM,
        validUntil: env.MANA_AUTONOMY_VALID_UNTIL,
        resourceRevision: env.BRAINBASE_RESOURCE_REVISION,
        policyRevision: env.BRAINBASE_POLICY_REVISION,
        raciRevision: env.BRAINBASE_RACI_REVISION
    };
}

function assertAppliedReadback(after, manifest) {
    const identity = after.company_identity;
    if (!identity || identity.status !== 'active'
        || identity.principal_type !== 'service'
        || identity.project_id !== manifest.project.project_id
        || identity.placement_id !== manifest.service_actor.placement_id) {
        fail('APPLY_READBACK_IDENTITY_MISMATCH');
    }
    const desired = manifest.service_actor.bindings[0];
    const active = after.company_authority_bindings.filter((binding) => (
        binding.status === 'active'
        && binding.resource_ref === desired.resource_ref
        && binding.capability_id === desired.capability_id
    ));
    if (active.length !== 1) fail('APPLY_READBACK_AUTHORITY_MISMATCH');
    const binding = active[0];
    if (binding.decision !== desired.decision
        || JSON.stringify(binding.allowed_effects) !== JSON.stringify([...desired.allowed_effects].sort())
        || binding.policy_revision !== desired.policy_revision
        || binding.raci_revision !== desired.raci_revision
        || binding.valid_from !== new Date(desired.valid_from).toISOString()
        || binding.valid_until !== new Date(desired.valid_until).toISOString()) {
        fail('APPLY_READBACK_AUTHORITY_MISMATCH');
    }
}

export async function runManaAutonomyAuthorityRollout({
    argv = process.argv.slice(2),
    env = process.env,
    pool = null,
    dependencies = {}
} = {}) {
    const { mode, actor } = parseManaAutonomyAuthorityRolloutArgs(argv, env);
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) fail('DATABASE_CONFIG_REQUIRED');
    const readFoundation = dependencies.readFoundation ?? readServiceCompanyAuthorityFoundation;
    const buildManifest = dependencies.buildManifest ?? buildManaAutonomyServiceAuthorityManifest;
    const provision = dependencies.provision ?? provisionServiceCompanyAuthority;
    let client;
    try {
        client = await activePool.connect();
        const before = await readFoundation({
            client,
            ...foundationInput(env)
        });
        const manifest = buildManifest(manifestInput(env, before));
        const result = await provision({
            client,
            manifest,
            actorId: actor,
            commit: mode === 'apply'
        });
        const after = await readFoundation({
            client,
            ...foundationInput(env)
        });
        if (mode === 'apply') assertAppliedReadback(after, manifest);
        return {
            ok: true,
            mode,
            persisted: mode === 'apply',
            tenant_id: manifest.tenant_id,
            organization_id: manifest.organization_id,
            project_id: manifest.project.project_id,
            project_code: manifest.project.project_code,
            actor_id: manifest.service_actor.actor_id,
            placement_id: manifest.service_actor.placement_id,
            accountable_person_id: manifest.service_actor.bindings[0].accountable_person_id,
            delegated_by_person_id: manifest.service_actor.bindings[0].delegated_by_person_id,
            valid_from: manifest.service_actor.bindings[0].valid_from,
            valid_until: manifest.service_actor.bindings[0].valid_until,
            snapshot_before: {
                service_actor: before.service_actor,
                company_identity: before.company_identity,
                company_authority_bindings: before.company_authority_bindings
            },
            plan: result.plan,
            transactional_readback: result.snapshot_after,
            persisted_readback: {
                service_actor: after.service_actor,
                company_identity: after.company_identity,
                company_authority_bindings: after.company_authority_bindings
            }
        };
    } finally {
        client?.release();
        if (!pool) await activePool.end();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runManaAutonomyAuthorityRollout()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.code ?? 'MANA_AUTONOMY_AUTHORITY_ROLLOUT_FAILED'}\n`);
            process.exitCode = 1;
        });
}
