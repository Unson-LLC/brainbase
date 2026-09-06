// @ts-check
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerApiRoutes } from '../../../server/bootstrap/register-api-routes.js';
import { createTenantRuntimeServicesFromEnv } from '../../../server/services/multitenant/tenant-runtime-services.js';

// VibePro traceability:
// story-brainbase-multitenant-platform:AC-005,
// story-admin-read-tenant-boundary-repair:AC-001..AC-003.

function bootstrapApp({ env }) {
    const infoSSOTService = {
        listGraphEntities: vi.fn(async () => []),
        auditOntology: vi.fn(async () => ({ status: 'complete' }))
    };
    const authService = {
        verifyToken: vi.fn(() => ({
            sub: 'person_admin',
            role: 'ceo',
            tenantId: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            projectCodes: ['brainbase'],
            clearance: ['internal']
        }))
    };
    const app = express();
    app.use(express.json());
    registerApiRoutes(app, {
        configParser: {},
        configService: {},
        runtimePaths: { varDir: '/tmp' },
        scheduleParser: {},
        googleCalendarService: {},
        projectsRoot: '/tmp',
        authService,
        infoSSOTService,
        canonicalTaskStoreConfig: { ownerPersonId: 'person_admin', ownerAliasIds: [] },
        canonicalTaskService: {},
        learningService: {},
        learningHealthService: {},
        candidateRepository: null,
        wikiService: {},
        tokenUsageService: {},
        uploadMiddleware: (_req, _res, next) => next(),
        appVersion: 'test',
        workspaceRoot: '/tmp',
        uploadsDir: '/tmp/uploads',
        runtimeInfo: {},
        brainbaseRoot: '/tmp',
        tenantRuntimeServices: createTenantRuntimeServicesFromEnv({ env, pool: null })
    });
    return { app, authService, infoSSOTService };
}

describe('tenant entrypoint bootstrap boundaries', () => {
    it('rejects unauthenticated admin reads before the visualization service runs', async () => {
        const { app, authService, infoSSOTService } = bootstrapApp({ env: {} });

        const response = await request(app).get('/api/admin/overview');

        expect(response.status).toBe(401);
        expect(authService.verifyToken).not.toHaveBeenCalled();
        expect(infoSSOTService.listGraphEntities).not.toHaveBeenCalled();
    });

    it.each([
        ['unset', {}],
        ['disabled', { BRAINBASE_TENANT_RUNTIME_ENABLED: '0' }]
    ])('AC-005 keeps audit writes fail-closed while authenticated admin reads remain available when tenant runtime is %s', async (_label, env) => {
        const { app, authService, infoSSOTService } = bootstrapApp({ env });

        const adminResponse = await request(app)
            .get('/api/admin/overview')
            .set('Authorization', 'Bearer admin-token');
        const auditResponse = await request(app)
            .post('/api/info/ontology/audit')
            .set('Authorization', 'Bearer admin-token')
            .send({});

        expect(adminResponse.status).toBe(200);
        expect(auditResponse.status).toBe(503);
        expect(auditResponse.headers['content-type']).toContain('application/problem+json');
        expect(auditResponse.body).toMatchObject({
            code: 'UPSTREAM_UNAVAILABLE',
            retryable: true,
            fault_domain: 'brainbase_cloud'
        });
        expect(authService.verifyToken).toHaveBeenCalledTimes(2);
        expect(infoSSOTService.listGraphEntities).toHaveBeenCalled();
        expect(infoSSOTService.auditOntology).not.toHaveBeenCalled();
    });
});
