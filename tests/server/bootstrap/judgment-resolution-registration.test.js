// @vitest-environment node

import express from 'express';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerJudgmentResolutionApiRoute } from '../../../server/bootstrap/register-api-routes.js';
import { csrfMiddleware } from '../../../server/middleware/csrf.js';
import { AuthService } from '../../../server/services/auth-service.js';
import { canonicalJson, computeRequestDigest } from '../../../server/services/judgment-resolution-service.js';
import { createPersonalKnowledgeAuthority } from '../../helpers/personal-knowledge-client-authority.js';

const secret = 'registration-secret';
const now = new Date('2026-08-07T00:00:00.000Z');
const contextWithoutDigest = {
    schema_version: 'brainbase-conversation-context-v1', session_ref: 'a'.repeat(64),
    messages: [{ sequence: 0, turn_id: 'turn-registration', role: 'user', phase: null, text: '意味を説明して' }],
    prior_receipts: [], runtime: { host: 'codex', model: 'gpt-5', permission_mode: 'workspace-write', project_binding: 'brainbase' },
    instruction_bindings: [], completeness: 'complete'
};
const payload = {
    request: '意味を説明して', turn_id: 'turn-registration', project_code: 'brainbase',
    conversation_context: { ...contextWithoutDigest, source_digest: computeRequestDigest(contextWithoutDigest) }
};

function headers() {
    const digest = computeRequestDigest(payload);
    const signaturePayload = canonicalJson(['brainbase-judgment-binding-v1', 'brainbase-mcp', '1', payload.turn_id, now.toISOString(), digest]);
    return {
        'x-brainbase-judgment-adapter': 'brainbase-mcp', 'x-brainbase-judgment-version': '1',
        'x-brainbase-judgment-issued-at': now.toISOString(), 'x-brainbase-judgment-request-digest': digest,
        'x-brainbase-judgment-signature': createHmac('sha256', secret).update(signaturePayload).digest('hex')
    };
}

function createApp({ receiptWriter, authService: authServiceOverride } = {}) {
    const resolve = vi.fn((input) => ({
        resolution_id: 'jr_registered', status: 'resolved', turn_id: input.turn_id, project_code: input.project_code
    }));
    const authService = authServiceOverride || {
        pool: { query: vi.fn().mockResolvedValue({ rows: [{ organization_id: 'unson' }] }) },
        verifyToken: vi.fn((token) => {
            if (token !== 'test-token') throw new Error('invalid token');
            return { sub: 'person_owner', tenantId: 'unson', role: 'ceo', projectCodes: ['brainbase'] };
        })
    };
    const app = express();
    app.use(express.json());
    app.use(csrfMiddleware());
    registerJudgmentResolutionApiRoute(app, {
        authService,
        service: { resolve, hasHostBinding: vi.fn(() => true) }, bindingSecret: secret, now: () => now, receiptWriter
    });
    return { app, resolve, authService };
}

describe('judgment resolution production API registration', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    it('unauthenticated requestをresolver前で拒否する', async () => {
        const { app, resolve } = createApp();
        const response = await request(app).post('/api/judgment/resolve').set(headers()).send(payload).expect(403);
        expect(response.body).toMatchObject({ message: 'CSRF token required' });
        expect(resolve).not.toHaveBeenCalled();
    });

    it('invalid BearerはCSRFを通過してもauth boundaryで拒否する', async () => {
        const { app, resolve } = createApp();
        await request(app).post('/api/judgment/resolve')
            .set('authorization', 'Bearer invalid-token').set(headers()).send(payload).expect(401);
        expect(resolve).not.toHaveBeenCalled();
    });

    it('Bearer exemptionを近接pathや別methodへ広げない', async () => {
        const { app } = createApp();
        await request(app).post('/api/judgment/resolve/other')
            .set('authorization', 'Bearer test-token').send(payload).expect(403);
        await request(app).put('/api/judgment/resolve')
            .set('authorization', 'Bearer test-token').send(payload).expect(403);
    });

    it('strict authとbinding検証後だけresolverを呼ぶ', async () => {
        const { app, resolve } = createApp();
        await request(app).post('/api/judgment/resolve').set('authorization', 'Bearer test-token').set(headers()).send(payload).expect(200);
        expect(resolve).toHaveBeenCalledOnce();
        expect(resolve.mock.calls[0][1]).toMatchObject({
            access: { personId: 'person_owner', tenantId: 'unson', projectCodes: ['brainbase'] },
            hostBinding: { status: 'managed' }
        });
    });

    it('service transportを署名済みSlack DM actorへrequest単位で束縛する', async () => {
        const authority = createPersonalKnowledgeAuthority({
            owner: 'person_owner', externalSubjectId: 'U_OWNER', requesterId: 'U_OWNER', now
        });
        const previous = Object.fromEntries(Object.keys(authority.env).map((key) => [key, process.env[key]]));
        Object.assign(process.env, authority.env);
        try {
            const authService = {
                verifyServiceToken: vi.fn(() => ({
                    sub: 'svc_mana', organizationId: 'unson', projectCodes: ['brainbase']
                }))
            };
            const { app, resolve } = createApp({ authService });
            await request(app).post('/api/judgment/resolve')
                .set('authorization', 'Bearer bbsvc_test')
                .set('x-brainbase-company-authority-response', Buffer.from(JSON.stringify(authority.response)).toString('base64url'))
                .set(headers()).send(payload).expect(200);
            expect(resolve.mock.calls[0][1].access).toMatchObject({
                personId: 'person_owner', organizationId: 'unson', slackUserId: 'U_OWNER'
            });
        } finally {
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });

    it('interactive tokenによるCompany Authority header注入を拒否する', async () => {
        const { app, resolve } = createApp();
        await request(app).post('/api/judgment/resolve')
            .set('authorization', 'Bearer test-token')
            .set('x-brainbase-company-authority-response', Buffer.from('{}').toString('base64url'))
            .set(headers()).send(payload).expect(403);
        expect(resolve).not.toHaveBeenCalled();
    });

    it('改ざんされたCompany Authorityを拒否する', async () => {
        const authority = createPersonalKnowledgeAuthority({
            owner: 'person_owner', externalSubjectId: 'U_OWNER', requesterId: 'U_OWNER', now
        });
        authority.response.context.actor.canonical_person_id = 'person_attacker';
        const previous = Object.fromEntries(Object.keys(authority.env).map((key) => [key, process.env[key]]));
        Object.assign(process.env, authority.env);
        try {
            const { app, resolve } = createApp({
                authService: { verifyServiceToken: vi.fn(() => ({ sub: 'svc_mana', projectCodes: ['brainbase'] })) }
            });
            await request(app).post('/api/judgment/resolve')
                .set('authorization', 'Bearer bbsvc_test')
                .set('x-brainbase-company-authority-response', Buffer.from(JSON.stringify(authority.response)).toString('base64url'))
                .set(headers()).send(payload).expect(403);
            expect(resolve).not.toHaveBeenCalled();
        } finally {
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });

    it('任意のreceiptWriterを認証後のrouterへ伝搬する', async () => {
        const receiptWriter = { record: vi.fn().mockResolvedValue(undefined) };
        const { app } = createApp({ receiptWriter });
        await request(app).post('/api/judgment/resolve')
            .set('authorization', 'Bearer test-token').set(headers()).send(payload).expect(200);
        expect(receiptWriter.record).toHaveBeenCalledWith(
            expect.objectContaining({ resolution_id: 'jr_registered', project_code: 'brainbase' }),
            expect.objectContaining({ personId: 'person_owner', tenantId: 'unson', projectCodes: ['brainbase'] })
        );
    });

    it('登録済みrouterがbearerのtarget project grantだけを保存用accessへ反映する', async () => {
        const receiptWriter = { record: vi.fn().mockResolvedValue(undefined) };
        const pool = {
            query: vi.fn()
                .mockResolvedValueOnce({ rows: [{ organization_id: 'techknight' }] })
                .mockResolvedValueOnce({ rows: [{
                    organization_id: 'techknight',
                    person_id: 'person_owner',
                    slack_user_id: 'U_OWNER',
                    slack_workspace_id: 'T_UNSON',
                    role: 'ceo',
                    project_codes: ['brainbase'],
                    clearance: ['internal', 'restricted']
                }] })
        };
        const authService = Object.create(AuthService.prototype);
        authService.pool = pool;
        authService.verifyToken = vi.fn((token) => {
            if (token !== 'test-token') throw new Error('invalid token');
            return {
                sub: 'person_owner', tenantId: 'unson', role: 'member', projectCodes: ['brainbase'],
                clearance: ['internal', 'finance'], slackUserId: 'U_OWNER', slackWorkspaceId: 'T_UNSON'
            };
        });
        const { app, resolve } = createApp({ receiptWriter, authService });

        const response = await request(app).post('/api/judgment/resolve')
            .set('authorization', 'Bearer test-token').set(headers()).send(payload).expect(200);

        expect(response.body).toMatchObject({ resolution_id: 'jr_registered', project_code: 'brainbase' });
        expect(resolve.mock.calls[0][1]).toMatchObject({
            access: {
                tenantId: 'unson', projectCodes: ['brainbase'], role: 'member', personId: 'person_owner'
            }
        });
        expect(receiptWriter.record).toHaveBeenCalledWith(
            expect.objectContaining({ resolution_id: 'jr_registered', project_code: 'brainbase' }),
            {
                personId: 'person_owner', role: 'member', projectCodes: ['brainbase'], clearance: ['internal'],
                organizationId: 'techknight', tenantId: 'techknight', slackUserId: 'U_OWNER', slackWorkspaceId: 'T_UNSON'
            }
        );
        expect(pool.query).toHaveBeenCalledTimes(2);
        expect(pool.query.mock.calls[1][1]).toEqual([
            'techknight', 'U_OWNER', 'T_UNSON', 'person_owner', 'brainbase'
        ]);
    });
});
