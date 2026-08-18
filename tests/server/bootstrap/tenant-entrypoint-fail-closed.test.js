// @ts-check
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerApiRoutes } from '../../../server/bootstrap/register-api-routes.js';
import { createTenantRuntimeServicesFromEnv } from '../../../server/services/multitenant/tenant-runtime-services.js';

// VibePro traceability: story-brainbase-multitenant-platform:AC-005.

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

describe('AC-005 tenant entrypoint bootstrap fail-closed', () => {
    it.each([
        ['unset', {}],
        ['disabled', { BRAINBASE_TENANT_RUNTIME_ENABLED: '0' }]
    ])('AC-005 rejects authenticated admin and audit routes when tenant runtime is %s', async (_label, env) => {
        const { app, authService, infoSSOTService } = bootstrapApp({ env });

        const adminResponse = await request(app)
            .get('/api/admin/overview')
            .set('Authorization', 'Bearer admin-token');
        const auditResponse = await request(app)
            .post('/api/info/ontology/audit')
            .set('Authorization', 'Bearer admin-token')
            .send({});

        for (const response of [adminResponse, auditResponse]) {
            expect(response.status).toBe(503);
            expect(response.headers['content-type']).toContain('application/problem+json');
            expect(response.body).toMatchObject({
                code: 'UPSTREAM_UNAVAILABLE',
                retryable: true,
                fault_domain: 'brainbase_cloud'
            });
        }
        expect(authService.verifyToken).toHaveBeenCalledTimes(2);
        expect(infoSSOTService.listGraphEntities).not.toHaveBeenCalled();
        expect(infoSSOTService.auditOntology).not.toHaveBeenCalled();
    });
});
