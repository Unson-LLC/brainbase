import { ContractError } from '../services/multitenant/errors.js';
import { MultitenantPostgresRepository } from '../services/multitenant/postgres-repository.js';
import { SlackInstallationControlPlane } from '../services/multitenant/slack-installation-control-plane.js';
import { createSlackInstallationControlPlaneAuthMiddleware } from '../services/multitenant/slack-installation-auth.js';
import { createSlackInstallationOAuthFlow } from '../services/multitenant/slack-installation-oauth-flow.js';
import { createRemoteCredentialStore } from '../services/multitenant/remote-credential-store.js';

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
        throw new ContractError('OAUTH_EXCHANGE_INVALID', {
            status: 502,
            fault_domain: 'external_provider'
        });
    }
}

function createSlackOAuthClient({ authService, env = process.env, fetchImpl = globalThis.fetch } = {}) {
    const dedicatedClientId = required(env, 'BRAINBASE_SLACK_INSTALLATION_CLIENT_ID');
    const dedicatedClientSecret = required(env, 'BRAINBASE_SLACK_INSTALLATION_CLIENT_SECRET');
    const dedicatedAppId = required(env, 'BRAINBASE_SLACK_INSTALLATION_APP_ID');
    const dedicatedMode = Boolean(dedicatedClientId || dedicatedClientSecret);
    if (Boolean(dedicatedClientId) !== Boolean(dedicatedClientSecret)
        || (dedicatedMode && !dedicatedAppId)) {
        throw new Error('slack_installation_oauth_configuration_incomplete');
    }
    const clientId = dedicatedClientId ?? authService?.slackClientId;
    const clientSecret = dedicatedClientSecret ?? authService?.slackClientSecret;
    const tokenUrl = required(env, 'BRAINBASE_SLACK_INSTALLATION_TOKEN_URL')
        ?? authService?.tokenUrl;
    const appId = dedicatedAppId ?? authService?.slackClientId;
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
                throw new ContractError('OAUTH_EXCHANGE_UNAVAILABLE', {
                    status: 503,
                    retryable: true,
                    fault_domain: 'external_provider'
                });
            }
            let payload;
            try {
                payload = parseJson(await response.text());
            } catch (error) {
                if (error instanceof ContractError && error.code === 'OAUTH_EXCHANGE_INVALID') throw error;
                throw new ContractError('OAUTH_EXCHANGE_INVALID', {
                    status: 502,
                    fault_domain: 'external_provider'
                });
            }
            if (!response.ok || payload.ok === false) {
                throw new ContractError('OAUTH_EXCHANGE_REJECTED', {
                    status: 502,
                    fault_domain: 'external_provider'
                });
            }

            const credentialMaterial = payload.access_token
                ?? payload.authed_user?.access_token
                ?? null;
            if (typeof credentialMaterial !== 'string' || credentialMaterial.length === 0) {
                throw new ContractError('OAUTH_CREDENTIAL_MISSING', {
                    status: 502,
                    fault_domain: 'external_provider'
                });
            }
            const workspaceId = payload.team?.id ?? payload.team_id ?? null;
            const enterpriseId = payload.enterprise?.id ?? payload.enterprise_id ?? null;
            const installerId = payload.authed_user?.id
                ?? payload.authed_user_id
                ?? payload.user_id
                ?? null;
            const providerAppId = payload.api_app_id ?? payload.app_id ?? null;
            if (dedicatedMode && !providerAppId) {
                throw new ContractError('OAUTH_EXCHANGE_INVALID', {
                    status: 502,
                    fault_domain: 'external_provider'
                });
            }
            return {
                app_id: providerAppId ?? appId,
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
    try {
        return createRemoteCredentialStore({ env, fetchImpl });
    } catch (error) {
        if (error?.message === 'tenant_credential_store_configuration_required') {
            throw new Error('slack_credential_store_configuration_required');
        }
        if (error?.message === 'tenant_credential_store_configuration_invalid') {
            throw new Error('slack_credential_store_configuration_invalid');
        }
        throw error;
    }
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
    const dedicatedClientId = required(env, 'BRAINBASE_SLACK_INSTALLATION_CLIENT_ID');
    const dedicatedClientSecret = required(env, 'BRAINBASE_SLACK_INSTALLATION_CLIENT_SECRET');
    const dedicatedRedirectUri = required(env, 'BRAINBASE_SLACK_INSTALLATION_REDIRECT_URI');
    const dedicatedStateSecret = required(env, 'BRAINBASE_SLACK_INSTALLATION_STATE_SECRET');
    const dedicatedBotScopes = required(env, 'BRAINBASE_SLACK_INSTALLATION_BOT_SCOPES');
    const dedicatedAppId = required(env, 'BRAINBASE_SLACK_INSTALLATION_APP_ID');
    const dedicatedRequested = Boolean(
        dedicatedClientId || dedicatedClientSecret || dedicatedRedirectUri
        || dedicatedStateSecret || dedicatedBotScopes
    );
    const dedicatedComplete = Boolean(
        dedicatedAppId && dedicatedClientId && dedicatedClientSecret && dedicatedRedirectUri
        && dedicatedStateSecret && dedicatedBotScopes
    );
    const appId = dedicatedAppId
        ?? authService?.slackClientId
        ?? '';
    const unavailable = (reason) => ({
        controlPlane: unavailableControlPlane(),
        authMiddleware,
        appId,
        oauthFlow: null,
        resolvePreProvisionedConnection: null,
        ready: false,
        reason
    });

    if (!pool) return unavailable('database_pool_required');
    if (!appId) return unavailable('slack_installation_app_id_required');
    if (dedicatedRequested && !dedicatedComplete) {
        return unavailable('slack_installation_oauth_configuration_incomplete');
    }

    try {
        const repository = new MultitenantPostgresRepository({ pool, now });
        const oauthClient = createSlackOAuthClient({ authService, env, fetchImpl });
        const credentialStore = createCredentialStore({ env, fetchImpl });
        const oauthFlow = dedicatedComplete
            ? createSlackInstallationOAuthFlow({
                clientId: dedicatedClientId,
                redirectUri: dedicatedRedirectUri,
                stateSecret: dedicatedStateSecret,
                botScopes: dedicatedBotScopes,
                authorizeUrl: required(env, 'BRAINBASE_SLACK_INSTALLATION_AUTHORIZE_URL') ?? undefined,
                now
            })
            : null;
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
            oauthFlow,
            resolvePreProvisionedConnection: null,
            ready: true,
            reason: null
        };
    } catch (error) {
        return unavailable(error?.message || 'slack_installation_configuration_invalid');
    }
}

export { createCredentialStore, createSlackOAuthClient };
