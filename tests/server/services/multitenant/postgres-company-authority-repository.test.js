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

describe('PostgresCompanyAuthorityRepository.resolveCanonicalAuthority', () => {
    it('revalidates active membership revision in the authority transaction', async () => {
        const row = {
            binding_id: 'binding-task-read',
            binding_revision: 4,
            capability_id: 'task.read',
            decision: 'auto',
            allowed_effects: ['read'],
            responsible_person_id: 'person-umeda',
            accountable_person_id: 'person-sato',
            approver_person_id: null,
            delegated_by_person_id: null,
            policy_revision: 8,
            raci_revision: 5,
            resource_revision: 12,
            stop_conditions: [],
            canonical_person_id: 'person-umeda',
            membership_payload: { status: 'active', revision: '3' }
        };
        const query = vi.fn(async (sql) => ({
            rows: sql.includes('FROM company_authority_bindings') ? [row] : []
        }));
        const client = { query, release: vi.fn() };
        const repository = new PostgresCompanyAuthorityRepository({
            pool: { connect: vi.fn(async () => client) },
            now: () => new Date('2026-08-19T09:00:00Z')
        });

        await repository.resolveCanonicalAuthority({
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            canonical_person_id: 'person-umeda',
            membership_id: 'membership-umeda-unson',
            membership_revision: '3',
            organization_id: 'organization-unson',
            project_id: 'project-unson-backoffice',
            resource_ref: 'project:unson-backoffice',
            capability_id: 'task.read',
            desired_effect: 'read'
        });

        const authorityQuery = query.mock.calls.find(([sql]) =>
            sql.includes('FROM company_authority_bindings')
        );
        expect(authorityQuery[0]).toContain('membership.membership_payload');
        expect(authorityQuery[1][7]).toBe('2026-08-19T09:00:00.000Z');
    });

    it('rejects a membership revoked after identity resolution', async () => {
        const query = vi.fn(async (sql) => ({
            rows: sql.includes('FROM company_authority_bindings') ? [{
                binding_id: 'binding-task-read',
                binding_revision: 4,
                capability_id: 'task.read',
                decision: 'auto',
                allowed_effects: ['read'],
                policy_revision: 8,
                raci_revision: 5,
                resource_revision: 12,
                canonical_person_id: 'person-umeda',
                membership_payload: { status: 'inactive', revision: '4' }
            }] : []
        }));
        const client = { query, release: vi.fn() };
        const repository = new PostgresCompanyAuthorityRepository({
            pool: { connect: vi.fn(async () => client) }
        });

        await expect(repository.resolveCanonicalAuthority({
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            canonical_person_id: 'person-umeda',
            membership_id: 'membership-umeda-unson',
            membership_revision: '3',
            organization_id: 'organization-unson',
            project_id: 'project-unson-backoffice',
            resource_ref: 'project:unson-backoffice',
            capability_id: 'task.read',
            desired_effect: 'read'
        })).rejects.toMatchObject({ code: 'COMPANY_MEMBERSHIP_INACTIVE' });

        expect(query).toHaveBeenCalledWith('ROLLBACK');
    });
});
