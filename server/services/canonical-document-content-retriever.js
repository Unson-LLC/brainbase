import { createHash } from 'node:crypto';

import { normalizeRepositoryRelativePath } from './canonical-document-writer-adapter.js';

function retrievalError(code, message, status = 503, details = {}) {
    const error = new Error(message);
    Object.assign(error, { code, status, details });
    return error;
}

function requiredText(value, field, status = 422) {
    if (typeof value !== 'string' || !value.trim()) {
        throw retrievalError(
            'knowledge_document_retrieval_input_invalid',
            `${field} is required for canonical document retrieval`,
            status,
            { field }
        );
    }
    return value.trim();
}

function requiredContent(value) {
    if (typeof value !== 'string' || !value.trim()) {
        throw retrievalError(
            'knowledge_document_retrieval_input_invalid',
            'content is required for canonical document retrieval',
            503,
            { field: 'content' }
        );
    }
    return value;
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function normalizeContentHash(value) {
    const hash = requiredText(value, 'content_hash', 503);
    return hash.startsWith('sha256:') ? hash : `sha256:${hash}`;
}

function immutableVersion(value) {
    const version = requiredText(value, 'version');
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(version)) {
        throw retrievalError(
            'knowledge_document_version_invalid',
            'version must be an immutable Git commit SHA',
            422,
            { field: 'version' }
        );
    }
    return version;
}

/**
 * Read only tenant/project-scoped team documents from the configured owning
 * GitHub repository. The Graph registration remains the authority for repo,
 * branch and path scope; request bodies cannot widen that boundary.
 */
export class CanonicalDocumentContentRetriever {
    constructor({ provider, graphPointerResolver }) {
        if (!provider || typeof provider.readVersion !== 'function') {
            throw new TypeError('provider.readVersion is required');
        }
        if (!graphPointerResolver || typeof graphPointerResolver.resolve !== 'function') {
            throw new TypeError('graphPointerResolver.resolve is required');
        }
        this.provider = provider;
        this.graphPointerResolver = graphPointerResolver;
    }

    async context(source, { access, record, projectCode } = {}) {
        if (record?.type !== 'document' || source?.kind !== 'repository_path') {
            throw retrievalError(
                'knowledge_document_route_invalid',
                'only owning repository team documents can use the canonical document retriever',
                422
            );
        }
        const project_code = requiredText(projectCode, 'project_code', 403);
        if (!Array.isArray(access?.projectCodes) || !access.projectCodes.includes(project_code)) {
            throw retrievalError('knowledge_project_not_accessible', 'project is not accessible', 403);
        }
        accessPrincipal(access);
        const path = normalizeRepositoryRelativePath(source.pointer);
        const version = immutableVersion(record?.version);
        const resolution = await this.graphPointerResolver.resolve({ access, project_code });
        return { access, project_code, path, version, resolution };
    }

    async authorize(source, context) {
        const input = await this.context(source, context);
        await this.provider.resolveTarget(input);
        return true;
    }

    async retrieve(source, context) {
        const input = await this.context(source, context);
        const readback = await this.provider.readVersion(input);
        const content = requiredContent(readback?.content);
        const version = requiredText(readback?.revision, 'revision', 503);
        const path = normalizeRepositoryRelativePath(readback?.path || input.path);
        if (path !== input.path) {
            throw retrievalError(
                'knowledge_document_readback_mismatch',
                'canonical document readback path does not match the authorized source',
                409,
                { expected_path: input.path, observed_path: path }
            );
        }
        const contentHash = normalizeContentHash(readback?.content_hash);
        const observedHash = `sha256:${sha256(content)}`;
        if (contentHash !== observedHash) {
            throw retrievalError(
                'knowledge_document_readback_mismatch',
                'canonical document provider hash does not match the returned content',
                409,
                { expected_content_hash: contentHash, observed_content_hash: observedHash }
            );
        }
        const target = await this.provider.resolveTarget(input);
        const receiptDigest = sha256([
            target.tenant_id, input.project_code, target.owner, target.repo,
            target.branch, path, version, contentHash, accessPrincipal(input.access)
        ].join('\n'));
        return {
            content,
            content_hash: contentHash,
            version,
            receipt_id: `github:${receiptDigest}`
        };
    }
}

function accessPrincipal(access) {
    return requiredText(access?.personId, 'person_id', 403);
}

export const canonicalDocumentContentRetrieverInternals = {
    immutableVersion,
    normalizeContentHash,
    sha256
};
