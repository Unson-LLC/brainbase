import express from 'express';

import { ContractError } from '../services/multitenant/errors.js';
import { generateCanonicalId, isCanonicalId } from '../services/multitenant/ids.js';
import { validateSlackInstallationBinding } from '../services/multitenant/slack-installation-control-plane.js';

const INTERNAL_FAILURE_DIAGNOSTIC_CODES = new Set([
    'OAUTH_EXCHANGE_UNAVAILABLE',
    'OAUTH_EXCHANGE_INVALID',
    'OAUTH_EXCHANGE_REJECTED',
    'OAUTH_CREDENTIAL_MISSING',
    'OAUTH_EXCHANGE_FAILED',
    'EXCHANGE_NORMALIZATION_FAILED',
    'CONNECTION_RESERVATION_FAILED',
    'CREDENTIAL_REF_INVALID',
    'CREDENTIAL_STORE_UNAVAILABLE',
    'CREDENTIAL_STORE_INVALID',
    'CREDENTIAL_STORE_REJECTED',
    'CREDENTIAL_STORE_FAILED',
    'DB_REGISTRATION_FAILED'
]);

function errorResponse(res, error) {
    if (error instanceof ContractError && INTERNAL_FAILURE_DIAGNOSTIC_CODES.has(error.code)) {
        return res.status(503).json({
            error: { code: 'UPSTREAM_UNAVAILABLE', retryable: true, fault_domain: 'brainbase_cloud' }
        });
    }
    if (error instanceof ContractError) {
        return res.status(error.status).json({
            error: {
                code: error.code,
                retryable: error.retryable,
                fault_domain: error.fault_domain
            }
        });
    }
    return res.status(503).json({
        error: { code: 'UPSTREAM_UNAVAILABLE', retryable: true, fault_domain: 'brainbase_cloud' }
    });
}

function bodyWithoutSecrets(req) {
    return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
}

function defaultAuthorizeRequest(req, { appId, resolvePreProvisionedConnection }) {
    const access = req.access ?? {};
    const role = String(access.role ?? '').toLowerCase();
    if (req.authSource === 'service-token'
        || req.authSource === 'internal'
        || req.authSource === 'insecure-header'
        || !['admin', 'owner', 'tenant_admin', 'ceo', 'gm'].includes(role)
        || !isCanonicalId(access.tenantId, 'ten')
        || !isCanonicalId(access.personId, 'per')
        || typeof appId !== 'string' || appId.length === 0) {
        throw new ContractError('INSTALLATION_AUTHORIZATION_REQUIRED', { status: 403 });
    }
    const requested = safeBody(req, [
        'app_id',
        'expected_workspace_id',
        'expected_enterprise_id',
        'expected_connection_revision'
    ]);
    if (requested.app_id !== undefined && requested.app_id !== appId) {
        throw new ContractError('INSTALLATION_BINDING_MISMATCH', { status: 409 });
    }
    const preProvisioned = typeof resolvePreProvisionedConnection === 'function'
        ? resolvePreProvisionedConnection({
            tenant_id: access.tenantId,
            app_id: appId,
            workspace_id: requested.expected_workspace_id,
            enterprise_id: requested.expected_enterprise_id
        })
        : null;
    return Promise.resolve(preProvisioned).then((connection) => validateSlackInstallationBinding({
        installation_intent_id: generateCanonicalId('insi'),
        tenant_id: access.tenantId,
        app_id: appId,
        ...(connection?.workspace_id || requested.expected_workspace_id
            ? { expected_workspace_id: connection?.workspace_id ?? requested.expected_workspace_id } : {}),
        ...(connection?.enterprise_id || requested.expected_enterprise_id
            ? { expected_enterprise_id: connection?.enterprise_id ?? requested.expected_enterprise_id } : {}),
        initiated_by_person_id: access.personId,
        ...(connection?.connection_revision || requested.expected_connection_revision
            ? { expected_connection_revision: connection?.connection_revision ?? requested.expected_connection_revision } : {})
    }));
}

function safeBody(req, fields) {
    const body = bodyWithoutSecrets(req);
    const allowed = new Set(fields);
    if (Object.keys(body).some((field) => !allowed.has(field))) {
        throw new ContractError('SCHEMA_INVALID', { status: 400, fault_domain: 'protocol' });
    }
    return body;
}

export function createSlackInstallationControlPlaneRouter({
    controlPlane,
    oauthFlow,
    appId,
    resolvePreProvisionedConnection,
    authorizeRequest = (req) => defaultAuthorizeRequest(req, { appId, resolvePreProvisionedConnection })
} = {}) {
    if (!controlPlane || typeof controlPlane.authorize !== 'function'
        || typeof controlPlane.authorizeBinding !== 'function'
        || typeof controlPlane.exchange_and_register !== 'function') {
        throw new Error('Slack installation control-plane is required');
    }
    const router = express.Router();
    router.post('/slack-installations\\:authorize', async (req, res) => {
        try {
            const binding = await authorizeRequest(req);
            // The route's auth middleware and optional pre-provisioned resolver
            // establish authority; only the resulting binding is persisted.
            const result = await controlPlane.authorizeBinding(binding);
            const authorization = oauthFlow?.createAuthorization(result) ?? null;
            return res.status(200).set('cache-control', 'no-store').json({
                result: authorization ? {
                    ...result,
                    authorization_url: authorization.authorization_url,
                    redirect_uri: authorization.redirect_uri
                } : result
            });
        } catch (error) {
            return errorResponse(res, error);
        }
    });
    if (oauthFlow) {
        router.get('/slack-installations\\:callback', async (req, res) => {
            try {
                if (typeof req.query?.code !== 'string' || typeof req.query?.state !== 'string'
                    || Object.keys(req.query).some((field) => !['code', 'state'].includes(field))) {
                    throw new ContractError('INSTALLATION_STATE_INVALID', { status: 400, fault_domain: 'protocol' });
                }
                const opened = oauthFlow.open(req.query.state);
                await controlPlane.exchange_and_register({
                    authorization_code: req.query.code,
                    redirect_uri: opened.redirect_uri,
                    intent: opened.intent
                });
                return res.status(200)
                    .set('cache-control', 'no-store')
                    .type('html')
                    .send('<!doctype html><html lang="ja"><meta charset="utf-8"><title>Slack連携完了</title><body><h1>Slack連携が完了しました</h1><p>この画面を閉じてください。</p></body></html>');
            } catch (error) {
                return errorResponse(res, error);
            }
        });
    }
    router.post('/slack-installations\\:exchange-and-register', async (req, res) => {
        try {
            const input = safeBody(req, ['authorization_code', 'redirect_uri', 'intent']);
            const result = await controlPlane.exchange_and_register(input);
            return res.status(200).set('cache-control', 'no-store').json({ result });
        } catch (error) {
            return errorResponse(res, error);
        }
    });
    return router;
}
