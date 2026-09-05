import { describe, expect, it, vi } from 'vitest';
import { AuthGrantService } from '../../../server/services/project-provisioning/auth-grant-service.js';

describe('Project Provisioning AuthGrantService', () => {
    it('organization and role matched grantだけをset-addし、JWT refreshを要求する', async () => {
        const client = {
            query: vi.fn()
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ id: 'grant_1', person_id: 'person_1', role: 'gm', project_codes: ['brainbase'] }] })
                .mockResolvedValueOnce({ rows: [{ id: 'grant_1', person_id: 'person_1', role: 'gm', project_codes: ['brainbase', 'growin-ai'] }] })
                .mockResolvedValueOnce({ rows: [] }),
            release: vi.fn()
        };
        const service = new AuthGrantService({ pool: { connect: vi.fn(async () => client) } });

        const receipt = await service.addProjectGrant({
            personId: 'person_1', role: 'gm', projectCode: 'growin-ai', organizationId: 'org_1'
        });

        expect(client.query.mock.calls[1][0]).toContain('ag.organization_id=$2');
        expect(client.query.mock.calls[1][1]).toEqual(['person_1', 'org_1']);
        expect(receipt).toMatchObject({ jwt_refresh_required: true, selector_project_code: 'growin-ai' });
    });
});
