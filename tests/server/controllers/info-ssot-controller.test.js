import { afterEach, describe, expect, it, vi } from 'vitest';
import { InfoSSOTController } from '../../../server/controllers/info-ssot-controller.js';

describe('InfoSSOTController Graph entity read contract', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not accept self-asserted access headers without verified access context', async () => {
        const service = { listGraphEntities: vi.fn() };
        const controller = new InfoSSOTController(service);
        const req = {
            query: { project: 'brainbase' },
            get: vi.fn((name) => ({
                'x-brainbase-role': 'gm',
                'x-brainbase-projects': 'brainbase',
                'x-brainbase-clearance': 'internal'
            })[name])
        };
        const res = {
            json: vi.fn(),
            status: vi.fn().mockReturnThis()
        };

        await controller.listGraphEntities(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(service.listGraphEntities).not.toHaveBeenCalled();
    });

    it('id/ids/type/query/limit/includeMergedをserviceへ渡して検索を可能にする', async () => {
        const service = { listGraphEntities: vi.fn().mockResolvedValue([{ id: 'baao', entity_type: 'org' }]) };
        const controller = new InfoSSOTController(service);
        const req = {
            access: { role: 'gm', projectCodes: ['brainbase'], clearance: ['internal'] },
            query: {
                id: 'org_baao',
                ids: 'org_unson',
                project: 'brainbase',
                type: 'org',
                query: '佐藤',
                limit: '25',
                includeMerged: 'true'
            }
        };
        const res = {
            json: vi.fn(),
            status: vi.fn().mockReturnThis()
        };

        await controller.listGraphEntities(req, res);

        expect(service.listGraphEntities).toHaveBeenCalledWith(
            expect.objectContaining({ role: 'gm', projectCodes: ['brainbase'], clearance: ['internal'] }),
            {
                id: 'org_baao',
                ids: ['org_unson'],
                projectCode: 'brainbase',
                entityType: 'org',
                query: '佐藤',
                limit: '25',
                includeMerged: true
            }
        );
        expect(res.json).toHaveBeenCalledWith({ records: [{ id: 'baao', entity_type: 'org' }] });
    });
});
