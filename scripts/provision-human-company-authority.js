#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import {
    HumanCompanyAuthorityProvisioningError,
    normalizeHumanCompanyAuthorityManifest,
    provisionHumanCompanyAuthority,
    readbackHumanCompanyAuthority
} from '../server/services/multitenant/human-company-authority-provisioner.js';

export function parseProvisionHumanAuthorityArgs(argv = [], env = process.env) {
    const modes = ['check', 'dry-run', 'apply'].filter((mode) => argv.includes(`--${mode}`));
    if (modes.length !== 1) {
        throw new HumanCompanyAuthorityProvisioningError(
            'ARGUMENT_INVALID', 'Specify exactly one of --check, --dry-run, or --apply'
        );
    }
    const manifestIndex = argv.indexOf('--manifest');
    const manifestPath = manifestIndex >= 0 ? argv[manifestIndex + 1] : null;
    if (!manifestPath || manifestPath.startsWith('--')) {
        throw new HumanCompanyAuthorityProvisioningError('MANIFEST_REQUIRED', '--manifest is required');
    }
    const allowed = new Set([`--${modes[0]}`, '--manifest', manifestPath]);
    if (modes[0] === 'apply') allowed.add('--approve-apply');
    if (argv.some((argument, index) => {
        if (argument === '--manifest') return false;
        if (index > 0 && argv[index - 1] === '--manifest') return false;
        return !allowed.has(argument);
    })) {
        throw new HumanCompanyAuthorityProvisioningError(
            'ARGUMENT_INVALID', 'Unsupported human authority provisioning argument'
        );
    }
    if (modes[0] === 'apply' && !argv.includes('--approve-apply')) {
        throw new HumanCompanyAuthorityProvisioningError(
            'APPLY_APPROVAL_REQUIRED', 'Apply requires --approve-apply'
        );
    }
    const actorId = String(env.BRAINBASE_PROVISIONING_ACTOR ?? '').trim();
    if (modes[0] === 'apply' && !actorId) {
        throw new HumanCompanyAuthorityProvisioningError(
            'ACTOR_REQUIRED', 'BRAINBASE_PROVISIONING_ACTOR is required for apply'
        );
    }
    return { mode: modes[0], manifestPath, actorId: actorId || 'dry-run' };
}

export async function runProvisionHumanCompanyAuthority({
    argv = process.argv.slice(2),
    env = process.env,
    pool = null,
    readManifest = readFile
} = {}) {
    const args = parseProvisionHumanAuthorityArgs(argv, env);
    let raw;
    try {
        raw = JSON.parse(await readManifest(args.manifestPath, 'utf8'));
    } catch {
        throw new HumanCompanyAuthorityProvisioningError(
            'MANIFEST_READ_FAILED', 'Human authority manifest could not be read'
        );
    }
    const manifest = normalizeHumanCompanyAuthorityManifest(raw);
    if (args.mode === 'check') {
        return {
            ok: true,
            mode: 'check',
            persisted: false,
            manifest: {
                version: manifest.version,
                tenant_id: manifest.tenant_id,
                organization_id: manifest.organization.organization_id,
                graph_organization_id: manifest.organization.graph_organization_id,
                project_id: manifest.project.project_id,
                project_code: manifest.project.project_code,
                provider: manifest.transport.provider,
                workspace_id: manifest.transport.workspace_id,
                app_id: manifest.transport.app_id,
                human_count: manifest.humans.length,
                humans: manifest.humans.map((human) => ({
                    person_id: human.person_id,
                    slack_user_id: human.slack_user_id,
                    login_role: human.login_role,
                    tenant_role: human.tenant_role,
                    project_codes: human.project_codes,
                    clearance: human.clearance,
                    placement_id: human.placement_id
                }))
            }
        };
    }

    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) {
        throw new HumanCompanyAuthorityProvisioningError(
            'DATABASE_CONFIG_REQUIRED', 'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required'
        );
    }
    let client;
    let clientError = null;
    try {
        client = await activePool.connect();
        let result;
        try {
            result = await provisionHumanCompanyAuthority({
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
            const postCommitReadback = await readbackHumanCompanyAuthority({
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
    runProvisionHumanCompanyAuthority()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.code ?? 'HUMAN_AUTHORITY_PROVISIONING_FAILED'}: ${error.message}\n`);
            process.exitCode = 1;
        });
}
