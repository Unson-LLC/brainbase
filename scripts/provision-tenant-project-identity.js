#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { createPostgresGraphProjectResolver } from '../server/services/multitenant/tenant-provisioning-resolvers.js';
import {
    normalizeTenantProjectIdentityManifest,
    provisionTenantProjectIdentity,
    readbackTenantProjectIdentity,
    TenantProjectIdentityProvisioningError
} from '../server/services/multitenant/tenant-project-identity-provisioner.js';

const SAFE_UPSTREAM_CODE = /^[A-Z0-9]{5}$/u;
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const SAFE_OPERATION = /^[a-z][a-z0-9_:-]{0,127}$/u;

export function parseProvisionTenantProjectIdentityArgs(argv = [], env = process.env) {
    const occurrences = ['check', 'dry-run', 'apply']
        .flatMap((mode) => argv.filter((argument) => argument === `--${mode}`).map(() => mode));
    if (occurrences.length !== 1) {
        throw new TenantProjectIdentityProvisioningError(
            'ARGUMENT_INVALID', 'Specify exactly one of --check, --dry-run, or --apply'
        );
    }

    const manifestOccurrences = argv
        .map((argument, index) => argument === '--manifest' ? index : -1)
        .filter((index) => index >= 0);
    const manifestIndex = manifestOccurrences[0];
    const manifestPath = manifestIndex === undefined ? null : argv[manifestIndex + 1];
    if (manifestOccurrences.length !== 1 || !manifestPath || manifestPath.startsWith('--')) {
        throw new TenantProjectIdentityProvisioningError(
            'MANIFEST_REQUIRED', '--manifest is required exactly once'
        );
    }

    const mode = occurrences[0];
    const allowed = new Set([`--${mode}`, '--manifest', manifestPath]);
    if (mode === 'apply') allowed.add('--approve-apply');
    if (argv.some((argument, index) => {
        if (argument === '--manifest') return false;
        if (index > 0 && argv[index - 1] === '--manifest') return false;
        return !allowed.has(argument);
    })) {
        throw new TenantProjectIdentityProvisioningError(
            'ARGUMENT_INVALID', 'Unsupported tenant project identity provisioning argument'
        );
    }
    if (mode === 'apply' && argv.filter((argument) => argument === '--approve-apply').length !== 1) {
        throw new TenantProjectIdentityProvisioningError(
            'APPLY_APPROVAL_REQUIRED', 'Apply requires --approve-apply'
        );
    }
    const actorId = String(env.BRAINBASE_PROVISIONING_ACTOR ?? '').trim();
    if (mode === 'apply' && !actorId) {
        throw new TenantProjectIdentityProvisioningError(
            'ACTOR_REQUIRED', 'BRAINBASE_PROVISIONING_ACTOR is required for apply'
        );
    }
    return { mode, manifestPath, actorId: actorId || 'dry-run' };
}

function manifestSummary(manifest) {
    return {
        version: manifest.version,
        tenant_id: manifest.tenant_id,
        tenant_key: manifest.tenant_key,
        organization_id: manifest.organization_id,
        project_id: manifest.project.project_id,
        project_code: manifest.project.project_code,
        provider: manifest.transport.provider,
        workspace_id: manifest.transport.workspace_id,
        app_id: manifest.transport.app_id,
        connection_id: manifest.transport.connection_id,
        human_count: manifest.humans.length,
        humans: manifest.humans.map((human) => ({
            person_id: human.person_id,
            slack_user_id: human.slack_user_id,
            membership_id: human.membership_id,
            placement_id: human.placement_id
        }))
    };
}

export async function runProvisionTenantProjectIdentity({
    argv = process.argv.slice(2),
    env = process.env,
    pool = null,
    graphResolver = null,
    readManifest = readFile
} = {}) {
    const args = parseProvisionTenantProjectIdentityArgs(argv, env);
    let raw;
    try {
        raw = JSON.parse(await readManifest(args.manifestPath, 'utf8'));
    } catch {
        throw new TenantProjectIdentityProvisioningError(
            'MANIFEST_READ_FAILED', 'Tenant project identity manifest could not be read'
        );
    }
    const manifest = normalizeTenantProjectIdentityManifest(raw);
    if (args.mode === 'check') {
        return {
            ok: true,
            mode: args.mode,
            persisted: false,
            manifest: manifestSummary(manifest)
        };
    }

    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) {
        throw new TenantProjectIdentityProvisioningError(
            'DATABASE_CONFIG_REQUIRED', 'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required'
        );
    }

    let client;
    let clientError = null;
    try {
        const resolver = graphResolver ?? createPostgresGraphProjectResolver({ pool: activePool });
        client = await activePool.connect();
        let result;
        try {
            result = await provisionTenantProjectIdentity({
                client,
                manifest,
                actorId: args.actorId,
                projectResolver: resolver,
                commit: args.mode === 'apply'
            });
        } catch (error) {
            clientError = error;
            throw error;
        } finally {
            if (clientError) client.release?.(clientError);
            else client.release?.();
            client = null;
        }
        if (args.mode !== 'apply') return { ok: true, mode: args.mode, ...result };

        const readbackClient = await activePool.connect();
        let readbackError = null;
        try {
            const postCommitReadback = await readbackTenantProjectIdentity({
                client: readbackClient,
                manifest
            });
            return { ok: true, mode: args.mode, ...result, post_commit_readback: postCommitReadback };
        } catch (error) {
            readbackError = error;
            throw error;
        } finally {
            if (readbackError) readbackClient.release?.(readbackError);
            else readbackClient.release?.();
        }
    } finally {
        if (client) {
            if (clientError) client.release?.(clientError);
            else client.release?.();
        }
        if (!pool) {
            try { await activePool.end(); } catch { /* never expose database details */ }
        }
    }
}

export function formatProvisioningError(error) {
    const code = typeof error?.code === 'string' && error.code.length > 0
        ? error.code : 'TENANT_PROJECT_IDENTITY_PROVISIONING_FAILED';
    const message = typeof error?.message === 'string' && error.message.length > 0
        ? error.message : 'Tenant project identity provisioning failed';
    const details = [];
    if (typeof error?.upstream_code === 'string' && SAFE_UPSTREAM_CODE.test(error.upstream_code)) {
        details.push(`upstream_code=${error.upstream_code}`);
    }
    if (typeof error?.upstream_name === 'string' && SAFE_ERROR_NAME.test(error.upstream_name)) {
        details.push(`upstream_name=${error.upstream_name}`);
    }
    if (typeof error?.operation === 'string' && SAFE_OPERATION.test(error.operation)) {
        details.push(`operation=${error.operation}`);
    }
    return `${code}: ${message}${details.length > 0 ? ` (${details.join(' ')})` : ''}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runProvisionTenantProjectIdentity()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(formatProvisioningError(error));
            process.exitCode = 1;
        });
}
