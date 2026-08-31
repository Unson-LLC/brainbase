import { describe, expect, it, vi } from 'vitest';
import { GitHubRepositoryBootstrap } from '../../../server/services/project-provisioning/github-repository-bootstrap.js';

const repository = { owner: 'Unson-LLC', repo: 'growin-project', visibility: 'private' };

function response(status, body = {}) {
    return { status, ok: status >= 200 && status < 300, json: vi.fn(async () => body) };
}

describe('GitHubRepositoryBootstrap', () => {
    it('existing repositoryをvisibility込みでreadbackする', async () => {
        const fetchImpl = vi.fn(async () => response(200, {
            id: 10, name: 'growin-project', owner: { login: 'Unson-LLC' }, private: true,
            visibility: 'private', html_url: 'https://github.com/Unson-LLC/growin-project', default_branch: 'main'
        }));
        const service = new GitHubRepositoryBootstrap({ token: 'test-token', fetchImpl });

        await expect(service.link(repository)).resolves.toMatchObject({
            status: 'verified', visibility: 'private', default_branch: 'main'
        });
    });

    it('createはtokenなしでfail closedする', async () => {
        const service = new GitHubRepositoryBootstrap({ token: '', fetchImpl: vi.fn() });
        await expect(service.create(repository)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_REPOSITORY_BOOTSTRAP_UNAVAILABLE'
        });
    });

    it('create後にrepositoryをreadbackする', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response(404))
            .mockResolvedValueOnce(response(201, { id: 10 }))
            .mockResolvedValueOnce(response(200, {
                id: 10, name: 'growin-project', owner: { login: 'Unson-LLC' }, private: true,
                visibility: 'private', html_url: 'https://github.com/Unson-LLC/growin-project', default_branch: 'main'
            }));
        const service = new GitHubRepositoryBootstrap({ token: 'test-token', fetchImpl });

        await expect(service.create(repository)).resolves.toMatchObject({ status: 'created_verified' });
        expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    });
});
