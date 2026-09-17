import { CanonicalDocumentWriterAdapter } from '../services/canonical-document-writer-adapter.js';
import { CanonicalDocumentContentRetriever } from '../services/canonical-document-content-retriever.js';
import { GitHubOwningRepositoryDocumentProvider } from '../services/github-owning-repository-document-provider.js';

function createConfiguredProvider({ configParser, env, fetchImpl, apiBaseUrl }) {
    const token = typeof env.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN.trim() : '';
    if (!token || !configParser?.getGitHubMappings) return null;
    return new GitHubOwningRepositoryDocumentProvider({
        configParser,
        token,
        fetchImpl,
        apiBaseUrl
    });
}

/**
 * Build the production composition-root writer only after an explicit opt-in.
 * GITHUB_TOKEN remains the existing GitHubService credential; it is injected
 * and never logged or copied into request payloads. Disabled or incomplete
 * configuration returns null so the API keeps its 503 fail-closed behavior.
 */
export function createConfiguredKnowledgeDocumentWriter({
    configParser,
    env = process.env,
    fetchImpl = globalThis.fetch,
    apiBaseUrl = env.GITHUB_API_BASE_URL || undefined,
    enabled = env.BRAINBASE_KNOWLEDGE_DOCUMENT_WRITER_ENABLED === '1',
    receiptStore = null
} = {}) {
    if (!enabled) return null;
    const provider = createConfiguredProvider({ configParser, env, fetchImpl, apiBaseUrl });
    if (!provider || typeof receiptStore?.find !== 'function' || typeof receiptStore?.put !== 'function') return null;

    return new CanonicalDocumentWriterAdapter({
        receiptStore,
        provider
    });
}

export function createConfiguredKnowledgeDocumentContentRetriever({
    configParser,
    graphPointerResolver,
    env = process.env,
    fetchImpl = globalThis.fetch,
    apiBaseUrl = env.GITHUB_API_BASE_URL || undefined,
    enabled = env.BRAINBASE_KNOWLEDGE_DOCUMENT_RETRIEVER_ENABLED === '1'
        || env.BRAINBASE_KNOWLEDGE_DOCUMENT_WRITER_ENABLED === '1'
} = {}) {
    if (!enabled || typeof graphPointerResolver?.resolve !== 'function') return null;
    const provider = createConfiguredProvider({ configParser, env, fetchImpl, apiBaseUrl });
    if (!provider) return null;
    return new CanonicalDocumentContentRetriever({ provider, graphPointerResolver });
}
