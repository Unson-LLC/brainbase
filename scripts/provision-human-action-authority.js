#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import {
    HumanActionAuthorityProvisioningError,
    normalizeHumanActionAuthorityManifest,
    provisionHumanActionAuthority,
    readbackHumanActionAuthority
} from '../server/services/multitenant/human-action-authority-provisioner.js';

export function parseProvisionHumanActionAuthorityArgs(argv = [], env = process.env) {
    const occurrences = ['check', 'dry-run', 'apply']
        .flatMap((mode) => argv.filter((argument) => argument === `--${mode}`).map(() => mode));
    if (occurrences.length !== 1) {
        throw new HumanActionAuthorityProvisioningError(
            'ARGUMENT_INVALID', 'Specify exactly one of --check, --dry-run, or --apply'
        );
    }
    const manifestIndex = argv.indexOf('--manifest');
    const manifestPath = manifestIndex >= 0 ? argv[manifestIndex + 1] : null;
    if (argv.filter((argument) => argument === '--manifest').length !== 1
        || !manifestPath || manifestPath.startsWith('--')) {
        throw new HumanActionAuthorityProvisioningError('MANIFEST_REQUIRED', '--manifest is required');
    }
    const mode = occurrences[0];
    const allowed = new Set([`--${mode}`, '--manifest', manifestPath]);
    if (mode === 'apply') allowed.add('--approve-apply');
    if (argv.some((argument, index) => {
        if (argument === '--manifest') return false;
        if (index > 0 && argv[index - 1] === '--manifest') return false;
        return !allowed.has(argument);
    })) {
        throw new HumanActionAuthorityProvisioningError(
            'ARGUMENT_INVALID', 'Unsupported human action authority provisioning argument'
        );
    }
    if (mode === 'apply' && argv.filter((argument) => argument === '--approve-apply').length !== 1) {
        throw new HumanActionAuthorityProvisioningError(
            'APPLY_APPROVAL_REQUIRED', 'Apply requires --approve-apply'
        );
    }
    const actorId = String(env.BRAINBASE_PROVISIONING_ACTOR ?? '').trim();
    if (mode === 'apply' && !actorId) {
        throw new HumanActionAuthorityProvisioningError(
            'ACTOR_REQUIRED', 'BRAINBASE_PROVISIONING_ACTOR is required for apply'
        );
    }
    return { mode, manifestPath, actorId: actorId || 'dry-run' };
}

export async function runProvisionHumanActionAuthority({
    argv = process.argv.slice(2),
    env = process.env,
    pool = null,
    readManifest = readFile
} = {}) {
    const args = parseProvisionHumanActionAuthorityArgs(argv, env);
    let raw;
    try {
        raw = JSON.parse(await readManifest(args.manifestPath, 'utf8'));
    } catch {
        throw new HumanActionAuthorityProvisioningError(
            'MANIFEST_READ_FAILED', 'Human action authority manifest could not be read'
        );
    }
    const manifest = normalizeHumanActionAuthorityManifest(raw);
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
                provider: manifest.transport.provider,
                workspace_id: manifest.transport.workspace_id,
                app_id: manifest.transport.app_id,
                human_count: manifest.humans.length,
                binding_count: manifest.humans.reduce((count, human) => count + human.bindings.length, 0),
                humans: manifest.humans.map((human) => ({
                    person_id: human.person_id,
                    membership_id: human.membership_id,
                    identity_id: human.identity_id,
                    binding_count: human.bindings.length,
                    bindings: human.bindings.map((binding) => ({
                        resource_ref: binding.resource_ref,
                        capability_id: binding.capability_id,
                        decision: binding.decision,
                        allowed_effects: binding.allowed_effects
                    }))
                }))
            }
        };
    }

    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) {
        throw new HumanActionAuthorityProvisioningError(
            'DATABASE_CONFIG_REQUIRED', 'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required'
        );
    }
    let client;
    let clientError = null;
    try {
        client = await activePool.connect();
        let result;
        try {
            result = await provisionHumanActionAuthority({
                client,
                manifest,
                actorId: args.actorId,
                commit: args.mode === 'apply'
            });
        } catch (error) {
            clientError = error;
            throw error;
        } finally {
            if (clientError) client.release(clientError);
            else client.release();
            client = null;
        }
        if (args.mode !== 'apply') return { ok: true, mode: args.mode, ...result };
        const readbackClient = await activePool.connect();
        let readbackError = null;
        try {
            const postCommitReadback = await readbackHumanActionAuthority({
                client: readbackClient,
                manifest
            });
            return { ok: true, mode: args.mode, ...result, post_commit_readback: postCommitReadback };
        } catch (error) {
            readbackError = error;
            throw error;
        } finally {
            if (readbackError) readbackClient.release(readbackError);
            else readbackClient.release();
        }
    } finally {
        if (client) {
            if (clientError) client.release(clientError);
            else client.release();
        }
        if (!pool) {
            try { await activePool.end(); } catch { /* never expose database details */ }
        }
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runProvisionHumanActionAuthority()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.code ?? 'HUMAN_ACTION_AUTHORITY_PROVISIONING_FAILED'}: ${error.message}\n`);
            process.exitCode = 1;
        });
}
