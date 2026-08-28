#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import {
    normalizeServiceCompanyAuthorityManifest,
    provisionServiceCompanyAuthority,
    ServiceCompanyAuthorityProvisioningError
} from '../server/services/multitenant/service-company-authority-provisioner.js';

export function parseProvisionServiceAuthorityArgs(argv = [], env = process.env) {
    const modes = ['check', 'dry-run', 'apply'].filter((mode) => argv.includes(`--${mode}`));
    if (modes.length !== 1) {
        throw new ServiceCompanyAuthorityProvisioningError(
            'ARGUMENT_INVALID',
            'Specify exactly one of --check, --dry-run, or --apply'
        );
    }
    const manifestIndex = argv.indexOf('--manifest');
    const manifestPath = manifestIndex >= 0 ? argv[manifestIndex + 1] : null;
    if (!manifestPath || manifestPath.startsWith('--')) {
        throw new ServiceCompanyAuthorityProvisioningError('MANIFEST_REQUIRED', '--manifest is required');
    }
    const allowed = new Set([`--${modes[0]}`, '--manifest', manifestPath]);
    if (modes[0] === 'apply') allowed.add('--approve-apply');
    if (argv.some((argument, index) => {
        if (argument === '--manifest') return false;
        if (index > 0 && argv[index - 1] === '--manifest') return false;
        return !allowed.has(argument);
    })) {
        throw new ServiceCompanyAuthorityProvisioningError(
            'ARGUMENT_INVALID',
            'Unsupported service authority provisioning argument'
        );
    }
    if (modes[0] === 'apply' && !argv.includes('--approve-apply')) {
        throw new ServiceCompanyAuthorityProvisioningError(
            'APPLY_APPROVAL_REQUIRED',
            'Apply requires --approve-apply'
        );
    }
    const actorId = String(env.BRAINBASE_PROVISIONING_ACTOR ?? '').trim();
    if (modes[0] === 'apply' && !actorId) {
        throw new ServiceCompanyAuthorityProvisioningError(
            'ACTOR_REQUIRED',
            'BRAINBASE_PROVISIONING_ACTOR is required for apply'
        );
    }
    return { mode: modes[0], manifestPath, actorId: actorId || 'dry-run' };
}

export async function runProvisionServiceCompanyAuthority({
    argv = process.argv.slice(2),
    env = process.env,
    pool = null,
    readManifest = readFile
} = {}) {
    const args = parseProvisionServiceAuthorityArgs(argv, env);
    let raw;
    try {
        raw = JSON.parse(await readManifest(args.manifestPath, 'utf8'));
    } catch {
        throw new ServiceCompanyAuthorityProvisioningError(
            'MANIFEST_READ_FAILED',
            'Service authority manifest could not be read'
        );
    }
    const manifest = normalizeServiceCompanyAuthorityManifest(raw);
    if (args.mode === 'check') {
        return {
            ok: true,
            mode: args.mode,
            persisted: false,
            manifest: {
                version: manifest.version,
                tenant_id: manifest.tenant_id,
                organization_id: manifest.organization_id,
                project_id: manifest.project.project_id,
                project_code: manifest.project.project_code,
                actor_id: manifest.service_actor.actor_id,
                placement_id: manifest.service_actor.placement_id,
                binding_count: manifest.service_actor.bindings.length,
                bindings: manifest.service_actor.bindings.map((binding) => ({
                    registry_capability: binding.registry_capability,
                    resource_ref: binding.resource_ref,
                    capability_id: binding.capability_id,
                    decision: binding.decision,
                    allowed_effects: binding.allowed_effects
                }))
            }
        };
    }

    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) {
        throw new ServiceCompanyAuthorityProvisioningError(
            'DATABASE_CONFIG_REQUIRED',
            'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required'
        );
    }
    let client;
    try {
        client = await activePool.connect();
        const result = await provisionServiceCompanyAuthority({
            client,
            manifest,
            actorId: args.actorId,
            commit: args.mode === 'apply'
        });
        return { ok: true, mode: args.mode, ...result };
    } finally {
        client?.release();
        if (!pool) {
            try { await activePool.end(); } catch { /* never expose database details */ }
        }
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runProvisionServiceCompanyAuthority()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.code ?? 'SERVICE_AUTHORITY_PROVISIONING_FAILED'}: ${error.message}\n`);
            process.exitCode = 1;
        });
}
