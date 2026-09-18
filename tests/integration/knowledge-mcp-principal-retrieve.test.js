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
import { KnowledgeAuthoringService } from '../../server/services/knowledge-authoring-service.js';
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

function createCanonicalAuthoringFixture() {
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
    const drafts = new Map();
    const saves = new Map();
    const entities = new Map([
        ['person-codex', {
            id: 'person-codex', entity_type: 'person', project_code: 'alpha', payload: {}
        }],
        ['decision-reference', {
            id: 'decision-reference', entity_type: 'decision', project_code: 'alpha',
            payload: { statement: 'Reference decision.', status: 'active', version: '3' }
        }]
    ]);
    const edges = [];
    const infoSSOTService = {
        async listGraphEntities(_access, options = {}) {
            return [...entities.values()].filter((entity) => {
                if (options.id && entity.id !== options.id) return false;
                if (Array.isArray(options.ids) && !options.ids.includes(entity.id)) return false;
                if (options.projectCode && entity.project_code !== options.projectCode) return false;
                if (options.entityType && entity.entity_type !== options.entityType) return false;
                return true;
            }).slice(0, options.limit || entities.size);
        },
        async listGraphEdges(_access, options = {}) {
            return edges.filter((edge) => {
                if (options.fromId && edge.from_id !== options.fromId) return false;
                if (options.toId && edge.to_id !== options.toId) return false;
                if (options.projectCode && edge.project_code !== options.projectCode) return false;
                return true;
            });
        }
    };
    const authService = {
        verifyToken(value) {
            if (value !== token) throw new Error('unknown token');
            return tokenClaims;
        }
    };
    const catalogService = new KnowledgeCatalogService({ infoSSOTService });
    const repository = {
        async createDraft(draft) {
            const row = {
                ...draft,
                created_at: '2026-09-18T00:00:00.000Z',
                updated_at: '2026-09-18T00:00:00.000Z'
            };
            drafts.set(row.draft_id, row);
            return row;
        },
        async getDraft(id) {
            return drafts.get(id) || null;
        },
        async findSave(key) {
            return saves.get(key) || null;
        },
        async claimSave(id, claim) {
            const row = drafts.get(id);
            if (!row || row.revision !== claim.expected_revision
                || !['draft', 'saving'].includes(row.status)
                || (row.status === 'saving' && row.save_idempotency_key !== claim.idempotency_key)) {
                return null;
            }
            const claimed = {
                ...row,
                status: 'saving',
                save_idempotency_key: claim.idempotency_key,
                save_decision_domain: claim.decision_domain
            };
            drafts.set(id, claimed);
            return claimed;
        },
        async completeSave(save) {
            const row = drafts.get(save.draft_id);
            drafts.set(save.draft_id, {
                ...row,
                status: 'saved',
                canonical_id: save.canonical_id,
                saved_event_id: save.event_id
            });
            saves.set(save.idempotency_key, { ...save });
        }
    };
    const knowledgeEventService = {
        async ingest(event) {
            entities.set(event.subject.id, {
                id: event.subject.id,
                entity_type: 'decision',
                project_code: event.applicability_scope.project_code,
                organization_id: event.organization_id,
                updated_at: event.occurred_at,
                payload: {
                    title: 'Saved through knowledge API',
                    statement: event.decision.statement,
                    status: 'active',
                    version: event.version,
                    owner_person_id: event.decision_authority.decider_id,
                    applicability_scope: event.applicability_scope
                }
            });
            return {
                event_id: event.event_id,
                graph_entity_id: event.subject.id,
                semantic_state: 'active',
                processing_stage: 'retrievable'
            };
        }
    };
    const graphRepository = {
        async validateAuthoringContext(input) {
            return {
                owner_person_id: input.owner_person_id,
                relations: input.relations || [],
                authority_verified: Boolean(input.decision_domain)
            };
        },
        async persistAuthoringRelations(input) {
            const persisted = [
                { from_id: input.entity_id, to_id: input.owner_person_id, rel_type: 'owned_by', project_code: input.project_code, payload: {} },
                { from_id: input.entity_id, to_id: input.project_code, rel_type: 'belongs_to', project_code: input.project_code, payload: {} },
                ...(input.relations || []).map((relation) => ({
                    from_id: input.entity_id,
                    to_id: relation.to_id,
                    rel_type: relation.relation,
                    project_code: input.project_code,
                    payload: relation.payload || {}
                }))
            ];
            edges.push(...persisted);
            return {
                graph_saved: true,
                readback_verified: true,
                relation_count: persisted.length,
                relations: persisted.map((edge) => ({
                    from_id: edge.from_id,
                    to_id: edge.to_id,
                    relation: edge.rel_type,
                    payload: edge.payload
                }))
            };
        }
    };
    const authoringService = new KnowledgeAuthoringService({
        repository,
        knowledgeEventService,
        catalogService,
        graphRepository,
        now: () => '2026-09-18T00:00:00.000Z',
        id: () => 'local-e2e'
    });
    const app = express();
    app.use(express.json());
    registerKnowledgeCatalogApiRoute(app, {
        authService,
        infoSSOTService,
        service: catalogService,
        authoringService
    });
    return { app, token, entities, edges };
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

    it('API保存からGraph正本をreadbackし、同じ内容を実MCP取得へ渡す', async () => {
        // This composes the production catalog/authoring routes, the canonical
        // Graph readback, and the production MCP HTTP wrapper. Only the
        // persistence/Graph adapters are in-memory, so the test has no
        // external or production side effects.
        const fixture = createCanonicalAuthoringFixture();
        const headers = { Authorization: `Bearer ${fixture.token}` };
        const draftResponse = await request(fixture.app)
            .post('/api/knowledge/drafts')
            .set(headers)
            .send({
                project_code: 'alpha',
                kind: 'decision',
                title: 'Local E2E decision',
                content: 'Use the canonical API-to-MCP path.',
                owner_person_id: 'person-codex',
                relations: [{ relation: 'references', to_id: 'decision-reference' }]
            })
            .expect(200);
        expect(draftResponse.body).toMatchObject({
            draft_id: 'kd_local-e2e',
            status: 'draft',
            owner_person_id: 'person-codex'
        });

        const saved = await request(fixture.app)
            .post(`/api/knowledge/drafts/${draftResponse.body.draft_id}/save`)
            .set(headers)
            .send({
                project_code: 'alpha',
                revision: draftResponse.body.revision,
                idempotency_key: 'local-e2e-save-1',
                decision_domain: 'engineering'
            })
            .expect(200);
        expect(saved.body).toMatchObject({
            status: 'saved',
            expected_version: '1',
            canonical: {
                id: expect.stringMatching(/^decision_/),
                version: '1',
                canonical_content: 'Use the canonical API-to-MCP path.'
            },
            persistence: {
                event_saved: true,
                graph_saved: true,
                readback_verified: true,
                relations_saved: true
            }
        });
        const canonicalId = saved.body.canonical.id;
        expect(fixture.entities.get(canonicalId)).toMatchObject({
            entity_type: 'decision',
            project_code: 'alpha',
            payload: {
                statement: 'Use the canonical API-to-MCP path.',
                version: '1'
            }
        });
        expect(fixture.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ from_id: canonicalId, to_id: 'person-codex', rel_type: 'owned_by' }),
            expect.objectContaining({ from_id: canonicalId, to_id: 'decision-reference', rel_type: 'references' })
        ]));

        const readback = await request(fixture.app)
            .get(`/api/knowledge/items/${canonicalId}?project_code=alpha`)
            .set(headers)
            .expect(200);
        expect(readback.body).toMatchObject({
            id: canonicalId,
            version: '1',
            canonical_content: 'Use the canonical API-to-MCP path.'
        });

        const server = await listen(fixture.app);
        try {
            const address = server.address();
            const mcp = await handleKnowledgeResolutionToolCall('brainbase_knowledge_retrieve', {
                project_code: 'alpha',
                refs: [{ id: canonicalId, version: '1' }]
            }, {
                apiUrl: `http://127.0.0.1:${address.port}`,
                configuredProjectCodes: ['alpha'],
                tokenManager: { getToken: async () => fixture.token }
            });
            expect(mcp).toMatchObject({
                status: 'ok',
                data: {
                    project_code: 'alpha',
                    results: [{
                        id: canonicalId,
                        status: 'resolved',
                        requested_version: '1',
                        resolved_version: '1',
                        content: 'Use the canonical API-to-MCP path.',
                        retrieval_receipt_id: `graph:${canonicalId}:1`
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
