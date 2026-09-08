import { describe, expect, it, vi } from 'vitest';

import { createSlackInstallationAccessResolver } from '../../../../server/services/multitenant/slack-installation-access.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX';
const personId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY';
const otherTenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const otherPersonId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAZ';

function poolFor(rows) {
    const client = {
        query: vi.fn(async () => ({ rows })),
        release: vi.fn()
    };
    return { pool: { connect: vi.fn(async () => client) }, client };
}

describe('Slack installation canonical access mapping', () => {
    it('resolves through the trusted app-bound route before accepting canonical JWT claims', async () => {
        const repository = {
            resolveObservedRoute: vi.fn(async () => ({
                tenant_id: tenantId,
                workspace_id: 'T0123456789',
                app_id: 'A_TRUSTED'
            })),
            resolveCanonicalIdentity: vi.fn(async () => ({
                tenant_id: tenantId,
                canonical_person_id: personId,
                membership_id: 'membership-umeda',
                membership_revision: '3',
                organization_id: 'org-techknight',
                project_id: 'project-techknight',
                project_code: 'techknight',
                membership_access: {
                    role: 'member',
                    project_codes: ['techknight'],
                    clearance: ['internal']
                }
            }))
        };
        const resolve = createSlackInstallationAccessResolver({
            authService: {},
            companyAuthorityRepository: repository,
            trustedAppId: 'A_TRUSTED'
        });

        const result = await resolve({
            access: {
                tenantId: otherTenantId,
                personId: otherPersonId,
                slackUserId: 'U0123456789',
                slackWorkspaceId: 'T0123456789'
            }
        });

        expect(result).toMatchObject({
            tenantId,
            organizationId: tenantId,
            personId,
            role: 'member',
            projectCodes: ['techknight'],
            slackUserId: 'U0123456789',
            slackWorkspaceId: 'T0123456789'
        });
        expect(repository.resolveObservedRoute).toHaveBeenCalledWith({
            provider_identity: {
                provider: 'slack',
                authenticated_subject_id: 'U0123456789',
                workspace_id: 'T0123456789',
                app_id: 'A_TRUSTED',
                enterprise_id: null
            },
            requested_action: { project_hint: null }
        });
        expect(repository.resolveCanonicalIdentity).toHaveBeenCalledWith({
            tenant_id: tenantId,
            provider: 'slack',
            authenticated_subject_id: 'U0123456789',
            workspace_id: 'T0123456789',
                app_id: 'A_TRUSTED',
                project_hint: null,
                include_membership_access: true
            });
    });

    it('fails closed instead of scanning tenant memberships without trusted app binding', async () => {
        const { pool, client } = poolFor([]);
        const resolve = createSlackInstallationAccessResolver({ authService: { pool } });

        const result = await resolve({
            access: {
                organizationId: 'org-self-asserted',
                personId: 'legacy-person',
                slackUserId: 'U0123456789',
                slackWorkspaceId: 'T0123456789'
            }
        });

        expect(result).toBeNull();
        expect(client.query).not.toHaveBeenCalled();
        expect(client.release).not.toHaveBeenCalled();
    });

    it('fails closed for ambiguous cross-tenant membership mappings', async () => {
        const { pool } = poolFor([
            { tenant_id: tenantId, principal_id: personId, membership_payload: {} },
            { tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAZ', principal_id: personId, membership_payload: {} }
        ]);
        const resolve = createSlackInstallationAccessResolver({ authService: { pool } });

        await expect(resolve({
            access: { organizationId: 'org-self-asserted', slackUserId: 'U0123456789', slackWorkspaceId: 'T0123456789' }
        })).resolves.toBeNull();
    });

    it('fails closed when the resolver returns non-canonical IDs', async () => {
        const resolve = createSlackInstallationAccessResolver({
            resolveCanonicalAccess: async () => ({
                tenantId: 'tenant-from-name',
                personId: 'person-from-name',
                role: 'ceo'
            })
        });

        await expect(resolve({
            access: { slackUserId: 'U0123456789', slackWorkspaceId: 'T0123456789' }
        })).resolves.toBeNull();
    });

    it('fails closed when canonical tenant and organization claims disagree', async () => {
        const resolve = createSlackInstallationAccessResolver();

        await expect(resolve({
            access: {
                tenantId,
                organizationId: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
                personId
            }
        })).resolves.toBeNull();
    });
});
