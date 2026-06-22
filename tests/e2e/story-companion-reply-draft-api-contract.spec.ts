import { expect, test } from '@playwright/test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

import { requireAuth } from '../../server/middleware/auth.js';
import { csrfMiddleware } from '../../server/middleware/csrf.js';
import { createCompanionRouter } from '../../server/routes/companion.js';
import { ReplyDraftService } from '../../server/services/companion/reply-draft-service.js';

const VALID_REQUEST = {
    provider: 'gmail',
    accountName: 'keigo@example.com',
    sourceTitle: 'Inbox message',
    sourceURL: 'https://mail.google.com/mail/u/0/#inbox/thread-1',
    sourceDedupeKey: 'gmail:thread-1',
    providerMessageID: 'msg-1',
    providerThreadID: 'thread-1',
    sender: {
        name: 'Example Sender',
        email: 'sender@example.com'
    },
    subject: 'Brainbase companion reply draft',
    snippet: 'Could you send a reply draft?',
    threadMessages: [
        {
            sender: 'Example Sender <sender@example.com>',
            body: 'Please share the next step.'
        }
    ],
    classificationReason: 'User asked for a reply draft.',
    classificationEvidence: ['reply_requested'],
    userInstruction: 'Keep it concise and mention that I will confirm details.',
    contextPolicy: 'brainbase_workflow',
    workflowName: 'brainbase.reply_draft'
};

const CONTEXT_REQUEST = {
    ...VALID_REQUEST,
    workflowName: 'brainbase.reply_context'
};

function createInProcessApp({ configureGenerator = true, useCsrf = false, infoSSOTService: injectedInfoSSOTService } = {}) {
    const infoSSOTService = injectedInfoSSOTService || {
        getContext: async () => ({
            meta: { entity_count: 2 },
            report: { meta: { node_count: 2, edge_count: 1 } }
        })
    };
    const learningService = {
        searchPersonalKgCandidates: async () => ([{
            id: 'mem_1',
            body: 'Prefer concise replies with clear next action.',
            cognitive_type: 'preference'
        }])
    };
    const draftGenerator = {
        generate: async ({ request: handoff, context }) => ({
            body: `Draft for ${handoff.subject}: I will confirm details and follow up.`,
            rationale: [
                `saw ${context.threadMessages.length} thread messages`,
                `instruction: ${handoff.userInstruction}`
            ],
            openQuestions: []
        })
    };
    const authService = {
        verifyToken: () => ({
            role: 'gm',
            projectCodes: ['brainbase'],
            clearance: ['internal', 'restricted'],
            personId: 'per_keigo'
        })
    };
    const app = express();
    app.use(express.json());
    if (useCsrf) {
        app.use(csrfMiddleware());
    }
    app.use('/api/companion', createCompanionRouter({
        replyDraftService: new ReplyDraftService({
            infoSSOTService,
            learningService,
            draftGenerator: configureGenerator ? draftGenerator : undefined
        }),
        authGuard: requireAuth(authService),
        accessGuardOptions: {
            ownerPersonId: 'sato_keigo',
            ownerAliasIds: ['per_keigo']
        }
    }));
    return app;
}

test('story-companion-reply-draft-api ac:6 unauthenticated native handoff is rejected', async () => {
    // **ac:6 auth-required**: Missing or invalid auth is rejected; the endpoint is not public.
    // S-001: workflow state transition: handoff_received with missing or invalid auth returns 401 before Graph or Personal KG work.
    // SCN-001: workflow state transition: handoff_received with missing or invalid auth returns 401 before Graph or Personal KG work.
    const response = await request(createInProcessApp())
        .post('/api/companion/reply-context')
        .send(CONTEXT_REQUEST)
        .expect(401);

    assert.equal(response.status, 401, 'story-companion-reply-draft-api ac:6 **ac:6 auth-required**: Missing or invalid auth is rejected; the endpoint is not public.');
    expect(response.body, 'story-companion-reply-draft-api S-001 SCN-001 ac:6 missing auth is rejected before context or generation').toMatchObject({
        error: 'Authorization token required'
    });
});

test('story-companion-reply-draft-api ac:1 ac:2 ac:5 ac:7 authenticated handoff reaches Brainbase context boundary without CSRF block', async () => {
    // **ac:1 route**: Brainbase exposes `POST /api/companion/reply-context` and does not return 404 for the Mac handoff path.
    // **ac:2 request-shape**: The endpoint accepts the Mac `DraftHandoffRequest` fields, including `userInstruction`, `threadMessages`, `contextPolicy=brainbase_workflow`, and `workflowName=brainbase.reply_context`.
    // **ac:5 structured-failure**: If Graph/Personal KG context cannot be loaded, the endpoint fails loudly with a structured error.
    // **ac:7 native-csrf**: Native/server-to-server companion POSTs are not blocked by browser CSRF middleware before auth.
    // S-002: workflow state transition: authenticated handoff moves from handoff_received to context_resolving, then Graph or Personal KG failure returns structured 503 context_unavailable.
    // S-005: workflow state transition: native companion POST without browser CSRF token passes CSRF middleware and then auth or context handling determines the response.
    // SCN-002: workflow state transition: authenticated handoff moves from handoff_received to context_resolving, then Graph or Personal KG failure returns structured 503 context_unavailable.
    // SCN-005: workflow state transition: native companion POST without browser CSRF token passes CSRF middleware and then auth or context handling determines the response.
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const app = createInProcessApp({
        useCsrf: true,
        infoSSOTService: {
            getContext: async () => {
                throw new Error('Graph unavailable');
            }
        }
    });

    const response = await request(app)
        .post('/api/companion/reply-context')
        .set('Authorization', 'Bearer user-token')
        .send(CONTEXT_REQUEST)
        .expect(503);
    process.env.NODE_ENV = prev;
    const body = response.body;

    assert.notEqual(response.status, 404, 'story-companion-reply-draft-api ac:1 **ac:1 route**: Brainbase exposes `POST /api/companion/reply-context` and does not return 404 for the Mac handoff path.');
    assert.notEqual(body.code, 'invalid_request', 'story-companion-reply-draft-api ac:2 **ac:2 request-shape**: The endpoint accepts the Mac `DraftHandoffRequest` fields, including `userInstruction`, `threadMessages`, `contextPolicy=brainbase_workflow`, and `workflowName=brainbase.reply_context`.');
    assert.equal(body.code, 'context_unavailable', 'story-companion-reply-draft-api ac:5 **ac:5 structured-failure**: If Graph/Personal KG context cannot be loaded, the endpoint fails loudly with a structured error.');
    assert.notEqual(body.code, 'csrf_required', 'story-companion-reply-draft-api ac:7 **ac:7 native-csrf**: Native/server-to-server companion POSTs are not blocked by browser CSRF middleware before auth.');
    expect(body, 'story-companion-reply-draft-api S-002 SCN-002 ac:5 context unavailable failures are structured').toMatchObject({
        error: expect.any(String),
        code: 'context_unavailable'
    });
    expect(body.code, 'ac:2 Mac DraftHandoffRequest shape reaches service validation/context handling instead of request-shape rejection').not.toBe('invalid_request');
    expect(body.code).not.toBe('csrf_required');
});

test('story-companion-reply-draft-api ac:6 ac:7 cookie-authenticated browser handoff is rejected on the CSRF-less native path', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
        const response = await request(createInProcessApp({ useCsrf: true }))
            .post('/api/companion/reply-context')
            .set('Cookie', 'brainbase_session=user-token')
            .send(CONTEXT_REQUEST)
            .expect(403);

        assert.equal(response.body.code, 'server_to_server_auth_required', 'story-companion-reply-draft-api ac:6 **ac:6 auth-required**: Missing or invalid auth is rejected; the endpoint is not public.');
        assert.equal(response.body.code, 'server_to_server_auth_required', 'story-companion-reply-draft-api ac:7 **ac:7 native-csrf**: Native/server-to-server companion POSTs are not blocked by browser CSRF middleware before auth, but browser cookie auth is rejected on this CSRF-less path.');
    } finally {
        process.env.NODE_ENV = prev;
    }
});

test('story-companion-reply-draft-api ac:3 ac:4 ac:8 fake generator returns safe DraftHandoffResult', async () => {
    // **ac:3 brainbase-context**: Brainbase API resolves Graph SSOT and Personal KG context server-side; the Mac app does not expand owner-only Personal KG.
    // **ac:4 success-result**: With an injected draft generator, the endpoint returns a Mac-compatible `DraftHandoffResult`.
    // **ac:8 draft-only-writeback**: The writeback intent is always draft-only: human approval is required and sending is not allowed.
    // S-004: workflow state transition: context_resolved with an injected generator returns draft_ready as DraftHandoffResult with requiresHumanApproval true and sendAllowed false.
    // SCN-004: workflow state transition: context_resolved with an injected generator returns draft_ready as DraftHandoffResult with requiresHumanApproval true and sendAllowed false.
    const response = await request(createInProcessApp())
        .post('/api/companion/reply-draft')
        .set('Authorization', 'Bearer user-token')
        .send(VALID_REQUEST)
        .expect(200);

    assert.ok(response.body.rationale.some((item) => item.includes('Graph SSOT context loaded')), 'story-companion-reply-draft-api ac:3 **ac:3 brainbase-context**: Brainbase API resolves Graph SSOT and Personal KG context server-side; the Mac app does not expand owner-only Personal KG.');
    assert.ok(response.body.body.includes('Draft for Brainbase companion reply draft'), 'story-companion-reply-draft-api ac:4 **ac:4 success-result**: With an injected draft generator, the endpoint returns a Mac-compatible `DraftHandoffResult`.');
    assert.equal(response.body.writebackIntent.sendAllowed, false, 'story-companion-reply-draft-api ac:8 **ac:8 draft-only-writeback**: The writeback intent is always draft-only: human approval is required and sending is not allowed.');
    expect(response.body.body, 'story-companion-reply-draft-api S-004 SCN-004 context_resolved injected generator returns draft_ready DraftHandoffResult body').toContain('Draft for Brainbase companion reply draft');
    expect(response.body.rationale, 'story-companion-reply-draft-api ac:3 Brainbase-side Graph/Personal KG context rationale is included').toEqual(expect.arrayContaining([
        expect.stringContaining('Graph SSOT context loaded'),
        expect.stringContaining('Personal KG search completed')
    ]));
    expect(response.body.writebackIntent, 'story-companion-reply-draft-api S-004 SCN-004 DraftHandoffResult requiresHumanApproval true and sendAllowed false').toMatchObject({
        provider: 'gmail',
        itemID: 'msg-1',
        targetDedupeKey: 'gmail:thread-1',
        requiresHumanApproval: true,
        sendAllowed: false
    });
});

test('story-companion-reply-draft-api ac:3 companion reply context returns Brainbase context without a hosted draft generator', async () => {
    const response = await request(createInProcessApp({ configureGenerator: false }))
        .post('/api/companion/reply-context')
        .set('Authorization', 'Bearer user-token')
        .send(CONTEXT_REQUEST)
        .expect(200);

    expect(response.body.workflowName, 'Brainbase is the context provider for Mac-side draft generation').toBe('brainbase.reply_context');
    expect(response.body.auditID).toMatch(/^ctx_/);
    expect(response.body.contextSnippets).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: 'graph_ssot' }),
        expect.objectContaining({ source: 'personal_kg' })
    ]));
    expect(response.body.guidance).toMatchObject({
        replyPrinciples: expect.any(Array),
        cautions: expect.arrayContaining([
            expect.stringContaining('Mac Companion')
        ]),
        openQuestions: []
    });
});

test('story-companion-reply-draft-api SCN-003 unconfigured generator fails loudly', async () => {
    // S-003: workflow state transition: context_resolved with no configured draft generator returns structured 503 generator_unconfigured rather than a canned reply.
    // SCN-003: workflow state transition: context_resolved with no configured draft generator returns structured 503 generator_unconfigured rather than a canned reply.
    const response = await request(createInProcessApp({ configureGenerator: false }))
        .post('/api/companion/reply-draft')
        .set('Authorization', 'Bearer user-token')
        .send(VALID_REQUEST)
        .expect(503);

    expect(response.body, 'story-companion-reply-draft-api S-003 SCN-003 generator_unconfigured is structured and not a canned reply').toMatchObject({
        error: 'Draft generator is not configured',
        code: 'generator_unconfigured'
    });
});
