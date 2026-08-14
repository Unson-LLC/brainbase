import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createKnowledgeEventRouter } from '../../../server/routes/knowledge-events.js';

function eventBody() {
    return {
        schema_version: 'knowledge_event.v1',
        event_id: 'kev_route_1',
        occurred_at: '2026-08-13T01:00:00.000Z',
        captured_at: '2026-08-13T01:01:00.000Z',
        source: { type: 'meeting' },
        subject: { type: 'decision', id: 'decision_route_1' },
        decision_authority: { authorized: true, decider_id: 'person_ceo', domain: 'pricing' },
        applicability_scope: { project_code: 'brainbase', scope: 'organization' },
        permission_snapshot: { visibility: 'org' },
        source_pointer: { uri: 'drive://meeting-1' },
        body_hash: 'sha256:route-1',
        parent_episode_id: 'episode_route_1'
    };
}

function createApp({ projectCodes = ['brainbase'], organizationId = 'org_a', authSource = 'bearer', eventService, feedbackService, cycleQueryService } = {}) {
    const services = {
        eventService: eventService || { ingest: vi.fn(async () => ({ event_id: 'kev_route_1', processing_stage: 'retrievable' })) },
        feedbackService: feedbackService || { recordFeedback: vi.fn(async () => ({ action: 'reject', semantic_state: 'retracted' })) },
        cycleQueryService: cycleQueryService || { getCycle: vi.fn(async () => ({ schema_version: 'knowledge_cycle_receipt.v1', event_id: 'kev_route_1' })) }
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.access = { role: 'member', projectCodes, organizationId };
        req.authSource = authSource;
        next();
    });
    app.use('/api/knowledge', createKnowledgeEventRouter(services));
    return { app, ...services };
}

describe('knowledge event routes', () => {
    it('server.jsが3つのknowledge serviceを実ランタイムのregisterApiRoutesへ渡す', () => {
        const serverSource = fs.readFileSync(path.resolve(process.cwd(), 'server.js'), 'utf8');
        const serviceBinding = serverSource.match(/const\s*\{([^{}]*)\}\s*=\s*createCoreServices\(/)?.[1] || '';
        const registration = serverSource.match(/registerApiRoutes\(app,\s*\{([\s\S]*?)\n\}\);/)?.[1] || '';

        expect(serviceBinding).toContain('knowledgeEventService');
        expect(serviceBinding).toContain('knowledgeFeedbackService');
        expect(serviceBinding).toContain('knowledgeCycleQueryService');
        expect(registration).toContain('knowledgeEventService');
        expect(registration).toContain('knowledgeFeedbackService');
        expect(registration).toContain('knowledgeCycleQueryService');
    });

    it('POST /eventsをevent serviceへ渡して202を返す', async () => {
        const { app, eventService } = createApp();

        const response = await request(app).post('/api/knowledge/events').send(eventBody()).expect(202);

        expect(response.body).toMatchObject({ event_id: 'kev_route_1', processing_stage: 'retrievable' });
        expect(eventService.ingest).toHaveBeenCalledWith(eventBody(), expect.objectContaining({
            access: expect.objectContaining({ projectCodes: ['brainbase'], organizationId: 'org_a' })
        }));
    });

    it('内部認証は明示organizationをaccessへ固定し、欠落と偽装を拒否する', async () => {
        const { app, eventService } = createApp({ organizationId: null, authSource: 'internal' });

        await request(app).post('/api/knowledge/events').send(eventBody()).expect(403);
        await request(app)
            .post('/api/knowledge/events')
            .set('x-brainbase-organization-id', 'org_a')
            .send({ ...eventBody(), organization_id: 'org_b' })
            .expect(403);
        await request(app)
            .post('/api/knowledge/events')
            .set('x-brainbase-organization-id', 'org_a')
            .send(eventBody())
            .expect(202);

        expect(eventService.ingest).toHaveBeenCalledTimes(1);
        expect(eventService.ingest).toHaveBeenCalledWith(eventBody(), expect.objectContaining({
            access: expect.objectContaining({ organizationId: 'org_a' })
        }));
    });

    it('POST /feedbackをfeedback serviceへ渡す', async () => {
        const { app, feedbackService } = createApp();
        const body = { action: 'reject', event_id: 'kev_route_1', project_code: 'brainbase' };

        await request(app).post('/api/knowledge/feedback').send(body).expect(200);

        expect(feedbackService.recordFeedback).toHaveBeenCalledWith(body, expect.objectContaining({ access: expect.any(Object) }));
    });

    it('GET /cycles/:eventIdをquery serviceへ渡す', async () => {
        const { app, cycleQueryService } = createApp();

        const response = await request(app).get('/api/knowledge/cycles/kev_route_1?project_code=brainbase').expect(200);

        expect(response.body.schema_version).toBe('knowledge_cycle_receipt.v1');
        expect(cycleQueryService.getCycle).toHaveBeenCalledWith('kev_route_1', expect.objectContaining({
            access: expect.any(Object),
            projectCode: 'brainbase'
        }));
    });

    it('GET /cycles/:eventIdはproject_code必須で欠落時serviceを呼ばない', async () => {
        const { app, cycleQueryService } = createApp();

        const response = await request(app).get('/api/knowledge/cycles/kev_route_1').expect(400);

        expect(response.body.error).toBe('knowledge_project_code_required');
        expect(cycleQueryService.getCycle).not.toHaveBeenCalled();
    });

    it('scope外projectをservice呼出し前に403で拒否する', async () => {
        const { app, eventService } = createApp({ projectCodes: ['other'] });

        const response = await request(app).post('/api/knowledge/events').send(eventBody()).expect(403);

        expect(response.body.error).toBe('knowledge_project_access_denied');
        expect(eventService.ingest).not.toHaveBeenCalled();
    });

    it.each([
        ['knowledge_event_invalid', 400],
        ['knowledge_event_conflict', 409]
    ])('POST error code=%sをHTTP %sへ写像する', async (code, status) => {
        const error = Object.assign(new Error(code), { code });
        const eventService = { ingest: vi.fn(async () => { throw error; }) };
        const { app } = createApp({ eventService });

        const response = await request(app).post('/api/knowledge/events').send(eventBody()).expect(status);

        expect(response.body.error).toBe(code);
    });

    it('存在しないcycleを404へ写像する', async () => {
        const error = Object.assign(new Error('not found'), { code: 'knowledge_cycle_not_found' });
        const cycleQueryService = { getCycle: vi.fn(async () => { throw error; }) };
        const { app } = createApp({ cycleQueryService });

        const response = await request(app).get('/api/knowledge/cycles/kev_missing?project_code=brainbase').expect(404);

        expect(response.body.error).toBe('knowledge_cycle_not_found');
    });
});
