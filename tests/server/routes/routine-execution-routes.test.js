import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerApiRoutes } from '../../../server/bootstrap/register-api-routes.js';
import { RoutineCycleExecutor } from '../../../server/services/routine-runtime/cycle-executor.js';
import { ProductionRoutinePorts } from '../../../server/services/routine-runtime/production-routine-ports.js';
import { createPersonalKgAuthorityEnv } from '../../helpers/personal-kg-authority-fixture.ts';

function createBootstrapApp({
    routineCycleExecutor,
    projectCodes = ['brainbase'],
    serviceClaims = {},
    canonicalRoutineClaims = null,
    members = [{
        slack_id: 'U-SATO',
        person_id: 'sato_keigo',
        status: 'active',
        projects: [{ name: 'brainbase' }]
    }],
    env = createPersonalKgAuthorityEnv({ projectId: 'brainbase' })
} = {}) {
    const authService = {
        verifyServiceToken: vi.fn(() => ({
            sub: 'routine-worker',
            role: 'member',
            projectCodes,
            clearance: ['internal'],
            ...serviceClaims
        })),
        resolveCanonicalRoutineAuthority: vi.fn(async ({ routine }) => canonicalRoutineClaims || ({
            sub: `brainbase_${routine}`,
            projectCodes: ['brainbase'],
            capabilities: [`routine.${routine}.execute`],
            routineAuthority: {
                routine,
                capability_id: 'personal_read',
                allowed_effects: ['read'],
                owner_person_id: 'sato_keigo',
                organization_id: 'organization-unson',
                project_id: 'brainbase',
                authority_resolution_receipt_id: `authres-${routine}`,
                identity_resolution_receipt_id: `idres-${routine}`
            }
        })),
        verifyToken: vi.fn()
    };
    const app = express();
    app.use(express.json());
    registerApiRoutes(app, {
        configParser: { getMembers: vi.fn(async () => members) },
        configService: {},
        runtimePaths: { varDir: '/tmp' },
        scheduleParser: {},
        googleCalendarService: {},
        projectsRoot: '/tmp',
        authService,
        infoSSOTService: { getContext: vi.fn(), listGraphEntities: vi.fn() },
        canonicalTaskStoreConfig: { ownerPersonId: 'sato_keigo', ownerAliasIds: [] },
        canonicalTaskService: {},
        learningService: { searchPersonalKgCandidates: vi.fn() },
        learningHealthService: {},
        candidateRepository: null,
        knowledgeEventService: null,
        knowledgeFeedbackService: null,
        knowledgeCycleQueryService: null,
        onboardingRuntimeService: null,
        wikiService: {},
        tokenUsageService: {},
        agentControlCatalogService: {},
        loopIntentService: {},
        meetingAutomationService: {},
        automationRunService: {},
        runReceiptQueryService: {},
        companionApprovalInboxService: {},
        meetingSourceMcpSyncService: null,
        externalRunnerIngestService: {},
        runReceiptIngestService: {},
        routineLivenessService: {},
        routineCycleExecutor,
        uploadMiddleware: (_req, _res, next) => next(),
        appVersion: 'test',
        workspaceRoot: '/tmp',
        uploadsDir: '/tmp/uploads',
        runtimeInfo: {},
        brainbaseRoot: '/tmp',
        env
    });
    return { app, authService };
}

describe('Routine execution API production wiring', () => {
    it.each(['ohayo', 'retro', 'oyasumi'])('%sはローカル内部認証から署名済み会社権限を自動解決する', async (routine) => {
        const previousSecret = process.env.INTERNAL_API_SECRET;
        process.env.INTERNAL_API_SECRET = 'test-internal-secret';
        try {
            const routineCycleExecutor = { execute: vi.fn(async () => ({
                status: 'completed',
                routine_summary: { routine, status: 'completed', anomaly_count: 0 }
            })) };
            const { app, authService } = createBootstrapApp({ routineCycleExecutor });

            await request(app)
                .post(`/api/routines/${routine}/execute`)
                .set('x-internal-api-key', 'test-internal-secret')
                .send({ input: { project_id: 'brainbase' } })
                .expect(200);

            expect(authService.resolveCanonicalRoutineAuthority).toHaveBeenCalledWith({
                routine,
                ownerPersonId: 'sato_keigo',
                projectId: 'brainbase',
                providerSubjectIds: ['U-SATO']
            });
            expect(routineCycleExecutor.execute).toHaveBeenCalledWith(
                { routine, input: { project_id: 'brainbase' } },
                expect.objectContaining({
                    access: expect.objectContaining({
                        personId: 'sato_keigo',
                        actorPersonId: `brainbase_${routine}`,
                        organizationId: 'organization-unson',
                        projectCodes: ['brainbase'],
                        proxied: true
                    })
                })
            );
        } finally {
            if (previousSecret === undefined) delete process.env.INTERNAL_API_SECRET;
            else process.env.INTERNAL_API_SECRET = previousSecret;
        }
    });

    it('標準CLIと同じPOST /api/routines/:routine/executeを認証actor・project scope付きでexecutorへ渡す', async () => {
        const routineCycleExecutor = {
            execute: vi.fn(async () => ({
                status: 'completed',
                routine_summary: { routine: 'ohayo', status: 'completed', anomaly_count: 0 },
                evidence_refs: [{ kind: 'artifact_ref', ref: 'routine_summary:ohayo', label: 'routine_summary' }]
            }))
        };
        const { app, authService } = createBootstrapApp({ routineCycleExecutor });
        const authority = JSON.parse(createPersonalKgAuthorityEnv({ projectId: 'brainbase' })
            .BRAINBASE_COMPANY_AUTHORITY_RESPONSE_JSON);
        const input = { project_id: 'brainbase', requested_at: '2026-08-13T00:00:00.000Z' };

        const response = await request(app)
            .post('/api/routines/ohayo/execute')
            .set('Authorization', 'Bearer bbsvc_routine-test')
            .send({ thread_id: 'thread-route-1', company_authority_response: authority, input })
            .expect(200);

        expect(authService.verifyServiceToken).toHaveBeenCalledWith('bbsvc_routine-test');
        expect(routineCycleExecutor.execute).toHaveBeenCalledWith(
            { routine: 'ohayo', input },
            {
                actor: expect.objectContaining({
                    person_id: 'person-sato',
                    projectCodes: ['brainbase'],
                    role: 'member',
                    authSource: 'service-token'
                }),
                access: expect.objectContaining({
                    personId: 'person-sato',
                    actorPersonId: 'person-sato',
                    organizationId: 'organization-tenant-a',
                    projectCodes: ['brainbase'],
                    role: 'member',
                    proxied: true,
                    authorityResolutionReceiptId: 'authority-receipt-tenant-a-person-sato-auto'
                }),
                external_run_id: 'thread-route-1'
            }
        );
        expect(response.body).toMatchObject({
            status: 'completed',
            routine_summary: { routine: 'ohayo', status: 'completed' }
        });
    });

    it('内部・service認証のroutineは署名済み会社権限を必須にする', async () => {
        const routineCycleExecutor = { execute: vi.fn(async () => ({ status: 'completed' })) };
        const { app } = createBootstrapApp({ routineCycleExecutor });

        const response = await request(app)
            .post('/api/routines/ohayo/execute')
            .set('Authorization', 'Bearer bbsvc_routine-test')
            .send({ input: { project_id: 'brainbase' } })
            .expect(403);

        expect(response.body).toEqual({ error: 'routine_company_authority_required' });
        expect(routineCycleExecutor.execute).not.toHaveBeenCalled();
    });

    it('retro専用の署名済みservice authorityはrequest bodyの人物自己申告なしでread-only実行できる', async () => {
        const routineCycleExecutor = { execute: vi.fn(async () => ({
            status: 'completed',
            routine_summary: { routine: 'retro', status: 'completed', anomaly_count: 0 }
        })) };
        const { app } = createBootstrapApp({
            routineCycleExecutor,
            serviceClaims: {
                sub: 'brainbase_retro',
                capabilities: ['routine.retro.execute'],
                routineAuthority: {
                    routine: 'retro',
                    capability_id: 'personal_read',
                    allowed_effects: ['read'],
                    owner_person_id: 'person-sato',
                    organization_id: 'organization-tenant-a',
                    project_id: 'brainbase',
                    authority_resolution_receipt_id: 'authres-retro-1',
                    identity_resolution_receipt_id: 'idres-retro-1'
                }
            }
        });

        await request(app)
            .post('/api/routines/retro/execute')
            .set('Authorization', 'Bearer bbsvc_retro-test')
            .send({ input: { project_id: 'brainbase' } })
            .expect(200);

        expect(routineCycleExecutor.execute).toHaveBeenCalledWith(
            { routine: 'retro', input: { project_id: 'brainbase' } },
            expect.objectContaining({
                access: expect.objectContaining({
                    personId: 'person-sato',
                    actorPersonId: 'brainbase_retro',
                    organizationId: 'organization-tenant-a',
                    projectCodes: ['brainbase'],
                    clearance: ['personal'],
                    proxied: true
                })
            })
        );
    });

    it('oyasumi専用の署名済みservice authorityはrequest bodyの人物自己申告なしでread-only実行できる', async () => {
        const routineCycleExecutor = { execute: vi.fn(async () => ({
            status: 'completed',
            routine_summary: { routine: 'oyasumi', status: 'completed', anomaly_count: 0 }
        })) };
        const { app } = createBootstrapApp({
            routineCycleExecutor,
            serviceClaims: {
                sub: 'brainbase_oyasumi',
                capabilities: ['routine.oyasumi.execute'],
                routineAuthority: {
                    routine: 'oyasumi',
                    capability_id: 'personal_read',
                    allowed_effects: ['read'],
                    owner_person_id: 'person-sato',
                    organization_id: 'organization-tenant-a',
                    project_id: 'brainbase',
                    authority_resolution_receipt_id: 'authres-oyasumi-1',
                    identity_resolution_receipt_id: 'idres-oyasumi-1'
                }
            }
        });

        await request(app)
            .post('/api/routines/oyasumi/execute')
            .set('Authorization', 'Bearer bbsvc_oyasumi-test')
            .send({ input: { project_id: 'brainbase' } })
            .expect(200);

        expect(routineCycleExecutor.execute).toHaveBeenCalledWith(
            { routine: 'oyasumi', input: { project_id: 'brainbase' } },
            expect.objectContaining({
                access: expect.objectContaining({
                    personId: 'person-sato',
                    actorPersonId: 'brainbase_oyasumi',
                    organizationId: 'organization-tenant-a',
                    projectCodes: ['brainbase'],
                    clearance: ['personal'],
                    proxied: true
                })
            })
        );
    });

    it('retro service authorityは別routine・write scope・bodyでのowner上書きを拒否する', async () => {
        const routineCycleExecutor = { execute: vi.fn(async () => ({ status: 'completed' })) };
        const claims = {
            sub: 'brainbase_retro',
            capabilities: ['routine.retro.execute'],
            routineAuthority: {
                routine: 'retro',
                capability_id: 'personal_read',
                allowed_effects: ['read'],
                owner_person_id: 'person-sato',
                organization_id: 'organization-tenant-a',
                project_id: 'brainbase',
                authority_resolution_receipt_id: 'authres-retro-1',
                identity_resolution_receipt_id: 'idres-retro-1'
            }
        };
        const { app } = createBootstrapApp({ routineCycleExecutor, serviceClaims: claims });

        await request(app)
            .post('/api/routines/ohayo/execute')
            .set('Authorization', 'Bearer bbsvc_retro-test')
            .send({ input: { project_id: 'brainbase' } })
            .expect(403);
        await request(app)
            .post('/api/routines/retro/execute')
            .set('Authorization', 'Bearer bbsvc_retro-test')
            .send({ owner_person_id: 'person-attacker', input: { project_id: 'brainbase' } })
            .expect(403);

        const writeClaims = structuredClone(claims);
        writeClaims.routineAuthority.allowed_effects = ['write'];
        const writeApp = createBootstrapApp({
            routineCycleExecutor,
            serviceClaims: writeClaims
        }).app;
        await request(writeApp)
            .post('/api/routines/retro/execute')
            .set('Authorization', 'Bearer bbsvc_retro-test')
            .send({ input: { project_id: 'brainbase' } })
            .expect(403);

        expect(routineCycleExecutor.execute).not.toHaveBeenCalled();
    });

    it('改ざんされた会社権限はroutine effectより前に拒否する', async () => {
        const routineCycleExecutor = { execute: vi.fn(async () => ({ status: 'completed' })) };
        const { app } = createBootstrapApp({ routineCycleExecutor });
        const authority = JSON.parse(createPersonalKgAuthorityEnv({ projectId: 'brainbase' })
            .BRAINBASE_COMPANY_AUTHORITY_RESPONSE_JSON);
        authority.context.scope.organization_id = 'organization-attacker';

        const response = await request(app)
            .post('/api/routines/ohayo/execute')
            .set('Authorization', 'Bearer bbsvc_routine-test')
            .send({ company_authority_response: authority, input: { project_id: 'brainbase' } })
            .expect(403);

        expect(response.body).toEqual({ error: 'routine_company_authority_rejected' });
        expect(routineCycleExecutor.execute).not.toHaveBeenCalled();
    });

    it('署名済みprojectがtransport tokenのscope外ならroutine effectより前に拒否する', async () => {
        const routineCycleExecutor = { execute: vi.fn(async () => ({ status: 'completed' })) };
        const { app } = createBootstrapApp({ routineCycleExecutor, projectCodes: ['brainbase'] });
        const authority = JSON.parse(createPersonalKgAuthorityEnv({ projectId: 'customer-project' })
            .BRAINBASE_COMPANY_AUTHORITY_RESPONSE_JSON);

        const response = await request(app)
            .post('/api/routines/ohayo/execute')
            .set('Authorization', 'Bearer bbsvc_routine-test')
            .send({ company_authority_response: authority, input: { project_id: 'customer-project' } })
            .expect(403);

        expect(response.body).toEqual({ error: 'routine_company_authority_transport_scope_mismatch' });
        expect(routineCycleExecutor.execute).not.toHaveBeenCalled();
    });

    it('createCoreServicesからserver.jsとregisterApiRoutesを経て実依存のRoutineCycleExecutorを配線する', () => {
        const coreSource = fs.readFileSync(
            path.resolve(process.cwd(), 'server/bootstrap/core-services.js'),
            'utf8'
        );
        const registrationSource = fs.readFileSync(
            path.resolve(process.cwd(), 'server/bootstrap/register-api-routes.js'),
            'utf8'
        );
        const serverSource = fs.readFileSync(path.resolve(process.cwd(), 'server.js'), 'utf8');
        const serviceBinding = serverSource.match(/const\s*\{([^{}]*)\}\s*=\s*createCoreServices\(/)?.[1] || '';
        const serverRegistration = serverSource.match(/registerApiRoutes\(app,\s*\{([\s\S]*?)\n\}\);/)?.[1] || '';

        expect(coreSource).toContain("import { RoutineCycleExecutor } from '../services/routine-runtime/cycle-executor.js'");
        expect(coreSource).toContain('new RoutineCycleExecutor({');
        for (const dependency of [
            'oyasumiReconciler',
            'episodeCompressor',
            'retrievabilityVerifier',
            'livenessService',
            'recallService',
            'feedbackService',
            'ohayoGenerator',
            'retroService'
        ]) {
            expect(coreSource).toContain(dependency);
        }
        expect(coreSource).not.toContain('createUnavailableRoutineCycleExecutor');
        expect(coreSource).toContain('routineCycleExecutor');

        expect(registrationSource).toContain("import { createRoutineRouter } from '../routes/routines.js'");
        expect(registrationSource).toMatch(/app\.use\(\s*['"]\/api\/routines['"]/);
        expect(registrationSource).toContain('personalKnowledgeAccessGuard');
        expect(registrationSource).toContain('routineCycleExecutor');
        expect(serviceBinding).toContain('routineCycleExecutor');
        expect(serverRegistration).toContain('routineCycleExecutor');
    });

    it('createCoreServicesは固定値adapterではなくproduction RoutinePortsへ実repositoryとserviceをDIする', () => {
        const coreSource = fs.readFileSync(
            path.resolve(process.cwd(), 'server/bootstrap/core-services.js'),
            'utf8'
        );

        expect(coreSource).toContain("import { ProductionRoutinePorts } from '../services/routine-runtime/production-routine-ports.js'");
        expect(coreSource).toContain('new ProductionRoutinePorts({');
        for (const dependency of [
            'knowledgeEventRepository',
            'candidateRepository',
            'infoSSOTService',
            'runReceiptQueryService',
            'knowledgeFeedbackService'
        ]) {
            expect(coreSource).toContain(dependency);
        }
        expect(coreSource).not.toMatch(/unprocessed_count:\s*0/);
        expect(coreSource).not.toMatch(/contradiction_count:\s*0/);
        expect(coreSource).not.toMatch(/expired_count:\s*0/);
        expect(coreSource).not.toMatch(/recallGraph:\s*async\s*\(\)\s*=>\s*\[\]/);
        expect(coreSource).not.toMatch(/recallPersonalKg:\s*async\s*\(\)\s*=>\s*\[\]/);
        expect(coreSource).not.toMatch(/retrievable:\s*true/);
        expect(coreSource).not.toMatch(/misregistration_rate:\s*null/);
        expect(coreSource).not.toContain('knowledgeFeedbackService?.recordFeedback');
        expect(coreSource).toContain('deliverJudgmentKnowledgeEventOutbox');
    });

    it('createCoreServicesはjudgment knowledge event Dead Letter directoryをlivenessへ配線する', () => {
        const coreSource = fs.readFileSync(
            path.resolve(process.cwd(), 'server/bootstrap/core-services.js'),
            'utf8'
        );

        expect(coreSource).toContain('knowledge-event-dead-letter');
        expect(coreSource).toContain('listKnowledgeEventDeadLetters');
        expect(coreSource).toMatch(/new RoutineLivenessService\(\{[\s\S]*listKnowledgeEventDeadLetters/);
    });

    it('server内judgment Outbox配送はloopbackだけ内部API認証を使い外部へ漏らさない', () => {
        const coreSource = fs.readFileSync(
            path.resolve(process.cwd(), 'server/bootstrap/core-services.js'),
            'utf8'
        );

        expect(coreSource).toContain('resolveJudgmentKnowledgeEventDeliveryAuth');
        expect(coreSource).toMatch(/deliverJudgmentKnowledgeEventOutbox\(\{[\s\S]*\.\.\.judgmentKnowledgeEventDeliveryAuth/);
        expect(coreSource).not.toMatch(/authService\.issueServiceToken\(\{[\s\S]*svc_brainbase_judgment_knowledge_event/);
        expect(coreSource).not.toMatch(/deliverJudgmentKnowledgeEventOutbox\(\{[\s\S]*serviceToken:\s*process\.env\.BRAINBASE_RUN_RECEIPT_SERVICE_TOKEN/);
    });

    it('Hostとserverはjudgment knowledge event Outboxのcanonical defaultを共有する', () => {
        const coreSource = fs.readFileSync(
            path.resolve(process.cwd(), 'server/bootstrap/core-services.js'),
            'utf8'
        );
        const hostSource = fs.readFileSync(
            path.resolve(process.cwd(), 'scripts/codex-hooks/judgment-resolver-host.mjs'),
            'utf8'
        );

        expect(coreSource).toContain('resolveJudgmentKnowledgeEventOutboxPath');
        expect(hostSource).toContain('resolveJudgmentKnowledgeEventOutboxPath');
    });

    it('Info SSOTとknowledge依存が使えない時も起動でthrowせずendpointは偽successを返さない', async () => {
        const productionPorts = new ProductionRoutinePorts({
            knowledgeEventRepository: null,
            candidateRepository: null,
            infoSSOTService: null,
            runReceiptQueryService: null,
            listJudgmentOutboxExceptions: null,
            knowledgeFeedbackService: null
        });
        const routineCycleExecutor = new RoutineCycleExecutor({
            livenessService: { listExceptions: vi.fn(async () => []) },
            recallService: productionPorts,
            feedbackService: productionPorts,
            ohayoGenerator: productionPorts
        });
        const { app } = createBootstrapApp({ routineCycleExecutor });
        const authority = JSON.parse(createPersonalKgAuthorityEnv({ projectId: 'brainbase' })
            .BRAINBASE_COMPANY_AUTHORITY_RESPONSE_JSON);

        const response = await request(app)
            .post('/api/routines/ohayo/execute')
            .set('Authorization', 'Bearer bbsvc_routine-test')
            .send({
                thread_id: 'thread-unavailable',
                company_authority_response: authority,
                input: { project_id: 'brainbase' }
            })
            .expect(200);

        expect(['failed', 'partial']).toContain(response.body.status);
        expect(response.body.status).not.toBe('completed');
        expect(response.body.anomalies).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'routine_dependency_unavailable' })
        ]));
    });

    it('routine実行のproject_idは認証scope内でもbrainbase以外を拒否する', async () => {
        const routineCycleExecutor = { execute: vi.fn(async () => ({ status: 'completed' })) };
        const { app } = createBootstrapApp({
            routineCycleExecutor,
            projectCodes: ['brainbase', 'customer-project']
        });
        const authority = JSON.parse(createPersonalKgAuthorityEnv({ projectId: 'brainbase' })
            .BRAINBASE_COMPANY_AUTHORITY_RESPONSE_JSON);

        const response = await request(app)
            .post('/api/routines/ohayo/execute')
            .set('Authorization', 'Bearer bbsvc_routine-test')
            .send({ company_authority_response: authority, input: { project_id: 'customer-project' } })
            .expect(403);

        expect(response.body).toEqual({ error: 'routine_project_not_supported' });
        expect(routineCycleExecutor.execute).not.toHaveBeenCalled();
    });
});
