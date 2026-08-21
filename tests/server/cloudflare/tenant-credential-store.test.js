import { describe, expect, it, vi } from 'vitest';

import {
    MAX_CREDENTIAL_BYTES,
    TenantCredentialStoreDurableObject,
    handleTenantCredentialStoreRequest
} from '../../../packages/cloudflare-tenant-credential-store/src/worker.js';

const SERVICE_TOKEN = 'tenant-credential-store-service-token';
const ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const binding = {
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    connection_revision: '1',
    provider: 'slack'
};

function request(path, body, { token = SERVICE_TOKEN, method = 'POST' } = {}) {
    return new Request(`https://brainbase-tenant-credential-store.example.workers.dev${path}`, {
        method,
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json'
        },
        body: method === 'GET' ? undefined : JSON.stringify(body)
    });
}

function createDurableObjectEnv() {
    const objects = new Map();
    const namespace = {
        idFromName: vi.fn((name) => name),
        get: vi.fn((id) => {
            if (!objects.has(id)) {
                const storage = new Map();
                const state = {
                    storage: {
                        get: async (key) => storage.get(key),
                        put: async (key, value) => storage.set(key, value),
                        delete: async (key) => storage.delete(key)
                    },
                    id: { toString: () => String(id) },
                    blockConcurrencyWhile: async (callback) => callback()
                };
                objects.set(id, new TenantCredentialStoreDurableObject(state, {
                    BRAINBASE_TENANT_CREDENTIAL_STORE_ENCRYPTION_KEY: ENCRYPTION_KEY
                }));
            }
            const durableObject = objects.get(id);
            return { fetch: (input, init) => durableObject.fetch(input, init) };
        })
    };
    return { namespace, objects };
}

function envFixture() {
    const { namespace, objects } = createDurableObjectEnv();
    return {
        env: {
            BRAINBASE_TENANT_CREDENTIAL_STORE_SERVICE_TOKEN: SERVICE_TOKEN,
            BRAINBASE_TENANT_CREDENTIAL_STORE_ENCRYPTION_KEY: ENCRYPTION_KEY,
            TENANT_CREDENTIAL_STORE: namespace
        },
        namespace,
        objects
    };
}

async function json(response) {
    return response.json();
}

describe('tenant credential store worker', () => {
    it('rejects missing or invalid bearer authentication without reaching the DO', async () => {
        const fixture = envFixture();
        const response = await handleTenantCredentialStoreRequest(
            request('/api/v1/credentials/store', {
                ...binding,
                credential_material: 'secret-that-must-not-escape'
            }, { token: 'wrong-token' }),
            fixture.env
        );

        expect(response.status).toBe(401);
        expect(await json(response)).toMatchObject({ code: 'SERVICE_AUTH_REQUIRED' });
        expect(fixture.namespace.get).not.toHaveBeenCalled();
    });

    it('stores encrypted material, verifies only opaque metadata, and materializes exact binding', async () => {
        const fixture = envFixture();
        const storeResponse = await handleTenantCredentialStoreRequest(
            request('/api/v1/credentials/store', {
                ...binding,
                idempotency_key: 'slack-installation-1',
                credential_material: 'xoxb-secret-token',
                credential_refresh_material: 'xoxe-refresh-secret',
                credential_mode: 'customer_oauth'
            }),
            fixture.env
        );
        expect(storeResponse.status).toBe(200);
        const stored = await json(storeResponse);
        expect(stored.result).toMatchObject({
            credential_mode: 'customer_oauth',
            refresh_revision: 1
        });
        expect(stored.result.credential_ref).toMatch(/^credref:\/\//u);
        expect(JSON.stringify(stored)).not.toContain('xoxb-secret-token');
        expect(JSON.stringify(stored)).not.toContain('xoxe-refresh-secret');

        const verifyResponse = await handleTenantCredentialStoreRequest(
            request('/api/v1/credentials/verify', {
                ...binding,
                credential_ref: stored.result.credential_ref
            }),
            fixture.env
        );
        expect(verifyResponse.status).toBe(200);
        const verified = await json(verifyResponse);
        expect(verified.result).toMatchObject({
            valid: true,
            ...binding,
            credential_ref: stored.result.credential_ref,
            credential_mode: 'customer_oauth'
        });
        expect(JSON.stringify(verified)).not.toContain('xoxb-secret-token');

        const materializeResponse = await handleTenantCredentialStoreRequest(
            request('/api/v1/credentials/materialize', {
                ...binding,
                credential_ref: stored.result.credential_ref
            }),
            fixture.env
        );
        expect(materializeResponse.status).toBe(200);
        await expect(json(materializeResponse)).resolves.toMatchObject({
            result: {
                credential_material: 'xoxb-secret-token',
                credential_refresh_material: 'xoxe-refresh-secret'
            }
        });
    });

    it('rejects cross-tenant, connection, revision, and provider binding before materialization', async () => {
        const fixture = envFixture();
        const stored = await handleTenantCredentialStoreRequest(
            request('/api/v1/credentials/store', {
                ...binding,
                credential_material: 'xoxb-secret-token'
            }),
            fixture.env
        ).then(json);
        const mismatches = [
            { tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX' },
            { connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69F5AV' },
            { connection_revision: '2' },
            { provider: 'google' }
        ];
        for (const mismatch of mismatches) {
            const response = await handleTenantCredentialStoreRequest(
                request('/api/v1/credentials/materialize', {
                    ...binding,
                    ...mismatch,
                    credential_ref: stored.result.credential_ref
                }),
                fixture.env
            );
            expect(response.status).toBe(403);
            expect(await json(response)).toMatchObject({ code: 'CREDENTIAL_BINDING_MISMATCH' });
        }
    });

    it('enforces the 64 KiB credential limit and makes revoke terminal', async () => {
        const fixture = envFixture();
        const accepted = await handleTenantCredentialStoreRequest(
            request('/api/v1/credentials/store', {
                ...binding,
                credential_material: 'a'.repeat(MAX_CREDENTIAL_BYTES)
            }),
            fixture.env
        );
        expect(accepted.status).toBe(200);
        const acceptedBody = await json(accepted);

        const rejected = await handleTenantCredentialStoreRequest(
            request('/api/v1/credentials/store', {
                ...binding,
                connection_revision: '2',
                credential_material: 'a'.repeat(MAX_CREDENTIAL_BYTES + 1)
            }),
            fixture.env
        );
        expect(rejected.status).toBe(413);
        expect(await json(rejected)).toMatchObject({ code: 'CREDENTIAL_MATERIAL_TOO_LARGE' });

        const revoked = await handleTenantCredentialStoreRequest(
            request('/api/v1/credentials/revoke', {
                ...binding,
                credential_ref: acceptedBody.result.credential_ref,
                reason: 'registration_failed'
            }),
            fixture.env
        );
        expect(revoked.status).toBe(200);
        const afterRevoke = await handleTenantCredentialStoreRequest(
            request('/api/v1/credentials/materialize', {
                ...binding,
                credential_ref: acceptedBody.result.credential_ref
            }),
            fixture.env
        );
        expect(afterRevoke.status).toBe(403);
        expect(await json(afterRevoke)).toMatchObject({ code: 'CREDENTIAL_REVOKED' });
    });

    it('supports idempotent store without returning or logging plaintext', async () => {
        const fixture = envFixture();
        const log = vi.spyOn(console, 'log');
        const payload = {
            ...binding,
            idempotency_key: 'same-installation',
            credential_material: 'do-not-log-this'
        };
        const first = await handleTenantCredentialStoreRequest(
            request('/api/v1/credentials/store', payload), fixture.env
        ).then(json);
        const second = await handleTenantCredentialStoreRequest(
            request('/api/v1/credentials/store', payload), fixture.env
        ).then(json);
        expect(second.result.credential_ref).toBe(first.result.credential_ref);
        expect(log.mock.calls.flat().join(' ')).not.toContain('do-not-log-this');
        log.mockRestore();
    });
});
