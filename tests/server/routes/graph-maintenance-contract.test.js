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
            .send({ project_code: 'brainbase', include_project_codes: ['vibepro'] })
            .expect(200);
        expect(validated.body).toEqual(responses.validate);
        expect(spies.validate).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org_unson' }),
            { projectCode: 'brainbase', includeProjectCodes: ['vibepro'] }
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
                evidence: { reviewer: 'per_graph_owner', approved_at: '2026-08-20T00:00:00.000Z' }
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
                evidence: { reviewer: 'per_graph_owner', approved_at: '2026-08-20T00:00:00.000Z' }
            }
        );
    });
});
