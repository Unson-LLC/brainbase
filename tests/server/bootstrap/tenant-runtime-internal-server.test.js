import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import {
    startTenantRuntimeInternalServer,
    startTenantRuntimeInternalServerFromEnv
} from '../../../server/bootstrap/tenant-runtime-internal-server.js';
import { createTenantRuntimeServices } from '../../../server/services/multitenant/tenant-runtime-services.js';
import { REQUIRED_CAPABILITIES } from '../../../server/services/multitenant/protocol-contract.js';

const serviceToken = 'internal-runtime-test-token-not-a-production-secret';
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
});
