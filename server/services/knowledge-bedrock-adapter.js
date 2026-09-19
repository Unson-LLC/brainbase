import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

import {
    KnowledgeAIAdapterContractError,
    referenceKey,
    validateCaptureProposal,
    validatePreviewAnswer
} from './knowledge-capture-preview-adapter.js';

const ANTHROPIC_VERSION = 'bedrock-2023-05-31';

function requiredText(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError(`${field} is required`);
    }
    return value.trim();
}

function positiveInteger(value, field) {
    if (!Number.isInteger(value) || value < 1) {
        throw new TypeError(`${field} must be a positive integer`);
    }
    return value;
}

function providerPayload(input) {
    try {
        const serialized = JSON.stringify(input);
        if (typeof serialized !== 'string') {
            throw new Error('input did not serialize to JSON');
        }
        return serialized;
    } catch (error) {
        throw new KnowledgeAIAdapterContractError('knowledge provider input is not serializable', {
            cause: error instanceof Error ? error.message : String(error)
        });
    }
}

function decodeResponseBody(body) {
    if (body == null) {
        throw new KnowledgeAIAdapterContractError('knowledge provider response body is missing');
    }
    try {
        return new TextDecoder().decode(body);
    } catch (error) {
        throw new KnowledgeAIAdapterContractError('knowledge provider response body is not decodable', {
            cause: error instanceof Error ? error.message : String(error)
        });
    }
}

function parseProviderOutput(response) {
    let envelope;
    try {
        envelope = JSON.parse(decodeResponseBody(response?.body));
    } catch (error) {
        if (error instanceof KnowledgeAIAdapterContractError) throw error;
        throw new KnowledgeAIAdapterContractError('knowledge provider response is not valid JSON', {
            cause: error instanceof Error ? error.message : String(error)
        });
    }
    const text = envelope?.content?.[0]?.text;
    if (typeof text !== 'string' || !text.trim()) {
        throw new KnowledgeAIAdapterContractError(
            'knowledge provider response must include content[0].text'
        );
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new KnowledgeAIAdapterContractError('knowledge provider content is not valid JSON', {
            cause: error instanceof Error ? error.message : String(error)
        });
    }
}

function allowedReferences(candidates = []) {
    return new Set(candidates
        .filter((candidate) => candidate?.id != null && candidate?.version != null)
        .map((candidate) => referenceKey(candidate.id, candidate.version)));
}

function captureSystemPrompt() {
    return [
        'You are the Brainbase knowledge capture proposal adapter.',
        'Return one JSON object only. Do not include markdown, prose, or code fences.',
        'The object must contain: proposal, evidence (array), unknown (array), version, and readback.',
        'proposal must contain kind, summary, scope, owner_candidate, and relations.',
        'Every evidence item must include version and may reference only supplied material ids.',
        'Keep uncertainty explicit in unknown; do not infer missing owners, versions, or persistence.',
        'readback must include state and a boolean verified. This is a proposal only; it is not persisted.',
        'Never invent catalog ids, versions, source URLs, or retrieval receipts.'
    ].join(' ');
}

function previewSystemPrompt() {
    return [
        'You are the Brainbase knowledge preview answerer.',
        'Return one JSON object only. Do not include markdown, prose, or code fences.',
        'The object must contain: answer, citations (array), evidence (array), unknown (array), version, and readback.',
        'Citations and evidence must use only the exact id/version pairs supplied in candidates.',
        'Do not cite exclusions or any source outside candidates. Keep unsupported claims in unknown.',
        'The draft is isolated and not canonical; never claim that it was persisted or published.',
        'readback must include state and a boolean verified. Do not fabricate retrieval receipts.'
    ].join(' ');
}

function buildRequest({ modelId, maxTokens, system, input }) {
    const payload = providerPayload(input);
    return new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: ANTHROPIC_VERSION,
            max_tokens: maxTokens,
            system,
            messages: [{
                role: 'user',
                content: [{ type: 'text', text: payload }]
            }]
        })
    });
}

/**
 * Build a knowledge adapter on top of the existing Bedrock Runtime contract.
 *
 * The caller must provide both a client and a model id.  There is deliberately
 * no environment lookup, default client, fallback provider, or raw-text
 * fallback here.  Bootstrap can therefore keep knowledge AI unavailable until
 * an explicit provider is approved and injected.
 */
export function createKnowledgeBedrockAdapter({ bedrockClient, modelId, maxTokens = 1024 } = {}) {
    if (!bedrockClient || typeof bedrockClient.send !== 'function') {
        throw new TypeError('bedrockClient with send(command) is required');
    }
    const resolvedModelId = requiredText(modelId, 'modelId');
    const resolvedMaxTokens = positiveInteger(maxTokens, 'maxTokens');

    async function invoke(system, input) {
        const response = await bedrockClient.send(buildRequest({
            modelId: resolvedModelId,
            maxTokens: resolvedMaxTokens,
            system,
            input
        }));
        return parseProviderOutput(response);
    }

    return {
        async proposeCapture(input = {}) {
            const safeInput = {
                project_code: input.project_code || null,
                content: input.content || input.source_text || null,
                source_refs: Array.isArray(input.source_refs) ? input.source_refs : [],
                materials: Array.isArray(input.materials) ? input.materials : [],
                exclusions: Array.isArray(input.exclusions) ? input.exclusions : []
            };
            const parsed = await invoke(captureSystemPrompt(), safeInput);
            return validateCaptureProposal(parsed, {
                allowedReferences: allowedReferences(safeInput.materials)
            });
        },

        async preview(input = {}) {
            const safeInput = {
                project_code: input.project_code || null,
                question: input.question || null,
                scenario: input.scenario || null,
                draft: input.draft || null,
                candidates: Array.isArray(input.candidates) ? input.candidates : [],
                exclusions: Array.isArray(input.exclusions) ? input.exclusions : []
            };
            const parsed = await invoke(previewSystemPrompt(), safeInput);
            return validatePreviewAnswer(parsed, {
                allowedReferences: allowedReferences(safeInput.candidates)
            });
        }
    };
}

export const knowledgeBedrockContract = Object.freeze({
    anthropicVersion: ANTHROPIC_VERSION,
    request: 'InvokeModelCommand',
    response: 'content[0].text JSON'
});
