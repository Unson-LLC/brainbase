import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createConfigRouter } from '../../../server/routes/config.js';
import { requireAuth } from '../../../server/middleware/auth.js';
import { errorHandler } from '../../../server/middleware/error-handler.js';
import { AppError, ErrorCodes } from '../../../server/lib/errors.js';

function makeApp(service, projectCodes = ['growin']) {
    const app = express();
    app.use(express.json());
    const allow = (req, _res, next) => {
        req.access = { organizationId: 'unson', role: 'gm', projectCodes };
        next();
    };
    app.use('/api/config', createConfigRouter({}, service, null, {
        authGuard: allow,
        writeGuard: allow,
        profileAuthGuard: allow,
        profileWriteGuard: allow
    }));
    app.use(errorHandler);
    return app;
}

describe('Project Profile routes', () => {
    it('creates a minimal profile and returns capability inspection', async () => {
        const project = {
            id: 'growin',
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo'
        };
        const inspection = { project_code: 'growin', project: 'registered' };
        const service = {
            createProjectProfile: vi.fn().mockResolvedValue(project),
            inspectProjectRecord: vi.fn().mockReturnValue(inspection)
        };

        const response = await request(makeApp(service, []))
            .post('/api/config/project-profiles')
            .send({
                project_code: 'growin',
                name: 'Growin向けBrainbase',
                organization: 'unson',
                created_by: 'keigo'
            });

        expect(response.status).toBe(201);
        expect(response.body).toEqual({ ok: true, project, inspection });
        expect(service.createProjectProfile).toHaveBeenCalledWith(
            expect.objectContaining({ project_code: 'growin' }),
            expect.objectContaining({ organizationId: 'unson', projectCodes: [] })
        );
        expect(service.inspectProjectRecord).toHaveBeenCalledWith(project);
    });

    it('passes verified tenant claims through the real auth middleware and fails closed', async () => {
        const authService = {
            verifyToken(token) {
                if (token === 'tenant-a') {
                    return {
                        sub: 'per_a', role: 'gm', organizationId: 'unson',
                        tenantId: 'unson', projectCodes: ['growin']
                    };
                }
                if (token === 'tenant-b') {
                    return {
                        sub: 'per_b', role: 'gm', organizationId: 'other',
                        tenantId: 'other', projectCodes: ['growin']
                    };
                }
                throw new Error('invalid token');
            }
        };
        const service = {
            inspectProjectProfile: vi.fn().mockImplementation(async (_projectCode, access) => {
                if (access.organizationId !== 'unson') {
                    throw AppError.forbidden('対象Projectは認証済みテナントの範囲外です');
                }
                return { project_code: 'growin', project: 'registered' };
            })
        };
        const app = express();
        app.use(express.json());
        app.use('/api/config', createConfigRouter({}, service, null, {
            profileAuthGuard: requireAuth(authService, {
                allowInsecureHeaders: false,
                structuredErrors: true
            }),
            profileWriteGuard: (_req, _res, next) => next()
        }));
        app.use(errorHandler);

        const unauthenticated = await request(app)
            .get('/api/config/project-profiles/growin/inspect')
            .expect(401);
        expect(unauthenticated.body).toEqual({
            error: { code: 'UNAUTHORIZED', message: '認証トークンが必要です' }
        });

        const invalid = await request(app)
            .get('/api/config/project-profiles/growin/inspect')
            .set('Authorization', 'Bearer invalid')
            .expect(401);
        expect(invalid.body).toEqual({
            error: { code: 'UNAUTHORIZED', message: '認証トークンが無効です' }
        });

        const allowed = await request(app)
            .get('/api/config/project-profiles/growin/inspect')
            .set('Authorization', 'Bearer tenant-a')
            .expect(200);
        expect(allowed.body).toEqual({ project_code: 'growin', project: 'registered' });

        const denied = await request(app)
            .get('/api/config/project-profiles/growin/inspect')
            .set('Authorization', 'Bearer tenant-b')
            .expect(403);
        expect(denied.body.error).toMatchObject({
            code: 'FORBIDDEN',
            message: '対象Projectは認証済みテナントの範囲外です'
        });
        expect(denied.body.error).not.toHaveProperty('stack');
    });

    it('returns reconciliation choices without mutating people', async () => {
        const result = {
            project_code: 'growin',
            candidates: [{
                person_id: 'kuramoto',
                status: 'candidate',
                actions: ['add', 'add_as_external', 'exclude', 'defer']
            }]
        };
        const service = {
            reconcileProjectProfile: vi.fn().mockResolvedValue(result)
        };

        const response = await request(makeApp(service))
            .post('/api/config/project-profiles/growin/reconcile')
            .send({ people_candidates: [{ person_id: 'kuramoto' }] });

        expect(response.status).toBe(200);
        expect(response.body).toEqual(result);
        expect(service.reconcileProjectProfile).toHaveBeenCalledWith(
            'growin',
            [{ person_id: 'kuramoto' }],
            expect.objectContaining({ organizationId: 'unson', projectCodes: ['growin'] })
        );
    });

    it('configures a profile through the HTTP route with access context', async () => {
        const project = { project_code: 'growin', capabilities: { slack: { desired_state: 'enabled' } } };
        const inspection = { project_code: 'growin', project: 'registered', capabilities: { slack: 'unverified' } };
        const service = {
            configureProjectProfile: vi.fn().mockResolvedValue(project),
            inspectProjectProfile: vi.fn().mockResolvedValue(inspection)
        };

        const response = await request(makeApp(service))
            .put('/api/config/project-profiles/growin')
            .send({ capabilities: { slack: { desired_state: 'enabled' } } });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true, project, inspection });
        expect(service.configureProjectProfile).toHaveBeenCalledWith(
            'growin',
            { capabilities: { slack: { desired_state: 'enabled' } } },
            expect.objectContaining({ organizationId: 'unson', projectCodes: ['growin'] })
        );
        expect(service.inspectProjectProfile).toHaveBeenCalledWith(
            'growin',
            expect.objectContaining({ organizationId: 'unson', projectCodes: ['growin'] })
        );
    });

    it('returns a structured Japanese 404 when configure targets an unknown Project', async () => {
        const service = {
            configureProjectProfile: vi.fn().mockRejectedValue(
                new AppError('Project「missing」が見つかりません', ErrorCodes.PROJECT_NOT_FOUND)
            )
        };

        const response = await request(makeApp(service, ['missing']))
            .put('/api/config/project-profiles/missing')
            .send({ capabilities: { mana: { desired_state: 'disabled' } } })
            .expect(404);

        expect(response.body.error).toMatchObject({
            code: 'PROJECT_NOT_FOUND',
            message: 'Project「missing」が見つかりません'
        });
        expect(response.body.error).not.toHaveProperty('stack');
    });

    it('inspects a profile through the HTTP route with access context', async () => {
        const inspection = { project_code: 'growin', project: 'registered' };
        const service = {
            inspectProjectProfile: vi.fn().mockResolvedValue(inspection)
        };

        const response = await request(makeApp(service))
            .get('/api/config/project-profiles/growin/inspect');

        expect(response.status).toBe(200);
        expect(response.body).toEqual(inspection);
        expect(service.inspectProjectProfile).toHaveBeenCalledWith(
            'growin',
            expect.objectContaining({ organizationId: 'unson', projectCodes: ['growin'] })
        );
    });
});
