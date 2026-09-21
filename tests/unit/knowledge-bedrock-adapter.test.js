import { describe, expect, it, vi } from 'vitest';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

import {
    createKnowledgeBedrockAdapter,
    knowledgeBedrockContract,
    QWEN3_235B_MODEL_ID
} from '../../server/services/knowledge-bedrock-adapter.js';
import { KnowledgeAIAdapterContractError } from '../../server/services/knowledge-capture-preview-adapter.js';

function providerResponse(value) {
    return {
        output: {
            message: {
                content: [{ text: JSON.stringify(value) }]
            }
        }
    };
}

describe('knowledge Bedrock adapter', () => {
    it('uses the Converse contract for a strict capture proposal', async () => {
        const bedrockClient = {
            send: vi.fn(async (command) => {
                expect(command).toBeInstanceOf(ConverseCommand);
                expect(command.input).toMatchObject({
                    modelId: QWEN3_235B_MODEL_ID,
                    inferenceConfig: { maxTokens: 1024 },
                    system: [{ text: expect.stringContaining('knowledge capture proposal adapter') }],
                    messages: [{ role: 'user', content: [{ text: expect.any(String) }] }]
                });
                const input = JSON.parse(command.input.messages[0].content[0].text);
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
        const adapter = createKnowledgeBedrockAdapter({ bedrockClient });

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
                expect(command).toBeInstanceOf(ConverseCommand);
                expect(command.input.modelId).toBe(QWEN3_235B_MODEL_ID);
                expect(command.input.messages[0].role).toBe('user');
                const input = JSON.parse(command.input.messages[0].content[0].text);
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
        const adapter = createKnowledgeBedrockAdapter({ bedrockClient });

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

    it('drops fabricated evidence when capture has no supplied materials', async () => {
        const bedrockClient = {
            send: vi.fn(async () => providerResponse({
                proposal: {
                    kind: 'decision',
                    summary: 'A proposed decision',
                    scope: 'project',
                    owner_candidate: null,
                    relations: []
                },
                evidence: [{ source_ref: 'fabricated-without-version' }],
                unknown: [],
                version: 'bedrock-v1',
                readback: { state: 'provider_received', verified: false }
            }))
        };
        const adapter = createKnowledgeBedrockAdapter({ bedrockClient });

        await expect(adapter.proposeCapture({
            project_code: 'brainbase',
            content: 'a source-only capture',
            materials: []
        })).resolves.toMatchObject({
            evidence: [],
            version: 'bedrock-v1'
        });
    });

    it('fails closed on malformed provider output rather than returning raw text', async () => {
        const bedrockClient = {
            send: vi.fn(async () => ({
                output: { message: { content: [{ text: 'title only' }] } }
            }))
        };
        const adapter = createKnowledgeBedrockAdapter({ bedrockClient });

        await expect(adapter.proposeCapture({ content: 'new note' }))
            .rejects.toBeInstanceOf(KnowledgeAIAdapterContractError);
        await expect(adapter.preview({ question: 'what?', candidates: [] }))
            .rejects.toBeInstanceOf(KnowledgeAIAdapterContractError);
    });

    it('fails closed when the Converse response has missing or multiple text blocks', async () => {
        for (const response of [
            {},
            { output: { message: { content: [] } } },
            { output: { message: { content: [{ text: '{}' }, { text: '{}' }] } } }
        ]) {
            const bedrockClient = { send: vi.fn(async () => response) };
            const adapter = createKnowledgeBedrockAdapter({ bedrockClient });
            await expect(adapter.proposeCapture({ content: 'new note' }))
                .rejects.toBeInstanceOf(KnowledgeAIAdapterContractError);
        }
    });

    it('requires a provider client and uses the Qwen3 235B standard contract', () => {
        expect(() => createKnowledgeBedrockAdapter()).toThrow(/bedrockClient/);
        expect(knowledgeBedrockContract).toEqual({
            modelId: QWEN3_235B_MODEL_ID,
            request: 'ConverseCommand',
            response: 'output.message.content[0].text JSON'
        });
    });
});
