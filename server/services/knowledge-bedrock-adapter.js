import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

import {
    KnowledgeAIAdapterContractError,
    referenceKey,
    validateCaptureProposal,
    validatePreviewAnswer
} from './knowledge-capture-preview-adapter.js';

export const QWEN3_235B_MODEL_ID = 'qwen.qwen3-235b-a22b-2507-v1:0';

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

function parseProviderOutput(response) {
    const content = response?.output?.message?.content;
    const textBlocks = Array.isArray(content)
        ? content.filter((block) => typeof block?.text === 'string')
        : [];
    if (textBlocks.length !== 1 || !textBlocks[0].text.trim()) {
        throw new KnowledgeAIAdapterContractError(
            'knowledge provider response must include exactly one non-empty output.message.content text'
        );
    }
    const text = textBlocks[0].text;
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
        'If materials is empty, evidence must be an empty array.',
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
    return new ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages: [{
            role: 'user',
            content: [{ text: payload }]
        }],
        inferenceConfig: { maxTokens, temperature: 0 }
    });
}

/**
 * Build a knowledge adapter on top of the existing Bedrock Runtime contract.
 *
 * The caller must provide a client. Qwen3 235B is the single standard model;
 * the optional modelId parameter exists for explicit dependency injection in
 * isolated callers and tests. There is deliberately no environment lookup,
 * fallback provider, or raw-text fallback here.
 */
export function createKnowledgeBedrockAdapter({
    bedrockClient,
    modelId = QWEN3_235B_MODEL_ID,
    maxTokens = 1024
} = {}) {
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
            if (safeInput.materials.length === 0) {
                parsed.evidence = [];
            }
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
    modelId: QWEN3_235B_MODEL_ID,
    request: 'ConverseCommand',
    response: 'output.message.content[0].text JSON'
});
