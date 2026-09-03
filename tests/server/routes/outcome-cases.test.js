import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createOutcomeCaseRouter } from '../../../server/routes/outcome-cases.js';
import { OutcomeCaseService } from '../../../server/services/outcome-case/outcome-case-service.js';

function createApp(service, actor = { personId: 'internal_api', projectCodes: ['brainbase'], role: 'admin' }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.authSource = 'internal';
        req.auth = { sub: 'internal_api' };
        req.access = actor;
        next();
    });
    app.use('/api/outcome-cases', createOutcomeCaseRouter({ service }));
    return app;
}

const createPayload = {
    project_code: 'brainbase',
    capability_id: 'cap_outcome_control',
    user_observable_outcome: '依頼者が外部の完了読戻しを確認できる',
    protected_constraints: ['外部読戻しなしで閉鎖しない'],
    non_goals: ['汎用 workflow engine'],
    authority: { closure_authorized_person_ids: ['per_owner'] },
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
            })
        });
        const app = createApp(service, { personId: 'not_authorized', projectCodes: ['brainbase'], role: 'admin' });
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
