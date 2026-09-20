#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import {
    LegacyOrganizationAuthorityBridgeError,
    normalizeLegacyOrganizationAuthorityBridgeManifest,
    provisionLegacyOrganizationAuthorityBridge,
    readbackLegacyOrganizationAuthorityBridge
} from '../server/services/multitenant/legacy-organization-authority-bridge.js';

export function parseArgs(argv, env = process.env) {
    const modes = ['check', 'dry-run', 'apply'].filter((mode) => argv.includes(`--${mode}`));
    const index = argv.indexOf('--manifest');
    if (modes.length !== 1 || index < 0 || !argv[index + 1]) throw new LegacyOrganizationAuthorityBridgeError('ARGUMENT_INVALID', 'Specify one mode and --manifest');
    if (modes[0] === 'apply' && !argv.includes('--approve-apply')) throw new LegacyOrganizationAuthorityBridgeError('APPLY_APPROVAL_REQUIRED', 'Apply requires --approve-apply');
    const actorId = String(env.BRAINBASE_PROVISIONING_ACTOR ?? '').trim();
    if (modes[0] === 'apply' && !actorId) throw new LegacyOrganizationAuthorityBridgeError('ACTOR_REQUIRED', 'BRAINBASE_PROVISIONING_ACTOR is required');
    return { mode: modes[0], manifestPath: argv[index + 1], actorId: actorId || 'dry-run' };
}

export async function run({ argv = process.argv.slice(2), env = process.env, pool = null, readManifest = readFile } = {}) {
    const args = parseArgs(argv, env);
    const manifest = normalizeLegacyOrganizationAuthorityBridgeManifest(JSON.parse(await readManifest(args.manifestPath, 'utf8')));
    if (args.mode === 'check') return { ok: true, mode: 'check', persisted: false, manifest };
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) throw new LegacyOrganizationAuthorityBridgeError('DATABASE_CONFIG_REQUIRED', 'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required');
    try {
        const client = await activePool.connect();
        try {
            const result = await provisionLegacyOrganizationAuthorityBridge({ client, manifest, actorId: args.actorId, commit: args.mode === 'apply' });
            if (args.mode !== 'apply') return { ok: true, mode: args.mode, ...result };
            const readbackClient = await activePool.connect();
            try { return { ok: true, mode: 'apply', ...result, post_commit_readback: await readbackLegacyOrganizationAuthorityBridge({ client: readbackClient, manifest }) }; }
            finally { readbackClient.release(); }
        } finally { client.release(); }
    } finally { if (!pool) await activePool.end(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    run().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
        process.stderr.write(`${error.code ?? 'LEGACY_ORGANIZATION_BRIDGE_FAILED'}: ${error.message}\n`); process.exitCode = 1;
    });
}
