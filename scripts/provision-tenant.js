#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import {
    normalizeProvisioningManifest,
    redactedManifestSummary
} from '../server/services/multitenant/provisioning-manifest.js';
import { provisionTenant, TenantProvisioningError } from '../server/services/multitenant/tenant-provisioner.js';

export function parseProvisionTenantArgs(argv = [], env = process.env) {
    const modeNames = ['check', 'dry-run', 'apply'];
    const modes = modeNames.filter((mode) => argv.includes(`--${mode}`));
    if (modes.length !== 1) throw new TenantProvisioningError('ARGUMENT_INVALID', 'Specify exactly one of --check, --dry-run, or --apply');
    const manifestIndex = argv.indexOf('--manifest');
    const manifestPath = manifestIndex >= 0 ? argv[manifestIndex + 1] : null;
    if (!manifestPath || manifestPath.startsWith('--')) throw new TenantProvisioningError('MANIFEST_REQUIRED', '--manifest is required');
    const idempotencyIndex = argv.indexOf('--idempotency-key');
    const idempotencyKey = idempotencyIndex >= 0 ? argv[idempotencyIndex + 1] : null;
    if (!idempotencyKey || idempotencyKey.startsWith('--')) throw new TenantProvisioningError('IDEMPOTENCY_KEY_REQUIRED', '--idempotency-key is required');
    const allowed = new Set([`--${modes[0]}`, '--manifest', manifestPath, '--idempotency-key', idempotencyKey]);
    if (modes[0] === 'apply') allowed.add('--approve-apply');
    if (argv.some((argument, index) => {
        if (argument === '--manifest' || argument === '--idempotency-key') return false;
        if (index > 0 && (argv[index - 1] === '--manifest' || argv[index - 1] === '--idempotency-key')) return false;
        return !allowed.has(argument);
    })) throw new TenantProvisioningError('ARGUMENT_INVALID', 'Unsupported tenant provisioning argument');
    const approved = argv.includes('--approve-apply');
    if (modes[0] === 'apply' && !approved) throw new TenantProvisioningError('APPLY_APPROVAL_REQUIRED', 'Apply requires --approve-apply');
    if (modes[0] === 'apply' && !String(env.BRAINBASE_PROVISIONING_ACTOR ?? '').trim()) {
        throw new TenantProvisioningError('ACTOR_REQUIRED', 'BRAINBASE_PROVISIONING_ACTOR is required for apply');
    }
    return { mode: modes[0], manifestPath, idempotencyKey, approved };
}

function unavailableResolver(name) {
    return {
        async [name]() {
            throw new TenantProvisioningError('RESOLVER_CONFIG_REQUIRED', `A configured ${name} resolver is required`);
        }
    };
}

export async function runProvisionTenant({
    argv = process.argv.slice(2),
    env = process.env,
    pool = null,
    graphResolver = unavailableResolver('resolveCanonicalProject'),
    credentialResolver = unavailableResolver('verifyOpaqueReference'),
    readManifest = readFile
} = {}) {
    const args = parseProvisionTenantArgs(argv, env);
    let raw;
    try {
        raw = JSON.parse(await readManifest(args.manifestPath, 'utf8'));
    } catch {
        throw new TenantProvisioningError('MANIFEST_READ_FAILED', 'Provisioning manifest could not be read');
    }
    const manifest = normalizeProvisioningManifest(raw);
    if (args.mode === 'check') {
        return { ok: true, mode: args.mode, manifest: redactedManifestSummary(manifest), persisted: false };
    }
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) throw new TenantProvisioningError('DATABASE_CONFIG_REQUIRED', 'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required');
    let client;
    try {
        client = await activePool.connect();
        const result = await provisionTenant({
            client,
            manifest,
            idempotencyKey: args.idempotencyKey,
            actorId: String(env.BRAINBASE_PROVISIONING_ACTOR ?? 'dry-run'),
            graphResolver,
            credentialResolver,
            commit: args.mode === 'apply'
        });
        return { ok: true, mode: args.mode, persisted: args.mode === 'apply' && result.persisted !== false, ...result };
    } catch (error) {
        if (error instanceof TenantProvisioningError) throw error;
        throw new TenantProvisioningError('UPSTREAM_UNAVAILABLE', 'Tenant provisioning failed; inspect control-plane logs');
    } finally {
        client?.release();
        if (!pool) {
            try { await activePool.end(); } catch { /* never expose database details */ }
        }
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runProvisionTenant()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.code ?? 'PROVISIONING_FAILED'}: ${error.message}\n`);
            process.exitCode = 1;
        });
}
