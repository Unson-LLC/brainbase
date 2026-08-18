import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it } from 'vitest';

import {
    startTenantRuntimeInternalServer,
    startTenantRuntimeInternalServerFromEnv
} from '../../../server/bootstrap/tenant-runtime-internal-server.js';
import {
    createTenantRuntimeServices,
    createTenantRuntimeServicesFromEnv
} from '../../../server/services/multitenant/tenant-runtime-services.js';
import { REQUIRED_CAPABILITIES } from '../../../server/services/multitenant/protocol-contract.js';

const serviceToken = 'internal-runtime-test-token-not-a-production-secret';
const serviceTokenSecret = 'internal-runtime-jwt-secret-not-a-production-secret';
const deploymentId = 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX';
const servers = [];

function createServices() {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return createTenantRuntimeServices({
        serviceToken,
        tenantAuthority: {},
        connectionRegistry: {},
        credentialBroker: {},
        usageLedger: {},
        tenantBoundaryGateway: {},
        signingKey: {
            key_id: 'brainbase-test-key-1',
            private_key: privateKey,
            public_key: publicKey,
            status: 'current',
            not_before: '2026-08-16T00:00:00Z',
            expires_at: '2027-08-16T00:00:00Z'
        },
        audience: 'mana-runtime',
        deploymentId: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX',
        deploymentProfile: 'shared_cloud'
    });
}

function issueCanonicalServiceToken(overrides = {}) {
    const claims = {
        typ: 'service',
        issuer: 'brainbase',
        subject: 'svc_mana_runtime',
        audience: ['mana-runtime'],
        deployment_id: deploymentId,
        expires_at: '2030-01-01T00:00:00.000Z',
        capabilities: ['tenant_context:resolve'],
        exp: Math.floor(Date.parse('2030-01-01T00:00:00.000Z') / 1000),
        ...overrides
    };
    return `bbsvc_${jwt.sign(claims, serviceTokenSecret)}`;
}

function createProductionServices(token) {
    const { privateKey } = generateKeyPairSync('ed25519');
    return createTenantRuntimeServicesFromEnv({
        env: {
            BRAINBASE_TENANT_RUNTIME_ENABLED: '1',
            BRAINBASE_TENANT_RUNTIME_SERVICE_TOKEN: token,
            BRAINBASE_SERVICE_TOKEN_SECRET: serviceTokenSecret,
            BRAINBASE_TENANT_RUNTIME_SERVICE_ISSUER: 'brainbase',
            BRAINBASE_TENANT_RUNTIME_SERVICE_AUDIENCE: 'mana-runtime',
            BRAINBASE_TENANT_RUNTIME_REQUIRED_CAPABILITIES: 'tenant_context:resolve',
            BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID: deploymentId,
            BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_PROFILE: 'shared_cloud',
            BRAINBASE_TENANT_CONTEXT_SIGNING_KEY_ID: 'brainbase-test-key-1',
            BRAINBASE_TENANT_CONTEXT_SIGNING_KEY_JWK: JSON.stringify(privateKey.export({ format: 'jwk' }))
        },
        pool: { query: async () => ({ rows: [] }) },
        now: () => new Date('2026-08-18T00:00:00.000Z'),
        credentialMaterializer: async () => 'test-material-only',
        providerForwarders: { test: async () => ({ status: 200 }) }
    });
}

async function negotiate(services, token) {
    const server = await startTenantRuntimeInternalServer({
        services,
        host: '127.0.0.1',
        port: 0,
        log: { log: () => {} }
    });
    servers.push(server);
    const address = server.address();
    return fetch(`http://127.0.0.1:${address.port}/api/v1/runtime/negotiate`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            message_type: 'protocol_negotiation_request',
            protocol_id: 'mana-brainbase-tenant-context',
            deployment_id: deploymentId,
            deployment_profile: 'shared_cloud',
            supported_range: '>=1.0 <2.0',
            supported_versions: ['1.0'],
            required_capabilities: [...REQUIRED_CAPABILITIES],
            optional_capabilities: []
        })
    });
}

async function close(server) {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
});

describe('tenant runtime internal service binding', () => {
    it('P0-1: manaが専用内部portのservice-authenticated routeへ到達できる', async () => {
        const server = await startTenantRuntimeInternalServer({
            services: createServices(),
            host: '127.0.0.1',
            port: 0,
            log: { log: () => {} }
        });
        servers.push(server);
        const address = server.address();

        const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/runtime/negotiate`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${serviceToken}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                message_type: 'protocol_negotiation_request',
                protocol_id: 'mana-brainbase-tenant-context',
                deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX',
                deployment_profile: 'shared_cloud',
                supported_range: '>=1.0 <2.0',
                supported_versions: ['1.0'],
                required_capabilities: [...REQUIRED_CAPABILITIES],
                optional_capabilities: []
            })
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ selected_version: '1.0' });
    });

    it('P0-1: production bindingは明示port必須でwildcard listenを既定拒否する', async () => {
        await expect(startTenantRuntimeInternalServerFromEnv({
            services: createServices(),
            env: { BRAINBASE_TENANT_RUNTIME_ENABLED: '1' },
            log: { log: () => {} }
        })).rejects.toThrow(/PORT/);

        await expect(startTenantRuntimeInternalServerFromEnv({
            services: createServices(),
            env: {
                BRAINBASE_TENANT_RUNTIME_ENABLED: '1',
                BRAINBASE_TENANT_RUNTIME_PORT: '31016',
                BRAINBASE_TENANT_RUNTIME_HOST: '0.0.0.0'
            },
            log: { log: () => {} }
        })).rejects.toThrow(/non-loopback/);
    });

    it('AC-005: production runtimeは署名済みcanonical service tokenだけを受理する', async () => {
        const token = issueCanonicalServiceToken();
        const response = await negotiate(createProductionServices(token), token);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ selected_version: '1.0' });
    });

    it.each([
        ['issuer違い', { issuer: 'other-issuer' }],
        ['subject欠落', { subject: undefined }],
        ['期限切れ', { expires_at: '2020-01-01T00:00:00.000Z' }],
        ['audience違い', { audience: ['other-runtime'] }],
        ['deployment違い', { deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAY' }],
        ['capability不足', { capabilities: [] }]
    ])('AC-005: production runtimeは%sのservice tokenを拒否する', async (_label, overrides) => {
        const token = issueCanonicalServiceToken(overrides);
        const response = await negotiate(createProductionServices(token), token);

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: 'SERVICE_AUTH_INVALID' });
    });
});
