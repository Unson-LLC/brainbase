import { CanonicalDocumentWriterAdapter } from '../services/canonical-document-writer-adapter.js';
import { GitHubOwningRepositoryDocumentProvider } from '../services/github-owning-repository-document-provider.js';

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
    const token = typeof env.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN.trim() : '';
    if (!token || !configParser?.getGitHubMappings
        || typeof receiptStore?.find !== 'function' || typeof receiptStore?.put !== 'function') return null;

    return new CanonicalDocumentWriterAdapter({
        receiptStore,
        provider: new GitHubOwningRepositoryDocumentProvider({
            configParser,
            token,
            fetchImpl,
            apiBaseUrl
        })
    });
}
