import { describe, expect, it, vi } from 'vitest';

import {
    createRemoteCredentialMaterializer,
    createRemoteCredentialStore,
    isRemoteCredentialStoreConfigured
} from '../../../../server/services/multitenant/remote-credential-store.js';

const binding = {
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    connection_revision: '1',
    provider: 'slack'
};

describe('remote tenant credential store adapter', () => {
    it('uses the canonical URL/token names and sends only a bearer credential', async () => {
        const fetchImpl = vi.fn(async (_url, init) => {
            expect(init.headers.authorization).toBe('Bearer store-service-token');
            return Response.json({ result: {
                credential_ref: 'credref://tenant/slack/ref-1',
                credential_mode: 'customer_oauth',
                refresh_revision: 1
            } });
        });
        const store = createRemoteCredentialStore({
            env: {
                BRAINBASE_TENANT_CREDENTIAL_STORE_URL: 'https://credentials.example.test',
                BRAINBASE_TENANT_CREDENTIAL_STORE_SERVICE_TOKEN: 'store-service-token'
            },
            fetchImpl
        });

        await expect(store.store({
            ...binding,
            credential_material: 'secret-only-in-boundary'
        })).resolves.toMatchObject({ credential_ref: 'credref://tenant/slack/ref-1' });
        expect(fetchImpl).toHaveBeenCalledWith(
            'https://credentials.example.test/api/v1/credentials/store',
            expect.objectContaining({ method: 'POST' })
        );
        expect(fetchImpl.mock.calls[0][1].body).toContain('secret-only-in-boundary');
    });

    it('materializes only with the complete tenant/connection/revision/provider binding', async () => {
        const fetchImpl = vi.fn(async (_url, init) => {
            const body = JSON.parse(init.body);
            expect(body).toEqual({
                operation: 'materialize',
                credential_ref: 'credref://tenant/slack/ref-1',
                ...binding
            });
            return Response.json({ result: {
                credential_material: 'provider-secret'
            } });
        });
        const materializer = createRemoteCredentialMaterializer({
            env: {
                BRAINBASE_TENANT_CREDENTIAL_STORE_URL: 'https://credentials.example.test',
                BRAINBASE_TENANT_CREDENTIAL_STORE_SERVICE_TOKEN: 'store-service-token'
            },
            fetchImpl
        });

        await expect(materializer.materialize('credref://tenant/slack/ref-1', binding))
            .resolves.toEqual(Buffer.from('provider-secret'));
        expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty('x-credential-material');
    });

    it('projects verify and revoke to the strict remote boundary without leaking local context fields', async () => {
        const fetchImpl = vi.fn(async (_url, init) => Response.json({ result: { valid: true } }));
        const store = createRemoteCredentialStore({
            env: {
                BRAINBASE_TENANT_CREDENTIAL_STORE_URL: 'https://credentials.example.test',
                BRAINBASE_TENANT_CREDENTIAL_STORE_SERVICE_TOKEN: 'store-service-token'
            },
            fetchImpl
        });
        const input = {
            ...binding,
            credential_ref: 'credref://tenant/slack/ref-1',
            tenant_key: 'unson-business',
            workspace_id: 'T0123456789',
            app_id: 'A0123456789'
        };

        await store.verify(input);
        await store.revoke({ ...input, reason: 'registration_failed' });
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
            operation: 'verify',
            ...binding,
            credential_ref: input.credential_ref
        });
        expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
            operation: 'revoke',
            ...binding,
            credential_ref: input.credential_ref,
            reason: 'registration_failed'
        });
    });

    it('fails closed before a canonical request when verify lacks the strict connection binding', async () => {
        const fetchImpl = vi.fn();
        const store = createRemoteCredentialStore({
            env: {
                BRAINBASE_TENANT_CREDENTIAL_STORE_URL: 'https://credentials.example.test',
                BRAINBASE_TENANT_CREDENTIAL_STORE_SERVICE_TOKEN: 'store-service-token'
            },
            fetchImpl
        });

        expect(() => store.verify({
            tenant_id: binding.tenant_id,
            credential_ref: 'credref://tenant/slack/ref-1',
            provider: 'slack'
        })).toThrow(/materialization_binding_required/u);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('supports old Slack adapter names while canonical runtime names remain preferred', () => {
        expect(isRemoteCredentialStoreConfigured({
            BRAINBASE_TENANT_CREDENTIAL_STORE_URL: 'https://credentials.example.test',
            BRAINBASE_TENANT_CREDENTIAL_STORE_SERVICE_TOKEN: 'token'
        })).toBe(true);
        expect(isRemoteCredentialStoreConfigured({
            BRAINBASE_SLACK_CREDENTIAL_STORE_URL: 'https://credentials.example.test',
            BRAINBASE_SLACK_CREDENTIAL_STORE_TOKEN: 'token'
        })).toBe(true);
    });

    it.each([
        {},
        { BRAINBASE_TENANT_CREDENTIAL_STORE_URL: 'http://credentials.example.test', BRAINBASE_TENANT_CREDENTIAL_STORE_SERVICE_TOKEN: 'token' },
        { BRAINBASE_TENANT_CREDENTIAL_STORE_URL: 'https://credentials.example.test', BRAINBASE_TENANT_CREDENTIAL_STORE_SERVICE_TOKEN: '' }
    ])('fails closed for incomplete or insecure configuration %j', (env) => {
        expect(() => createRemoteCredentialStore({ env, fetchImpl: vi.fn() }))
            .toThrow(/credential_store_configuration/u);
    });
});
