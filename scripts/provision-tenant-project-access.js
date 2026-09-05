#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { createPostgresGraphProjectResolver } from '../server/services/multitenant/tenant-provisioning-resolvers.js';
import {
    provisionTenantProjectAccess,
    readbackTenantProjectAccess,
    TenantProjectAccessProvisioningError,
    TWO_USER_ACCESS_TARGET
} from '../server/services/multitenant/tenant-project-access-provisioner.js';

export function parseProvisionTenantProjectAccessArgs(argv = [], env = process.env) {
    const modes = ['check', 'dry-run', 'apply'].flatMap((mode) => argv.filter((arg) => arg === `--${mode}`).map(() => mode));
    if (modes.length !== 1) throw new TenantProjectAccessProvisioningError('ARGUMENT_INVALID', 'Specify exactly one of --check, --dry-run, or --apply');
    const mode = modes[0]; const allowed = new Set([`--${mode}`]);
    if (mode === 'apply') allowed.add('--approve-apply');
    if (argv.some((arg) => !allowed.has(arg))) throw new TenantProjectAccessProvisioningError('ARGUMENT_INVALID', 'This fixed-scope provisioner does not accept target arguments');
    if (mode === 'apply' && argv.filter((arg) => arg === '--approve-apply').length !== 1) throw new TenantProjectAccessProvisioningError('APPLY_APPROVAL_REQUIRED', 'Apply requires --approve-apply');
    const actorId = String(env.BRAINBASE_PROVISIONING_ACTOR ?? '').trim();
    if (mode === 'apply' && !actorId) throw new TenantProjectAccessProvisioningError('ACTOR_REQUIRED', 'BRAINBASE_PROVISIONING_ACTOR is required for apply');
    return { mode, actorId: actorId || 'dry-run' };
}

export async function runProvisionTenantProjectAccess({ argv = process.argv.slice(2), env = process.env, pool = null, graphResolver = null } = {}) {
    const args = parseProvisionTenantProjectAccessArgs(argv, env);
    if (args.mode === 'check') return { ok: true, mode: 'check', persisted: false, target: TWO_USER_ACCESS_TARGET };
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) throw new TenantProjectAccessProvisioningError('DATABASE_CONFIG_REQUIRED', 'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required');
    try {
        const resolver = graphResolver ?? createPostgresGraphProjectResolver({ pool: activePool });
        const client = await activePool.connect(); let primaryError = null; let result;
        try { result = await provisionTenantProjectAccess({ client, actorId: args.actorId, projectResolver: resolver, commit: args.mode === 'apply' }); } catch (error) { primaryError = error; throw error; } finally { client.release?.(primaryError ?? undefined); }
        if (args.mode !== 'apply') return { ok: true, mode: args.mode, ...result };
        const readbackClient = await activePool.connect(); let readbackError = null;
        try { return { ok: true, mode: 'apply', ...result, post_commit_readback: await readbackTenantProjectAccess({ client: readbackClient }) }; } catch (error) { readbackError = error; throw error; } finally { readbackClient.release?.(readbackError ?? undefined); }
    } finally { if (!pool) { try { await activePool.end(); } catch { /* never mask result */ } } }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runProvisionTenantProjectAccess().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => { process.stderr.write(`${error.code ?? 'TENANT_PROJECT_ACCESS_FAILED'}: ${error.message}\n`); process.exitCode = 1; });
}
