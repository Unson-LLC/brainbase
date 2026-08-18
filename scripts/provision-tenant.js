#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import { createCredentialStore } from '../server/bootstrap/slack-installation-control-plane.js';
import {
    normalizeProvisioningManifest,
    redactedManifestSummary
} from '../server/services/multitenant/provisioning-manifest.js';
import { provisionTenant, TenantProvisioningError } from '../server/services/multitenant/tenant-provisioner.js';
import {
    createPostgresCredentialResolver,
    createPostgresGraphProjectResolver
} from '../server/services/multitenant/tenant-provisioning-resolvers.js';

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

export async function runProvisionTenant({
    argv = process.argv.slice(2),
    env = process.env,
    pool = null,
    graphResolver = null,
    credentialResolver = null,
    credentialBoundary = null,
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
        // Production defaults are DB-backed canonical read adapters.  They
        // use their own pool clients so Graph/credential reads never happen
        // under the provisioner's transaction or advisory lock.  Supplying a
        // custom adapter remains an explicit DI seam for controlled tests.
        const activeGraphResolver = graphResolver ?? createPostgresGraphProjectResolver({ pool: activePool });
        const activeCredentialBoundary = credentialBoundary ?? (() => {
            try {
                return createCredentialStore({ env });
            } catch {
                // A missing canonical boundary must remain fail-closed.  The
                // resolver reports the required boundary if first-install
                // verification reaches it; no DB-only fallback is allowed.
                return null;
            }
        })();
        const activeCredentialResolver = credentialResolver ?? createPostgresCredentialResolver({
            pool: activePool,
            credentialBoundary: activeCredentialBoundary
        });
        const schemaSql = await readFile(new URL('../server/sql/tenant-production-provisioning-schema.sql', import.meta.url), 'utf8');
        const schemaSha256 = createHash('sha256').update(schemaSql).digest('hex');
        const result = await provisionTenant({
            client,
            manifest,
            idempotencyKey: args.idempotencyKey,
            actorId: String(env.BRAINBASE_PROVISIONING_ACTOR ?? 'dry-run'),
            graphResolver: activeGraphResolver,
            credentialResolver: activeCredentialResolver,
            schemaSha256,
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
