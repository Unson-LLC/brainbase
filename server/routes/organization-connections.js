import { createHmac, randomUUID } from 'node:crypto';
import express from 'express';

import { ContractError } from '../services/multitenant/errors.js';
import { generateCanonicalId, isCanonicalId } from '../services/multitenant/ids.js';
import { createSlackInstallationAccessResolver } from '../services/multitenant/slack-installation-access.js';
import { validateSlackInstallationBinding } from '../services/multitenant/slack-installation-control-plane.js';

const ADMIN_ROLES = new Set(['admin', 'owner', 'tenant_admin', 'ceo', 'gm']);
const PROVIDERS = new Set(['slack', 'github']);

function problem(res, status, code) {
    return res.status(status).type('application/problem+json').json({
        type: `https://brainbase.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
        status,
        code,
        title: '組織連携を確認できません',
        retryable: status >= 500,
        fault_domain: status >= 500 ? 'brainbase_cloud' : 'protocol',
        correlation_id: null
    });
}

function safeBody(req) {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const allowed = new Set(['expected_workspace_id', 'expected_enterprise_id', 'expected_connection_revision']);
    if (Object.keys(body).some((key) => !allowed.has(key))) {
        throw new ContractError('SCHEMA_INVALID', { status: 400, fault_domain: 'protocol' });
    }
    return body;
}

function cleanStatusRow(row) {
    const revoked = row?.status === 'revoked';
    return {
        status: revoked ? 'revoked' : 'unknown',
        connected: revoked ? false : null,
        account: {
            connection_id: typeof row?.connection_id === 'string' ? row.connection_id : null,
            provider_status: ['pending', 'active', 'revoked'].includes(row?.status) ? row.status : 'unknown',
            external_handle: row?.workspace_id || row?.installation_id || null,
            granted_scopes: Array.isArray(row?.granted_scopes) ? row.granted_scopes : [],
            installed_at: row?.installed_at ?? null
        }
    };
}

async function verifiedSlackStatus({ row, controlPlane, tenantId }) {
    if (row?.status === 'revoked') return cleanStatusRow(row);
    if (row?.status !== 'active' || typeof row?.credential_ref !== 'string'
        || !controlPlane?.credentialStore?.verify) return cleanStatusRow(row);
    const result = await controlPlane.credentialStore.verify({
        tenant_id: tenantId,
        connection_id: row.connection_id,
        connection_revision: String(row.connection_revision),
        provider: 'slack',
        credential_ref: row.credential_ref
    });
    if (result?.valid !== true) return cleanStatusRow(row);
    return { ...cleanStatusRow(row), status: 'connected', connected: true };
}

function signedAttemptState({ tenantId, personId, secret, now }) {
    if (typeof secret !== 'string' || secret.length < 32) return null;
    const issuedAt = now();
    const payload = Buffer.from(JSON.stringify({
        provider: 'github',
        tenant_id: tenantId,
        person_id: personId,
        jti: randomUUID(),
        issued_at: issuedAt.toISOString(),
        expires_at: new Date(issuedAt.getTime() + 10 * 60 * 1000).toISOString()
    })).toString('base64url');
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

export function createOrganizationConnectionsRouter({
    controlPlane,
    appId,
    oauthFlow,
    authService,
    connectionRepository,
    githubAppSlug,
    githubStateSecret,
    now = () => new Date(),
    resolveAccess
} = {}) {
    const router = express.Router();
    const accessResolver = resolveAccess ?? createSlackInstallationAccessResolver({ authService, trustedAppId: appId });

    async function authorized(req) {
        if (req.authSource === 'service-token' || req.authSource === 'internal'
            || req.authSource === 'insecure-header') return null;
        const access = await accessResolver({ req, auth: req.auth, access: req.access });
        if (!access || !isCanonicalId(access.tenantId, 'ten') || !isCanonicalId(access.personId, 'per')
            || !ADMIN_ROLES.has(String(access.role ?? '').toLowerCase())) return null;
        return access;
    }

    router.get('/:provider/status', async (req, res) => {
        const { provider } = req.params;
        if (!PROVIDERS.has(provider)) return problem(res, 404, 'PROVIDER_NOT_SUPPORTED');
        try {
            const access = await authorized(req);
            if (!access) return problem(res, 403, 'ORGANIZATION_ADMIN_REQUIRED');
            if (!connectionRepository?.listOrganizationConnections) {
                return res.status(200).set('cache-control', 'no-store').json({
                    provider, status: 'unknown', connected: null, account: null,
                    reason: 'connection_state_unavailable'
                });
            }
            const rows = await connectionRepository.listOrganizationConnections({
                tenant_id: access.tenantId,
                provider
            });
            const current = Array.isArray(rows) ? rows[0] : null;
            const status = provider === 'slack' && current
                ? await verifiedSlackStatus({ row: current, controlPlane, tenantId: access.tenantId })
                : (current ? cleanStatusRow(current) : { status: 'unknown', connected: null, account: null });
            return res.status(200).set('cache-control', 'no-store').json({
                provider,
                ...status
            });
        } catch {
            return problem(res, 503, 'CONNECTION_STATE_UNAVAILABLE');
        }
    });

    router.post('/:provider/start', async (req, res) => {
        const { provider } = req.params;
        if (!PROVIDERS.has(provider)) return problem(res, 404, 'PROVIDER_NOT_SUPPORTED');
        try {
            const access = await authorized(req);
            if (!access) return problem(res, 403, 'ORGANIZATION_ADMIN_REQUIRED');
            const body = safeBody(req);
            if (provider === 'slack') {
                if (!controlPlane?.authorizeBinding || !oauthFlow?.createAuthorization
                    || typeof appId !== 'string' || appId.length === 0) {
                    return problem(res, 503, 'SLACK_AUTHORIZATION_UNAVAILABLE');
                }
                const existingRows = connectionRepository?.listOrganizationConnections
                    ? await connectionRepository.listOrganizationConnections({
                        tenant_id: access.tenantId,
                        provider: 'slack'
                    }) : [];
                const current = Array.isArray(existingRows)
                    ? existingRows.find((row) => ['active', 'pending', 'reauth_required'].includes(row?.status))
                    : null;
                if (body.expected_connection_revision !== undefined && current
                    && String(body.expected_connection_revision) !== String(current.connection_revision)) {
                    return problem(res, 409, 'WORKSPACE_CONNECTION_STALE_REVISION');
                }
                const expectedRevision = current?.connection_revision ?? body.expected_connection_revision;
                const binding = validateSlackInstallationBinding({
                    installation_intent_id: generateCanonicalId('insi'),
                    tenant_id: access.tenantId,
                    app_id: appId,
                    ...(body.expected_workspace_id ? { expected_workspace_id: body.expected_workspace_id } : {}),
                    ...(body.expected_enterprise_id ? { expected_enterprise_id: body.expected_enterprise_id } : {}),
                    initiated_by_person_id: access.personId,
                    ...(expectedRevision !== undefined && expectedRevision !== null
                        ? { expected_connection_revision: String(expectedRevision) } : {})
                });
                const authorizedBinding = await controlPlane.authorizeBinding(binding);
                const authorization = oauthFlow.createAuthorization(authorizedBinding);
                if (typeof authorization?.authorization_url !== 'string') {
                    return problem(res, 503, 'SLACK_AUTHORIZATION_UNAVAILABLE');
                }
                return res.status(200).set('cache-control', 'no-store').json({
                    provider, status: 'authorization_required',
                    url: authorization.authorization_url,
                    redirect_uri: authorization.redirect_uri ?? null
                });
            }

            if (typeof githubAppSlug !== 'string' || !/^[a-zA-Z0-9-]+$/.test(githubAppSlug)) {
                return problem(res, 503, 'GITHUB_APP_NOT_CONFIGURED');
            }
            const state = signedAttemptState({
                tenantId: access.tenantId,
                personId: access.personId,
                secret: githubStateSecret,
                now
            });
            if (!state) return problem(res, 503, 'GITHUB_STATE_SIGNING_NOT_CONFIGURED');
            const authorizationUrl = new URL(`/apps/${githubAppSlug}/installations/new`, 'https://github.com');
            authorizationUrl.searchParams.set('state', state);
            return res.status(200).set('cache-control', 'no-store').json({
                provider, status: 'authorization_required', url: authorizationUrl.toString()
            });
        } catch (error) {
            if (error instanceof ContractError) return problem(res, error.status, error.code);
            return problem(res, 503, 'AUTHORIZATION_START_UNAVAILABLE');
        }
    });
    return router;
}
