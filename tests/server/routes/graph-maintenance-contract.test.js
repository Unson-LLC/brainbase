import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireAuth } from '../../../server/middleware/auth.js';
import { csrfMiddleware } from '../../../server/middleware/csrf.js';
import { createInfoSSOTRouter } from '../../../server/routes/info-ssot.js';
import { GraphMaintenanceService } from '../../../server/services/graph-maintenance-service.js';

const AUTH_TOKEN = 'signed-user-token';
const SERVICE_TOKEN = 'bbsvc_machine-token';

const authService = {
    verifyToken: vi.fn(() => ({
        sub: 'per_graph_owner',
        role: 'gm',
        projectCodes: ['brainbase', 'vibepro'],
        clearance: ['internal', 'restricted', 'finance', 'hr', 'contract'],
        organizationId: 'org_unson'
    })),
    verifyServiceToken: vi.fn(() => ({
        sub: 'svc_graph_maintenance',
        role: 'gm',
        projectCodes: ['brainbase'],
        clearance: ['internal'],
        organizationId: 'org_unson'
    }))
};

function securedApp() {
    const app = express();
    app.use(express.json());
    app.use(csrfMiddleware());
    app.use(
        '/api/info',
        requireAuth(authService, { allowInsecureHeaders: false }),
        createInfoSSOTRouter({})
    );
    return app;
}

function bearerHeaders() {
    return {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        'x-brainbase-projects': 'brainbase'
    };
}

describe('Graph maintenance REST/MCP contract', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        vi.restoreAllMocks();
        authService.verifyToken.mockClear();
        authService.verifyServiceToken.mockClear();
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalNodeEnv;
    });

    it('6つのREST routeがcontrollerからserviceへ正しいmethod/body/queryを渡す', async () => {
        process.env.NODE_ENV = 'production';
        const snapshotHash = `sha256:${'a'.repeat(64)}`;
        const responses = {
            exportSnapshot: { snapshot_id: 'gms_1', snapshot_hash: snapshotHash, entities: [], edges: [] },
            planMutations: { plan_id: 'gmp_1', status: 'planned', dry_run: true },
            applyPlan: { receipt_id: 'gmr_apply_1', receipt_type: 'apply', status: 'completed' },
            getPlanReceipt: { plan_id: 'gmp_1', receipts: [] },
            rollbackPlan: { receipt_id: 'gmr_rollback_1', receipt_type: 'rollback', status: 'completed' },
            validate: { valid: true, snapshot_hash: snapshotHash }
        };
        const spies = {
            exportSnapshot: vi.spyOn(GraphMaintenanceService.prototype, 'exportSnapshot').mockResolvedValue(responses.exportSnapshot),
            planMutations: vi.spyOn(GraphMaintenanceService.prototype, 'planMutations').mockResolvedValue(responses.planMutations),
            applyPlan: vi.spyOn(GraphMaintenanceService.prototype, 'applyPlan').mockResolvedValue(responses.applyPlan),
            getPlanReceipt: vi.spyOn(GraphMaintenanceService.prototype, 'getPlanReceipt').mockResolvedValue(responses.getPlanReceipt),
            rollbackPlan: vi.spyOn(GraphMaintenanceService.prototype, 'rollbackPlan').mockResolvedValue(responses.rollbackPlan),
            validate: vi.spyOn(GraphMaintenanceService.prototype, 'validate').mockResolvedValue(responses.validate)
        };
        const app = securedApp();

        const exported = await request(app)
            .post('/api/info/graph/maintenance/snapshots')
            .set({ ...bearerHeaders(), 'x-brainbase-projects': 'brainbase,vibepro' })
            .send({ project_code: 'brainbase', include_project_codes: ['vibepro'] })
            .expect(201);
        expect(exported.body).toEqual(responses.exportSnapshot);
        expect(spies.exportSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org_unson', projectCodes: ['brainbase', 'vibepro'], role: 'gm' }),
            { projectCode: 'brainbase', includeProjectCodes: ['vibepro'] }
        );

        const planned = await request(app)
            .post('/api/info/graph/maintenance/plans')
            .set(bearerHeaders())
            .send({
                project_code: 'brainbase', snapshot_id: 'gms_1', idempotency_key: 'phase0-contract',
                reason: 'REST/MCP contract', operations: [], human_gate_receipt: 'gate_1'
            })
            .expect(201);
        expect(planned.body).toEqual(responses.planMutations);
        expect(spies.planMutations).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org_unson' }),
            {
                projectCode: 'brainbase', snapshotId: 'gms_1', idempotencyKey: 'phase0-contract',
                reason: 'REST/MCP contract', operations: [], humanGateReceipt: 'gate_1'
            }
        );

        const applied = await request(app)
            .post('/api/info/graph/maintenance/plans/gmp_1/apply')
            .set(bearerHeaders())
            .send({ project_code: 'brainbase', snapshot_hash: snapshotHash })
            .expect(200);
        expect(applied.body).toEqual(responses.applyPlan);
        expect(spies.applyPlan).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org_unson' }),
            { projectCode: 'brainbase', planId: 'gmp_1', snapshotHash }
        );

        const receipt = await request(app)
            .get('/api/info/graph/maintenance/plans/gmp_1/receipt?project_code=brainbase')
            .set(bearerHeaders())
            .expect(200);
        expect(receipt.body).toEqual(responses.getPlanReceipt);
        expect(spies.getPlanReceipt).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org_unson' }),
            { projectCode: 'brainbase', planId: 'gmp_1' }
        );

        const rolledBack = await request(app)
            .post('/api/info/graph/maintenance/plans/gmp_1/rollback')
            .set(bearerHeaders())
            .send({ project_code: 'brainbase', apply_receipt_id: 'gmr_apply_1' })
            .expect(200);
        expect(rolledBack.body).toEqual(responses.rollbackPlan);
        expect(spies.rollbackPlan).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org_unson' }),
            { projectCode: 'brainbase', planId: 'gmp_1', applyReceiptId: 'gmr_apply_1' }
        );

        const validated = await request(app)
            .post('/api/info/graph/maintenance/validate')
            .set({ ...bearerHeaders(), 'x-brainbase-projects': 'brainbase,vibepro' })
            .send({ project_code: 'brainbase', include_project_codes: ['vibepro'], strict_collection: true })
            .expect(200);
        expect(validated.body).toEqual(responses.validate);
        expect(spies.validate).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org_unson' }),
            { projectCode: 'brainbase', includeProjectCodes: ['vibepro'], strictCollection: true }
        );
    });

    it('Project Catalog subject操作をREST plan経路から改変せずserviceへ渡す', async () => {
        process.env.NODE_ENV = 'production';
        const operations = [
            {
                operation: 'materialize_project_subject',
                catalog_project_id: 'brainbase-universal-arts-ai-support',
                expected_version: 0
            },
            {
                operation: 'link_decision_project_subject',
                decision_id: 'dec_ua',
                decision_expected_version: 1,
                subject_entity_id: 'brainbase-universal-arts-ai-support',
                subject_expected_version: 1,
                expected_version: 0
            }
        ];
        const planMutations = vi.spyOn(GraphMaintenanceService.prototype, 'planMutations')
            .mockResolvedValue({ plan_id: 'gmp_phase03', status: 'planned', dry_run: true });

        await request(securedApp())
            .post('/api/info/graph/maintenance/plans')
            .set(bearerHeaders())
            .send({
                project_code: 'brainbase',
                snapshot_id: 'gms_phase03',
                idempotency_key: 'phase03-rest-contract',
                reason: 'Phase 0.3 REST contract',
                operations
            })
            .expect(201);

        expect(planMutations).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org_unson' }),
            expect.objectContaining({
                projectCode: 'brainbase',
                snapshotId: 'gms_phase03',
                operations
            })
        );
    });

    it('service-tokenをBearer相当として扱わず、controller到達後も拒否する', async () => {
        process.env.NODE_ENV = 'production';
        const exportSnapshot = vi.spyOn(GraphMaintenanceService.prototype, 'exportSnapshot');
        const response = await request(securedApp())
            .post('/api/info/graph/maintenance/snapshots')
            .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
            .send({ project_code: 'brainbase' });

        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: 'Bearer authorization is required' });
        expect(authService.verifyServiceToken).toHaveBeenCalledOnce();
        expect(exportSnapshot).not.toHaveBeenCalled();
    });

    it('service-tokenのApplyを安定code付き403で拒否する', async () => {
        process.env.NODE_ENV = 'production';
        const applyPlan = vi.spyOn(GraphMaintenanceService.prototype, 'applyPlan');
        const response = await request(securedApp())
            .post('/api/info/graph/maintenance/plans/gmp_service/apply')
            .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
            .send({ project_code: 'brainbase', snapshot_hash: 'sha256:before', human_gate_receipt: 'gate_1' });

        expect(response.status).toBe(403);
        expect(response.body).toEqual({
            error: 'Graph Apply requires a signed human Bearer principal',
            code: 'GRAPH_HUMAN_PRINCIPAL_REQUIRED'
        });
        expect(authService.verifyServiceToken).toHaveBeenCalledOnce();
        expect(applyPlan).not.toHaveBeenCalled();
    });

    it('Graph maintenanceのBearer以外のPOSTはCSRF境界で止める', async () => {
        process.env.NODE_ENV = 'production';
        const response = await request(securedApp())
            .post('/api/info/graph/maintenance/plans')
            .send({ project_code: 'brainbase' });

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: 'Forbidden', message: 'CSRF token required' });
        expect(authService.verifyToken).not.toHaveBeenCalled();
        expect(authService.verifyServiceToken).not.toHaveBeenCalled();
    });

    it('service errorのconflictを409として返す', async () => {
        process.env.NODE_ENV = 'production';
        vi.spyOn(GraphMaintenanceService.prototype, 'applyPlan')
            .mockRejectedValue(new Error('snapshot hash conflict'));

        const response = await request(securedApp())
            .post('/api/info/graph/maintenance/plans/gmp_1/apply')
            .set(bearerHeaders())
            .send({ project_code: 'brainbase', snapshot_hash: `sha256:${'a'.repeat(64)}` });

        expect(response.status).toBe(409);
        expect(response.body).toEqual({ error: 'snapshot hash conflict' });
    });

    it('Human Gate scope不一致を安定code・details付き409で返す', async () => {
        process.env.NODE_ENV = 'production';
        const error = new Error('Human Gate receipt does not approve this Decision subject operation');
        error.code = 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH';
        error.status = 409;
        error.details = { expected_operation_scope: { target_project_code: 'aitle' } };
        vi.spyOn(GraphMaintenanceService.prototype, 'planMutations').mockRejectedValue(error);

        const response = await request(securedApp())
            .post('/api/info/graph/maintenance/plans')
            .set(bearerHeaders())
            .send({ project_code: 'brainbase', snapshot_id: 'gms_1', operations: [] });

        expect(response.status).toBe(409);
        expect(response.body).toEqual({
            error: error.message,
            code: 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH',
            details: error.details
        });
    });

    it('不正なHuman Gate evidenceを安定code付き400で返す', async () => {
        process.env.NODE_ENV = 'production';
        const error = new Error('evidence must be an object');
        error.code = 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID';
        error.status = 400;
        vi.spyOn(GraphMaintenanceService.prototype, 'recordHumanGateReceipt').mockRejectedValue(error);

        const response = await request(securedApp())
            .post('/api/info/graph/maintenance/human-gate-receipts')
            .set(bearerHeaders())
            .send({ project_code: 'brainbase', decision_id: 'decision_1', receipt_id: 'gate_invalid', evidence: null });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
            error: 'evidence must be an object',
            code: 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID'
        });
    });

    it('Human Gate receiptの供給経路をBearer human access付きでserviceへ渡す', async () => {
        process.env.NODE_ENV = 'production';
        const responseBody = {
            receipt_id: 'gate_receipt_1',
            decision_id: 'decision_1',
            organization_id: 'org_unson',
            project_code: 'brainbase',
            status: 'approved'
        };
        const recordReceipt = vi.spyOn(GraphMaintenanceService.prototype, 'recordHumanGateReceipt')
            .mockResolvedValue(responseBody);

        const response = await request(securedApp())
            .post('/api/info/graph/maintenance/human-gate-receipts')
            .set(bearerHeaders())
            .send({
                project_code: 'brainbase',
                decision_id: 'decision_1',
                receipt_id: 'gate_receipt_1',
                evidence: { operation_scope: {
                    operation: 'retire_entity', decision_id: 'decision_1', decision_expected_version: 2
                }, source: 'human-review' }
            })
            .expect(201);

        expect(response.body).toEqual(responseBody);
        expect(recordReceipt).toHaveBeenCalledWith(
            expect.objectContaining({
                organizationId: 'org_unson',
                projectCodes: ['brainbase', 'vibepro'],
                role: 'gm',
                authSource: 'bearer'
            }),
            {
                projectCode: 'brainbase',
                decisionId: 'decision_1',
                receiptId: 'gate_receipt_1',
                evidence: { operation_scope: {
                    operation: 'retire_entity', decision_id: 'decision_1', decision_expected_version: 2
                }, source: 'human-review' }
            }
        );
    });
});
