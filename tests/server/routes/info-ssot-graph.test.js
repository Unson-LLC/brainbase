import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createInfoSSOTRouter } from '../../../server/routes/info-ssot.js';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';

const DATABASE_URL = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL || '';
const RUN_INFO_SSOT_DB_TESTS = process.env.RUN_INFO_SSOT_DB_TESTS === 'true';
const describeWithInfoDb = RUN_INFO_SSOT_DB_TESTS && DATABASE_URL ? describe : describe.skip;
if (DATABASE_URL) {
    process.env.INFO_SSOT_DATABASE_URL = DATABASE_URL;
    process.env.ALLOW_INSECURE_SSOT_HEADERS = 'true';
}

const buildHeaders = (overrides = {}) => ({
    'x-brainbase-role': 'gm',
    'x-brainbase-projects': 'brainbase',
    'x-brainbase-clearance': 'internal,restricted,finance,hr,contract',
    ...overrides
});

describeWithInfoDb('Info SSOT Graph API (smoke)', () => {
    let app;
    let service;

    beforeAll(() => {
        service = new InfoSSOTService();
        app = express();
        app.use(express.json());
        app.use('/api/info', createInfoSSOTRouter(service));
    });

    afterAll(async () => {
        if (service?.pool) {
            await service.pool.end();
        }
    });

    it('creates decision and reads graph entities', async () => {
        await request(app)
            .post('/api/info/raci')
            .set(buildHeaders())
            .send({
                projectCode: 'brainbase',
                projectName: 'Brainbase',
                personName: 'Smoke Tester',
                roleCode: 'decision:general',
                authorityScope: 'general',
                roleMin: 'member',
                sensitivity: 'internal'
            })
            .expect(201);

        const decisionPayload = {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            ownerPersonName: 'Smoke Tester',
            roleMin: 'gm',
            sensitivity: 'internal',
            title: 'Smoke decision',
            context: { from: 'test' },
            decisionDomain: 'general'
        };

        await request(app)
            .post('/api/info/decisions')
            .set(buildHeaders())
            .send(decisionPayload)
            .expect(201);

        const res = await request(app)
            .get('/api/info/graph/entities?project=brainbase&type=decision')
            .set(buildHeaders())
            .expect(200);

        expect(Array.isArray(res.body.records)).toBe(true);
        expect(res.body.records.length).toBeGreaterThan(0);
    });

    it('upserts graph entity and reads it back', async () => {
        const entityId = `app_smoke_${Date.now()}`;
        const payload = {
            name: 'SmokeTestApp',
            app_id: 'smoke_test',
            environments: {
                local: { url: 'http://localhost:9999', host: 'local' }
            }
        };

        await request(app)
            .post('/api/info/graph/entities')
            .set(buildHeaders())
            .send({
                id: entityId,
                entityType: 'app',
                projectCode: 'brainbase',
                projectName: 'Brainbase',
                roleMin: 'gm',
                sensitivity: 'internal',
                payload
            })
            .expect(201);

        const res = await request(app)
            .get('/api/info/graph/entities?project=brainbase&type=app')
            .set(buildHeaders())
            .expect(200);

        const found = res.body.records.find((r) => r.id === entityId);
        expect(found).toBeTruthy();
        expect(found.payload.name).toBe('SmokeTestApp');
        expect(found.payload.environments.local.url).toBe('http://localhost:9999');

        const updated = {
            ...payload,
            environments: {
                local: { url: 'http://localhost:9999', host: 'local' },
                staging: { url: 'https://smoke.example.com', host: 'vercel' }
            }
        };
        await request(app)
            .post('/api/info/graph/entities')
            .set(buildHeaders())
            .send({
                id: entityId,
                entityType: 'app',
                projectCode: 'brainbase',
                projectName: 'Brainbase',
                roleMin: 'gm',
                sensitivity: 'internal',
                payload: updated
            })
            .expect(201);

        const res2 = await request(app)
            .get('/api/info/graph/entities?project=brainbase&type=app')
            .set(buildHeaders())
            .expect(200);
        const found2 = res2.body.records.find((r) => r.id === entityId);
        expect(found2.payload.environments.staging.url).toBe('https://smoke.example.com');
    });

    it('rejects graph entity upsert with missing id', async () => {
        await request(app)
            .post('/api/info/graph/entities')
            .set(buildHeaders())
            .send({
                entityType: 'app',
                projectCode: 'brainbase',
                projectName: 'Brainbase',
                roleMin: 'gm',
                sensitivity: 'internal',
                payload: {}
            })
            .expect(400);
    });

    it('rejects graph entity upsert when role is below roleMin', async () => {
        await request(app)
            .post('/api/info/graph/entities')
            .set(buildHeaders({ 'x-brainbase-role': 'member' }))
            .send({
                id: 'app_smoke_denied',
                entityType: 'app',
                projectCode: 'brainbase',
                projectName: 'Brainbase',
                roleMin: 'gm',
                sensitivity: 'internal',
                payload: { name: 'Denied' }
            })
            .expect(403);
    });

    it('upserts graph edge between two entities', async () => {
        const fromId = `app_smoke_from_${Date.now()}`;
        const toId = `app_smoke_to_${Date.now()}`;

        for (const id of [fromId, toId]) {
            await request(app)
                .post('/api/info/graph/entities')
                .set(buildHeaders())
                .send({
                    id,
                    entityType: 'app',
                    projectCode: 'brainbase',
                    projectName: 'Brainbase',
                    roleMin: 'gm',
                    sensitivity: 'internal',
                    payload: { name: id }
                })
                .expect(201);
        }

        await request(app)
            .post('/api/info/graph/edges')
            .set(buildHeaders())
            .send({
                fromId,
                toId,
                relType: 'depends_on',
                projectCode: 'brainbase',
                projectName: 'Brainbase',
                roleMin: 'gm',
                sensitivity: 'internal',
                payload: { note: 'smoke' }
            })
            .expect(201);

        const res = await request(app)
            .get(`/api/info/graph/edges?project=brainbase&type=depends_on&from=${fromId}`)
            .set(buildHeaders())
            .expect(200);
        expect(res.body.records.some((r) => r.to_id === toId && r.rel_type === 'depends_on')).toBe(true);
    });
});
