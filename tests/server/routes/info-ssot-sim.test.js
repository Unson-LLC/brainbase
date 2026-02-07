import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createInfoSSOTRouter } from '../../../server/routes/info-ssot.js';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';

const DATABASE_URL = process.env.INFO_SSOT_DATABASE_URL || 'postgres://localhost/brainbase_ssot';
process.env.INFO_SSOT_DATABASE_URL = DATABASE_URL;
process.env.ALLOW_INSECURE_SSOT_HEADERS = 'true';

const buildHeaders = ({ role = 'gm', projects, clearance = 'internal' } = {}) => ({
    'x-brainbase-role': role,
    'x-brainbase-projects': projects,
    'x-brainbase-clearance': clearance
});

describe.sequential('Info SSOT story simulations (E1-001 / E1-002)', () => {
    let app;
    let service;
    let runId;
    let projectA;
    let projectB;
    let personName;
    let raciPersonName;
    let financeTitle;

    const ensureRaci = async ({ projectCode, person }) => {
        await request(app)
            .post('/api/info/raci')
            .set(buildHeaders({ projects: projectCode }))
            .send({
                projectCode,
                projectName: projectCode,
                personName: person,
                roleCode: 'decision:general',
                authorityScope: 'general',
                roleMin: 'member',
                sensitivity: 'internal'
            })
            .expect(201);
    };

    beforeAll(() => {
        runId = Date.now().toString();
        projectA = `simproj_a_${runId}`;
        projectB = `simproj_b_${runId}`;
        personName = `Sim Person ${runId}`;
        raciPersonName = `Sim RACI ${runId}`;
        financeTitle = `Finance Decision ${runId}`;

        service = new InfoSSOTService();
        app = express();
        app.use(express.json());
        app.use('/api/info', createInfoSSOTRouter(service));
    });

    afterAll(async () => {
        if (!service?.pool) return;
        await service.pool.end();
    });

    it('E1-001: project boundary prevents cross-project reads', async () => {
        await ensureRaci({ projectCode: projectA, person: personName });
        await ensureRaci({ projectCode: projectB, person: personName });

        const decisionRes = await request(app)
            .post('/api/info/decisions')
            .set(buildHeaders({ projects: projectA }))
            .send({
                projectCode: projectA,
                projectName: projectA,
                ownerPersonName: personName,
                roleMin: 'gm',
                sensitivity: 'internal',
                title: `Decision A ${runId}`,
                decisionDomain: 'general'
            })
            .expect(201);
        const decisionId = decisionRes.body.decision_id;

        await request(app)
            .post('/api/info/decisions')
            .set(buildHeaders({ projects: projectB }))
            .send({
                projectCode: projectB,
                projectName: projectB,
                ownerPersonName: personName,
                roleMin: 'gm',
                sensitivity: 'internal',
                title: `Decision B ${runId}`,
                decisionDomain: 'general'
            })
            .expect(201);

        const expandRes = await request(app)
            .get(`/api/info/graph/expand?project=${projectA}&seed=${decisionId}&depth=2&humanReadable=true`)
            .set(buildHeaders({ projects: projectA }))
            .expect(200);

        expect(expandRes.body.nodes?.length || 0).toBeGreaterThan(0);
        expect(expandRes.body.edges?.length || 0).toBeGreaterThan(0);
        expect(Array.isArray(expandRes.body.summary_lines)).toBe(true);
        expect(expandRes.body.report?.header?.seed_id).toBe(decisionId);
        expect(expandRes.body.report?.meta?.node_count || 0).toBeGreaterThan(0);

        const resA = await request(app)
            .get(`/api/info/graph/entities?project=${projectA}&type=decision`)
            .set(buildHeaders({ projects: projectA }))
            .expect(200);

        expect(resA.body.records.some(record => record.payload?.title === `Decision A ${runId}`)).toBe(true);

        const resCross = await request(app)
            .get(`/api/info/graph/entities?project=${projectB}&type=decision`)
            .set(buildHeaders({ projects: projectA }))
            .expect(200);

        expect(resCross.body.records.some(record => record.payload?.title === `Decision B ${runId}`)).toBe(false);
    });

    it('E1-001: clearance gate hides finance data', async () => {
        await request(app)
            .post('/api/info/raci')
            .set(buildHeaders({ projects: projectA }))
            .send({
                projectCode: projectA,
                projectName: projectA,
                personName,
                roleCode: 'decision:finance',
                authorityScope: 'finance',
                roleMin: 'gm',
                sensitivity: 'internal'
            })
            .expect(201);

        await request(app)
            .post('/api/info/decisions')
            .set(buildHeaders({ projects: projectA, clearance: 'internal,finance' }))
            .send({
                projectCode: projectA,
                projectName: projectA,
                ownerPersonName: personName,
                roleMin: 'gm',
                sensitivity: 'finance',
                title: financeTitle,
                decisionDomain: 'finance'
            })
            .expect(201);

        const resInternal = await request(app)
            .get(`/api/info/graph/entities?project=${projectA}&type=decision`)
            .set(buildHeaders({ projects: projectA, clearance: 'internal' }))
            .expect(200);

        expect(resInternal.body.records.some(record => record.payload?.title === financeTitle)).toBe(false);

        const resFinance = await request(app)
            .get(`/api/info/graph/entities?project=${projectA}&type=decision`)
            .set(buildHeaders({ projects: projectA, clearance: 'internal,finance' }))
            .expect(200);

        expect(resFinance.body.records.some(record => record.payload?.title === financeTitle)).toBe(true);
    });

    it('E1-002: RACI creates member_of edge and person visibility', async () => {
        const raciRes = await request(app)
            .post('/api/info/raci')
            .set(buildHeaders({ projects: projectA }))
            .send({
                projectCode: projectA,
                projectName: projectA,
                personName: raciPersonName,
                roleCode: 'position',
                authorityScope: 'core',
                roleMin: 'member',
                sensitivity: 'internal'
            })
            .expect(201);

        const raciId = raciRes.body.raci_id;
        const edgeRes = await request(app)
            .get(`/api/info/graph/edges?project=${projectA}&type=assigned_to&from=${raciId}`)
            .set(buildHeaders({ projects: projectA }))
            .expect(200);

        expect(edgeRes.body.records.length).toBeGreaterThan(0);

        const personRes = await request(app)
            .get(`/api/info/graph/entities?project=${projectA}&type=person`)
            .set(buildHeaders({ projects: projectA }))
            .expect(200);

        const personEntity = personRes.body.records.find(record => record.payload?.name === raciPersonName);
        expect(personEntity).toBeTruthy();

        const memberEdgeRes = await request(app)
            .get(`/api/info/graph/edges?project=${projectA}&type=member_of&from=${personEntity.id}`)
            .set(buildHeaders({ projects: projectA }))
            .expect(200);

        expect(memberEdgeRes.body.records.length).toBeGreaterThan(0);

        const otherProjectPeople = await request(app)
            .get(`/api/info/graph/entities?project=${projectB}&type=person`)
            .set(buildHeaders({ projects: projectB }))
            .expect(200);

        expect(otherProjectPeople.body.records.some(record => record.payload?.name === raciPersonName)).toBe(false);
    });

    it('E1-001: finance requires role_min gm/ceo on write', async () => {
        const res = await request(app)
            .post('/api/info/decisions')
            .set(buildHeaders({ projects: projectA, clearance: 'internal,finance' }))
            .send({
                projectCode: projectA,
                projectName: projectA,
                ownerPersonName: personName,
                roleMin: 'member',
                sensitivity: 'finance',
                title: `Invalid Finance ${runId}`,
                decisionDomain: 'finance'
            });

        expect(res.status).toBe(400);
        expect(res.body?.error || '').toContain('Sensitive data requires role_min gm or ceo');
    });

    it('E1-001: write is rejected without project scope', async () => {
        const res = await request(app)
            .post('/api/info/decisions')
            .set(buildHeaders({ projects: projectA }))
            .send({
                projectCode: projectB,
                projectName: projectB,
                ownerPersonName: personName,
                roleMin: 'gm',
                sensitivity: 'internal',
                title: `Denied Cross ${runId}`,
                decisionDomain: 'general'
            });

        expect(res.status).toBe(403);
        expect(res.body?.error || '').toContain('Access denied for project');
    });

    it('E1-002: decision requires matching RACI domain', async () => {
        await ensureRaci({ projectCode: projectA, person: personName });
        const res = await request(app)
            .post('/api/info/decisions')
            .set(buildHeaders({ projects: projectA }))
            .send({
                projectCode: projectA,
                projectName: projectA,
                ownerPersonName: personName,
                roleMin: 'gm',
                sensitivity: 'internal',
                title: `Unauthorized ${runId}`,
                decisionDomain: 'unknown-domain'
            });

        expect(res.status).toBe(403);
        expect(res.body?.error || '').toContain('Decision authority missing');
    });

    it('AI query is logged and readable via graph', async () => {
        await ensureRaci({ projectCode: projectA, person: personName });
        const queryRes = await request(app)
            .post('/api/info/ai/query')
            .set(buildHeaders({ projects: projectA }))
            .send({
                projectCode: projectA,
                queryType: 'entities',
                entityType: 'decision',
                intent: 'simulation',
                humanReadable: true
            })
            .expect(200);

        expect(queryRes.body.query_id).toBeTruthy();
        expect(Array.isArray(queryRes.body.summary_lines)).toBe(true);

        const graphRes = await request(app)
            .get(`/api/info/graph/entities?project=${projectA}&type=ai_query`)
            .set(buildHeaders({ projects: projectA }))
            .expect(200);

        expect(graphRes.body.records.some(record => record.id === queryRes.body.query_id)).toBe(true);
    });

    it('AI decision log is projected to graph', async () => {
        await ensureRaci({ projectCode: projectA, person: personName });
        const logRes = await request(app)
            .post('/api/info/ai/decision-log')
            .set(buildHeaders({ projects: projectA }))
            .send({
                projectCode: projectA,
                summary: `AI decision ${runId}`,
                rationale: 'simulation',
                confidence: 0.8
            })
            .expect(201);

        expect(logRes.body.ai_decision_id).toBeTruthy();

        const graphRes = await request(app)
            .get(`/api/info/graph/entities?project=${projectA}&type=ai_decision`)
            .set(buildHeaders({ projects: projectA }))
            .expect(200);

        expect(graphRes.body.records.some(record => record.id === logRes.body.ai_decision_id)).toBe(true);
    });
});
