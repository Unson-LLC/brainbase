import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerApiRoutes } from '../../../server/bootstrap/register-api-routes.js';
import { RoutineCycleExecutor } from '../../../server/services/routine-runtime/cycle-executor.js';
import { ProductionRoutinePorts } from '../../../server/services/routine-runtime/production-routine-ports.js';

function createBootstrapApp({ routineCycleExecutor, projectCodes = ['brainbase'] } = {}) {
    const authService = {
        verifyServiceToken: vi.fn(() => ({
            sub: 'routine-worker',
            role: 'member',
            projectCodes,
            clearance: ['internal']
        })),
        verifyToken: vi.fn()
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
        brainbaseRoot: '/tmp'
    });
    return { app, authService };
}

describe('Routine execution API production wiring', () => {
    it('標準CLIと同じPOST /api/routines/:routine/executeを認証actor・project scope付きでexecutorへ渡す', async () => {
        const routineCycleExecutor = {
            execute: vi.fn(async () => ({
                status: 'completed',
                routine_summary: { routine: 'ohayo', status: 'completed', anomaly_count: 0 },
                evidence_refs: [{ kind: 'artifact_ref', ref: 'routine_summary:ohayo', label: 'routine_summary' }]
            }))
        };
        const { app, authService } = createBootstrapApp({ routineCycleExecutor });
        const input = { project_id: 'brainbase', requested_at: '2026-08-13T00:00:00.000Z' };

        const response = await request(app)
            .post('/api/routines/ohayo/execute')
            .set('Authorization', 'Bearer bbsvc_routine-test')
            .send({ thread_id: 'thread-route-1', input })
            .expect(200);

        expect(authService.verifyServiceToken).toHaveBeenCalledWith('bbsvc_routine-test');
        expect(routineCycleExecutor.execute).toHaveBeenCalledWith(
            { routine: 'ohayo', input },
            {
                actor: expect.objectContaining({
                    person_id: 'routine-worker',
                    projectCodes: ['brainbase'],
                    role: 'member',
                    authSource: 'service-token'
                }),
                access: expect.objectContaining({
                    personId: 'routine-worker',
                    projectCodes: ['brainbase'],
                    role: 'member'
                }),
                external_run_id: 'thread-route-1'
            }
        );
        expect(response.body).toMatchObject({
            status: 'completed',
            routine_summary: { routine: 'ohayo', status: 'completed' }
        });
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
        expect(registrationSource).toContain("app.use('/api/routines'");
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

    it('server内judgment Outbox配送は起動時に発行したbrainbase限定service tokenを使う', () => {
        const coreSource = fs.readFileSync(
            path.resolve(process.cwd(), 'server/bootstrap/core-services.js'),
            'utf8'
        );

        expect(coreSource).toMatch(/authService\.issueServiceToken\(\{[\s\S]*projectCodes:\s*\['brainbase'\]/);
        expect(coreSource).toMatch(/deliverJudgmentKnowledgeEventOutbox\(\{[\s\S]*serviceToken:\s*judgmentKnowledgeEventServiceToken/);
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

        const response = await request(app)
            .post('/api/routines/ohayo/execute')
            .set('Authorization', 'Bearer bbsvc_routine-test')
            .send({ thread_id: 'thread-unavailable', input: { project_id: 'brainbase' } })
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

        const response = await request(app)
            .post('/api/routines/ohayo/execute')
            .set('Authorization', 'Bearer bbsvc_routine-test')
            .send({ input: { project_id: 'customer-project' } })
            .expect(403);

        expect(response.body).toEqual({ error: 'routine_project_not_supported' });
        expect(routineCycleExecutor.execute).not.toHaveBeenCalled();
    });
});
