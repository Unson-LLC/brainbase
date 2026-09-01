function githubError(message, code, statusCode, details) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    error.details = details;
    return error;
}

export class GitHubRepositoryBootstrap {
    constructor({ organizationBindings, env = process.env, fetchImpl = globalThis.fetch, apiBase = 'https://api.github.com' } = {}) {
        this.organizationBindings = organizationBindings ?? this.parseOrganizationBindings(env);
        this.fetch = fetchImpl;
        this.apiBase = apiBase.replace(/\/$/u, '');
    }

    parseOrganizationBindings(env) {
        const raw = String(env.PROJECT_PROVISIONING_GITHUB_BINDINGS || '').trim();
        if (!raw) return {};
        let configured;
        try {
            configured = JSON.parse(raw);
        } catch {
            throw githubError(
                'PROJECT_PROVISIONING_GITHUB_BINDINGS must be valid JSON',
                'PROJECT_PROVISIONING_REPOSITORY_ORGANIZATION_BINDING_INVALID',
                503
            );
        }
        return Object.fromEntries(Object.entries(configured).map(([organizationId, binding]) => [
            organizationId,
            {
                owner: String(binding?.owner || '').trim(),
                token: String(env[String(binding?.token_env || '')] || '')
            }
        ]));
    }

    resolveBinding(repository, { organizationId } = {}) {
        const normalizedOrganizationId = String(organizationId || '').trim();
        const binding = this.organizationBindings[normalizedOrganizationId];
        if (!normalizedOrganizationId || !binding?.owner) {
            throw githubError(
                'GitHub repository organization binding is required',
                'PROJECT_PROVISIONING_REPOSITORY_ORGANIZATION_BINDING_REQUIRED',
                503,
                { organization_id: normalizedOrganizationId || null }
            );
        }
        if (binding.owner.toLowerCase() !== String(repository.owner || '').trim().toLowerCase()) {
            throw githubError(
                'GitHub repository owner is not authorized for this organization',
                'PROJECT_PROVISIONING_REPOSITORY_OWNER_FORBIDDEN',
                403,
                { organization_id: normalizedOrganizationId, expected_owner: binding.owner }
            );
        }
        return binding;
    }

    headers(token) {
        return {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        };
    }

    async read(repository, context) {
        const { token } = this.resolveBinding(repository, context);
        if (repository.visibility === 'private' && !token) {
            throw githubError('An organization-scoped GitHub token is required to verify a private repository', 'PROJECT_PROVISIONING_REPOSITORY_READBACK_UNAVAILABLE', 503);
        }
        const response = await this.fetch(
            `${this.apiBase}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`,
            { headers: this.headers(token) }
        );
        if (response.status === 404) return null;
        if (!response.ok) {
            throw githubError('GitHub repository readback failed', 'PROJECT_PROVISIONING_REPOSITORY_READBACK_FAILED', 502, {
                github_status: response.status
            });
        }
        const body = await response.json();
        return {
            provider: 'github',
            owner: body.owner?.login || repository.owner,
            repo: body.name || repository.repo,
            url: body.html_url,
            visibility: body.visibility || (body.private ? 'private' : 'public'),
            default_branch: body.default_branch,
            github_repository_id: body.id
        };
    }

    async link(repository, context) {
        const readback = await this.read(repository, context);
        if (!readback) {
            throw githubError('GitHub repository does not exist', 'PROJECT_PROVISIONING_REPOSITORY_NOT_FOUND', 409);
        }
        if (readback.visibility !== repository.visibility) {
            throw githubError('GitHub repository visibility differs from Manifest', 'PROJECT_PROVISIONING_REPOSITORY_VISIBILITY_MISMATCH', 409, {
                expected: repository.visibility,
                actual: readback.visibility
            });
        }
        return { mode: 'link_existing', status: 'verified', ...readback };
    }

    async create(repository, context) {
        const { token } = this.resolveBinding(repository, context);
        if (!token) {
            throw githubError('An organization-scoped GitHub token is required for Repository Bootstrap', 'PROJECT_PROVISIONING_REPOSITORY_BOOTSTRAP_UNAVAILABLE', 503);
        }
        const existing = await this.read(repository, context);
        if (existing) {
            if (existing.visibility !== repository.visibility) {
                throw githubError('Existing GitHub repository visibility differs from Manifest', 'PROJECT_PROVISIONING_REPOSITORY_VISIBILITY_MISMATCH', 409);
            }
            return { mode: 'create', status: 'already_exists_verified', ...existing };
        }
        const response = await this.fetch(`${this.apiBase}/orgs/${encodeURIComponent(repository.owner)}/repos`, {
            method: 'POST',
            headers: { ...this.headers(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: repository.repo,
                private: repository.visibility !== 'public',
                auto_init: true
            })
        });
        if (!response.ok) {
            throw githubError('GitHub repository creation failed', 'PROJECT_PROVISIONING_REPOSITORY_CREATE_FAILED', 502, {
                github_status: response.status
            });
        }
        const readback = await this.read(repository, context);
        if (!readback || readback.visibility !== repository.visibility) {
            throw githubError('GitHub repository create readback failed', 'PROJECT_PROVISIONING_REPOSITORY_READBACK_FAILED', 502);
        }
        return { mode: 'create', status: 'created_verified', ...readback };
    }
}
