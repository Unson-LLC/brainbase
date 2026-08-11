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
            getProjectAssignments: vi.fn()
        };
        const configParser = {
            getProjects: vi.fn()
        };
        const controller = new SetupController({}, infoSsotService, configParser);
        const req = {
            access: {
                slackUserId: 'U123',
                slackWorkspaceId: 'T123',
                projectCodes: ['brainbase', 'baao', 'brainbase']
            }
        };
        const res = createResponse();

        await controller.getSetupConfig(req, res);

        expect(res.status).not.toHaveBeenCalled();
        expect(infoSsotService.getPersonBySlackId).toHaveBeenCalledWith('U123', 'T123');
        expect(infoSsotService.getProjectAssignments).not.toHaveBeenCalled();
        expect(configParser.getProjects).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            ok: true,
            configWriteMode: 'create_only',
            user: expect.objectContaining({ workspaceId: 'T123' }),
            projects: [
                { id: 'brainbase', name: 'brainbase', description: '' },
                { id: 'baao', name: 'baao', description: '' }
            ]
        }));
        expect(res.json.mock.calls[0][0].configYaml).toContain(
            'Never replace an existing workspace config'
        );
    });
});
