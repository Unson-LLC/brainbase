import { createHash } from 'node:crypto';
import path from 'node:path';

const SOURCE_CLASS = 'owning_repo';
const CONTENT_TYPE = 'team_document';

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
    }
    return value;
}

function digest(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requiredString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new CanonicalDocumentWriterError(
            'canonical_document_input_invalid',
            `${name} is required`,
            400,
            { field: name }
        );
    }
    return value.trim();
}

function normalizeRevision(value, name) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value);
    return requiredString(value, name);
}

export class CanonicalDocumentWriterError extends Error {
    constructor(code, message, status = 400, details = {}) {
        super(message);
        this.name = 'CanonicalDocumentWriterError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

/**
 * Canonical document provider contract.
 *
 * A provider is intentionally supplied by the caller. It must implement:
 *   write({ project_code, path, content, base_hash, base_revision,
 *           idempotency_key, request_fingerprint, resolution, access })
 *     -> { path?, canonical_url?, revision? }
 *   read({ project_code, path, canonical_url?, access })
 *     -> { path?, content, content_hash?, revision, canonical_url? }
 *
 * The provider owns the atomic CAS and durable idempotency boundary. This
 * adapter validates the request, forwards both CAS values, and verifies the
 * provider's post-write readback before reporting success.
 */
export class CanonicalDocumentWriterAdapter {
    constructor({ provider = null } = {}) {
        this.provider = provider;
        this.completed = new Map();
    }

    async save(input = {}) {
        const request = this.normalizeRequest(input);
        this.assertProvider();

        const previous = this.completed.get(request.idempotency_key);
        if (previous) {
            if (previous.request_fingerprint !== request.request_fingerprint) {
                throw new CanonicalDocumentWriterError(
                    'canonical_document_idempotency_conflict',
                    'idempotency_key was already used with different document content',
                    409,
                    { idempotency_key: request.idempotency_key }
                );
            }
            return { ...previous.result, idempotency_replayed: true };
        }

        let result;
        try {
            const writeResult = await this.provider.write(request);
            const readback = await this.readback(request, writeResult);
            result = {
                ...readback,
                idempotency_key: request.idempotency_key,
                idempotency_replayed: false,
                request_fingerprint: request.request_fingerprint
            };
        } catch (error) {
            throw this.normalizeProviderError(error);
        }

        this.completed.set(request.idempotency_key, {
            request_fingerprint: request.request_fingerprint,
            result
        });
        return result;
    }

    normalizeRequest(input) {
        const projectCode = requiredString(input.project_code, 'project_code');
        const resolution = input.resolution;
        this.assertOwningRepositoryResolution(resolution, projectCode);

        const content = input.content;
        if (typeof content !== 'string' || !content.trim()) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_input_invalid',
                'content is required',
                400,
                { field: 'content' }
            );
        }

        const repositoryPath = normalizeRepositoryRelativePath(input.path ?? input.repository_path);
        const baseHash = requiredString(input.base_hash ?? input.expected_hash, 'base_hash');
        const baseRevision = normalizeRevision(input.base_revision ?? input.expected_revision, 'base_revision');
        const idempotencyKey = requiredString(input.idempotency_key, 'idempotency_key');
        const contentHash = digest(content);
        const fingerprint = digest(JSON.stringify(stableValue({
            project_code: projectCode,
            path: repositoryPath,
            content_hash: contentHash,
            base_hash: baseHash,
            base_revision: baseRevision,
            source_class: SOURCE_CLASS,
            content_type: CONTENT_TYPE
        })));

        return {
            project_code: projectCode,
            path: repositoryPath,
            content,
            content_hash: contentHash,
            base_hash: baseHash,
            base_revision: baseRevision,
            idempotency_key: idempotencyKey,
            request_fingerprint: fingerprint,
            resolution,
            access: input.access || null
        };
    }

    assertProvider() {
        if (!this.provider || typeof this.provider.write !== 'function' || typeof this.provider.read !== 'function') {
            throw new CanonicalDocumentWriterError(
                'canonical_document_writer_not_configured',
                'canonical document writer is not configured',
                503
            );
        }
    }

    assertOwningRepositoryResolution(resolution, projectCode) {
        if (!resolution
            || resolution.status !== 'resolved'
            || resolution.source_class !== SOURCE_CLASS
            || resolution.content_type !== CONTENT_TYPE
            || resolution.project_code !== projectCode) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_route_invalid',
                'team_document must resolve to the owning repository before it can be saved',
                422,
                { required_source_class: SOURCE_CLASS, required_content_type: CONTENT_TYPE }
            );
        }

        const expectedRepository = `project:${projectCode}`;
        const repository = resolution.canonical_location?.repository;
        if (repository && repository !== expectedRepository) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_route_invalid',
                'resolution repository does not match project_code',
                422,
                { expected_repository: expectedRepository, repository }
            );
        }
    }

    async readback(request, writeResult = {}) {
        if (!writeResult || typeof writeResult !== 'object') {
            throw new CanonicalDocumentWriterError(
                'canonical_document_write_invalid',
                'canonical document provider returned an invalid write result',
                503
            );
        }
        const pathFromWrite = normalizeRepositoryRelativePath(writeResult.path ?? request.path);
        const readback = await this.provider.read({
            project_code: request.project_code,
            path: pathFromWrite,
            canonical_url: writeResult.canonical_url || null,
            access: request.access
        });
        if (!readback || typeof readback !== 'object' || typeof readback.content !== 'string') {
            throw new CanonicalDocumentWriterError(
                'canonical_document_readback_unavailable',
                'canonical document could not be read back after save',
                503
            );
        }

        const readbackPath = normalizeRepositoryRelativePath(readback.path ?? pathFromWrite);
        const readbackHash = readback.content_hash || digest(readback.content);
        if (readbackPath !== request.path || readbackHash !== request.content_hash || readback.content !== request.content) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_readback_mismatch',
                'canonical document readback does not match the requested content',
                502,
                {
                    path: request.path,
                    expected_content_hash: request.content_hash,
                    actual_content_hash: readbackHash,
                    actual_path: readbackPath
                }
            );
        }

        const revision = normalizeRevision(readback.revision ?? writeResult.revision, 'revision');
        return {
            status: 'saved',
            project_code: request.project_code,
            source_class: SOURCE_CLASS,
            content_type: CONTENT_TYPE,
            path: request.path,
            canonical_url: readback.canonical_url || writeResult.canonical_url || null,
            content_hash: request.content_hash,
            revision,
            readback: {
                path: readbackPath,
                content_hash: readbackHash,
                revision,
                canonical_url: readback.canonical_url || writeResult.canonical_url || null
            },
            search_indexed: 'unknown'
        };
    }

    normalizeProviderError(error) {
        if (error instanceof CanonicalDocumentWriterError) return error;
        const status = Number.isInteger(error?.status) ? error.status : 503;
        const code = typeof error?.code === 'string' && error.code
            ? error.code
            : 'canonical_document_writer_failed';
        return new CanonicalDocumentWriterError(
            code,
            status === 409 ? 'canonical document write conflicts with the current version' : 'canonical document writer is unavailable',
            status,
            status === 409 ? { provider_code: code } : {}
        );
    }
}

export function normalizeRepositoryRelativePath(value) {
    const raw = requiredString(value, 'path');
    if (raw.includes('\0') || raw.includes('\\') || raw.startsWith('/') || raw.startsWith('~') || /^[A-Za-z]:[\\/]/.test(raw)) {
        throw new CanonicalDocumentWriterError(
            'canonical_document_path_invalid',
            'path must be a repository-relative POSIX path',
            400,
            { field: 'path' }
        );
    }
    const segments = raw.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new CanonicalDocumentWriterError(
            'canonical_document_path_invalid',
            'path must not contain empty, dot, or parent segments',
            400,
            { field: 'path' }
        );
    }
    const normalized = path.posix.normalize(raw);
    if (normalized !== raw || normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
        throw new CanonicalDocumentWriterError(
            'canonical_document_path_invalid',
            'path must be a normalized repository-relative path',
            400,
            { field: 'path' }
        );
    }
    return normalized;
}

export const canonicalDocumentWriterInternals = { digest, stableValue };
