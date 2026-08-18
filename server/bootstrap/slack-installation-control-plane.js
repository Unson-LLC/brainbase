import { ContractError } from '../services/multitenant/errors.js';
import { MultitenantPostgresRepository } from '../services/multitenant/postgres-repository.js';
import { SlackInstallationControlPlane } from '../services/multitenant/slack-installation-control-plane.js';
import { createSlackInstallationControlPlaneAuthMiddleware } from '../services/multitenant/slack-installation-auth.js';

function unavailableControlPlane() {
    const fail = async () => {
        throw new ContractError('UPSTREAM_UNAVAILABLE', {
            status: 503,
            retryable: true,
            fault_domain: 'brainbase_cloud',
            message: 'Slack installation control-plane is not configured'
        });
    };
    return {
        authorize: fail,
        authorizeBinding: fail,
        exchange_and_register: fail,
        exchangeAndRegister: fail
    };
}

function required(env, name) {
    const value = env?.[name];
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    return value.trim();
}

function parseJson(text) {
    try {
        return text ? JSON.parse(text) : {};
    } catch {
        throw new Error('upstream_response_invalid');
    }
}

function createSlackOAuthClient({ authService, fetchImpl = globalThis.fetch } = {}) {
    const clientId = authService?.slackClientId;
    const clientSecret = authService?.slackClientSecret;
    const tokenUrl = authService?.tokenUrl;
    if (typeof fetchImpl !== 'function' || !clientId || !clientSecret || !tokenUrl) {
        throw new Error('slack_oauth_configuration_required');
    }
    return {
        async exchangeCode({ authorization_code, redirect_uri }) {
            const body = new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri,
                code: authorization_code
            });
            if (authService.slackMode !== 'oauth') {
                body.set('grant_type', 'authorization_code');
            }
            let response;
            try {
                response = await fetchImpl(tokenUrl, {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body
                });
            } catch {
                throw new Error('slack_oauth_exchange_unavailable');
            }
            let payload;
            try {
                payload = parseJson(await response.text());
            } catch {
                throw new Error('slack_oauth_exchange_invalid');
            }
            if (!response.ok || payload.ok === false) {
                throw new Error('slack_oauth_exchange_rejected');
            }

            const credentialMaterial = payload.access_token
                ?? payload.authed_user?.access_token
                ?? null;
            if (typeof credentialMaterial !== 'string' || credentialMaterial.length === 0) {
                throw new Error('slack_oauth_credential_missing');
            }
            const workspaceId = payload.team?.id ?? payload.team_id ?? null;
            const enterpriseId = payload.enterprise?.id ?? payload.enterprise_id ?? null;
            const installerId = payload.authed_user?.id
                ?? payload.authed_user_id
                ?? payload.user_id
                ?? null;
            return {
                app_id: payload.api_app_id ?? payload.app_id ?? clientId,
                workspace_id: workspaceId,
                ...(enterpriseId ? { enterprise_id: enterpriseId } : {}),
                installer_id: installerId,
                installation_id: payload.installation_id ?? null,
                granted_scopes: payload.scope ?? payload.authed_user?.scope ?? null,
                credential_material: credentialMaterial,
                credential_refresh_material: payload.refresh_token ?? null
            };
        }
    };
}

function createCredentialStore({ env, fetchImpl = globalThis.fetch } = {}) {
    const rawUrl = required(env, 'BRAINBASE_SLACK_CREDENTIAL_STORE_URL');
    const token = required(env, 'BRAINBASE_SLACK_CREDENTIAL_STORE_TOKEN');
    if (!rawUrl || !token || typeof fetchImpl !== 'function') {
        throw new Error('slack_credential_store_configuration_required');
    }
    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error('slack_credential_store_configuration_invalid');
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('slack_credential_store_configuration_invalid');
    }

    async function call(payload) {
        let response;
        try {
            response = await fetchImpl(url, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${token}`,
                    'content-type': 'application/json',
                    accept: 'application/json'
                },
                body: JSON.stringify(payload)
            });
        } catch {
            throw new Error('slack_credential_store_unavailable');
        }
        let body;
        try {
            body = parseJson(await response.text());
        } catch {
            throw new Error('slack_credential_store_invalid');
        }
        if (!response.ok || !body.result || typeof body.result !== 'object') {
            throw new Error('slack_credential_store_rejected');
        }
        return body.result;
    }

    return {
        store(input) {
            return call({ operation: 'store', ...input });
        },
        revoke(input) {
            return call({ operation: 'revoke', ...input });
        }
    };
}

/**
 * Construct the production Slack installation control plane. Missing
 * production ports intentionally produce a registered, fail-closed route;
 * they never fall back to an in-memory credential or fake OAuth exchange.
 */
export function createSlackInstallationControlPlaneFromEnv({
    pool,
    authService,
    env = process.env,
    now,
    fetchImpl = globalThis.fetch
} = {}) {
    const authMiddleware = createSlackInstallationControlPlaneAuthMiddleware({
        authService,
        env,
        now
    });
    const appId = required(env, 'BRAINBASE_SLACK_INSTALLATION_APP_ID')
        ?? authService?.slackClientId
        ?? '';
    const unavailable = (reason) => ({
        controlPlane: unavailableControlPlane(),
        authMiddleware,
        appId,
        resolvePreProvisionedConnection: null,
        ready: false,
        reason
    });

    if (!pool) return unavailable('database_pool_required');
    if (!appId) return unavailable('slack_installation_app_id_required');

    try {
        const repository = new MultitenantPostgresRepository({ pool, now });
        const oauthClient = createSlackOAuthClient({ authService, fetchImpl });
        const credentialStore = createCredentialStore({ env, fetchImpl });
        const controlPlane = new SlackInstallationControlPlane({
            repository,
            oauthClient,
            credentialStore,
            now
        });
        return {
            controlPlane,
            authMiddleware,
            appId,
            resolvePreProvisionedConnection: null,
            ready: true,
            reason: null
        };
    } catch (error) {
        return unavailable(error?.message || 'slack_installation_configuration_invalid');
    }
}

export { createCredentialStore, createSlackOAuthClient };
