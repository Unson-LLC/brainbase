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

    it('ログイン中のSlack identityが指定された場合は同じworkspaceのgrantだけを更新する', async () => {
        const client = {
            query: vi.fn()
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{
                    id: 'grant_exact', person_id: 'person_1', role: 'gm', project_codes: ['brainbase']
                }] })
                .mockResolvedValueOnce({ rows: [{
                    id: 'grant_exact', person_id: 'person_1', role: 'gm', project_codes: ['brainbase', 'growin-ai']
                }] })
                .mockResolvedValueOnce({ rows: [] }),
            release: vi.fn()
        };
        const service = new AuthGrantService({ pool: { connect: vi.fn(async () => client) } });

        await service.addProjectGrant({
            personId: 'person_1', role: 'gm', projectCode: 'growin-ai', organizationId: 'org_1',
            slackUserId: 'U_LOGIN', slackWorkspaceId: 'T_LOGIN'
        });

        expect(client.query.mock.calls[1][0]).toContain('ag.slack_user_id=$3');
        expect(client.query.mock.calls[1][0]).toContain('ag.slack_workspace_id=$4');
        expect(client.query.mock.calls[1][1]).toEqual(['person_1', 'org_1', 'U_LOGIN', 'T_LOGIN']);
        expect(client.query.mock.calls[2][1][0]).toBe('grant_exact');
    });

    it('readbackもログイン中のSlack workspaceと完全一致するgrantだけを成功扱いする', async () => {
        const query = vi.fn(async () => ({ rows: [] }));
        const service = new AuthGrantService({ pool: { query } });

        await expect(service.readProjectGrant({
            personId: 'person_1', role: 'gm', projectCode: 'growin-ai', organizationId: 'org_1',
            slackUserId: 'U_LOGIN', slackWorkspaceId: 'T_LOGIN'
        })).resolves.toBeNull();

        expect(query.mock.calls[0][0]).toContain('ag.slack_user_id=$4');
        expect(query.mock.calls[0][0]).toContain('ag.slack_workspace_id=$5');
        expect(query.mock.calls[0][1]).toEqual(['person_1', 'gm', 'org_1', 'U_LOGIN', 'T_LOGIN']);
    });

    it('Slack identityを指定できない別人grantが複数ある場合は任意の1件を更新しない', async () => {
        const client = {
            query: vi.fn()
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [
                    { id: 'grant_a', person_id: 'person_2', role: 'gm', project_codes: [] },
                    { id: 'grant_b', person_id: 'person_2', role: 'gm', project_codes: [] }
                ] })
                .mockResolvedValueOnce({ rows: [] }),
            release: vi.fn()
        };
        const service = new AuthGrantService({ pool: { connect: vi.fn(async () => client) } });

        await expect(service.addProjectGrant({
            personId: 'person_2', role: 'gm', projectCode: 'growin-ai', organizationId: 'org_1'
        })).rejects.toMatchObject({ code: 'PROJECT_PROVISIONING_AUTH_GRANT_AMBIGUOUS' });

        expect(client.query).toHaveBeenCalledTimes(3);
        expect(client.query.mock.calls[2][0]).toBe('ROLLBACK');
    });
});
