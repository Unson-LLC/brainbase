import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createMeetingMinutesContextReceiptRouter } from '../../../server/routes/meeting-minutes-context-receipts.js';

function appFor(service, access = { projectCodes: ['mana'] }, authSource = 'service-token') {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.access = access;
        req.auth = { sub: 'bbsvc_mana' };
        req.authSource = authSource;
        next();
    });
    app.use('/api/meeting-minutes/context-receipts', createMeetingMinutesContextReceiptRouter({ service }));
    return app;
}

describe('meeting minutes context receipt routes', () => {
    it('creates and retrieves an identity-bound receipt', async () => {
        const receipt = { receipt_id: 'mmctx_1', status: 'resolved' };
        const service = {
            create: vi.fn().mockResolvedValue(receipt),
            get: vi.fn().mockResolvedValue(receipt)
        };
        const app = appFor(service);
        const body = { run_id: 'Ev1', project_code: 'mana', transcript_sha256: 'a'.repeat(64) };

        const created = await request(app).post('/api/meeting-minutes/context-receipts').send(body);
        const fetched = await request(app)
            .get('/api/meeting-minutes/context-receipts/mmctx_1')
            .query(body);

        expect(created.status).toBe(201);
        expect(fetched.status).toBe(200);
        expect(service.create).toHaveBeenCalledWith(body, expect.objectContaining({ projectCodes: ['mana'] }));
        expect(service.get).toHaveBeenCalledWith('mmctx_1', body, expect.any(Object));
    });

    it('rejects non-service callers before dispatch', async () => {
        const service = { create: vi.fn(), get: vi.fn() };
        const response = await request(appFor(service, { projectCodes: ['mana'] }, 'session'))
            .post('/api/meeting-minutes/context-receipts')
            .send({ run_id: 'Ev1', project_code: 'mana', transcript_sha256: 'a'.repeat(64) });

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('server_to_server_auth_required');
        expect(service.create).not.toHaveBeenCalled();
    });

    it('preserves fail-closed service errors', async () => {
        const error = Object.assign(new Error('identity mismatch'), {
            code: 'meeting_minutes_context_identity_mismatch',
            statusCode: 409,
            details: { field: 'run_id' }
        });
        const service = { create: vi.fn(), get: vi.fn().mockRejectedValue(error) };
        const response = await request(appFor(service))
            .get('/api/meeting-minutes/context-receipts/mmctx_1')
            .query({ run_id: 'wrong', project_code: 'mana', transcript_sha256: 'a'.repeat(64) });

        expect(response.status).toBe(409);
        expect(response.body).toEqual({
            error: 'meeting_minutes_context_identity_mismatch',
            message: 'identity mismatch',
            details: { field: 'run_id' }
        });
    });
});
