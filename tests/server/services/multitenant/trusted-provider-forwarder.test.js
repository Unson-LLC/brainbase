import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
    createEnvCredentialMaterializer,
    createTrustedHttpProviderForwarder,
    createTrustedProviderForwardersFromEnv
} from '../../../../server/services/multitenant/trusted-provider-forwarder.js';
import { expectContractErrorAsync } from './test-helpers.js';

describe('trusted provider HTTP forwarder', () => {
    it('P0-1: server-owned HTTPS endpointだけへcredentialをAuthorization headerとしてforwardする', async () => {
        const fetchImpl = vi.fn(async (_url, init) => ({
            status: 202,
            headers: { get: () => 'application/json' },
            json: async () => ({ provider_request_id: 'request-a' }),
            text: async () => ''
        }));
        const forwarder = createTrustedHttpProviderForwarder({
            provider: 'openai',
            endpoint: 'https://provider.internal.example/v1/responses',
            allowedOperations: ['responses.create'],
            fetchImpl
        });
        const providerCredential = randomBytes(32).toString('base64url');
        const credential = Buffer.from(providerCredential, 'utf8');

        await expect(forwarder.forward({
            credential,
            operation: 'responses.create',
            body: { input: 'hello' }
        })).resolves.toEqual({ status: 202, body: { provider_request_id: 'request-a' } });

        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://provider.internal.example/v1/responses');
        expect(init.headers.authorization).toBe(`Bearer ${providerCredential}`);
        expect(init.headers['brainbase-provider-operation']).toBe('responses.create');
        expect(init.body).not.toContain(providerCredential);
    });

    it('P0-1: arbitrary operationと非TLS provider endpointをfail-closedにする', async () => {
        expect(() => createTrustedHttpProviderForwarder({
            provider: 'openai',
            endpoint: 'http://provider.example/v1/responses',
            allowedOperations: ['responses.create'],
            fetchImpl: vi.fn()
        })).toThrow(/HTTPS/);

        const forwarder = createTrustedHttpProviderForwarder({
            provider: 'openai',
            endpoint: 'https://provider.example/v1/responses',
            allowedOperations: ['responses.create'],
            fetchImpl: vi.fn()
        });
        await expectContractErrorAsync(
            () => forwarder.forward({
                credential: Buffer.from('secret'),
                operation: 'arbitrary.forward',
                body: { input: 'hello' }
            }),
            { code: 'CREDENTIAL_LEASE_SCOPE_MISMATCH' }
        );
    });

    it('P0-1: provider responseがcredential materialを反射した場合もmanaへ返さない', async () => {
        const providerCredential = randomBytes(32).toString('base64url');
        const forwarder = createTrustedHttpProviderForwarder({
            provider: 'openai',
            endpoint: 'https://provider.example/v1/responses',
            allowedOperations: ['responses.create'],
            fetchImpl: vi.fn(async () => ({
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({ message: providerCredential }),
                text: async () => ''
            }))
        });

        await expectContractErrorAsync(
            () => forwarder.forward({
                credential: Buffer.from(providerCredential, 'utf8'),
                operation: 'responses.create',
                body: { input: 'hello' }
            }),
            { code: 'UPSTREAM_INVALID_RESPONSE' }
        );
    });

    it('P0-1: production env bindingはopaque refから許可済みenv名だけをmaterializeする', async () => {
        const providerCredential = randomBytes(32).toString('base64url');
        const env = {
            PROVIDER_CREDENTIAL_A: providerCredential,
            BRAINBASE_TENANT_CREDENTIAL_ENV_REFS_JSON: JSON.stringify({ 'credref:a': 'PROVIDER_CREDENTIAL_A' }),
            BRAINBASE_TENANT_PROVIDER_FORWARDERS_JSON: JSON.stringify({
                'api.provider.example': {
                    provider: 'openai',
                    endpoint: 'https://api.provider.example/v1/responses',
                    allowed_operations: ['responses.create']
                }
            })
        };
        const materializer = createEnvCredentialMaterializer({ env });
        const forwarders = createTrustedProviderForwardersFromEnv({ env, fetchImpl: vi.fn() });

        await expect(materializer.materialize('credref:a')).resolves.toBeInstanceOf(Buffer);
        await expectContractErrorAsync(
            () => materializer.materialize('credref:unknown'),
            { code: 'CREDENTIAL_REF_UNKNOWN' }
        );
        expect(forwarders['api.provider.example']).toMatchObject({ provider: 'openai' });
        expect(JSON.stringify(forwarders)).not.toContain(providerCredential);
    });
});
