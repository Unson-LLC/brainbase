import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createOutcomeCaseRouter } from '../../../server/routes/outcome-cases.js';

function createApp(service) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.authSource = 'internal';
        req.auth = { sub: 'internal_api' };
        req.access = { personId: 'internal_api', projectCodes: ['brainbase'], role: 'admin' };
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
    authority: { accountable: 'per_owner' },
    selected_domain_pack: 'delivery-control/v1',
    current_external_state: 'processing',
    technical_story_refs: ['story-outcome-case-v1'],
    run_receipt_refs: [],
    prior_attempt_refs: [],
    unresolved_failure_boundary: null
};

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
});
