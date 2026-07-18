import { describe, expect, it, vi } from 'vitest';
import { SetupController } from '../../../server/controllers/setup-controller.js';

function createResponse() {
    return {
        status: vi.fn(function status() {
            return this;
        }),
        json: vi.fn()
    };
}

describe('SetupController', () => {
    it('検証済みJWTのSlack workspace claimでセットアップ設定を生成する', async () => {
        const infoSsotService = {
            getPersonBySlackId: vi.fn().mockResolvedValue({ id: 'per_1', name: 'Test User' }),
            getProjectAssignments: vi.fn().mockResolvedValue([{ project_id: 'brainbase' }])
        };
        const configParser = {
            getProjects: vi.fn().mockResolvedValue({
                projects: [
                    { id: 'brainbase', name: 'Brainbase' },
                    { id: 'baao', name: 'BAAO' }
                ]
            })
        };
        const controller = new SetupController({}, infoSsotService, configParser);
        const req = {
            access: {
                slackUserId: 'U123',
                slackWorkspaceId: 'T123'
            }
        };
        const res = createResponse();

        await controller.getSetupConfig(req, res);

        expect(res.status).not.toHaveBeenCalled();
        expect(infoSsotService.getPersonBySlackId).toHaveBeenCalledWith('U123', 'T123');
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            ok: true,
            user: expect.objectContaining({ workspaceId: 'T123' }),
            projects: [{ id: 'brainbase', name: 'Brainbase', description: '' }]
        }));
    });
});
