// @ts-check
/**
 * Contract test: POST /api/candidate-store/raw-ledger
 * Story: story-candidate-store-cross-repo-write
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHmac } from 'crypto';

import { createCandidateStoreRouter } from '../../../server/routes/candidate-store.js';
import { captureCandidateStoreRawBody } from '../../../server/middleware/candidate-store-hmac.js';
import { InMemoryCandidateRepository } from '../../../server/services/candidate-store/candidate-repository.js';

function makeApp({
    allowedSources = ['salestailor_ops_refactor', 'mana_slack'],
    upstreamJsonParser = false
} = {}) {
    const candidateRepository = new InMemoryCandidateRepository();
    const app = express();
    if (upstreamJsonParser) {
        app.use(express.json({
            limit: '10mb',
            verify: captureCandidateStoreRawBody
        }));
    }
    app.use('/api/candidate-store', createCandidateStoreRouter({
        candidateRepository,
        allowedSources
    }));
    return { app, candidateRepository };
}

function sign(secret, body) {
    return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

function asProxy(req, {
    personId = 'person:ksato',
    organizationId = 'org:unson'
} = {}) {
    return req
        .set('x-brainbase-proxy-person-id', personId)
        .set('x-brainbase-organization-id', organizationId);
}

function validEnvelope(overrides = {}) {
    return {
        raw_event_id: 'raw_salestailor_ops_refactor_test_001',
        source_system: 'salestailor_ops_refactor',
        source_event_id: 'ops-refactor-2026-05-14T11-00-00-hotspot-abc',
        occurred_at: '2026-05-14T11:00:00.000Z',
        captured_at: '2026-05-14T11:00:01.000Z',
        actor_external_id: 'github_actions:ksato-mac',
        actor_person_id: 'person:ksato',
        workspace: 'unson',
        channel_id: null,
        project_code: 'salestailor',
        permission_snapshot: {
            roles: ['ops_team'],
            clearance: ['internal']
        },
        evidence_ref: {
            kind: 'source_pointer',
            uri: 'github://Unson-LLC/salestailor/runs/12345',
            hash: 'sha256:abc123'
        },
        retention_policy: 'envelope_only',
        snippet: 'Refactor extracted shared helpers from lib/services/foo.ts (judge=92)',
        ...overrides
    };
}

describe('POST /api/candidate-store/raw-ledger', () => {
    const SECRET = 'test-hmac-secret-for-salestailor-ops-refactor';

    beforeEach(() => {
        process.env.CANDIDATE_STORE_HMAC_SALESTAILOR_OPS_REFACTOR = SECRET;
    });

    afterEach(() => {
        delete process.env.CANDIDATE_STORE_HMAC_SALESTAILOR_OPS_REFACTOR;
    });

    it('正常 envelope + 正しい HMAC → 202 + candidate_ids が返る', async () => {
        const { app, candidateRepository } = makeApp();
        const body = JSON.stringify(validEnvelope());
        const sig = sign(SECRET, body);

        const res = await asProxy(request(app)
            .post('/api/candidate-store/raw-ledger')
            .set('Content-Type', 'application/json')
            .set('x-cs-source', 'salestailor_ops_refactor')
            .set('x-cs-signature', sig)
            .send(body));

        expect(res.status).toBe(202);
        expect(res.body.raw_event_id).toBe('raw_salestailor_ops_refactor_test_001');
        expect(Array.isArray(res.body.candidate_ids)).toBe(true);
        expect(res.body.candidate_ids.length).toBeGreaterThan(0);
        const candidates = await candidateRepository.list({});
        expect(candidates.length).toBe(res.body.candidate_ids.length);
        expect(candidates[0]).toMatchObject({
            owner_person_id: 'person:ksato',
            organization_id: 'org:unson'
        });
    });

    it('署名済みサービスでも代理本人・組織がなければ403で閉じる', async () => {
        const { app } = makeApp();
        const body = JSON.stringify(validEnvelope());
        const sig = sign(SECRET, body);

        const res = await request(app)
            .post('/api/candidate-store/raw-ledger')
            .set('Content-Type', 'application/json')
            .set('x-cs-source', 'salestailor_ops_refactor')
            .set('x-cs-signature', sig)
            .send(body);

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('personal_knowledge_proxy_required');
    });

    it('上位JSON parserが先にbodyを消費してもraw body HMACを検証できる', async () => {
        const { app } = makeApp({ upstreamJsonParser: true });
        const body = JSON.stringify(validEnvelope({ raw_event_id: 'raw_upstream_parser_001' }));
        const sig = sign(SECRET, body);

        const res = await asProxy(request(app)
            .post('/api/candidate-store/raw-ledger')
            .set('Content-Type', 'application/json')
            .set('x-cs-source', 'salestailor_ops_refactor')
            .set('x-cs-signature', sig)
            .send(body));

        expect(res.status).toBe(202);
        expect(res.body.raw_event_id).toBe('raw_upstream_parser_001');
    });

    it('HMAC 不一致 → 401', async () => {
        const { app } = makeApp();
        const body = JSON.stringify(validEnvelope());

        const res = await asProxy(request(app)
            .post('/api/candidate-store/raw-ledger')
            .set('Content-Type', 'application/json')
            .set('x-cs-source', 'salestailor_ops_refactor')
            .set('x-cs-signature', 'deadbeef0000')
            .send(body));

        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/invalid HMAC signature/i);
    });

    it('source ヘッダー欠落 → 401', async () => {
        const { app } = makeApp();
        const body = JSON.stringify(validEnvelope());
        const sig = sign(SECRET, body);

        const res = await asProxy(request(app)
            .post('/api/candidate-store/raw-ledger')
            .set('Content-Type', 'application/json')
            .set('x-cs-signature', sig)
            .send(body));

        expect(res.status).toBe(401);
    });

    it('allowlist 外の source → 403', async () => {
        const { app } = makeApp({ allowedSources: ['mana_slack'] });
        const body = JSON.stringify(validEnvelope());
        const sig = sign(SECRET, body);

        const res = await asProxy(request(app)
            .post('/api/candidate-store/raw-ledger')
            .set('Content-Type', 'application/json')
            .set('x-cs-source', 'salestailor_ops_refactor')
            .set('x-cs-signature', sig)
            .send(body));

        expect(res.status).toBe(403);
    });

    it('source の HMAC secret 未設定 → 403', async () => {
        delete process.env.CANDIDATE_STORE_HMAC_SALESTAILOR_OPS_REFACTOR;
        const { app } = makeApp();
        const body = JSON.stringify(validEnvelope());
        const sig = sign('whatever', body);

        const res = await asProxy(request(app)
            .post('/api/candidate-store/raw-ledger')
            .set('Content-Type', 'application/json')
            .set('x-cs-source', 'salestailor_ops_refactor')
            .set('x-cs-signature', sig)
            .send(body));

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/no HMAC secret/);
    });

    it('envelope 必須フィールド欠落 → 400', async () => {
        const { app } = makeApp();
        const broken = validEnvelope();
        delete broken.evidence_ref;
        const body = JSON.stringify(broken);
        const sig = sign(SECRET, body);

        const res = await asProxy(request(app)
            .post('/api/candidate-store/raw-ledger')
            .set('Content-Type', 'application/json')
            .set('x-cs-source', 'salestailor_ops_refactor')
            .set('x-cs-signature', sig)
            .send(body));

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('invalid envelope');
        expect(res.body.details.some((d) => d.includes('evidence_ref'))).toBe(true);
    });

    it('header の x-cs-source と envelope.source_system が不一致 → 400', async () => {
        const { app } = makeApp();
        const body = JSON.stringify(validEnvelope({ source_system: 'mana_slack' }));
        const sig = sign(SECRET, body);

        const res = await asProxy(request(app)
            .post('/api/candidate-store/raw-ledger')
            .set('Content-Type', 'application/json')
            .set('x-cs-source', 'salestailor_ops_refactor')
            .set('x-cs-signature', sig)
            .send(body));

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/does not match/);
    });

    it('同じ raw_event_id を 2 回投函 → 1 件目 202、 2 件目も 202 (idempotent、 duplicate は無視)', async () => {
        const { app, candidateRepository } = makeApp();
        const env = validEnvelope({ raw_event_id: 'raw_dup_001' });
        const body = JSON.stringify(env);
        const sig = sign(SECRET, body);

        const res1 = await asProxy(request(app)
            .post('/api/candidate-store/raw-ledger')
            .set('Content-Type', 'application/json')
            .set('x-cs-source', 'salestailor_ops_refactor')
            .set('x-cs-signature', sig)
            .send(body));
        expect(res1.status).toBe(202);

        const res2 = await asProxy(request(app)
            .post('/api/candidate-store/raw-ledger')
            .set('Content-Type', 'application/json')
            .set('x-cs-source', 'salestailor_ops_refactor')
            .set('x-cs-signature', sig)
            .send(body));
        expect(res2.status).toBe(202);

        const candidates = await candidateRepository.list({});
        expect(candidates.length).toBe(1);
    });
});
