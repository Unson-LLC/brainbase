import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { requireAuth } from '../../../server/middleware/auth.js';
import { createCompanionRouter } from '../../../server/routes/companion.js';
import { registerApiRoutes } from '../../../server/bootstrap/register-api-routes.js';
import { ReplyDraftService } from '../../../server/services/companion/reply-draft-service.js';

function createPayload(overrides = {}) {
    return {
        provider: 'gmail',
        accountName: 'work',
        sourceTitle: 'Inbox',
        sourceURL: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
        sourceDedupeKey: 'gmail:thread-1',
        providerMessageID: 'msg-1',
        providerThreadID: 'thread-1',
        sender: { name: 'Sender User', email: 'sender@example.com' },
        subject: 'Partnership follow-up',
        snippet: 'Can you send the next proposal?',
        threadMessages: [
            { sender: 'Sender User', body: 'Can you send the next proposal by Friday?' },
            { sender: 'Keigo Sato', body: 'I will review the context.' }
        ],
        classificationReason: 'Direct reply request',
        classificationEvidence: ['Question in latest message'],
        userInstruction: 'Keep it concise and mention next steps.',
        contextPolicy: 'brainbase_workflow',
        workflowName: 'brainbase.reply_draft',
        ...overrides
    };
}

function createAuthService({ valid = true, personId = 'per_keigo', organizationId = 'unson' } = {}) {
    return {
        verifyToken: vi.fn(() => {
            if (!valid) throw new Error('invalid');
            return {
                role: 'gm',
                projectCodes: ['brainbase'],
                clearance: ['internal', 'restricted'],
                personId,
                organizationId
            };
        })
    };
}

function createApp({
    service,
    authService = createAuthService(),
    accessGuardOptions = {
        ownerPersonId: 'sato_keigo',
        ownerAliasIds: ['per_keigo']
    }
}) {
    const app = express();
    app.use(express.json());
    app.use('/api/companion', createCompanionRouter({
        replyDraftService: service,
        authGuard: requireAuth(authService),
        accessGuardOptions
    }));
    return app;
}

function createBootstrapApp({ authService = createAuthService(), infoSSOTService, learningService }) {
    const app = express();
    app.use(express.json());
    registerApiRoutes(app, {
        stateStore: {},
        sessionServices: {
            runtime: {
                registry: {},
                query: {},
                reconciler: {}
            },
            workspace: {}
        },
        testMode: true,
        configParser: {},
        configService: {},
        runtimePaths: { varDir: '/tmp' },
        scheduleParser: {},
        googleCalendarService: {},
        worktreeService: {},
        conversationLinker: {},
        projectsRoot: '/tmp',
        tmuxCaptureCache: {},
        authService,
        infoSSOTService,
        learningService,
        learningHealthService: {},
        candidateRepository: null,
        wikiService: {},
        tokenUsageService: {},
        workflowService: {},
        externalRunnerIngestService: {},
        uploadMiddleware: (_req, _res, next) => next(),
        appVersion: 'test',
        workspaceRoot: '/tmp',
        uploadsDir: '/tmp/uploads',
        runtimeInfo: {},
        brainbaseRoot: '/tmp',
        canonicalTaskStoreConfig: {
            ownerPersonId: 'sato_keigo',
            ownerAliasIds: ['per_keigo']
        }
    });
    return app;
}

describe('companion reply draft route', () => {
    let infoSSOTService;
    let learningService;
    let draftGenerator;
    let service;

    beforeEach(() => {
        infoSSOTService = {
            getContext: vi.fn(async () => ({
                meta: { entity_count: 3 },
                report: { meta: { node_count: 3, edge_count: 2 } },
                philosophy_context: { prompt_block: 'Brainbase Philosophy Context' }
            }))
        };
        learningService = {
            searchPersonalKgCandidates: vi.fn(async ({ query }) => ([{
                id: `mem_${query.replace(/[^a-z0-9]/gi, '_').slice(0, 12)}`,
                cognitive_type: 'preference',
                body: 'Prefer concise replies that make the next action clear.',
                confidence: 0.9,
                source_system: 'test'
            }]))
        };
        draftGenerator = {
            generate: vi.fn(async () => ({
                body: 'Thanks for reaching out. I will send the proposal by Friday.',
                rationale: ['Generator used resolved Brainbase context'],
                openQuestions: []
            }))
        };
        service = new ReplyDraftService({
            infoSSOTService,
            learningService,
            draftGenerator
        });
    });

    it('S-1 INV-2: returns DraftHandoffResult for an authenticated request', async () => {
        const app = createApp({ service });

        const res = await request(app)
            .post('/api/companion/reply-draft')
            .set('Authorization', 'Bearer user-token')
            .send(createPayload())
            .expect(200);

        expect(res.body.body).toContain('proposal');
        expect(res.body.rationale).toEqual(expect.arrayContaining([
            expect.stringContaining('Graph SSOT context loaded'),
            expect.stringContaining('Personal KG search completed'),
            'Generator used resolved Brainbase context'
        ]));
        expect(res.body.openQuestions).toEqual([]);
        expect(res.body.sourceURL).toBe('https://mail.google.com/mail/u/0/#inbox/msg-1');
        expect(res.body.auditID).toMatch(/^aud_/);
        expect(infoSSOTService.getContext).toHaveBeenCalledWith(expect.objectContaining({
            role: 'gm',
            projectCodes: ['brainbase']
        }), expect.objectContaining({
            projectCode: 'brainbase',
            includePhilosophy: true,
            includeEdges: true,
            objectType: 'reply_draft'
        }));
        expect(learningService.searchPersonalKgCandidates).toHaveBeenCalled();
    });

    it('S-2 INV-7: passes userInstruction and threadMessages to the generator', async () => {
        const app = createApp({ service });
        const payload = createPayload({
            userInstruction: 'Use a warm but direct tone.',
            threadMessages: [{ sender: 'A', body: 'First' }, { sender: 'B', body: 'Second' }]
        });

        await request(app)
            .post('/api/companion/reply-draft')
            .set('Authorization', 'Bearer user-token')
            .send(payload)
            .expect(200);

        expect(draftGenerator.generate).toHaveBeenCalledWith(expect.objectContaining({
            userInstruction: 'Use a warm but direct tone.',
            threadMessages: payload.threadMessages,
            request: expect.objectContaining({ threadMessages: payload.threadMessages }),
            context: expect.objectContaining({ threadMessages: payload.threadMessages })
        }));
    });

    it('returns reply context without requiring a Brainbase-hosted draft generator', async () => {
        const app = createApp({
            service: new ReplyDraftService({ infoSSOTService, learningService })
        });

        const res = await request(app)
            .post('/api/companion/reply-context')
            .set('Authorization', 'Bearer user-token')
            .send(createPayload({ workflowName: 'brainbase.reply_context' }))
            .expect(200);

        expect(res.body).toMatchObject({
            contextPolicy: 'brainbase_workflow',
            workflowName: 'brainbase.reply_context',
            sourceURL: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
            guidance: {
                cautions: expect.arrayContaining([
                    expect.stringContaining('Mac Companion側の人間承認')
                ]),
                openQuestions: []
            }
        });
        expect(res.body.auditID).toMatch(/^ctx_/);
        expect(res.body.rationale).toEqual(expect.arrayContaining([
            expect.stringContaining('Graph SSOT context loaded'),
            expect.stringContaining('Personal KG search completed')
        ]));
        expect(res.body.contextSnippets).toEqual(expect.arrayContaining([
            expect.objectContaining({
                source: 'graph_ssot',
                title: 'Graph SSOT'
            }),
            expect.objectContaining({
                source: 'personal_kg',
                title: 'preference',
                text: expect.stringContaining('Prefer concise replies')
            })
        ]));
        expect(res.body.guidance.replyPrinciples).toEqual(expect.arrayContaining([
            expect.stringContaining('Prefer concise replies')
        ]));
        expect(draftGenerator.generate).not.toHaveBeenCalled();
    });

    it('rejects reply-context requests that use the old reply draft workflow name', async () => {
        const app = createApp({
            service: new ReplyDraftService({ infoSSOTService, learningService })
        });

        const res = await request(app)
            .post('/api/companion/reply-context')
            .set('Authorization', 'Bearer user-token')
            .send(createPayload({ workflowName: 'brainbase.reply_draft' }))
            .expect(400);

        expect(res.body).toMatchObject({
            code: 'invalid_request',
            details: { field: 'workflowName' }
        });
    });

    it('INV-3 INV-4: always returns safe draft-only writeback intent', async () => {
        const app = createApp({ service });

        const res = await request(app)
            .post('/api/companion/reply-draft')
            .set('Authorization', 'Bearer user-token')
            .send(createPayload())
            .expect(200);

        expect(res.body.writebackIntent).toEqual({
            provider: 'gmail',
            itemID: 'msg-1',
            targetDedupeKey: 'gmail:thread-1',
            sourceURL: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
            requiresHumanApproval: true,
            sendAllowed: false
        });
    });

    it('S-3 INV-5: returns structured failure when Personal KG lookup fails', async () => {
        learningService.searchPersonalKgCandidates.mockRejectedValueOnce(new Error('database unavailable'));
        const app = createApp({ service });

        const res = await request(app)
            .post('/api/companion/reply-draft')
            .set('Authorization', 'Bearer user-token')
            .send(createPayload())
            .expect(503);

        expect(res.body).toEqual({
            error: 'Personal KG context unavailable',
            code: 'context_unavailable',
            details: {
                source: 'personal_kg',
                message: 'database unavailable'
            }
        });
        expect(draftGenerator.generate).not.toHaveBeenCalled();
    });

    it('S-3 INV-5: returns structured failure when Graph lookup fails', async () => {
        infoSSOTService.getContext.mockRejectedValueOnce(new Error('graph unavailable'));
        const app = createApp({ service });

        const res = await request(app)
            .post('/api/companion/reply-draft')
            .set('Authorization', 'Bearer user-token')
            .send(createPayload())
            .expect(503);

        expect(res.body).toEqual({
            error: 'Graph context unavailable',
            code: 'context_unavailable',
            details: {
                source: 'graph',
                message: 'graph unavailable'
            }
        });
        expect(draftGenerator.generate).not.toHaveBeenCalled();
    });

    it('S-3 INV-5: returns structured failure when Graph resolver is missing', async () => {
        const app = createApp({
            service: new ReplyDraftService({ learningService, draftGenerator })
        });

        const res = await request(app)
            .post('/api/companion/reply-draft')
            .set('Authorization', 'Bearer user-token')
            .send(createPayload())
            .expect(503);

        expect(res.body).toEqual({
            error: 'Graph context resolver is not configured',
            code: 'context_unavailable',
            details: { source: 'graph' }
        });
        expect(draftGenerator.generate).not.toHaveBeenCalled();
    });

    it('S-3 INV-5: returns structured failure when Personal KG resolver is missing', async () => {
        const app = createApp({
            service: new ReplyDraftService({ infoSSOTService, draftGenerator })
        });

        const res = await request(app)
            .post('/api/companion/reply-draft')
            .set('Authorization', 'Bearer user-token')
            .send(createPayload())
            .expect(503);

        expect(res.body).toEqual({
            error: 'Personal KG resolver is not configured',
            code: 'context_unavailable',
            details: { source: 'personal_kg' }
        });
        expect(draftGenerator.generate).not.toHaveBeenCalled();
    });

    it('INV-6: returns structured failure when generator is not configured', async () => {
        const app = createApp({
            service: new ReplyDraftService({ infoSSOTService, learningService })
        });

        const res = await request(app)
            .post('/api/companion/reply-draft')
            .set('Authorization', 'Bearer user-token')
            .send(createPayload())
            .expect(503);

        expect(res.body).toEqual({
            error: 'Draft generator is not configured',
            code: 'generator_unconfigured',
            details: {}
        });
    });

    it('S-4 INV-1: rejects missing auth', async () => {
        const app = createApp({ service });

        await request(app)
            .post('/api/companion/reply-draft')
            .send(createPayload())
            .expect(401);
    });

    it('S-4 INV-1: rejects invalid bearer token', async () => {
        const app = createApp({
            service,
            authService: createAuthService({ valid: false })
        });

        await request(app)
            .post('/api/companion/reply-draft')
            .set('Authorization', 'Bearer bad-token')
            .send(createPayload())
            .expect(401);
    });

    it('S-4 INV-1: rejects cookie-authenticated companion handoff on the CSRF-less native path', async () => {
        const app = createApp({ service });

        const res = await request(app)
            .post('/api/companion/reply-draft')
            .set('Cookie', 'brainbase_session=user-token')
            .send(createPayload())
            .expect(403);

        expect(res.body).toMatchObject({
            error: 'server_to_server_auth_required',
            code: 'server_to_server_auth_required'
        });
        expect(infoSSOTService.getContext).not.toHaveBeenCalled();
        expect(learningService.searchPersonalKgCandidates).not.toHaveBeenCalled();
    });

    it('S-4 INV-1: rejects non-owner bearer tokens before owner-visible Personal KG lookup', async () => {
        const app = createApp({
            service,
            authService: createAuthService({ personId: 'per_other' })
        });

        const res = await request(app)
            .post('/api/companion/reply-draft')
            .set('Authorization', 'Bearer other-user-token')
            .send(createPayload())
            .expect(403);

        expect(res.body).toMatchObject({
            error: 'personal_kg_owner_required',
            code: 'personal_kg_owner_required'
        });
        expect(infoSSOTService.getContext).not.toHaveBeenCalled();
        expect(learningService.searchPersonalKgCandidates).not.toHaveBeenCalled();
    });

    it('fails closed when no Personal KG owner is configured', async () => {
        const app = createApp({
            service,
            authService: createAuthService({ personId: 'sato_keigo' }),
            accessGuardOptions: { ownerPersonId: null, ownerAliasIds: [] }
        });

        const res = await request(app)
            .post('/api/companion/reply-draft')
            .set('Authorization', 'Bearer user-token')
            .send(createPayload())
            .expect(403);

        expect(res.body.code).toBe('personal_kg_owner_required');
        expect(infoSSOTService.getContext).not.toHaveBeenCalled();
        expect(learningService.searchPersonalKgCandidates).not.toHaveBeenCalled();
    });

    it('ac:1: registers /api/companion/reply-context through registerApiRoutes production bootstrap surface', async () => {
        const app = createBootstrapApp({
            authService: createAuthService({ personId: 'sato_keigo' }),
            infoSSOTService,
            learningService
        });

        const res = await request(app)
            .post('/api/companion/reply-context')
            .set('Authorization', 'Bearer user-token')
            .send(createPayload({ workflowName: 'brainbase.reply_context' }))
            .expect(200);

        expect(res.status).not.toBe(404);
        expect(res.body).toMatchObject({
            workflowName: 'brainbase.reply_context'
        });
        expect(infoSSOTService.getContext).toHaveBeenCalled();
        expect(learningService.searchPersonalKgCandidates).toHaveBeenCalled();
    });

    it('ac:1: keeps /api/companion/reply-draft registered for compatibility', async () => {
        const app = createBootstrapApp({
            authService: createAuthService({ personId: 'sato_keigo' }),
            infoSSOTService,
            learningService
        });

        const res = await request(app)
            .post('/api/companion/reply-draft')
            .set('Authorization', 'Bearer user-token')
            .send(createPayload())
            .expect(503);

        expect(res.status).not.toBe(404);
        expect(res.body).toMatchObject({
            error: 'Draft generator is not configured',
            code: 'generator_unconfigured'
        });
        expect(infoSSOTService.getContext).toHaveBeenCalled();
        expect(learningService.searchPersonalKgCandidates).toHaveBeenCalled();
    });
});
