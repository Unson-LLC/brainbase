import { createHmac } from 'node:crypto';

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createJudgmentResolutionRouter } from '../../server/routes/judgment-resolution.js';
import {
    JudgmentResolutionService,
    canonicalJson,
    computeRequestDigest
} from '../../server/services/judgment-resolution-service.js';

const SECRET = 'test-binding-secret';
const NOW = new Date('2026-08-07T00:00:00.000Z');

function body(overrides = {}) {
    const requestText = overrides.request ?? 'この文章の意味を説明して';
    const turnId = overrides.turn_id ?? 'host-turn-api';
    const hasProjectCode = Object.hasOwn(overrides, 'project_code');
    const projectCode = hasProjectCode ? overrides.project_code : 'brainbase';
    const contextWithoutDigest = {
        schema_version: 'brainbase-conversation-context-v1',
        session_ref: 'b'.repeat(64),
        messages: [{ sequence: 0, turn_id: turnId, role: 'user', phase: null, text: requestText }],
        prior_receipts: [],
        runtime: { host: 'codex', model: 'gpt-5', permission_mode: 'workspace-write', project_binding: projectCode ?? null },
        instruction_bindings: [],
        completeness: 'complete'
    };
    const { request: _request, turn_id: _turnId, project_code: _projectCode, ...rest } = overrides;
    return {
        request: requestText,
        turn_id: turnId,
        ...(projectCode === undefined ? {} : { project_code: projectCode }),
        conversation_context: { ...contextWithoutDigest, source_digest: computeRequestDigest(contextWithoutDigest) },
        model_interpretation: {
            intent: 'answer', domains: ['general'], action_kind: 'none', risk: 'low', confidence: 'confirmed', signals: []
        },
        ...rest
    };
}

function bindingHeaders(payload, issuedAt = NOW.toISOString()) {
    const requestDigest = computeRequestDigest(payload);
    const signaturePayload = canonicalJson([
        'brainbase-judgment-binding-v1', 'brainbase-mcp', '1', payload.turn_id, issuedAt, requestDigest
    ]);
    return {
        'x-brainbase-judgment-adapter': 'brainbase-mcp',
        'x-brainbase-judgment-version': '1',
        'x-brainbase-judgment-issued-at': issuedAt,
        'x-brainbase-judgment-request-digest': requestDigest,
        'x-brainbase-judgment-signature': createHmac('sha256', SECRET).update(signaturePayload).digest('hex')
    };
}

function app({ access, service, receiptWriter } = {}) {
    const value = express();
    value.use(express.json());
    value.use((req, _res, next) => {
        req.access = access || { personId: 'person_owner', tenantId: 'unson', projectCodes: ['brainbase'] };
        next();
    });
    value.use('/api/judgment', createJudgmentResolutionRouter({
        service: service || new JudgmentResolutionService({
            now: () => NOW, id: () => 'jr_api', personalOwnerPersonId: 'person_owner'
        }),
        bindingSecret: SECRET,
        now: () => NOW,
        receiptWriter
    }));
    return value;
}

describe('judgment resolution API', () => {
    // Trace: story-brainbase-judgment-resolver-v1:ac:1 story-brainbase-judgment-resolver-v1:ac:13
    it('valid bindingでrequest-bound managed receiptを返す', async () => {
        const payload = body();
        const response = await request(app()).post('/api/judgment/resolve').set(bindingHeaders(payload)).send(payload);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            resolution_id: 'jr_api', status: 'resolved', request_digest: computeRequestDigest(payload),
            host_binding: { adapter_id: 'brainbase-mcp', adapter_version: '1', status: 'managed', enforcement_level: 'host_contract' }
        });
    });

    it.each([
        ['missing signature', {}, 403],
        ['unregistered adapter', { 'x-brainbase-judgment-adapter': 'unknown' }, 403],
        ['version mismatch', { 'x-brainbase-judgment-version': '2' }, 403],
        ['request digest mismatch', { 'x-brainbase-judgment-request-digest': '0'.repeat(64) }, 403],
        ['invalid signature', { 'x-brainbase-judgment-signature': '0'.repeat(64) }, 403],
        ['malformed timestamp', { 'x-brainbase-judgment-issued-at': '2026-08-07T00:00:00Z' }, 403],
        ['future beyond skew', { 'x-brainbase-judgment-issued-at': '2026-08-07T00:00:30.001Z' }, 403],
        ['stale beyond age', { 'x-brainbase-judgment-issued-at': '2026-08-06T23:54:59.999Z' }, 403]
    ])('%sをfail closedにする', async (_label, overrides, expectedStatus) => {
        const payload = body();
        const headers = overrides['x-brainbase-judgment-issued-at']
            ? { ...bindingHeaders(payload, overrides['x-brainbase-judgment-issued-at']), ...overrides }
            : { ...bindingHeaders(payload), ...overrides };
        if (_label === 'missing signature') delete headers['x-brainbase-judgment-signature'];
        const response = await request(app()).post('/api/judgment/resolve').set(headers).send(payload);
        expect(response.status).toBe(expectedStatus);
        expect(response.body.error.code).toBe('judgment_host_binding_untrusted');
    });

    it.each([
        ['future equality', '2026-08-07T00:00:30.000Z'],
        ['age equality', '2026-08-06T23:55:00.000Z']
    ])('%s boundaryを許可する', async (_label, issuedAt) => {
        const payload = body();
        await request(app()).post('/api/judgment/resolve').set(bindingHeaders(payload, issuedAt)).send(payload).expect(200);
    });

    it('scope外projectでも判断自体は継続しproject policyだけを適用しない', async () => {
        const payload = body({ project_code: 'salestailor' });
        const response = await request(app()).post('/api/judgment/resolve').set(bindingHeaders(payload)).send(payload);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ status: 'resolved', project_code: 'salestailor' });
        expect(response.body.applicable_policies.some((policy) => policy.scope.type === 'project')).toBe(false);
    });

    it('confirmedな本人・組織・project scopeだけでraw receiptを保存してから返す', async () => {
        const receiptWriter = { record: vi.fn().mockResolvedValue(undefined) };
        const payload = body();
        const response = await request(app({ receiptWriter })).post('/api/judgment/resolve')
            .set(bindingHeaders(payload)).send(payload);

        expect(response.status).toBe(200);
        expect(receiptWriter.record).toHaveBeenCalledWith(expect.objectContaining({
            resolution_id: 'jr_api', turn_id: 'host-turn-api', project_code: 'brainbase'
        }), expect.objectContaining({ personId: 'person_owner', tenantId: 'unson', projectCodes: ['brainbase'] }));
    });

    it.each([
        ['scope外project', { personId: 'person_owner', tenantId: 'unson', projectCodes: ['brainbase'] }, body({ project_code: 'salestailor' })],
        ['tenant不明', { personId: 'person_owner', projectCodes: ['brainbase'] }, body()],
        ['tenant矛盾', { personId: 'person_owner', tenantId: 'unson', organizationId: 'other', projectCodes: ['brainbase'] }, body()],
        ['本人不明', { tenantId: 'unson', projectCodes: ['brainbase'] }, body()]
    ])('%sでは従来応答を維持しraw receiptを保存しない', async (_label, access, payload) => {
        const receiptWriter = { record: vi.fn() };
        const response = await request(app({ access, receiptWriter })).post('/api/judgment/resolve')
            .set(bindingHeaders(payload)).send(payload);

        expect(response.status).toBe(200);
        expect(receiptWriter.record).not.toHaveBeenCalled();
    });

    it('configured writerの故障を生情報なしの503へ写像する', async () => {
        const receiptWriter = { record: vi.fn().mockRejectedValue(new Error('postgres secret: database unavailable')) };
        const payload = body();
        const response = await request(app({ receiptWriter })).post('/api/judgment/resolve')
            .set(bindingHeaders(payload)).send(payload);

        expect(response.status).toBe(503);
        expect(response.body.error).toEqual({
            code: 'judgment_receipt_persistence_unavailable',
            message: 'Judgment receipt persistence is unavailable'
        });
        expect(JSON.stringify(response.body)).not.toContain('postgres secret');
    });

    it('invalid public inputを400へ写像する', async () => {
        const payload = body({ dag_ids: ['direct.v1'] });
        const response = await request(app()).post('/api/judgment/resolve').set(bindingHeaders(payload)).send(payload);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('judgment_resolution_input_invalid');
    });

    it('knowledge requestのproject不足を不完全handoffではなくclarificationへ写像する', async () => {
        const payload = body({
            request: 'Brainbaseの判断履歴を調べて',
            project_code: undefined,
            model_interpretation: {
                intent: 'investigate', domains: ['knowledge'], action_kind: 'read', risk: 'low', confidence: 'confirmed', signals: []
            }
        });
        const response = await request(app()).post('/api/judgment/resolve').set(bindingHeaders(payload)).send(payload);
        expect(response.status).toBe(200);
        expect(response.body.status).toBe('needs_classification');
        expect(response.body.reconciliation_reasons).toContain('knowledge_project_code_missing');
        expect(response.body.required_capabilities).toEqual([]);
    });

    it.each([
        ['different owner', 'person_other'],
        ['missing owner', null],
        ['service credential', 'internal_api']
    ])('personal judgmentを%sへ公開しない', async (_label, personId) => {
        const payload = body({
            request: '俺の思考アルゴリズムで判断して',
            model_interpretation: {
                intent: 'answer', domains: ['personal_judgment'], action_kind: 'none', risk: 'medium', confidence: 'confirmed', signals: []
            }
        });
        const response = await request(app({
            access: { personId, tenantId: 'unson', projectCodes: ['brainbase'] }
        })).post('/api/judgment/resolve').set(bindingHeaders(payload)).send(payload);
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('personal_judgment_not_accessible');
        expect(JSON.stringify(response.body)).not.toContain('owner.sato');
    });

    it('予期しないservice失敗を500へ写像する', async () => {
        const payload = body();
        const failingService = {
            hasHostBinding: () => true,
            resolve: () => { throw new Error('unexpected'); }
        };
        const response = await request(app({ service: failingService }))
            .post('/api/judgment/resolve').set(bindingHeaders(payload)).send(payload);
        expect(response.status).toBe(500);
        expect(response.body.error.code).toBe('judgment_resolution_failed');
    });
});
