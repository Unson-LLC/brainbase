import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerKnowledgeCatalogApiRoute } from '../../../server/bootstrap/register-api-routes.js';

function createInfoSSOTService() {
    return {
        listGraphEntities: vi.fn(async () => []),
        listGraphEdges: vi.fn(async () => [])
    };
}

function createAuthService() {
    return {
        verifyToken: vi.fn((token) => {
            if (token !== 'test-token') throw new Error('invalid token');
            return { sub: 'per_owner', role: 'ceo', projectCodes: ['alpha'] };
        })
    };
}

describe('knowledge catalog Bedrock composition root', () => {
    it('uses the concrete adapter published by production bootstrap', async () => {
        const adapter = {
            proposeCapture: vi.fn(async () => ({
                proposal: {
                    kind: 'decision',
                    summary: 'A bootstrap-wired decision',
                    scope: 'project',
                    owner_candidate: 'per_owner',
                    relations: []
                },
                evidence: [],
                unknown: [],
                version: 'bedrock-v1',
                readback: { state: 'provider_received', verified: false }
            })),
            preview: vi.fn()
        };
        const app = express();
        app.use(express.json());
        registerKnowledgeCatalogApiRoute(app, {
            authService: createAuthService(),
            infoSSOTService: createInfoSSOTService(),
            knowledgeBedrockAdapter: adapter
        });

        const response = await request(app)
            .post('/api/knowledge/capture/proposal')
            .set('authorization', 'Bearer test-token')
            .send({ project_code: 'alpha', content: 'new note' })
            .expect(200);

        expect(response.body.proposal).toMatchObject({ summary: 'A bootstrap-wired decision' });
        expect(adapter.proposeCapture).toHaveBeenCalledWith(expect.objectContaining({
            project_code: 'alpha',
            content: 'new note'
        }));
    });

    it('injects the explicit Bedrock provider double while preserving the proposal HTTP contract', async () => {
        const bedrockClient = {
            send: vi.fn(async (command) => {
                expect(command.input.modelId).toBe('model-test');
                const requestBody = JSON.parse(command.input.body);
                const providerInput = JSON.parse(requestBody.messages[0].content[0].text);
                expect(providerInput).toMatchObject({ project_code: 'alpha', content: 'new note' });
                expect(providerInput.access).toBeUndefined();
                return {
                    body: new TextEncoder().encode(JSON.stringify({
                        content: [{ text: JSON.stringify({
                            proposal: {
                                kind: 'decision',
                                summary: 'A proposed decision',
                                scope: 'project',
                                owner_candidate: 'per_owner',
                                relations: []
                            },
                            evidence: [],
                            unknown: [],
                            version: 'bedrock-v1',
                            readback: { state: 'provider_received', verified: false }
                        }) }]
                    }))
                };
            })
        };
        const app = express();
        app.use(express.json());
        registerKnowledgeCatalogApiRoute(app, {
            authService: createAuthService(),
            infoSSOTService: createInfoSSOTService(),
            knowledgeBedrockClient: bedrockClient,
            knowledgeBedrockModelId: 'model-test',
            knowledgeBedrockMaxTokens: 1536
        });

        const response = await request(app)
            .post('/api/knowledge/capture/proposal')
            .set('authorization', 'Bearer test-token')
            .send({ project_code: 'alpha', content: 'new note' })
            .expect(200);

        expect(response.body).toMatchObject({
            state: 'proposed',
            canonical: false,
            persisted: false,
            proposal: { kind: 'decision', summary: 'A proposed decision' },
            version: { adapter: 'bedrock-v1' },
            readback: { state: 'proposal_only', verified: false }
        });
        expect(response.body.evidence).toEqual([
            expect.objectContaining({ id: 'capture-input', state: 'provided' })
        ]);
        expect(bedrockClient.send).toHaveBeenCalledOnce();
    });

    it('keeps capture unavailable when no explicit provider is injected', async () => {
        const app = express();
        app.use(express.json());
        registerKnowledgeCatalogApiRoute(app, {
            authService: createAuthService(),
            infoSSOTService: createInfoSSOTService()
        });

        const response = await request(app)
            .post('/api/knowledge/capture/proposal')
            .set('authorization', 'Bearer test-token')
            .send({ project_code: 'alpha', content: 'new note' })
            .expect(503);

        expect(response.body.error).toMatchObject({
            code: 'knowledge_capture_proposal_unavailable'
        });
    });

    it('maps an injected provider transport failure to 503 without synthesizing a proposal', async () => {
        const bedrockClient = {
            send: vi.fn(async () => { throw new Error('provider unavailable'); })
        };
        const app = express();
        app.use(express.json());
        registerKnowledgeCatalogApiRoute(app, {
            authService: createAuthService(),
            infoSSOTService: createInfoSSOTService(),
            knowledgeBedrockClient: bedrockClient,
            knowledgeBedrockModelId: 'model-test'
        });

        const response = await request(app)
            .post('/api/knowledge/capture/proposal')
            .set('authorization', 'Bearer test-token')
            .send({ project_code: 'alpha', content: 'new note' })
            .expect(503);

        expect(response.body.error).toMatchObject({
            code: 'knowledge_capture_provider_failed'
        });
    });
});
