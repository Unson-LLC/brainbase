import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createInfoSSOTRouter } from '../../../server/routes/info-ssot.js';

function createApp({ service, authSource = 'service-token', projectCodes = ['mana'] }) {
    const app = express();
    app.use((req, _res, next) => {
        req.authSource = authSource;
        req.access = {
            role: 'member',
            projectCodes,
            clearance: ['internal'],
            personId: 'svc_mana_runtime'
        };
        next();
    });
    app.use('/api/info', createInfoSSOTRouter(service));
    return app;
}

describe('Info SSOT Slack person route', () => {
    it('service tokenがworkspaceとSlack userの完全一致で最小人物情報を返す', async () => {
        const service = {
            getPersonBySlackId: vi.fn().mockResolvedValue({
                id: 'per_umeda',
                name: '梅田',
                email: 'must-not-leak@example.com',
                metadata: { secret: true }
            })
        };

        const response = await request(createApp({ service }))
            .get('/api/info/person/by-slack?workspaceId=T0882T8N9UH&slackUserId=U0BKP8D3KPD&project=mana')
            .expect(200);

        expect(response.body).toEqual({ person: { id: 'per_umeda', name: '梅田' } });
        expect(service.getPersonBySlackId).toHaveBeenCalledWith('U0BKP8D3KPD', 'T0882T8N9UH');
    });

    it('browser bearer認証からの人物逆引きを拒否する', async () => {
        const service = { getPersonBySlackId: vi.fn() };

        await request(createApp({ service, authSource: 'bearer' }))
            .get('/api/info/person/by-slack?workspaceId=T0882T8N9UH&slackUserId=U0BKP8D3KPD&project=mana')
            .expect(403);

        expect(service.getPersonBySlackId).not.toHaveBeenCalled();
    });

    it('service tokenのproject scope外なら人物逆引きを拒否する', async () => {
        const service = { getPersonBySlackId: vi.fn() };

        await request(createApp({ service, projectCodes: ['brainbase'] }))
            .get('/api/info/person/by-slack?workspaceId=T0882T8N9UH&slackUserId=U0BKP8D3KPD&project=mana')
            .expect(403);

        expect(service.getPersonBySlackId).not.toHaveBeenCalled();
    });

    it('workspaceまたはSlack userが欠けた要求をDB照会前に拒否する', async () => {
        const service = { getPersonBySlackId: vi.fn() };

        await request(createApp({ service }))
            .get('/api/info/person/by-slack?workspaceId=T0882T8N9UH&project=mana')
            .expect(400);

        expect(service.getPersonBySlackId).not.toHaveBeenCalled();
    });

    it('対応人物がない場合は404を返し全件検索へフォールバックしない', async () => {
        const service = { getPersonBySlackId: vi.fn().mockResolvedValue(null) };

        const response = await request(createApp({ service }))
            .get('/api/info/person/by-slack?workspaceId=T0882T8N9UH&slackUserId=U_UNKNOWN&project=mana')
            .expect(404);

        expect(response.body).toEqual({ error: 'Person not found' });
        expect(service.getPersonBySlackId).toHaveBeenCalledTimes(1);
    });
});
