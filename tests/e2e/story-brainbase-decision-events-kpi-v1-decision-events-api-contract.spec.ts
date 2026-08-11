import { expect, test } from '@playwright/test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { requireAuth } from '../../server/middleware/auth.js';
import { createCompanionRouter } from '../../server/routes/companion.js';
import { ReplyDraftService } from '../../server/services/companion/reply-draft-service.js';
import { DecisionEventService } from '../../server/services/companion/decision-event-service.js';

function basePayload(overrides: Record<string, unknown> = {}) {
    return {
        event_id: 'evt_e2e_1',
        occurred_at: '2026-07-01T09:00:00.000Z',
        item_dedupe_key: 'gmail:thread-e2e-1',
        provider: 'gmail',
        event_type: 'ai_drafted',
        ...overrides
    };
}

function writeLedger(dir: string, month: string, events: Array<Record<string, unknown>>) {
    writeFileSync(path.join(dir, `${month}.json`), JSON.stringify({
        schema_version: '0.1.0',
        events
    }));
}

function ledgerFiles(dir: string) {
    return readdirSync(dir)
        .filter((name) => /^\d{4}-(0[1-9]|1[0-2])\.json$/.test(name))
        .sort();
}

function createInProcessApp(decisionEventService: DecisionEventService | null) {
    const authService = {
        verifyToken: () => ({
            role: 'gm',
            projectCodes: ['brainbase'],
            clearance: ['internal', 'restricted'],
            personId: 'person_fixture_owner'
        })
    };
    const app = express();
    app.use(express.json());
    app.use('/api/companion', createCompanionRouter({
        replyDraftService: new ReplyDraftService({ infoSSOTService: {}, learningService: {} }),
        decisionEventService: decisionEventService || undefined,
        authGuard: requireAuth(authService),
        accessGuardOptions: {
            ownerPersonId: 'fixture_owner',
            ownerAliasIds: ['person_fixture_owner']
        }
    }));
    return app;
}

test('story-brainbase-decision-events-kpi-v1 ac:1 ac:5 authenticated decision event is accepted and persisted into a monthly ledger file', async () => {
    // **ac:1 route**: POST /api/companion/decision-events accepts the fixed mac-companion contract and does not 404.
    // **ac:5 persistence**: the event is appended to a month-partitioned ledger file named by occurred_at ({yyyy-mm}.json).
    // S-001: workflow state transition: Received with a valid, previously unseen event_id moves to Persisted and returns 201 duplicate=false.
    const dir = mkdtempSync(path.join(tmpdir(), 'decision-events-e2e-'));
    try {
        const decisionEventService = new DecisionEventService({ dataDir: dir });
        const response = await request(createInProcessApp(decisionEventService))
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload())
            .expect(201);

        assert.notEqual(response.status, 404, 'story-brainbase-decision-events-kpi-v1 ac:1 route exists and does not 404');
        expect(response.body, 'story-brainbase-decision-events-kpi-v1 S-001 Persisted event is returned').toMatchObject({
            ok: true,
            duplicate: false,
            event: { event_id: 'evt_e2e_1' }
        });
        expect(readdirSync(dir), 'story-brainbase-decision-events-kpi-v1 ac:5 month-partitioned ledger file exists for occurred_at 2026-07').toContain('2026-07.json');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('story-brainbase-decision-events-kpi-v1 ac:4 S-001 duplicate event_id is idempotent and does not overwrite the persisted record', async () => {
    // S-001: workflow state transition: Received with a duplicate event_id moves to Duplicate and returns 200 with the originally stored event, never overwriting it.
    const dir = mkdtempSync(path.join(tmpdir(), 'decision-events-e2e-'));
    try {
        const decisionEventService = new DecisionEventService({ dataDir: dir });
        const app = createInProcessApp(decisionEventService);

        await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload({ metadata: { attempt: 1 } }))
            .expect(201);

        const retry = await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload({ metadata: { attempt: 2 } }))
            .expect(200);

        expect(retry.body, 'story-brainbase-decision-events-kpi-v1 S-001 duplicate retry keeps original metadata').toMatchObject({
            ok: true,
            duplicate: true,
            event: { event_id: 'evt_e2e_1', metadata: { attempt: 1 } }
        });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('story-brainbase-decision-events-kpi-v1 ac:4 S-001 duplicate event_id remains idempotent across month partitions', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'decision-events-e2e-'));
    try {
        const decisionEventService = new DecisionEventService({ dataDir: dir });
        const app = createInProcessApp(decisionEventService);

        await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload({
                occurred_at: '2026-06-30T23:59:00.000Z',
                metadata: { attempt: 1 }
            }))
            .expect(201);

        const retry = await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload({
                occurred_at: '2026-07-01T00:01:00.000Z',
                metadata: { attempt: 2 }
            }))
            .expect(200);

        expect(retry.body, 'story-brainbase-decision-events-kpi-v1 S-001 cross-month retry keeps the first record').toMatchObject({
            ok: true,
            duplicate: true,
            event: {
                event_id: 'evt_e2e_1',
                occurred_at: '2026-06-30T23:59:00.000Z',
                metadata: { attempt: 1 }
            }
        });
        expect(ledgerFiles(dir), 'cross-month retry must not create a second month ledger').toEqual(['2026-06.json']);
        expect(decisionEventService.listEvents({})).toHaveLength(1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('story-brainbase-decision-events-kpi-v1 ac:4 legacy cross-month duplicates are returned once and keep the first record', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'decision-events-e2e-'));
    try {
        writeLedger(dir, '2026-06', [basePayload({
            occurred_at: '2026-06-30T23:59:00.000Z',
            metadata: { attempt: 1 }
        })]);
        writeLedger(dir, '2026-07', [basePayload({
            occurred_at: '2026-07-01T00:01:00.000Z',
            metadata: { attempt: 2 }
        })]);
        const app = createInProcessApp(new DecisionEventService({ dataDir: dir }));

        const listed = await request(app)
            .get('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .expect(200);
        expect(listed.body).toMatchObject({
            count: 1,
            events: [{
                event_id: 'evt_e2e_1',
                occurred_at: '2026-06-30T23:59:00.000Z',
                metadata: { attempt: 1 }
            }]
        });

        const retry = await request(app)
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload({
                occurred_at: '2026-08-01T00:01:00.000Z',
                metadata: { attempt: 3 }
            }))
            .expect(200);
        expect(retry.body).toMatchObject({
            duplicate: true,
            event: {
                occurred_at: '2026-06-30T23:59:00.000Z',
                metadata: { attempt: 1 }
            }
        });
        expect(ledgerFiles(dir)).toEqual(['2026-06.json', '2026-07.json']);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('story-brainbase-decision-events-kpi-v1 ac:2 unauthenticated server-to-server request is rejected before persistence', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'decision-events-e2e-'));
    try {
        const decisionEventService = new DecisionEventService({ dataDir: dir });
        const response = await request(createInProcessApp(decisionEventService))
            .post('/api/companion/decision-events')
            .set('Cookie', 'brainbase_session=user-token')
            .send(basePayload())
            .expect(403);

        assert.equal(response.body.code, 'server_to_server_auth_required', 'story-brainbase-decision-events-kpi-v1 ac:2 companion access guard is reused unchanged');
        expect(decisionEventService.listEvents({}), 'story-brainbase-decision-events-kpi-v1 rejected request writes nothing').toHaveLength(0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('story-brainbase-decision-events-kpi-v1 ac:3 invalid event_type is rejected with a structured 400 before persistence', async () => {
    // INV-003: event_type must be restricted to the fixed enum; invalid values are rejected before persistence.
    const dir = mkdtempSync(path.join(tmpdir(), 'decision-events-e2e-'));
    try {
        const decisionEventService = new DecisionEventService({ dataDir: dir });
        const response = await request(createInProcessApp(decisionEventService))
            .post('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .send(basePayload({ event_type: 'not_a_real_type' }))
            .expect(400);

        expect(response.body, 'story-brainbase-decision-events-kpi-v1 INV-003 invalid event_type is a structured failure').toMatchObject({
            code: 'invalid_decision_event',
            details: { field: 'event_type' }
        });
        expect(decisionEventService.listEvents({}), 'story-brainbase-decision-events-kpi-v1 rejected request writes nothing').toHaveLength(0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('story-brainbase-decision-events-kpi-v1 ac:6 GET decision-events lists stored events filtered by from/to for weekly aggregation', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'decision-events-e2e-'));
    try {
        const decisionEventService = new DecisionEventService({ dataDir: dir });
        const app = createInProcessApp(decisionEventService);

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

        const response = await request(app)
            .get('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .query({ from: '2026-07-10T00:00:00.000Z' })
            .expect(200);

        expect(response.body, 'story-brainbase-decision-events-kpi-v1 ac:6 GET filters by from/to for scripts/send-decision-kpi-to-slack.js').toMatchObject({
            count: 1,
            events: [{ event_id: 'evt_b' }]
        });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('story-brainbase-decision-events-kpi-v1 ac:7 weekly KPI excludes legacy cross-month duplicates', async () => {
    // **ac:7 weekly-kpi**: 委任率 = (draft_accepted+draft_edited)/(draft_accepted+draft_edited+self_handled),
    // 差戻し率 = draft_edited/(draft_accepted+draft_edited), エスカレーション件数, 境界拡張数(rule_created).
    // scenario:weekly-report: GET decision-events -> calculateKpi -> Slack blocks.
    process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'e2e-secret';
    process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || 'e2e-token';
    const { calculateKpi, buildSlackBlocks, sendToSlack } = await import('../../scripts/send-decision-kpi-to-slack.js');

    const dir = mkdtempSync(path.join(tmpdir(), 'decision-events-e2e-'));
    try {
        writeLedger(dir, '2026-06', [basePayload({
            event_id: 'evt_k1',
            occurred_at: '2026-06-30T23:59:00.000Z',
            event_type: 'draft_accepted'
        })]);
        writeLedger(dir, '2026-07', [basePayload({
            event_id: 'evt_k1',
            occurred_at: '2026-07-01T00:01:00.000Z',
            event_type: 'self_handled'
        })]);
        const decisionEventService = new DecisionEventService({ dataDir: dir });
        const app = createInProcessApp(decisionEventService);
        const seed = [
            { event_id: 'evt_k2', event_type: 'draft_accepted' },
            { event_id: 'evt_k3', event_type: 'draft_edited' },
            { event_id: 'evt_k4', event_type: 'self_handled' },
            { event_id: 'evt_k5', event_type: 'escalated' },
            { event_id: 'evt_k6', event_type: 'rule_created' }
        ];
        for (const overrides of seed) {
            await request(app)
                .post('/api/companion/decision-events')
                .set('Authorization', 'Bearer user-token')
                .send(basePayload(overrides))
                .expect(201);
        }

        const listed = await request(app)
            .get('/api/companion/decision-events')
            .set('Authorization', 'Bearer user-token')
            .expect(200);

        const kpi = calculateKpi(listed.body.events);
        expect(kpi.delegationRate, 'story-brainbase-decision-events-kpi-v1 ac:7 委任率 (2+1)/(2+1+1)=75%').toBe(75);
        expect(kpi.reworkRate, 'story-brainbase-decision-events-kpi-v1 ac:7 差戻し率 1/(2+1)=33.3%').toBe(33.3);
        expect(kpi.escalatedCount, 'story-brainbase-decision-events-kpi-v1 ac:7 エスカレーション件数').toBe(1);
        expect(kpi.ruleCreatedCount, 'story-brainbase-decision-events-kpi-v1 ac:7 境界拡張数 rule_created').toBe(1);

        const blocks = buildSlackBlocks(kpi, {
            from: '2026-06-24T00:00:00.000Z',
            to: '2026-07-01T00:00:00.000Z'
        });
        const originalFetch = globalThis.fetch;
        const slackRequests: Array<{ url: string; init?: RequestInit }> = [];
        globalThis.fetch = async (url, init) => {
            slackRequests.push({ url: String(url), init });
            return new Response(JSON.stringify({ ok: true, channel: 'C123', ts: '123.456' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        };
        try {
            await expect(sendToSlack(blocks, '#brainbase'), 'story-brainbase-decision-events-kpi-v1 ac:7 Slack API acknowledges the weekly report').resolves.toMatchObject({
                channel: 'C123',
                ts: '123.456'
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
        expect(slackRequests, 'story-brainbase-decision-events-kpi-v1 ac:7 one Slack post is issued').toHaveLength(1);
        expect(slackRequests[0].url).toBe('https://slack.com/api/chat.postMessage');
        expect(JSON.parse(String(slackRequests[0].init?.body))).toMatchObject({
            channel: '#brainbase',
            blocks
        });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('story-brainbase-decision-events-kpi-v1 ac:8 S-003 weekly KPI report never fakes zero rates and flags empty weeks', async () => {
    // **ac:8 no-fake-zero**: データが無い週は「計測不能」、イベント0件の週は「イベント未受信」と明示する。
    // scenario:weekly-report negative_path: zero-denominator and zero-event weeks are labeled, not reported as 0%.
    process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'e2e-secret';
    process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || 'e2e-token';
    const { calculateKpi, formatRate, buildSlackBlocks } = await import('../../scripts/send-decision-kpi-to-slack.js');

    const emptyKpi = calculateKpi([]);
    expect(emptyKpi.delegationRate, 'story-brainbase-decision-events-kpi-v1 ac:8 zero-denominator delegation rate is null, not 0').toBeNull();
    expect(formatRate(emptyKpi.delegationRate, emptyKpi.delegationDenominator), 'story-brainbase-decision-events-kpi-v1 ac:8 委任率は計測不能と表示').toContain('計測不能');
    expect(formatRate(emptyKpi.reworkRate, emptyKpi.reworkDenominator), 'story-brainbase-decision-events-kpi-v1 ac:8 差戻し率は計測不能と表示').toContain('計測不能');

    const blocks = buildSlackBlocks(emptyKpi, { from: '2026-06-24T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' });
    const blockText = JSON.stringify(blocks);
    expect(blockText, 'story-brainbase-decision-events-kpi-v1 ac:8 イベント0件の週はイベント未受信と報告').toContain('イベント未受信');
    expect(blockText, 'story-brainbase-decision-events-kpi-v1 ac:8 イベント0件の率は計測不能と報告').toContain('計測不能');
});
