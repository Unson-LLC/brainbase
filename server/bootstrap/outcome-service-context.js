import { createPrivateKey } from 'node:crypto';

import {
    createManaOutcomeAuthorityReadbackHttpTransport,
    createManaOutcomeAuthorityReadbackProvider,
    MANA_OUTCOME_AUTHORITY_BRIDGE_ACCESS_CLIENT_ID_ENV,
    MANA_OUTCOME_AUTHORITY_BRIDGE_ACCESS_CLIENT_SECRET_ENV,
    MANA_OUTCOME_AUTHORITY_BRIDGE_AUDIENCE_ENV,
    MANA_OUTCOME_AUTHORITY_BRIDGE_DEPLOYMENT_ID_ENV,
    MANA_OUTCOME_AUTHORITY_BRIDGE_HOSTNAME_ENV,
    MANA_OUTCOME_AUTHORITY_BRIDGE_ISSUER_ENV,
    MANA_OUTCOME_AUTHORITY_BRIDGE_SERVICE_TOKEN_ENV,
    MANA_OUTCOME_AUTHORITY_BRIDGE_URL_ENV,
    MANA_OUTCOME_AUTHORITY_READBACK_RESOURCE_ENV
} from '../services/knowledge-retrieve-binding-provider.js';
import { createOutcomeServiceContextIssuer } from '../services/multitenant/outcome-service-context-issuer.js';

const SIGNING_KEY_JWK_ENV = 'BRAINBASE_TENANT_CONTEXT_SIGNING_KEY_JWK';
const SIGNING_KEY_ID_ENV = 'BRAINBASE_TENANT_CONTEXT_SIGNING_KEY_ID';
const SERVICE_ISSUER_ENV = 'BRAINBASE_TENANT_RUNTIME_SERVICE_ISSUER';
const SERVICE_AUDIENCE_ENV = 'BRAINBASE_TENANT_RUNTIME_SERVICE_AUDIENCE';
const RUNTIME_AUDIENCE_ENV = 'BRAINBASE_TENANT_RUNTIME_AUDIENCE';
const DEPLOYMENT_ID_ENV = 'BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID';
const REQUIRED_CAPABILITIES_ENV = 'BRAINBASE_TENANT_RUNTIME_REQUIRED_CAPABILITIES';

function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function asList(value) {
    if (Array.isArray(value)) return value.filter(nonEmpty).map((item) => item.trim());
    if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
    return [];
}

function configuredSigningKey(env, signingKey) {
    if (signingKey?.private_key && nonEmpty(signingKey.key_id)) return signingKey;
    if (!nonEmpty(env?.[SIGNING_KEY_JWK_ENV]) || !nonEmpty(env?.[SIGNING_KEY_ID_ENV])) return null;
    try {
        const privateKey = createPrivateKey({
            key: JSON.parse(env[SIGNING_KEY_JWK_ENV]),
            format: 'jwk'
        });
        return {
            key_id: env[SIGNING_KEY_ID_ENV],
            private_key: privateKey
        };
    } catch {
        return null;
    }
}

function configuredServiceAuth(env) {
    const issuer = env?.[MANA_OUTCOME_AUTHORITY_BRIDGE_ISSUER_ENV];
    const audience = asList(env?.[MANA_OUTCOME_AUTHORITY_BRIDGE_AUDIENCE_ENV]);
    const deploymentId = env?.[MANA_OUTCOME_AUTHORITY_BRIDGE_DEPLOYMENT_ID_ENV];
    if (!nonEmpty(issuer) && audience.length === 0 && !nonEmpty(deploymentId)) return null;
    if (!nonEmpty(issuer) || audience.length === 0 || !nonEmpty(deploymentId)) return null;
    return { issuer, audience, deploymentId };
}

function createReadbackTransportFromEnv({ env, fetchImpl }) {
    return createManaOutcomeAuthorityReadbackHttpTransport({
        endpoint: env?.[MANA_OUTCOME_AUTHORITY_BRIDGE_URL_ENV],
        hostname: env?.[MANA_OUTCOME_AUTHORITY_BRIDGE_HOSTNAME_ENV],
        serviceToken: env?.[MANA_OUTCOME_AUTHORITY_BRIDGE_SERVICE_TOKEN_ENV],
        accessClientId: env?.[MANA_OUTCOME_AUTHORITY_BRIDGE_ACCESS_CLIENT_ID_ENV],
        accessClientSecret: env?.[MANA_OUTCOME_AUTHORITY_BRIDGE_ACCESS_CLIENT_SECRET_ENV],
        fetchImpl,
        serviceAuth: configuredServiceAuth(env)
    });
}

function createServiceAuthorization({ env, tenantRuntimeServices }) {
    if (typeof tenantRuntimeServices?.serviceAuth !== 'function') return null;
    const issuer = env?.[SERVICE_ISSUER_ENV] || 'brainbase';
    const audience = env?.[SERVICE_AUDIENCE_ENV]
        || env?.[RUNTIME_AUDIENCE_ENV]
        || 'mana-runtime';
    const deploymentId = env?.[DEPLOYMENT_ID_ENV];
    const requiredCapabilities = asList(env?.[REQUIRED_CAPABILITIES_ENV] || 'tenant_context:resolve');
    if (!nonEmpty(issuer) || !nonEmpty(audience) || !nonEmpty(deploymentId) || requiredCapabilities.length === 0) {
        return null;
    }
    return async (serviceIdentity) => {
        if (!serviceIdentity || serviceIdentity.issuer !== issuer
            || serviceIdentity.deployment_id !== deploymentId) return false;
        const audiences = asList(serviceIdentity.audience);
        const capabilities = asList(serviceIdentity.capabilities);
        return audiences.includes(audience)
            && requiredCapabilities.every((capability) => capabilities.includes(capability));
    };
}

function normalizeAuthority(value) {
    if (!value || typeof value !== 'object') return null;
    if (!nonEmpty(value.tenant_id)) return null;
    return {
        principal: {
            tenant_id: value.tenant_id,
            project_id: value.authorized_project_codes?.[0],
            actor_principal_id: value.delegated_actor_person_id
        },
        persisted: {
            contract_id: value.outcome_contract_id,
            contract_version: String(value.contract_version),
            run_id: value.run_id,
            resource_ref: value.resource_ref
        },
        authority_revision: value.authority_revision,
        profile_id: value.profile_id,
        run_mode: value.run_mode,
        contract_status: value.contract_status
    };
}

function createProviderReadback({ provider }) {
    if (typeof provider?.verifyAuthority !== 'function') return null;
    return async (input) => {
        const organizations = input.profile?.organization_ids;
        if (!Array.isArray(organizations) || organizations.length !== 1 || !nonEmpty(organizations[0])) {
            throw new Error('Outcome service profile must name exactly one organization for Mana readback');
        }
        const organizationId = organizations[0].trim();
        if (organizationId === input.tenant) {
            throw new Error('Outcome service tenant and organization must be distinct');
        }
        const authority = await provider.verifyAuthority({
            tenant_id: input.tenant,
            organization_id: organizationId,
            delegated_actor_person_id: input.actor,
            project_code: input.project,
            outcome_contract_id: input.contract,
            outcome_contract_version: input.version,
            run_id: input.run,
            run_mode: input.mode
        });
        return normalizeAuthority(authority);
    };
}

/**
 * Compose the outcome context issuer only from explicit trust-boundary
 * adapters. Profile resolution is intentionally not inferred from request
 * data, tenant runtime internals, or environment JSON. Missing adapters or
 * credentials return null so the route remains a 503 fail-closed boundary.
 */
export function createOutcomeServiceContextIssuerFromEnv({
    env = process.env,
    tenantRuntimeServices = null,
    adapters = null,
    signingKey = null,
    serviceBinding = null,
    transport = null,
    resource = env?.[MANA_OUTCOME_AUTHORITY_READBACK_RESOURCE_ENV],
    fetchImpl = globalThis.fetch,
    timeoutMs,
    now
} = {}) {
    if (!tenantRuntimeServices) return null;
    const injected = adapters || tenantRuntimeServices.outcomeServiceContextAdapters || null;
    const resolveProfile = injected?.resolveProfile;
    const resolveTenant = injected?.resolveTenant;
    const resolveConnection = injected?.resolveConnection;
    if ([resolveProfile, resolveTenant, resolveConnection].some((adapter) => typeof adapter !== 'function')) return null;

    const resolvedSigningKey = configuredSigningKey(env, signingKey || injected?.signingKey);
    if (!resolvedSigningKey) return null;

    const resolvedAuthorize = typeof injected?.authorizeService === 'function'
        ? injected.authorizeService
        : createServiceAuthorization({ env, tenantRuntimeServices });
    if (typeof resolvedAuthorize !== 'function') return null;

    let readback = injected?.readback;
    if (typeof readback !== 'function') {
        const resolvedTransport = serviceBinding || transport || createReadbackTransportFromEnv({ env, fetchImpl });
        const provider = createManaOutcomeAuthorityReadbackProvider({
            serviceBinding,
            transport: resolvedTransport,
            resource,
            timeoutMs
        });
        readback = createProviderReadback({ provider });
    }
    if (typeof readback !== 'function') return null;

    return createOutcomeServiceContextIssuer({
        signingKey: resolvedSigningKey,
        resolveProfile,
        resolveTenant,
        resolveConnection,
        readback,
        authorizeService: resolvedAuthorize,
        now
    });
}

export const outcomeServiceContextBootstrapConfig = Object.freeze({
    signingKeyJwkEnv: SIGNING_KEY_JWK_ENV,
    signingKeyIdEnv: SIGNING_KEY_ID_ENV,
    readbackResourceEnv: MANA_OUTCOME_AUTHORITY_READBACK_RESOURCE_ENV
});
