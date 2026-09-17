import { describe, expect, it, vi } from 'vitest';

import { createConfiguredKnowledgeBedrockAdapter } from '../../../server/bootstrap/knowledge-bedrock.js';

function providerResponse(value) {
    return {
        body: new TextEncoder().encode(JSON.stringify({
            content: [{ text: JSON.stringify(value) }]
        }))
    };
}

function captureResponse() {
    return providerResponse({
        proposal: {
            kind: 'decision',
            summary: 'A configured proposal',
            scope: 'project',
            owner_candidate: 'per_owner',
            relations: []
        },
        evidence: [],
        unknown: [],
        version: 'bedrock-v1',
        readback: { state: 'provider_received', verified: false }
    });
}

describe('configured knowledge Bedrock bootstrap', () => {
    it('stays disabled until the explicit Brainbase opt-in is enabled', () => {
        const BedrockRuntimeClientClass = vi.fn();

        const adapter = createConfiguredKnowledgeBedrockAdapter({
            env: {
                AWS_REGION: 'eu-west-1',
                AWS_PROFILE: 'knowledge',
                BEDROCK_MODEL_ID: 'model-test'
            },
            BedrockRuntimeClientClass
        });

        expect(adapter).toBeNull();
        expect(BedrockRuntimeClientClass).not.toHaveBeenCalled();
    });

    it('stays unavailable when the opt-in has no model id', () => {
        const BedrockRuntimeClientClass = vi.fn();

        const adapter = createConfiguredKnowledgeBedrockAdapter({
            env: {
                BRAINBASE_KNOWLEDGE_BEDROCK_ENABLED: '1',
                AWS_REGION: 'eu-west-1',
                AWS_PROFILE: 'knowledge'
            },
            BedrockRuntimeClientClass
        });

        expect(adapter).toBeNull();
        expect(BedrockRuntimeClientClass).not.toHaveBeenCalled();
    });

    it('constructs the existing Bedrock client pattern and returns the concrete adapter', async () => {
        const bedrockClient = { send: vi.fn(async () => captureResponse()) };
        const fromIniProvider = vi.fn(() => 'profile-credentials');
        const BedrockRuntimeClientClass = vi.fn(function FakeBedrockRuntimeClient(config) {
            this.config = config;
            return bedrockClient;
        });

        const env = {
            BRAINBASE_KNOWLEDGE_BEDROCK_ENABLED: '1',
            AWS_REGION: 'eu-west-1',
            AWS_PROFILE: 'knowledge',
            BEDROCK_MODEL_ID: 'model-test',
            BRAINBASE_KNOWLEDGE_BEDROCK_MAX_TOKENS: '1536'
        };
        const adapter = createConfiguredKnowledgeBedrockAdapter({
            env,
            BedrockRuntimeClientClass,
            fromIniProvider
        });

        expect(adapter).toEqual(expect.objectContaining({
            proposeCapture: expect.any(Function),
            preview: expect.any(Function)
        }));
        expect(fromIniProvider).toHaveBeenCalledWith({ profile: 'knowledge' });
        expect(BedrockRuntimeClientClass).toHaveBeenCalledWith({
            region: 'eu-west-1',
            credentials: 'profile-credentials'
        });

        await expect(adapter.proposeCapture({
            project_code: 'alpha',
            content: 'new note'
        })).resolves.toMatchObject({
            proposal: { summary: 'A configured proposal' },
            version: 'bedrock-v1'
        });
        const request = JSON.parse(bedrockClient.send.mock.calls[0][0].input.body);
        expect(bedrockClient.send).toHaveBeenCalledOnce();
        expect(request).toMatchObject({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 1536
        });
    });
});
