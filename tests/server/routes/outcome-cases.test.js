import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerApiRoutes } from '../../../server/bootstrap/register-api-routes.js';
import { createOutcomeCaseRouter } from '../../../server/routes/outcome-cases.js';
import { OutcomeCaseService } from '../../../server/services/outcome-case/outcome-case-service.js';

function createApp(service, actor = { personId: 'internal_api', projectCodes: ['brainbase'], role: 'admin', organizationId: 'org_unson' }, { auditSink = null } = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.authSource = 'internal';
        req.auth = { sub: 'internal_api' };
        req.access = actor;
        next();
    });
    app.use('/api/outcome-cases', createOutcomeCaseRouter({ service, auditSink }));
    return app;
}

const createPayload = {
    project_code: 'brainbase',
    capability_id: 'cap_outcome_control',
    user_observable_outcome: '依頼者が外部の完了読戻しを確認できる',
    protected_constraints: ['外部読戻しなしで閉鎖しない'],
    non_goals: ['汎用 workflow engine'],
    selected_domain_pack: 'delivery-control/v1',
    current_external_state: 'processing',
    technical_story_refs: ['story-outcome-case-v1'],
    run_receipt_refs: [],
    prior_attempt_refs: [],
    unresolved_failure_boundary: null
};

class MemoryOutcomeCaseRepository {
    constructor() {
        this.items = new Map();
    }

    async create(item) {
        this.items.set(item.case_id, structuredClone(item));
        return structuredClone(item);
    }

    async findByCaseId(caseId) {
        const item = this.items.get(caseId);
        return item ? structuredClone(item) : null;
    }

    async update(item) {
        this.items.set(item.case_id, structuredClone(item));
        return structuredClone(item);
    }
}

function createRegisteredApp(service, { projectCodes = ['brainbase'], organizationId, tenantId } = {}) {
    const app = express();
    app.use(express.json());
    const authService = {
        verifyToken: vi.fn(() => ({
            sub: 'per_owner', role: 'member', projectCodes, clearance: ['internal'],
            tenantId: tenantId === undefined ? 'unson' : tenantId,
            ...(organizationId === undefined ? {} : { organizationId })
        }))
    };
    registerApiRoutes(app, {
        configParser: {}, configService: {}, runtimePaths: { varDir: '/tmp' }, scheduleParser: {},
        googleCalendarService: {}, projectsRoot: '/tmp', authService,
        infoSSOTService: { getContext: vi.fn(), listGraphEntities: vi.fn() },
        canonicalTaskStoreConfig: { ownerPersonId: 'per_owner', ownerAliasIds: [] }, canonicalTaskService: {},
        learningService: {}, learningHealthService: {}, candidateRepository: null, knowledgeEventService: null,
        knowledgeFeedbackService: null, knowledgeCycleQueryService: null, onboardingRuntimeService: null,
        wikiService: {}, tokenUsageService: {}, agentControlCatalogService: {}, loopIntentService: {},
        meetingAutomationService: {}, automationRunService: {}, runReceiptQueryService: {}, outcomeCaseService: service,
        companionApprovalInboxService: {}, meetingSourceMcpSyncService: null, externalRunnerIngestService: {},
        runReceiptIngestService: {}, routineLivenessService: {}, uploadMiddleware: (_req, _res, next) => next(),
        appVersion: 'test', workspaceRoot: '/tmp', uploadsDir: '/tmp/uploads', runtimeInfo: {}, brainbaseRoot: '/tmp'
    });
    return { app, authService };
}

describe('outcome case routes', () => {
    it('offers only create, read, and evaluate through the injected service', async () => {
        const stored = { case_id: 'oc_01', ...createPayload, closure_status: 'open' };
        const service = {
            create: async (payload, actor) => ({ ...stored, received: { payload, actor } }),
            read: async (caseId, actor) => ({ ...stored, case_id: caseId, actor }),
            evaluate: async (caseId, payload, actor) => ({ ...stored, case_id: caseId, closure_status: 'incomplete', received: { payload, actor } })
        };
        const app = createApp(service);

        const created = await request(app).post('/api/outcome-cases').send(createPayload).expect(201);
        const read = await request(app).get('/api/outcome-cases/oc_01').expect(200);
        const evaluated = await request(app).post('/api/outcome-cases/oc_01/evaluations').send({ evaluator: 'per_owner' }).expect(200);

        expect(created.body.case_id).toBe('oc_01');
        expect(read.body.case_id).toBe('oc_01');
        expect(evaluated.body.closure_status).toBe('incomplete');
    });

    it('wires the authenticated route actor into actual service-layer closure authority', async () => {
        const service = new OutcomeCaseService({
            repository: new MemoryOutcomeCaseRepository(),
            readRunReceipt: async () => ({ evidence_state: 'confirmed' }),
            resolveOutcomeReferences: async ({ projectCode, capabilityId }) => ({
                project: { ref: projectCode, state: 'confirmed' },
                capability: { ref: capabilityId, state: 'confirmed' }
            }),
            resolveClosureAuthority: async ({ projectCode }) => ({
                state: 'confirmed', closure_authorized_person_ids: ['per_owner'],
                provenance: { source: 'test_raci', project_code: projectCode }
            })
        });
        const app = createApp(service, { personId: 'not_authorized', projectCodes: ['brainbase'], role: 'admin', organizationId: 'org_unson' });
        const created = await request(app).post('/api/outcome-cases').send(createPayload).expect(201);

        const response = await request(app)
            .post(`/api/outcome-cases/${created.body.case_id}/evaluations`)
            .send({
                technical_evidence: { status: 'confirmed', refs: ['test:route-service'] },
                run_receipt_refs: ['run-route-1'],
                external_readback: { status: 'confirm', ref: 'external:route-1' },
                constraints_status: 'satisfied',
                evaluator: 'per_owner',
                observed_at: '2026-09-04T00:00:00.000Z'
            })
            .expect(403);

        expect(response.body.error).toBe('closure_authority_denied');
    });

    it('registerApiRoutes protects and wires create, read, and evaluate through workflowAuthGuard', async () => {
        const service = new OutcomeCaseService({
            repository: new MemoryOutcomeCaseRepository(),
            readRunReceipt: async () => ({ evidence_state: 'confirmed' }),
            resolveOutcomeReferences: async ({ projectCode, capabilityId }) => ({
                project: { ref: projectCode, state: 'confirmed' },
                capability: { ref: capabilityId, state: 'confirmed' }
            }),
            resolveClosureAuthority: async ({ projectCode }) => ({
                state: 'confirmed', closure_authorized_person_ids: ['per_owner'],
                provenance: { source: 'test_raci', project_code: projectCode }
            })
        });
        const { app, authService } = createRegisteredApp(service);
        await request(app).post('/api/outcome-cases').send(createPayload).expect(401);

        const created = await request(app)
            .post('/api/outcome-cases').set('Authorization', 'Bearer outcome-user').send(createPayload).expect(201);
        await request(app)
            .get(`/api/outcome-cases/${created.body.case_id}`).set('Authorization', 'Bearer outcome-user').expect(200);
        const evaluated = await request(app)
            .post(`/api/outcome-cases/${created.body.case_id}/evaluations`)
            .set('Authorization', 'Bearer outcome-user')
            .send({
                technical_evidence: { status: 'confirmed', refs: ['test:registered-route'] },
                run_receipt_refs: ['run-route-1'],
                external_readback: { status: 'confirm', ref: 'external:route-1' },
                constraints_status: 'satisfied', evaluator: 'self-declared-ignored',
                observed_at: '2026-09-04T00:00:00.000Z'
            }).expect(200);

        expect(evaluated.body.closure_status).toBe('closed');
        expect(authService.verifyToken).toHaveBeenCalledTimes(3);
    });

    it('preserves conflicting token claims through workflowAuthGuard and rejects every OutcomeCase action', async () => {
        const service = { create: vi.fn(), read: vi.fn(), evaluate: vi.fn() };
        const { app } = createRegisteredApp(service, { organizationId: 'org_unson', tenantId: 'org_other' });

        for (const requestBuilder of [
            () => request(app).post('/api/outcome-cases').set('Authorization', 'Bearer conflicting').send(createPayload),
            () => request(app).get('/api/outcome-cases/oc_hidden').set('Authorization', 'Bearer conflicting'),
            () => request(app).post('/api/outcome-cases/oc_hidden/evaluations').set('Authorization', 'Bearer conflicting').send({})
        ]) {
            const response = await requestBuilder().expect(403);
            expect(response.body).toMatchObject({
                error: 'outcome_case_organization_access_denied',
                details: { audit_event: 'outcome_case_ambiguous_tenant_denied' }
            });
        }
        expect(service.create).not.toHaveBeenCalled();
        expect(service.read).not.toHaveBeenCalled();
        expect(service.evaluate).not.toHaveBeenCalled();
    });

    it.each([
        ['internal', { personId: 'internal_api', projectCodes: [], role: 'admin' }],
        ['admin', { personId: 'per_admin', projectCodes: [], role: 'admin' }],
        ['ceo', { personId: 'per_ceo', projectCodes: [], role: 'ceo' }]
    ])('requires an explicit project scope for %s actors', async (_kind, actor) => {
        const service = {
            create: vi.fn(),
            read: vi.fn(),
            evaluate: vi.fn()
        };
        const app = createApp(service, actor);

        await request(app).post('/api/outcome-cases').send(createPayload).expect(403);
        expect(service.create).not.toHaveBeenCalled();
    });

    it('denies an empty organization scope for create, read, and evaluate before invoking the service', async () => {
        const service = { create: vi.fn(), read: vi.fn(), evaluate: vi.fn() };
        const app = createApp(service, { personId: 'per_owner', projectCodes: ['brainbase'], role: 'member' });

        for (const requestBuilder of [
            () => request(app).post('/api/outcome-cases').send(createPayload),
            () => request(app).get('/api/outcome-cases/oc_missing'),
            () => request(app).post('/api/outcome-cases/oc_missing/evaluations').send({})
        ]) {
            const response = await requestBuilder().expect(403);
            expect(response.body).toMatchObject({
                error: 'outcome_case_organization_access_denied',
                details: { audit_event: 'outcome_case_unknown_tenant_denied' }
            });
        }
        expect(service.create).not.toHaveBeenCalled();
        expect(service.read).not.toHaveBeenCalled();
        expect(service.evaluate).not.toHaveBeenCalled();
    });

    it('rejects conflicting organization claims before service access and records opaque denial identifiers', async () => {
        const service = { create: vi.fn(), read: vi.fn(), evaluate: vi.fn() };
        const auditEntries = [];
        const app = createApp(service, {
            personId: 'per_owner', projectCodes: ['brainbase'], role: 'member',
            organizationId: 'org_unson', tenantId: 'org_other'
        }, { auditSink: { writeAuditLog: (entry) => auditEntries.push(entry) } });

        for (const requestBuilder of [
            () => request(app).post('/api/outcome-cases').send(createPayload),
            () => request(app).get('/api/outcome-cases/oc_hidden'),
            () => request(app).post('/api/outcome-cases/oc_hidden/evaluations').send({})
        ]) {
            const response = await requestBuilder().expect(403);
            expect(response.body).toMatchObject({
                error: 'outcome_case_organization_access_denied',
                details: {
                    audit_event: 'outcome_case_ambiguous_tenant_denied',
                    audit_id: expect.stringMatching(/^oca_/)
                }
            });
        }
        expect(auditEntries.map((entry) => entry.action)).toEqual(['create', 'read', 'evaluate']);
        expect(JSON.stringify(auditEntries)).not.toContain('org_unson');
        expect(JSON.stringify(auditEntries)).not.toContain('org_other');
        expect(service.create).not.toHaveBeenCalled();
        expect(service.read).not.toHaveBeenCalled();
        expect(service.evaluate).not.toHaveBeenCalled();
    });

    it('keeps the live bootstrap path connected to the service, resolver, and registered API', async () => {
        const { readFile } = await import('node:fs/promises');
        const core = await readFile('server/bootstrap/core-services.js', 'utf8');
        const registration = await readFile('server/bootstrap/register-api-routes.js', 'utf8');
        const server = await readFile('server.js', 'utf8');

        expect(core).toContain('createOutcomeCaseReferenceResolver');
        expect(core).toContain('resolveOutcomeReferences: createOutcomeCaseReferenceResolver');
        expect(registration).toContain("app.use('/api/outcome-cases', workflowAuthGuard");
        expect(registration).toContain('service: outcomeCaseService');
        expect(server).toContain('outcomeCaseService');
    });
});
