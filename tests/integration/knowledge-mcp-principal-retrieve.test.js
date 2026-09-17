import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { registerKnowledgeCatalogApiRoute } from '../../server/bootstrap/register-api-routes.js';
import { KnowledgeCatalogService } from '../../server/services/knowledge-catalog-service.js';
import { __testing as mcpServerTesting } from '../../mcp/brainbase/src/server.ts';
import { handleKnowledgeResolutionToolCall } from '../../mcp/brainbase/src/tools/knowledge-resolution-tools.ts';
import {
    buildJudgmentRequest,
    canonicalJson,
    recordBrainbaseToolUse,
    startEpisode
} from '../../scripts/codex-hooks/judgment-resolver-host.mjs';

function encode(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function codexJwt(claims) {
    return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}.codex-test-signature`;
}

function hash(value) {
    return createHash('sha256').update(value).digest('hex');
}

function validReceipt(args) {
    return {
        resolution_id: 'knowledge_mcp_host_fixture',
        turn_id: args.turn_id,
        request_digest: hash(canonicalJson(args)),
        context_digest: hash(canonicalJson(args.conversation_context)),
        status: 'resolved',
        host_binding: { status: 'managed' },
        classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] },
        active_node_definitions: [{ id: 'entry', kind: 'common', instruction: 'Judge first.' }],
        autonomy_policy_ids: []
    };
}

function createFixture() {
    const tokenClaims = {
        sub: 'person-codex',
        organizationId: 'org-codex',
        projectCodes: ['alpha'],
        role: 'member',
        clearance: ['internal'],
        authProvider: 'codex',
        providerSubject: 'codex-person',
        providerTenant: 'codex-workspace'
    };
    const token = codexJwt(tokenClaims);
    const accessLog = [];
    const decision = {
        id: 'decision-alpha',
        entity_type: 'decision',
        project_code: 'alpha',
        payload: {
            title: 'Alpha canonical decision',
            statement: 'Codex may use the alpha decision.',
            status: 'active',
            version: '7',
            source_url: 'brainbase://graph/decision-alpha'
        },
        updated_at: '2026-09-17T00:00:00.000Z'
    };
    const infoSSOTService = {
        async listGraphEntities(access, options = {}) {
            accessLog.push({ access, options });
            if (options.id === decision.id && options.projectCode === decision.project_code) {
                return [decision];
            }
            return [];
        },
        async listGraphEdges() {
            return [];
        }
    };
    const authService = {
        verifyToken(value) {
            if (value !== token) throw new Error('unknown token');
            return tokenClaims;
        }
    };
    const catalogService = new KnowledgeCatalogService({ infoSSOTService });
    const app = express();
    app.use(express.json());
    registerKnowledgeCatalogApiRoute(app, {
        authService,
        infoSSOTService,
        service: catalogService
    });
    return { app, authService, catalogService, accessLog, decision, token };
}

function listen(app) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

function close(server) {
    return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe('Codex principal knowledge retrieval', () => {
    it('Codex-shaped JWT reaches the catalog and cannot read another project', async () => {
        // Doubles are limited to authService.verifyToken and Graph list reads;
        // the route registration, requireAuth, catalog service, and HTTP server
        // are the production implementations under test.
        const fixture = createFixture();
        const headers = { Authorization: `Bearer ${fixture.token}` };
        const args = {
            project_code: 'alpha',
            refs: [{ id: fixture.decision.id, version: '7' }]
        };

        const direct = await request(fixture.app)
            .post('/api/knowledge/retrieve-principal')
            .set(headers)
            .send(args)
            .expect(200);
        expect(direct.body).toMatchObject({
            project_code: 'alpha',
            results: [{
                id: fixture.decision.id,
                status: 'resolved',
                requested_version: '7',
                resolved_version: '7',
                content: 'Codex may use the alpha decision.',
                retrieval_receipt_id: 'graph:decision-alpha:7'
            }]
        });
        expect(fixture.accessLog[0].access).toMatchObject({
            personId: 'person-codex',
            organizationId: 'org-codex',
            projectCodes: ['alpha'],
            authProvider: 'codex'
        });

        const denied = await request(fixture.app)
            .post('/api/knowledge/retrieve-principal')
            .set(headers)
            .send({ ...args, project_code: 'beta' })
            .expect(403);
        expect(denied.body.error).toMatchObject({ code: 'knowledge_project_not_accessible' });

        const server = await listen(fixture.app);
        try {
            const address = server.address();
            const apiUrl = `http://127.0.0.1:${address.port}`;
            const mcp = await handleKnowledgeResolutionToolCall('brainbase_knowledge_retrieve', args, {
                apiUrl,
                configuredProjectCodes: ['alpha'],
                tokenManager: { getToken: async () => fixture.token }
            });
            expect(mcp).toMatchObject({
                status: 'ok',
                scope: { project_codes: ['alpha'] },
                data: {
                    project_code: 'alpha',
                    results: [{
                        id: fixture.decision.id,
                        status: 'resolved',
                        content: 'Codex may use the alpha decision.',
                        retrieval_receipt_id: 'graph:decision-alpha:7'
                    }]
                }
            });
        } finally {
            await close(server);
        }
    });

    it('実MCP取得出力をHostへ渡すと本文付きretrieved evidenceとして記録される', async () => {
        const fixture = createFixture();
        const root = mkdtempSync(join(tmpdir(), 'brainbase-knowledge-mcp-host-'));
        const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
        const payload = {
            session_id: 'knowledge-mcp-host-session',
            turn_id: 'knowledge-mcp-host-turn',
            prompt: '正本の判断を取得して',
            cwd: process.cwd()
        };
        const args = {
            project_code: 'alpha',
            refs: [{ id: fixture.decision.id, version: '7' }]
        };

        try {
            await startEpisode(payload, {
                env,
                fetchImpl: async () => ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        management_status: 'managed',
                        receipt: validReceipt(buildJudgmentRequest(payload, { env }))
                    })
                })
            });

            // Exercise the real MCP wrapper with the production principal route
            // result, then pass that exact envelope to the Host recorder.
            const server = await listen(fixture.app);
            try {
                const address = server.address();
                const mcpExtension = await handleKnowledgeResolutionToolCall('brainbase_knowledge_retrieve', args, {
                    apiUrl: `http://127.0.0.1:${address.port}`,
                    configuredProjectCodes: ['alpha'],
                    tokenManager: { getToken: async () => fixture.token }
                });
                expect(mcpExtension?.status).toBe('ok');
                const mcpSuccess = mcpServerTesting.buildMcpToolResult(
                    'brainbase_knowledge_retrieve',
                    args,
                    JSON.stringify(mcpExtension, null, 2),
                    mcpExtension
                );
                expect(mcpSuccess.isError).toBeUndefined();
                expect(JSON.parse(mcpSuccess.content[0].text).data.results[0]).toMatchObject({
                    id: fixture.decision.id,
                    requested_version: '7',
                    resolved_version: '7',
                    content: 'Codex may use the alpha decision.',
                    source: { kind: 'graph_entity' },
                    retrieval_receipt_id: 'graph:decision-alpha:7'
                });

                const event = recordBrainbaseToolUse({
                    hook_event_name: 'PostToolUse',
                    session_id: payload.session_id,
                    turn_id: payload.turn_id,
                    tool_name: 'mcp__brainbase__brainbase_knowledge_retrieve',
                    tool_use_id: 'knowledge-mcp-host-retrieve',
                    tool_input: args,
                    tool_response: mcpSuccess
                }, { env });
                expect(event).toMatchObject({
                    success: true,
                    event_kind: 'retrieve',
                    safe_metadata: {
                        retrieval_outcome: 'result',
                        retrieval_evidence: {
                            status: 'retrieved',
                            coverage: 'complete',
                            sufficiency: 'needs_model_verification',
                            references: [{
                                id: fixture.decision.id,
                                evidence_status: 'present',
                                evidence_fields: ['content']
                            }],
                            absence_confirmed: false
                        }
                    }
                });
            } finally {
                await close(server);
            }
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
