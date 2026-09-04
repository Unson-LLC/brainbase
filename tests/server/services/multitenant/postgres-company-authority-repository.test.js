import { describe, expect, it, vi } from 'vitest';

import { PostgresCompanyAuthorityRepository } from '../../../../server/services/multitenant/postgres-company-authority-repository.js';

function input() {
    return {
        provider_identity: {
            provider: 'slack',
            authenticated_subject_id: 'U-UMEDA',
            workspace_id: 'workspace-a',
            app_id: 'app-a',
            enterprise_id: 'enterprise-a'
        },
        requested_action: {
            capability_id: 'task.read',
            resource_ref: 'project:unson-backoffice',
            project_hint: 'unson-backoffice',
            desired_effect: 'read'
        }
    };
}

describe('PostgresCompanyAuthorityRepository.resolveObservedRoute', () => {
    it('uses only observed identity and project hint to resolve one canonical route', async () => {
        const row = {
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            tenant_revision: 7,
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW',
            connection_revision: 11,
            workspace_id: 'workspace-a',
            app_id: 'app-a'
        };
        const pool = { query: vi.fn(async () => ({ rows: [row] })) };
        const repository = new PostgresCompanyAuthorityRepository({ pool });

        await expect(repository.resolveObservedRoute(input())).resolves.toEqual(row);
        expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining('public.resolve_company_authority_route($1, $2, $3, $4, $5, $6)'),
            ['slack', 'U-UMEDA', 'workspace-a', 'app-a', 'enterprise-a', 'unson-backoffice']
        );
    });

    it.each([
        [[], 'COMPANY_IDENTITY_UNRESOLVED'],
        [[{ tenant_id: 'tenant-a' }, { tenant_id: 'tenant-b' }], 'COMPANY_IDENTITY_AMBIGUOUS']
    ])('fails closed for %s route candidates', async (rows, code) => {
        const repository = new PostgresCompanyAuthorityRepository({
            pool: { query: vi.fn(async () => ({ rows })) }
        });

        await expect(repository.resolveObservedRoute(input())).rejects.toMatchObject({ code });
    });

    it('does not expose database failures as identity absence', async () => {
        const repository = new PostgresCompanyAuthorityRepository({
            pool: { query: vi.fn(async () => { throw new Error('database detail'); }) }
        });

        await expect(repository.resolveObservedRoute(input())).rejects.toMatchObject({
            code: 'UPSTREAM_UNAVAILABLE',
            status: 503,
            retryable: true
        });
    });
});
