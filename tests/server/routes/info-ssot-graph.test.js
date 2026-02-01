import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createInfoSSOTRouter } from '../../../server/routes/info-ssot.js';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';

const DATABASE_URL = process.env.INFO_SSOT_DATABASE_URL || 'postgres://localhost/brainbase_ssot';
process.env.INFO_SSOT_DATABASE_URL = DATABASE_URL;

const buildHeaders = (overrides = {}) => ({
    'x-brainbase-role': 'gm',
    'x-brainbase-projects': 'brainbase',
    'x-brainbase-clearance': 'internal,restricted,finance,hr,contract',
    ...overrides
});

describe('Info SSOT Graph API (smoke)', () => {
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
});
