import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createInfoSSOTRouter } from '../../../server/routes/info-ssot.js';

const buildHeaders = () => ({
    'x-brainbase-role': 'gm',
    'x-brainbase-projects': 'brainbase',
    'x-brainbase-clearance': 'internal,restricted,finance,hr,contract'
});

describe('Info SSOT context route', () => {
    it('GET /api/info/context呼び出し時_philosophy queryをServiceへ渡す', async () => {
        const service = {
            getContext: vi.fn(async () => ({
                entities: {},
                edges: [],
                report: null,
                philosophy_context: {
                    mode: 'graph_operation_context',
                    scope: 'crm'
                },
                meta: {}
            }))
        };
        const app = express();
        app.use(express.json());
        app.use('/api/info', createInfoSSOTRouter(service));

        const res = await request(app)
            .get('/api/info/context?project=brainbase&types=project,push_case&includePhilosophy=true&scope=crm&objectType=push_case&operation=write&maxRecommended=4')
            .set(buildHeaders())
            .expect(200);

        expect(res.body.philosophy_context.scope).toBe('crm');
        expect(service.getContext).toHaveBeenCalledWith(
            expect.objectContaining({
                role: 'gm',
                projectCodes: ['brainbase']
            }),
            expect.objectContaining({
                projectCode: 'brainbase',
                entityTypes: 'project,push_case',
                includePhilosophy: true,
                scope: 'crm',
                objectType: 'push_case',
                operation: 'write',
                maxRecommended: '4'
            })
        );
    });
});
