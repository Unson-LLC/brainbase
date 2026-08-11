import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { requireAuth } from '../../../server/middleware/auth.js';
import { createCompanionRouter } from '../../../server/routes/companion.js';
import { ReplyDraftService } from '../../../server/services/companion/reply-draft-service.js';
import { DecisionEventService } from '../../../server/services/companion/decision-event-service.js';

function basePayload(overrides = {}) {
    return {
        event_id: 'evt_1',
        occurred_at: '2026-07-01T09:00:00.000Z',
        item_dedupe_key: 'gmail:thread-1',
        provider: 'gmail',
        event_type: 'ai_drafted',
        ...overrides
    };
}

function createAuthService({ valid = true, personId = 'per_keigo' } = {}) {
    return {
        verifyToken: vi.fn(() => {
            if (!valid) throw new Error('invalid');
            return {
                role: 'gm',
                projectCodes: ['brainbase'],
                clearance: ['internal', 'restricted'],
                personId
            };
        })
    };
}

function createApp({ decisionEventService, authService = createAuthService() }) {
    const app = express();
    app.use(express.json());
    app.use('/api/companion', createCompanionRouter({
        replyDraftService: new ReplyDraftService({ infoSSOTService: {}, learningService: {} }),
        decisionEventService,
        authGuard: requireAuth(authService),
        accessGuardOptions: {
            ownerPersonId: 'sato_keigo',
            ownerAliasIds: ['per_keigo']
        }
    }));
    return app;
}

describe('companion decision-events route', () => {
    let dir;
    let decisionEventService;

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), 'decision-events-route-'));
        decisionEventService = new DecisionEventService({ dataDir: dir });
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('accepts a valid event and returns 201 with the stored record', async () => {
        const app = createApp({ decisionEventService });

        const res = await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload())
            .expect(201);

        expect(res.body.ok).toBe(true);
        expect(res.body.duplicate).toBe(false);
        expect(res.body.event.event_id).toBe('evt_1');
    });

    it('returns 200 and ignores a duplicate event_id', async () => {
        const app = createApp({ decisionEventService });

        await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload())
            .expect(201);

        const res = await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload({ metadata: { retried: true } }))
            .expect(200);

        expect(res.body.duplicate).toBe(true);
    });

    it('rejects an invalid event_type with 400', async () => {
        const app = createApp({ decisionEventService });

        const res = await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload({ event_type: 'not_a_real_type' }))
            .expect(400);

        expect(res.body.code).toBe('invalid_decision_event');
        expect(res.body.details.field).toBe('event_type');
    });

    it('rejects a missing occurred_at with 400', async () => {
        const app = createApp({ decisionEventService });

        const res = await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload({ occurred_at: undefined }))
            .expect(400);

        expect(res.body.details.field).toBe('occurred_at');
    });

    it('rejects unauthenticated server-to-server requests with 403', async () => {
        const app = createApp({ decisionEventService });

        const res = await request(app)
            .post('/api/companion/decision-events')
            .set('Cookie', 'brainbase_session=user-token')
            .send(basePayload())
            .expect(403);

        expect(res.body.code).toBe('server_to_server_auth_required');
    });

    it('rejects non-owner bearer tokens with 403', async () => {
        const app = createApp({
            decisionEventService,
            authService: createAuthService({ personId: 'per_other' })
        });

        const res = await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer other-user-token')
            .send(basePayload())
            .expect(403);

        expect(res.body.code).toBe('personal_kg_owner_required');
    });

    it('returns 503 when the decision event service is not configured', async () => {
        const app = createApp({ decisionEventService: null });

        const res = await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload())
            .expect(503);

        expect(res.body.code).toBe('decision_event_service_unconfigured');
    });

    it('returns 503 and quarantines a corrupt decision event ledger', async () => {
        writeFileSync(path.join(dir, '2026-07.json'), '{not-json');
        const app = createApp({ decisionEventService });

        const res = await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload())
            .expect(503);

        expect(res.body.code).toBe('decision_event_ledger_corrupt');
    });

    it('returns 503 for a ledger whose JSON schema is invalid', async () => {
        writeFileSync(path.join(dir, '2026-07.json'), JSON.stringify({
            schema_version: '0.1.0',
            events: {}
        }));
        const app = createApp({ decisionEventService });

        const res = await request(app)
            .get('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .expect(503);

        expect(res.body.code).toBe('decision_event_ledger_corrupt');
    });

    it('lists stored events via GET, filtered by from/to', async () => {
        const app = createApp({ decisionEventService });

        await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload({ event_id: 'evt_a', occurred_at: '2026-07-01T00:00:00.000Z' }))
            .expect(201);
        await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload({ event_id: 'evt_b', occurred_at: '2026-07-15T00:00:00.000Z' }))
            .expect(201);

        const res = await request(app)
            .get('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .query({ from: '2026-07-10T00:00:00.000Z' })
            .expect(200);

        expect(res.body.count).toBe(1);
        expect(res.body.events[0].event_id).toBe('evt_b');
    });
});
