#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import {
    CompanyAuthorityRetirementError,
    normalizeCompanyAuthorityRetirementManifest,
    readbackCompanyAuthorityRetirement,
    retireCompanyAuthority
} from '../server/services/multitenant/company-authority-retirement.js';

export function parseRetireCompanyAuthorityArgs(argv = [], env = process.env) {
    const modes = ['check', 'dry-run', 'apply']
        .flatMap((mode) => argv.filter((argument) => argument === `--${mode}`).map(() => mode));
    if (modes.length !== 1) {
        throw new CompanyAuthorityRetirementError(
            'ARGUMENT_INVALID', 'Specify exactly one of --check, --dry-run, or --apply'
        );
    }
    const valueFor = (name) => {
        const positions = argv.map((argument, index) => argument === name ? index : -1).filter((index) => index >= 0);
        const value = positions.length === 1 ? argv[positions[0] + 1] : null;
        if (!value || value.startsWith('--')) {
            throw new CompanyAuthorityRetirementError('ARGUMENT_INVALID', `${name} requires one value`);
        }
        return value;
    };
    const manifestPath = valueFor('--manifest');
    const idempotencyKey = valueFor('--idempotency-key');
    const mode = modes[0];
    const allowed = new Set([`--${mode}`, '--manifest', manifestPath, '--idempotency-key', idempotencyKey]);
    if (mode === 'apply') allowed.add('--approve-apply');
    if (argv.some((argument) => !allowed.has(argument))) {
        throw new CompanyAuthorityRetirementError('ARGUMENT_INVALID', 'Unsupported authority retirement argument');
    }
    if (mode === 'apply' && argv.filter((argument) => argument === '--approve-apply').length !== 1) {
        throw new CompanyAuthorityRetirementError('APPLY_APPROVAL_REQUIRED', 'Apply requires --approve-apply');
    }
    const actorId = String(env.BRAINBASE_PROVISIONING_ACTOR ?? '').trim();
    if (mode === 'apply' && !actorId) {
        throw new CompanyAuthorityRetirementError(
            'ACTOR_REQUIRED', 'BRAINBASE_PROVISIONING_ACTOR is required for apply'
        );
    }
    return { mode, manifestPath, idempotencyKey, actorId: actorId || 'dry-run' };
}

export async function runRetireCompanyAuthority({
    argv = process.argv.slice(2),
    env = process.env,
    pool = null,
    readManifest = readFile
} = {}) {
    const args = parseRetireCompanyAuthorityArgs(argv, env);
    let raw;
    try {
        raw = JSON.parse(await readManifest(args.manifestPath, 'utf8'));
    } catch {
        throw new CompanyAuthorityRetirementError(
            'MANIFEST_READ_FAILED', 'Authority retirement manifest could not be read'
        );
    }
    const manifest = normalizeCompanyAuthorityRetirementManifest(raw);
    if (args.mode === 'check') {
        return {
            ok: true,
            mode: 'check',
            persisted: false,
            manifest: {
                version: manifest.version,
                tenant_id: manifest.tenant_id,
                tenant_key: manifest.tenant_key,
                organization_id: manifest.organization_id,
                project_id: manifest.project_id,
                membership_ids: manifest.memberships.map(({ membership_id: id }) => id),
                external_identity_ids: manifest.external_identities.map(({ identity_id: id }) => id),
                active_binding_ids: manifest.active_bindings.map(({ binding_id: id }) => id)
            }
        };
    }

    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) {
        throw new CompanyAuthorityRetirementError(
            'DATABASE_CONFIG_REQUIRED', 'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required'
        );
    }
    try {
        const client = await activePool.connect();
        let result;
        try {
            result = await retireCompanyAuthority({
                client,
                manifest,
                idempotencyKey: args.idempotencyKey,
                actorId: args.actorId,
                commit: args.mode === 'apply'
            });
        } finally {
            client.release();
        }
        if (args.mode !== 'apply') return { ok: true, mode: args.mode, ...result };

        const readbackClient = await activePool.connect();
        try {
            const postCommitReadback = await readbackCompanyAuthorityRetirement({
                client: readbackClient,
                manifest,
                idempotencyKey: args.idempotencyKey
            });
            return { ok: true, mode: args.mode, ...result, post_commit_readback: postCommitReadback };
        } finally {
            readbackClient.release();
        }
    } finally {
        if (!pool) {
            try { await activePool.end(); } catch { /* do not expose database details */ }
        }
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runRetireCompanyAuthority()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.code ?? 'AUTHORITY_RETIREMENT_FAILED'}: ${error.message}\n`);
            process.exitCode = 1;
        });
}
