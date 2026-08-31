import { afterEach, describe, expect, it, vi } from 'vitest';
import { InfoSSOTController } from '../../../server/controllers/info-ssot-controller.js';

describe('InfoSSOTController Graph entity read contract', () => {
    const original = process.env.ALLOW_INSECURE_SSOT_HEADERS;

    afterEach(() => {
        vi.restoreAllMocks();
        if (original === undefined) delete process.env.ALLOW_INSECURE_SSOT_HEADERS;
        else process.env.ALLOW_INSECURE_SSOT_HEADERS = original;
    });

    it('id/ids/type/query/limit/includeMergedをserviceへ渡して検索を可能にする', async () => {
        process.env.ALLOW_INSECURE_SSOT_HEADERS = 'true';
        const service = { listGraphEntities: vi.fn().mockResolvedValue([{ id: 'baao', entity_type: 'org' }]) };
        const controller = new InfoSSOTController(service);
        const req = {
            query: {
                id: 'org_baao',
                ids: 'org_unson',
                project: 'brainbase',
                type: 'org',
                query: '佐藤',
                limit: '25',
                includeMerged: 'true'
            },
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
