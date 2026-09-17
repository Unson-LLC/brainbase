import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { fromIni } from '@aws-sdk/credential-providers';

import { createKnowledgeBedrockAdapter } from '../services/knowledge-bedrock-adapter.js';

function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function positiveInteger(value) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * Build the production Knowledge Bedrock adapter only after an explicit opt-in.
 *
 * The client follows the existing Mana Bedrock construction pattern: the AWS
 * SDK resolves its normal credential chain, while AWS_PROFILE is translated to
 * the SDK's fromIni provider when it is present.  Knowledge does not inherit
 * Mana's default model, so a model id must be configured explicitly.  Missing
 * or invalid configuration returns null and leaves the catalog's 503 boundary
 * intact.
 */
export function createConfiguredKnowledgeBedrockAdapter({
    env = process.env,
    enabled = env.BRAINBASE_KNOWLEDGE_BEDROCK_ENABLED === '1',
    region = env.BRAINBASE_KNOWLEDGE_BEDROCK_REGION || env.AWS_REGION || 'us-east-1',
    profile = env.BRAINBASE_KNOWLEDGE_BEDROCK_AWS_PROFILE || env.AWS_PROFILE || null,
    modelId = env.BRAINBASE_KNOWLEDGE_BEDROCK_MODEL_ID || env.BEDROCK_MODEL_ID || null,
    maxTokens = env.BRAINBASE_KNOWLEDGE_BEDROCK_MAX_TOKENS || 1024,
    bedrockClient = null,
    BedrockRuntimeClientClass = BedrockRuntimeClient,
    fromIniProvider = fromIni
} = {}) {
    if (!enabled) return null;

    const resolvedModelId = text(modelId);
    const resolvedRegion = text(region);
    const resolvedMaxTokens = positiveInteger(maxTokens);
    if (!resolvedModelId || !resolvedRegion || !resolvedMaxTokens) return null;

    const client = bedrockClient || (() => {
        const clientConfig = { region: resolvedRegion };
        const resolvedProfile = text(profile);
        if (resolvedProfile) {
            clientConfig.credentials = fromIniProvider({ profile: resolvedProfile });
        }
        return new BedrockRuntimeClientClass(clientConfig);
    })();

    if (!client || typeof client.send !== 'function') return null;

    return createKnowledgeBedrockAdapter({
        bedrockClient: client,
        modelId: resolvedModelId,
        maxTokens: resolvedMaxTokens
    });
}
