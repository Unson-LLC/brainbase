import { describe, expect, it, vi } from 'vitest';

import {
    createPostgresCredentialResolver,
    createPostgresGraphProjectResolver
} from '../../../../server/services/multitenant/tenant-provisioning-resolvers.js';

function createPool(rows) {
    const queries = [];
    const client = {
        query: vi.fn(async (text, values = []) => {
            queries.push({ text: String(text), values });
            if (String(text).startsWith('SELECT ')) return { rows };
            return { rows: [] };
        }),
        release: vi.fn()
    };
    return {
        pool: { connect: vi.fn(async () => client) },
        client,
        queries
    };
}

describe('tenant provisioning production resolvers', () => {
    it('resolves one canonical project with a bounded, separate read client', async () => {
        const fixture = createPool([{ id: 'project_mana' }]);
        const resolver = createPostgresGraphProjectResolver({ pool: fixture.pool, timeoutMs: 2500 });

        await expect(resolver.resolveCanonicalProject({ project_code: 'mana' }))
            .resolves.toEqual({ project_id: 'project_mana', matches: 1 });
        expect(fixture.pool.connect).toHaveBeenCalledTimes(1);
        expect(fixture.client.release).toHaveBeenCalledTimes(1);
        expect(fixture.queries[0]).toEqual({ text: "SET statement_timeout = '2500ms'", values: [] });
        expect(fixture.queries.at(-1)).toEqual({ text: 'RESET statement_timeout', values: [] });
        expect(fixture.queries.some(({ text }) => /INSERT|UPDATE|DELETE|person/iu.test(text))).toBe(false);
    });

    it('returns an ambiguous result instead of guessing between canonical projects', async () => {
        const fixture = createPool([{ id: 'project_a' }, { id: 'project_b' }]);
        const resolver = createPostgresGraphProjectResolver({ pool: fixture.pool });

        await expect(resolver.resolveCanonicalProject({ project_code: 'mana' }))
            .resolves.toEqual({ project_id: null, matches: 2 });
    });

    it('returns a tenant-bound credential match without selecting secret material', async () => {
        const fixture = createPool([{
            tenant_key: 'unson-business',
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            credential_ref: 'credref://unson-business/slack/primary',
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            connection_revision: 2
        }]);
        const resolver = createPostgresCredentialResolver({ pool: fixture.pool });

        await expect(resolver.verifyOpaqueReference({
            tenant_key: 'unson-business',
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            credential_ref: 'credref://unson-business/slack/primary',
            provider: 'slack',
            workspace_id: 'T0123456789',
            app_id: 'A0123456789'
        })).resolves.toEqual({
            valid: true,
            tenant_key: 'unson-business',
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            connection_revision: 2
        });
        expect(fixture.queries.map(({ text }) => text).join('\n')).not.toMatch(/secret|token|value/iu);
    });

    it('does not accept a credential row whose canonical tenant id differs', async () => {
        const fixture = createPool([{
            tenant_key: 'unson-business',
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAY',
            credential_ref: 'credref://unson-business/slack/primary',
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            connection_revision: 2
        }]);
        const resolver = createPostgresCredentialResolver({ pool: fixture.pool });

        await expect(resolver.verifyOpaqueReference({
            tenant_key: 'unson-business',
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            credential_ref: 'credref://unson-business/slack/primary',
            provider: 'slack',
            workspace_id: 'T0123456789',
            app_id: 'A0123456789'
        })).resolves.toEqual({ valid: false, tenant_key: 'unson-business' });
    });

    it('fails closed for an absent or ambiguous credential boundary', async () => {
        const absent = createPool([]);
        const resolver = createPostgresCredentialResolver({ pool: absent.pool });
        await expect(resolver.verifyOpaqueReference({
            tenant_key: 'unson-business',
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            credential_ref: 'credref://unson-business/slack/primary',
            provider: 'slack',
            workspace_id: 'T0123456789',
            app_id: 'A0123456789'
        })).resolves.toEqual({ valid: false, tenant_key: 'unson-business' });

        const ambiguous = createPool([{ tenant_key: 'unson-business' }, { tenant_key: 'unson-business' }]);
        const ambiguousResolver = createPostgresCredentialResolver({ pool: ambiguous.pool });
        await expect(ambiguousResolver.verifyOpaqueReference({
            tenant_key: 'unson-business',
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            credential_ref: 'credref://unson-business/slack/primary',
            provider: 'slack',
            workspace_id: 'T0123456789',
            app_id: 'A0123456789'
        })).resolves.toEqual({ valid: false, tenant_key: 'unson-business' });
    });

    it('fails closed when first-install credential verification has no canonical boundary', async () => {
        const fixture = createPool([]);
        const resolver = createPostgresCredentialResolver({ pool: fixture.pool });

        await expect(resolver.verifyOpaqueReference({
            tenant_key: 'unson-business',
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            credential_ref: 'credref://unson-business/slack/primary',
            provider: 'slack',
            workspace_id: 'T0123456789',
            app_id: 'A0123456789',
            allow_unregistered: true
        })).rejects.toMatchObject({ code: 'CREDENTIAL_BOUNDARY_REQUIRED' });
        expect(fixture.queries.map(({ text }) => text).join('\n')).not.toMatch(/SELECT .*secret|token|value/iu);
    });

    it('requires the canonical credential boundary to prove first-install existence and tenant binding', async () => {
        const fixture = createPool([]);
        const credentialBoundary = {
            verify: vi.fn(async (input) => ({
                valid: true,
                ...input
            }))
        };
        const resolver = createPostgresCredentialResolver({ pool: fixture.pool, credentialBoundary });

        await expect(resolver.verifyOpaqueReference({
            tenant_key: 'unson-business',
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            credential_ref: 'credref://unson-business/slack/primary',
            provider: 'slack',
            workspace_id: 'T0123456789',
            app_id: 'A0123456789',
            allow_unregistered: true
        })).resolves.toEqual({
            valid: true,
            tenant_key: 'unson-business',
            first_install: true
        });
        expect(credentialBoundary.verify).toHaveBeenCalledWith({
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            tenant_key: 'unson-business',
            credential_ref: 'credref://unson-business/slack/primary',
            provider: 'slack',
            workspace_id: 'T0123456789',
            app_id: 'A0123456789'
        });
    });

    it('rejects a first-install credential boundary response bound to another tenant', async () => {
        const fixture = createPool([]);
        const credentialBoundary = {
            verify: vi.fn(async (input) => ({
                valid: true,
                ...input,
                tenant_key: 'other-tenant'
            }))
        };
        const resolver = createPostgresCredentialResolver({ pool: fixture.pool, credentialBoundary });

        await expect(resolver.verifyOpaqueReference({
            tenant_key: 'unson-business',
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            credential_ref: 'credref://unson-business/slack/primary',
            provider: 'slack',
            workspace_id: 'T0123456789',
            app_id: 'A0123456789',
            allow_unregistered: true
        })).resolves.toEqual({ valid: false, tenant_key: 'unson-business' });
    });

    it('passes and verifies the strict connection binding for a remote first install', async () => {
        const fixture = createPool([]);
        const credentialBoundary = {
            verify: vi.fn(async ({ tenant_id, credential_ref, provider, connection_id, connection_revision }) => ({
                valid: true,
                tenant_id,
                credential_ref,
                provider,
                connection_id,
                connection_revision
            }))
        };
        const resolver = createPostgresCredentialResolver({ pool: fixture.pool, credentialBoundary });

        await expect(resolver.verifyOpaqueReference({
            tenant_key: 'unson-business',
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            credential_ref: 'credref://unson-business/slack/primary',
            provider: 'slack',
            workspace_id: 'T0123456789',
            app_id: 'A0123456789',
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            connection_revision: '1',
            allow_unregistered: true
        })).resolves.toEqual({
            valid: true,
            tenant_key: 'unson-business',
            first_install: true,
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            connection_revision: 1
        });
        expect(credentialBoundary.verify).toHaveBeenCalledWith({
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            tenant_key: 'unson-business',
            credential_ref: 'credref://unson-business/slack/primary',
            provider: 'slack',
            workspace_id: 'T0123456789',
            app_id: 'A0123456789',
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            connection_revision: '1'
        });
    });

    it('requires a production pool and rejects unbounded timeout configuration', () => {
        expect(() => createPostgresGraphProjectResolver()).toThrow(/PostgreSQL pool/u);
        expect(() => createPostgresCredentialResolver({ pool: { connect: vi.fn() }, timeoutMs: 0 }))
            .toThrow(/between 1 and 60000/u);
    });
});
