import { describe, expect, it, vi } from 'vitest';

import {
    createKnowledgeBedrockAdapter,
    knowledgeBedrockContract
} from '../../server/services/knowledge-bedrock-adapter.js';
import { KnowledgeAIAdapterContractError } from '../../server/services/knowledge-capture-preview-adapter.js';

function providerResponse(value) {
    return {
        body: new TextEncoder().encode(JSON.stringify({
            content: [{ text: JSON.stringify(value) }]
        }))
    };
}

describe('knowledge Bedrock adapter', () => {
    it('reuses the existing InvokeModel Anthropic contract for a strict capture proposal', async () => {
        const bedrockClient = {
            send: vi.fn(async (command) => {
                expect(command.input.modelId).toBe('model-test');
                expect(command.input.contentType).toBe('application/json');
                expect(command.input.accept).toBe('application/json');
                const request = JSON.parse(command.input.body);
                expect(request).toMatchObject({
                    anthropic_version: 'bedrock-2023-05-31',
                    max_tokens: 1024,
                    system: expect.stringContaining('knowledge capture proposal adapter')
                });
                const input = JSON.parse(request.messages[0].content[0].text);
                expect(input).toMatchObject({
                    project_code: 'alpha',
                    content: 'new note',
                    source_refs: [{ id: 'dec_1', version: '3' }]
                });
                expect(input.access).toBeUndefined();
                return providerResponse({
                    proposal: {
                        kind: 'decision',
                        summary: 'A proposed decision',
                        scope: 'project',
                        owner_candidate: 'per_owner',
                        relations: []
                    },
                    evidence: [{ id: 'dec_1', version: '3', source_ref: 'graph:dec_1:3' }],
                    unknown: [],
                    version: 'bedrock-v1',
                    readback: { state: 'provider_received', verified: false }
                });
            })
        };
        const adapter = createKnowledgeBedrockAdapter({
            bedrockClient,
            modelId: 'model-test',
            maxTokens: 1024
        });

        await expect(adapter.proposeCapture({
            project_code: 'alpha',
            content: 'new note',
            source_refs: [{ id: 'dec_1', version: '3' }],
            materials: [{ id: 'dec_1', version: '3', content: 'canonical body' }],
            exclusions: [],
            access: { projectCodes: ['alpha'], secret: 'must-not-leak' }
        })).resolves.toMatchObject({
            proposal: { kind: 'decision', summary: 'A proposed decision' },
            evidence: [{ id: 'dec_1', version: '3' }],
            version: 'bedrock-v1',
            readback: { verified: false }
        });
        expect(bedrockClient.send).toHaveBeenCalledOnce();
    });

    it('sends only the isolated preview inputs and preserves exact candidate citations', async () => {
        const bedrockClient = {
            send: vi.fn(async (command) => {
                const request = JSON.parse(command.input.body);
                expect(request.messages[0].role).toBe('user');
                const input = JSON.parse(request.messages[0].content[0].text);
                expect(input).toMatchObject({
                    project_code: 'alpha',
                    question: 'what applies?',
                    candidates: [{ id: 'draft_1', version: 'draft-v2' }]
                });
                expect(input.access).toBeUndefined();
                return providerResponse({
                    answer: 'Use the isolated draft for this preview.',
                    citations: [{ id: 'draft_1', version: 'draft-v2' }],
                    evidence: [{ id: 'draft_1', version: 'draft-v2', source_ref: 'draft:draft_1' }],
                    unknown: [],
                    version: 'bedrock-v1',
                    readback: { state: 'isolated_draft', verified: false }
                });
            })
        };
        const adapter = createKnowledgeBedrockAdapter({ bedrockClient, modelId: 'model-test' });

        await expect(adapter.preview({
            project_code: 'alpha',
            question: 'what applies?',
            scenario: 'preview only',
            draft: { id: 'draft_1', version: 'draft-v2', content: 'draft body' },
            candidates: [{ id: 'draft_1', version: 'draft-v2', content: 'draft body' }],
            exclusions: [],
            access: { projectCodes: ['alpha'], secret: 'must-not-leak' }
        })).resolves.toMatchObject({
            answer: 'Use the isolated draft for this preview.',
            citations: [{ id: 'draft_1', version: 'draft-v2' }],
            readback: { state: 'isolated_draft', verified: false }
        });
    });

    it('fails closed on malformed provider output rather than returning raw text', async () => {
        const bedrockClient = {
            send: vi.fn(async () => ({
                body: new TextEncoder().encode(JSON.stringify({ content: [{ text: 'title only' }] }))
            }))
        };
        const adapter = createKnowledgeBedrockAdapter({ bedrockClient, modelId: 'model-test' });

        await expect(adapter.proposeCapture({ content: 'new note' }))
            .rejects.toBeInstanceOf(KnowledgeAIAdapterContractError);
        await expect(adapter.preview({ question: 'what?', candidates: [] }))
            .rejects.toBeInstanceOf(KnowledgeAIAdapterContractError);
    });

    it('requires explicit provider client and model id', () => {
        expect(() => createKnowledgeBedrockAdapter()).toThrow(/bedrockClient/);
        expect(() => createKnowledgeBedrockAdapter({ bedrockClient: { send: vi.fn() } }))
            .toThrow(/modelId/);
        expect(knowledgeBedrockContract).toEqual({
            anthropicVersion: 'bedrock-2023-05-31',
            request: 'InvokeModelCommand',
            response: 'content[0].text JSON'
        });
    });
});
