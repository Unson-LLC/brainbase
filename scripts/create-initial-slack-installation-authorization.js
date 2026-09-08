#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import { MultitenantPostgresRepository } from '../server/services/multitenant/postgres-repository.js';
import { SlackInstallationControlPlane } from '../server/services/multitenant/slack-installation-control-plane.js';
import { createSlackInstallationOAuthFlow } from '../server/services/multitenant/slack-installation-oauth-flow.js';
import {
    createInitialSlackInstallationAuthorization,
    HumanCompanyAuthorityProvisioningError,
    normalizeInitialTenantAdminManifest
} from '../server/services/multitenant/human-company-authority-provisioner.js';

function required(env, name) {
    const value = String(env?.[name] ?? '').trim();
    if (!value) {
        throw new HumanCompanyAuthorityProvisioningError(
            'SLACK_INSTALLATION_CONFIGURATION_REQUIRED', `${name} is required`
        );
    }
    return value;
}

export function parseInitialSlackAuthorizationArgs(argv = [], env = process.env) {
    const manifestIndex = argv.indexOf('--manifest');
    const manifestPath = manifestIndex >= 0 ? argv[manifestIndex + 1] : null;
    if (argv.filter((argument) => argument === '--manifest').length !== 1
        || !manifestPath || manifestPath.startsWith('--')) {
        throw new HumanCompanyAuthorityProvisioningError('MANIFEST_REQUIRED', '--manifest is required');
    }
    const allowed = new Set(['--authorize', '--approve-authorize', '--manifest', manifestPath]);
    if (argv.filter((argument) => argument === '--authorize').length !== 1
        || argv.filter((argument) => argument === '--approve-authorize').length !== 1
        || argv.some((argument, index) => {
            if (argument === '--manifest') return false;
            if (index > 0 && argv[index - 1] === '--manifest') return false;
            return !allowed.has(argument);
        })) {
        throw new HumanCompanyAuthorityProvisioningError(
            'AUTHORIZATION_APPROVAL_REQUIRED', 'Authorize requires --authorize and --approve-authorize'
        );
    }
    const actorId = String(env.BRAINBASE_PROVISIONING_ACTOR ?? '').trim();
    if (!actorId) {
        throw new HumanCompanyAuthorityProvisioningError(
            'ACTOR_REQUIRED', 'BRAINBASE_PROVISIONING_ACTOR is required for authorize'
        );
    }
    return { manifestPath, actorId };
}

export async function runCreateInitialSlackInstallationAuthorization({
    argv = process.argv.slice(2), env = process.env, pool = null, readManifest = readFile,
    repository = null, controlPlane = null, oauthFlow = null,
    createPool = (options) => new Pool(options)
} = {}) {
    const args = parseInitialSlackAuthorizationArgs(argv, env);
    let raw;
    try {
        raw = JSON.parse(await readManifest(args.manifestPath, 'utf8'));
    } catch {
        throw new HumanCompanyAuthorityProvisioningError(
            'MANIFEST_READ_FAILED', 'Initial tenant admin manifest could not be read'
        );
    }
    const manifest = normalizeInitialTenantAdminManifest(raw);
    const appId = required(env, 'BRAINBASE_SLACK_INSTALLATION_APP_ID');
    if (manifest.transport.app_id !== appId) {
        throw new HumanCompanyAuthorityProvisioningError(
            'SLACK_INSTALLATION_APP_MISMATCH', 'Manifest app ID differs from the configured installation app'
        );
    }
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? createPool({ connectionString: databaseUrl }) : null);
    if (!activePool) {
        throw new HumanCompanyAuthorityProvisioningError(
            'DATABASE_CONFIG_REQUIRED', 'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required'
        );
    }
    let client;
    let clientError = null;
    try {
        const activeRepository = repository ?? new MultitenantPostgresRepository({ pool: activePool });
        const activeControlPlane = controlPlane ?? new SlackInstallationControlPlane({ repository: activeRepository });
        const activeOauthFlow = oauthFlow ?? createSlackInstallationOAuthFlow({
            clientId: required(env, 'BRAINBASE_SLACK_INSTALLATION_CLIENT_ID'),
            redirectUri: required(env, 'BRAINBASE_SLACK_INSTALLATION_REDIRECT_URI'),
            stateSecret: required(env, 'BRAINBASE_SLACK_INSTALLATION_STATE_SECRET'),
            botScopes: required(env, 'BRAINBASE_SLACK_INSTALLATION_BOT_SCOPES'),
            authorizeUrl: String(env.BRAINBASE_SLACK_INSTALLATION_AUTHORIZE_URL ?? '').trim() || undefined
        });
        client = await activePool.connect();
        try {
            const result = await createInitialSlackInstallationAuthorization({
                client,
                manifest,
                actorId: args.actorId,
                controlPlane: activeControlPlane,
                oauthFlow: activeOauthFlow
            });
            return {
                ok: true,
                tenant_id: result.tenant_id,
                initiated_by_person_id: result.initiated_by_person_id,
                installation_intent_id: result.installation_intent_id,
                authorization_url: result.authorization_url,
                redirect_uri: result.redirect_uri,
                authorized_by: result.authorized_by
            };
        } catch (error) {
            clientError = error;
            throw error;
        } finally {
            if (clientError) client.release(clientError);
            else client.release();
            client = null;
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
    runCreateInitialSlackInstallationAuthorization()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.code ?? 'INITIAL_SLACK_AUTHORIZATION_FAILED'}: ${error.message}\n`);
            process.exitCode = 1;
        });
}
