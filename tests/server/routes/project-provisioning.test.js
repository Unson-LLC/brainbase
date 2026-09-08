import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createProjectProvisioningRouter } from '../../../server/routes/project-provisioning.js';

function app(service) {
    const instance = express();
    instance.use(express.json());
    instance.use((req, _res, next) => {
        req.access = {
            role: 'gm', personId: 'person_1', organizationId: 'unson', projectCodes: [],
            slackUserId: 'U_LOGIN', slackWorkspaceId: 'T_LOGIN'
        };
        next();
    });
    instance.use('/api/project-provisioning', createProjectProvisioningRouter({ service }));
    return instance;
}

describe('Project Provisioning routes', () => {

    it('Slack login identityをserviceへ渡す', async () => {
        const service = { check: vi.fn(async () => ({ ok: true })) };
        const response = await request(app(service))
            .post('/api/project-provisioning/check')
            .send({});

        expect(response.status).toBe(200);
        expect(service.check).toHaveBeenCalledWith(expect.objectContaining({
            slackUserId: 'U_LOGIN', slackWorkspaceId: 'T_LOGIN'
        }), {});
    });
    it('production server wiring passes ProjectProvisioningService into registerApiRoutes', () => {
        const source = fs.readFileSync(path.resolve('server.js'), 'utf8');
        const binding = source.match(/const\s*\{([^{}]*)\}\s*=\s*createCoreServices\(/u)?.[1] || '';
        const registration = source.match(/registerApiRoutes\(app,\s*\{([\s\S]*?)\n\}\);/u)?.[1] || '';
        expect(binding).toContain('projectProvisioningService');
        expect(registration).toContain('projectProvisioningService');
    });

    it('Idempotency-Keyをplan serviceへ渡す', async () => {
        const service = { plan: vi.fn(async (_actor, body, options) => ({ body, key: options.idempotencyKey })) };
        const response = await request(app(service)).post('/api/project-provisioning/plan')
            .set('Idempotency-Key', 'project-1').send({ project_code: 'growin-ai' });
        expect(response.status).toBe(201);
        expect(response.body.key).toBe('project-1');
    });

    it('check APIはwrites_performed 0とauthority/collision detailsを保持する', async () => {
        const checkResult = {
            ok: false,
            manifest: { project_code: 'growin-ai' },
            collisions: [{ field: 'project_code', value: 'growin-ai', source: 'project_registry' }],
            authority: {
                organization_exists: true,
                owner_person_exists: false,
                organization_entity_exists: true,
                owner_has_organization_grant: false
            },
            writes_performed: 0
        };
        const service = { check: vi.fn(async () => checkResult) };

        const response = await request(app(service))
            .post('/api/project-provisioning/check')
            .send({ project_code: 'growin-ai' });

        expect(response.status).toBe(200);
        expect(service.check).toHaveBeenCalledWith(
            expect.any(Object), { project_code: 'growin-ai' }
        );
        expect(response.body).toMatchObject({
            writes_performed: 0,
            authority: checkResult.authority,
            collisions: checkResult.collisions
        });
    });

    it('plan APIはURLのManifestとIdempotency-Keyをservice結果へ保持する', async () => {
        const manifest = { project_code: 'growin-ai', display_name: 'Growin AI' };
        const idempotencyKey = 'project-plan-1';
        const service = {
            plan: vi.fn(async (_actor, body, options) => ({
                run_id: 'ppr_1',
                manifest: body,
                idempotency_key: options.idempotencyKey,
                plan: {
                    required_human_gates: ['manifest_plan_approval'],
                    preflight: {
                        authority: { organization_exists: true },
                        collisions: []
                    }
                }
            }))
        };

        const response = await request(app(service))
            .post('/api/project-provisioning/plan')
            .set('Idempotency-Key', idempotencyKey)
            .send(manifest);

        expect(response.status).toBe(201);
        expect(service.plan).toHaveBeenCalledWith(
            expect.any(Object), manifest, { idempotencyKey }
        );
        expect(response.body).toMatchObject({
            run_id: 'ppr_1',
            manifest,
            idempotency_key: idempotencyKey,
            plan: {
                required_human_gates: ['manifest_plan_approval'],
                preflight: { authority: { organization_exists: true }, collisions: [] }
            }
        });
    });

    it('未知runを構造化された404として返す', async () => {
        const error = Object.assign(new Error('Unknown provisioning run'), { code: 'PROJECT_PROVISIONING_RUN_NOT_FOUND', statusCode: 404 });
        const response = await request(app({ status: vi.fn(async () => { throw error; }) }))
            .get('/api/project-provisioning/runs/missing');
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('PROJECT_PROVISIONING_RUN_NOT_FOUND');
    });

    it('Graph ID競合をretryable details付きの409として返す', async () => {
        const error = Object.assign(new Error('Project Graph identity is busy'), {
            code: 'GRAPH_PROJECT_IDENTITY_BUSY',
            statusCode: 409,
            details: { entity_id: 'growin-ai', retryable: true }
        });
        const response = await request(app({ check: vi.fn(async () => { throw error; }) }))
            .post('/api/project-provisioning/check')
            .send({ project_code: 'growin-ai' });

        expect(response.status).toBe(409);
        expect(response.body.error).toEqual({
            code: 'GRAPH_PROJECT_IDENTITY_BUSY',
            message: 'Project Graph identity is busy',
            details: { entity_id: 'growin-ai', retryable: true }
        });
    });

    it('Human Gate承認を専用approve serviceへ渡す', async () => {
        const service = { approve: vi.fn(async (_actor, runId, input) => ({ runId, input })) };
        const response = await request(app(service)).post('/api/project-provisioning/runs/ppr_1/approve')
            .send({ approved_gates: ['repository_create'], review_ref: 'review-1' });
        expect(response.status).toBe(200);
        expect(service.approve).toHaveBeenCalledWith(expect.any(Object), 'ppr_1', {
            approvedGates: ['repository_create'], reviewRef: 'review-1'
        });
    });
});
