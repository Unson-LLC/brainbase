import { describe, expect, it, vi } from 'vitest';

import { createSlackInstallationAccessResolver } from '../../../../server/services/multitenant/slack-installation-access.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX';
const personId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY';

function poolFor(rows) {
    const client = {
        query: vi.fn(async () => ({ rows })),
        release: vi.fn()
    };
    return { pool: { connect: vi.fn(async () => client) }, client };
}

describe('Slack installation canonical access mapping', () => {
    it('uses canonical membership tables and ignores self-asserted legacy org claims', async () => {
        const { pool, client } = poolFor([{
            tenant_id: tenantId,
            principal_id: personId,
            membership_payload: {
                slack_user_id: 'U0123456789',
                slack_workspace_id: 'T0123456789',
                role: 'ceo',
                project_codes: ['mana']
            }
        }]);
        const resolve = createSlackInstallationAccessResolver({ authService: { pool } });

        const result = await resolve({
            access: {
                organizationId: 'org-self-asserted',
                personId: 'legacy-person',
                slackUserId: 'U0123456789',
                slackWorkspaceId: 'T0123456789'
            }
        });

        expect(result).toMatchObject({
            tenantId,
            organizationId: tenantId,
            personId,
            role: 'ceo',
            projectCodes: ['mana']
        });
        expect(result.organizationId).not.toBe('org-self-asserted');
        expect(client.query).toHaveBeenCalledWith(expect.stringContaining('tenant_memberships'), [
            'U0123456789',
            'T0123456789'
        ]);
        expect(client.release).toHaveBeenCalledOnce();
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
