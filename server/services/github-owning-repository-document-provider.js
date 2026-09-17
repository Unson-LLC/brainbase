import { createHash } from 'node:crypto';

import {
    CanonicalDocumentWriterError,
    normalizeRepositoryRelativePath
} from './canonical-document-writer-adapter.js';

const DEFAULT_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const SOURCE_CLASS = 'owning_repo';
const CONTENT_TYPE = 'team_document';

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

function documentContent(value) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new CanonicalDocumentWriterError(
            'canonical_document_input_invalid',
            'content is required',
            400,
            { field: 'content' }
        );
    }
    return value;
}

function digest(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function immutableRevision(value) {
    const revision = requiredString(value, 'version');
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(revision)) {
        throw new CanonicalDocumentWriterError(
            'canonical_document_version_invalid',
            'version must be an immutable Git commit SHA',
            422,
            { field: 'version' }
        );
    }
    return revision;
}

function normalizeApiBaseUrl(value) {
    const raw = requiredString(value || DEFAULT_API_BASE_URL, 'apiBaseUrl');
    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new TypeError('apiBaseUrl must be an absolute URL');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new TypeError('apiBaseUrl must be an HTTP(S) URL without credentials or query parameters');
    }
    return url.toString().replace(/\/$/u, '');
}

function repositorySegment(value, name) {
    const normalized = requiredString(value, name);
    if (!/^[A-Za-z0-9_.-]+$/u.test(normalized)) {
        throw new CanonicalDocumentWriterError(
            'canonical_document_repository_invalid',
            `${name} is invalid`,
            422,
            { field: name }
        );
    }
    return normalized;
}

function encodePath(path) {
    return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function normalizePathPrefix(value) {
    const raw = graphPointerString(value, 'canonical_location.path');
    const withoutTrailingSlash = raw.replace(/\/+$/u, '');
    if (!withoutTrailingSlash) {
        throw new CanonicalDocumentWriterError(
            'canonical_document_pointer_invalid',
            'canonical location path must identify a repository scope',
            422,
            { field: 'canonical_location.path' }
        );
    }
    return normalizeRepositoryRelativePath(withoutTrailingSlash);
}

function pathInScope(repositoryPath, pathPrefix) {
    return repositoryPath === pathPrefix || repositoryPath.startsWith(`${pathPrefix}/`);
}

function graphPointerString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new CanonicalDocumentWriterError(
            'canonical_document_graph_pointer_required',
            `${name} must be supplied by the resolved owning repository Graph pointer`,
            503,
            { field: name }
        );
    }
    return value.trim();
}

function accessAllowsProject(access, projectCode) {
    return Array.isArray(access?.projectCodes) && access.projectCodes.includes(projectCode);
}

function owningRepoPointer(resolution, projectCode, repositoryPath, branch) {
    if (!resolution
        || resolution.status !== 'resolved'
        || resolution.source_class !== SOURCE_CLASS
        || resolution.content_type !== CONTENT_TYPE
        || resolution.project_code !== projectCode) {
        throw new CanonicalDocumentWriterError(
            'canonical_document_route_invalid',
            'the resolved knowledge pointer is not an owning repository team document',
            422,
            { required_source_class: SOURCE_CLASS, required_content_type: CONTENT_TYPE }
        );
    }

    const location = resolution.canonical_location;
    if (!location || location.repository !== `project:${projectCode}`) {
        throw new CanonicalDocumentWriterError(
            'canonical_document_pointer_invalid',
            'the owning repository pointer does not match the project',
            422,
            { expected_repository: `project:${projectCode}` }
        );
    }

    const pointerBranch = graphPointerString(location.branch, 'canonical_location.branch');
    if (branch && branch !== pointerBranch) {
        throw new CanonicalDocumentWriterError(
            'canonical_document_pointer_mismatch',
            'requested branch does not match the resolved owning repository pointer',
            422,
            { field: 'branch' }
        );
    }

    const pathPrefix = normalizePathPrefix(location.path || location.path_prefix || location.path_scope);
    if (!pathInScope(repositoryPath, pathPrefix)) {
        throw new CanonicalDocumentWriterError(
            'canonical_document_path_outside_pointer',
            'path is outside the resolved owning repository scope',
            422,
            { path: repositoryPath, path_prefix: `${pathPrefix}/` }
        );
    }

    return {
        branch: pointerBranch,
        path_prefix: pathPrefix,
        owner: graphPointerString(
            location.owner || location.github_owner || location.github?.owner,
            'canonical_location.owner'
        ),
        repo: graphPointerString(
            location.repo || location.github_repo || location.github?.repo,
            'canonical_location.repo'
        ),
        tenant_id: graphPointerString(
            location.tenant_id || location.organization_id,
            'canonical_location.tenant_id'
        )
    };
}

function parseJsonContent(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/gu, '');
    if (!normalized) return '';
    try {
        return Buffer.from(normalized, 'base64').toString('utf8');
    } catch {
        return null;
    }
}

/**
 * GitHub Contents API implementation of the canonical owning-repository
 * provider. It deliberately uses an injected fetch and token so tests can
 * exercise the HTTP contract without contacting GitHub.
 *
 * ConfigParser mappings resolve owner/repository only. Branch and path scope
 * come from the resolved owning_repo pointer and are mandatory; the mapping's
 * default branch is never used as a write authority.
 */
export class GitHubOwningRepositoryDocumentProvider {
    constructor({
        configParser = null,
        token = null,
        tokenProvider = null,
        fetchImpl = globalThis.fetch,
        apiBaseUrl = DEFAULT_API_BASE_URL,
        repositoryResolver = null
    } = {}) {
        this.configParser = configParser;
        this.token = typeof token === 'string' ? token.trim() : '';
        this.tokenProvider = tokenProvider;
        this.fetchImpl = fetchImpl;
        this.apiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
        this.repositoryResolver = repositoryResolver;
        this.completed = new Map();
    }

    async saveToken() {
        const candidate = this.tokenProvider ? await this.tokenProvider() : this.token;
        const token = typeof candidate === 'string' ? candidate.trim() : '';
        if (!token) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_writer_not_configured',
                'GitHub document writer authentication is not configured',
                503
            );
        }
        return token;
    }

    async resolveTarget(input) {
        const projectCode = requiredString(input?.project_code, 'project_code');
        const repositoryPath = normalizeRepositoryRelativePath(input?.path);
        if (!accessAllowsProject(input?.access, projectCode)) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_project_not_authorized',
                'project is not authorized for the canonical document provider',
                403
            );
        }

        const pointer = owningRepoPointer(input.resolution, projectCode, repositoryPath, input.branch);
        const accessTenant = input.access?.tenantId || input.access?.organizationId;
        if (typeof accessTenant !== 'string' || !accessTenant.trim()) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_tenant_required',
                'authenticated organization is required for canonical document storage',
                403
            );
        }
        if (pointer.tenant_id !== accessTenant.trim()) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_tenant_mismatch',
                'resolved owning repository tenant is not authorized',
                403,
                { expected_tenant_id: accessTenant.trim(), pointer_tenant_id: pointer.tenant_id }
            );
        }
        let mapping;
        try {
            mapping = this.repositoryResolver
                ? await this.repositoryResolver({ project_code: projectCode, resolution: input.resolution, access: input.access })
                : (await this.configParser?.getGitHubMappings?.() || [])
                    .find((candidate) => candidate?.project_id === projectCode);
        } catch {
            throw new CanonicalDocumentWriterError(
                'canonical_document_writer_unavailable',
                'canonical document repository mapping is unavailable',
                503
            );
        }
        if (!mapping) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_owning_repo_unconfigured',
                'the owning repository is not configured for this project',
                503
            );
        }

        const owner = repositorySegment(mapping.owner, 'owner');
        const repo = repositorySegment(mapping.repo, 'repo');
        if (pointer.owner !== owner || pointer.repo !== repo) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_pointer_mismatch',
                'configured repository does not match the resolved owning repository pointer',
                422,
                { project_code: projectCode }
            );
        }
        return {
            project_code: projectCode,
            owner,
            repo,
            branch: pointer.branch,
            path_prefix: pointer.path_prefix,
            tenant_id: pointer.tenant_id
        };
    }

    contentUrl(target, repositoryPath) {
        return `${this.apiBaseUrl}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${encodePath(repositoryPath)}`;
    }

    refUrl(target) {
        return `${this.apiBaseUrl}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/git/ref/heads/${encodeURIComponent(target.branch)}`;
    }

    commitsUrl(target, repositoryPath) {
        return `${this.apiBaseUrl}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/commits?path=${encodeURIComponent(repositoryPath)}&sha=${encodeURIComponent(target.branch)}&per_page=1`;
    }

    async request(url, { method = 'GET', token, body = undefined, operation } = {}) {
        if (typeof this.fetchImpl !== 'function') {
            throw new CanonicalDocumentWriterError(
                'canonical_document_writer_unavailable',
                'GitHub document writer HTTP client is not configured',
                503
            );
        }
        const options = {
            method,
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': GITHUB_API_VERSION
            }
        };
        if (body !== undefined) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }

        let response;
        try {
            response = await this.fetchImpl(url, options);
        } catch {
            throw new CanonicalDocumentWriterError(
                'canonical_document_writer_unavailable',
                'GitHub document writer HTTP request failed',
                503,
                { operation }
            );
        }

        const status = Number(response?.status) || 503;
        let payload = null;
        try {
            payload = typeof response?.json === 'function' ? await response.json() : null;
        } catch {
            payload = null;
        }
        const ok = response?.ok === true || (status >= 200 && status < 300);
        if (ok) return payload || {};

        if (status === 401 || status === 403) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_writer_auth_failed',
                'GitHub document writer authentication is unavailable',
                503,
                { operation, provider_status: status }
            );
        }
        if (status === 409 || status === 412) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_cas_conflict',
                'canonical document write conflicts with the current version',
                409,
                { operation, provider_status: status }
            );
        }
        throw new CanonicalDocumentWriterError(
            status === 404 ? 'canonical_document_source_not_found' : 'canonical_document_writer_failed',
            status === 404 ? 'canonical document source was not found' : 'GitHub document writer request failed',
            status >= 400 && status < 500 ? status : 503,
            { operation, provider_status: status }
        );
    }

    async getFile(target, repositoryPath, token, reference = target.branch) {
        let payload;
        try {
            payload = await this.request(`${this.contentUrl(target, repositoryPath)}?ref=${encodeURIComponent(reference)}`, {
                token,
                operation: 'read_file'
            });
        } catch (error) {
            if (error?.code === 'canonical_document_source_not_found') return null;
            throw error;
        }
        if (payload?.type && payload.type !== 'file') {
            throw new CanonicalDocumentWriterError(
                'canonical_document_source_not_found',
                'canonical document source is not a file',
                404
            );
        }
        return payload;
    }

    async latestPathCommit(target, repositoryPath, token) {
        const payload = await this.request(this.commitsUrl(target, repositoryPath), {
            token,
            operation: 'read_path_commit'
        });
        const commit = Array.isArray(payload) ? payload[0] : null;
        const message = commit?.commit?.message || commit?.message || '';
        const revision = commit?.sha || commit?.commit?.tree?.sha || null;
        return {
            revision: typeof revision === 'string' && revision.trim() ? revision.trim() : null,
            message: typeof message === 'string' ? message : ''
        };
    }

    async getRevision(target, token) {
        const payload = await this.request(this.refUrl(target), {
            token,
            operation: 'read_revision'
        });
        const revision = payload?.object?.sha || payload?.sha;
        if (typeof revision !== 'string' || !revision.trim()) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_readback_unavailable',
                'GitHub did not return a repository revision',
                503
            );
        }
        return revision.trim();
    }

    async write(input = {}) {
        const target = await this.resolveTarget(input);
        const token = await this.saveToken();
        const repositoryPath = normalizeRepositoryRelativePath(input.path);
        const rawBaseHash = input.base_hash;
        const baseHash = rawBaseHash === undefined || rawBaseHash === null || rawBaseHash === ''
            ? null
            : requiredString(rawBaseHash, 'base_hash');
        const baseRevision = requiredString(input.base_revision, 'base_revision');
        const idempotencyKey = requiredString(input.idempotency_key, 'idempotency_key');
        const fingerprint = requiredString(input.request_fingerprint, 'request_fingerprint');
        const content = documentContent(input.content);
        const replay = this.completed.get(idempotencyKey);
        if (replay) {
            if (replay.fingerprint !== fingerprint) {
                throw new CanonicalDocumentWriterError(
                    'canonical_document_idempotency_conflict',
                    'idempotency_key was already used with different document content',
                    409
                );
            }
            return { ...replay.result, idempotency_replayed: true };
        }

        const current = await this.getFile(target, repositoryPath, token);
        const currentContent = current ? parseJsonContent(current.content) : null;
        const currentRevision = await this.getRevision(target, token);

        // A remote PUT may succeed while its response is lost. Recover the
        // matching commit from GitHub, including after process restart.
        if (current
            && currentContent === content
            && currentRevision !== baseRevision) {
            const latest = await this.latestPathCommit(target, repositoryPath, token);
            if (latest.message.includes(`Brainbase-Document-Request: ${fingerprint}`)) {
                const result = {
                    path: current.path || repositoryPath,
                    canonical_url: current.html_url || null,
                    revision: latest.revision || currentRevision
                };
                if (!result.revision) {
                    throw new CanonicalDocumentWriterError(
                        'canonical_document_readback_unavailable',
                        'GitHub did not return the recovered commit revision',
                        503
                    );
                }
                this.completed.set(idempotencyKey, { fingerprint, result });
                return { ...result, idempotency_replayed: true };
            }
        }

        if (current && baseHash === null) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_cas_conflict',
                'base_hash is required when the canonical document already exists',
                409,
                { actual_hash: current.sha || null }
            );
        }
        if (!current && baseHash !== null) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_cas_conflict',
                'canonical document was deleted before the update',
                409,
                { expected_hash: baseHash, actual_hash: null }
            );
        }
        if (current && current.sha !== baseHash) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_cas_conflict',
                'canonical document write conflicts with the current file version',
                409,
                { expected_hash: baseHash, actual_hash: current?.sha || null }
            );
        }
        if (currentRevision !== baseRevision) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_cas_conflict',
                'canonical document write conflicts with the current repository revision',
                409,
                { expected_revision: baseRevision, actual_revision: currentRevision }
            );
        }

        const payload = await this.request(this.contentUrl(target, repositoryPath), {
            method: 'PUT',
            token,
            operation: 'write_file',
            body: {
                message: `${current ? 'knowledge: update' : 'knowledge: create'} ${repositoryPath}\n\nBrainbase-Document-Request: ${fingerprint}`,
                content: Buffer.from(content, 'utf8').toString('base64'),
                ...(baseHash ? { sha: baseHash } : {}),
                branch: target.branch
            }
        });
        const revision = payload?.commit?.sha;
        if (typeof revision !== 'string' || !revision.trim()) {
            throw new CanonicalDocumentWriterError(
                'canonical_document_write_invalid',
                'GitHub did not return the write commit revision',
                503
            );
        }
        const result = {
            path: payload?.content?.path || repositoryPath,
            canonical_url: payload?.content?.html_url || payload?.commit?.html_url || null,
            revision: revision.trim()
        };
        this.completed.set(idempotencyKey, { fingerprint, result });
        return { ...result, idempotency_replayed: false };
    }

    async read(input = {}) {
        const target = await this.resolveTarget(input);
        const token = await this.saveToken();
        const repositoryPath = normalizeRepositoryRelativePath(input.path);
        const payload = await this.getFile(target, repositoryPath, token);
        const content = parseJsonContent(payload?.content);
        if (content === null || typeof content !== 'string') {
            throw new CanonicalDocumentWriterError(
                'canonical_document_readback_unavailable',
                'GitHub did not return decodable canonical document content',
                503
            );
        }
        const revision = await this.getRevision(target, token);
        return {
            path: payload?.path || repositoryPath,
            content,
            content_hash: digest(content),
            revision,
            canonical_url: payload?.html_url || `https://github.com/${target.owner}/${target.repo}/blob/${encodePath(target.branch)}/${encodePath(repositoryPath)}`
        };
    }

    async readVersion(input = {}) {
        const revision = immutableRevision(input.version);
        const target = await this.resolveTarget(input);
        const token = await this.saveToken();
        const repositoryPath = normalizeRepositoryRelativePath(input.path);
        const payload = await this.getFile(target, repositoryPath, token, revision);
        const content = parseJsonContent(payload?.content);
        if (content === null || typeof content !== 'string') {
            throw new CanonicalDocumentWriterError(
                'canonical_document_readback_unavailable',
                'GitHub did not return decodable canonical document content',
                503
            );
        }
        return {
            path: payload?.path || repositoryPath,
            content,
            content_hash: digest(content),
            revision,
            canonical_url: payload?.html_url || `https://github.com/${target.owner}/${target.repo}/blob/${encodePath(revision)}/${encodePath(repositoryPath)}`
        };
    }
}

export const githubOwningRepositoryInternals = {
    digest,
    immutableRevision,
    normalizeApiBaseUrl,
    normalizePathPrefix,
    pathInScope
};
