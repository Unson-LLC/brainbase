import { describe, expect, it, vi } from 'vitest';
import { GitHubRepositoryBootstrap } from '../../../server/services/project-provisioning/github-repository-bootstrap.js';

const repository = { owner: 'Unson-LLC', repo: 'growin-project', visibility: 'private' };
const organizationContext = { organizationId: 'org_unson' };
const organizationBindings = {
    org_unson: { owner: 'Unson-LLC', token: 'test-token' }
};

function response(status, body = {}) {
    return { status, ok: status >= 200 && status < 300, json: vi.fn(async () => body) };
}

describe('GitHubRepositoryBootstrap', () => {
    it('existing repositoryをvisibility込みでreadbackする', async () => {
        const fetchImpl = vi.fn(async () => response(200, {
            id: 10, name: 'growin-project', owner: { login: 'Unson-LLC' }, private: true,
            visibility: 'private', html_url: 'https://github.com/Unson-LLC/growin-project', default_branch: 'main'
        }));
        const service = new GitHubRepositoryBootstrap({ organizationBindings, fetchImpl });

        await expect(service.link(repository, organizationContext)).resolves.toMatchObject({
            status: 'verified', visibility: 'private', default_branch: 'main'
        });
    });

    it('createはtokenなしでfail closedする', async () => {
        const service = new GitHubRepositoryBootstrap({
            organizationBindings: { org_unson: { owner: 'Unson-LLC', token: '' } },
            fetchImpl: vi.fn()
        });
        await expect(service.create(repository, organizationContext)).rejects.toMatchObject({
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
        const service = new GitHubRepositoryBootstrap({ organizationBindings, fetchImpl });

        await expect(service.create(repository, organizationContext)).resolves.toMatchObject({ status: 'created_verified' });
        expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    });

    it('public repositoryを作成しprivate:falseで送信した結果をreadbackする', async () => {
        const publicRepository = { ...repository, repo: 'new-public-project', visibility: 'public' };
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response(404))
            .mockResolvedValueOnce(response(201, { id: 11 }))
            .mockResolvedValueOnce(response(200, {
                id: 11, name: 'new-public-project', owner: { login: 'Unson-LLC' }, private: false,
                visibility: 'public', html_url: 'https://github.com/Unson-LLC/new-public-project', default_branch: 'main'
            }));
        const service = new GitHubRepositoryBootstrap({ organizationBindings, fetchImpl });

        await expect(service.create(publicRepository, organizationContext)).resolves.toMatchObject({
            status: 'created_verified', visibility: 'public', default_branch: 'main'
        });
        expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toMatchObject({
            name: 'new-public-project', private: false, auto_init: true
        });
    });

    it('public repositoryのreadbackが成功する', async () => {
        const publicRepository = { ...repository, visibility: 'public' };
        const fetchImpl = vi.fn(async () => response(200, {
            id: 12, name: 'growin-project', owner: { login: 'Unson-LLC' }, private: false,
            visibility: 'public', html_url: 'https://github.com/Unson-LLC/growin-project', default_branch: 'main'
        }));
        const service = new GitHubRepositoryBootstrap({ organizationBindings, fetchImpl });

        await expect(service.link(publicRepository, organizationContext)).resolves.toMatchObject({
            status: 'verified', visibility: 'public', default_branch: 'main'
        });
    });

    it('public repositoryのreadbackがprivateなら拒否する', async () => {
        const publicRepository = { ...repository, visibility: 'public' };
        const fetchImpl = vi.fn(async () => response(200, {
            id: 13, name: 'growin-project', owner: { login: 'Unson-LLC' }, private: true,
            visibility: 'private', html_url: 'https://github.com/Unson-LLC/growin-project', default_branch: 'main'
        }));
        const service = new GitHubRepositoryBootstrap({ organizationBindings, fetchImpl });

        await expect(service.link(publicRepository, organizationContext)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_REPOSITORY_VISIBILITY_MISMATCH',
            statusCode: 409,
            details: { expected: 'public', actual: 'private' }
        });
    });

    it('別organizationに束縛されたownerへのread/createを通信前に拒否する', async () => {
        const fetchImpl = vi.fn();
        const service = new GitHubRepositoryBootstrap({ organizationBindings, fetchImpl });
        const otherOwnerRepository = { ...repository, owner: 'Other-Company' };

        await expect(service.read(otherOwnerRepository, organizationContext)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_REPOSITORY_OWNER_FORBIDDEN',
            statusCode: 403
        });
        await expect(service.create(otherOwnerRepository, organizationContext)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_REPOSITORY_OWNER_FORBIDDEN',
            statusCode: 403
        });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('organization bindingがない場合は通信前にfail closedする', async () => {
        const fetchImpl = vi.fn();
        const service = new GitHubRepositoryBootstrap({ organizationBindings, fetchImpl });

        await expect(service.read(repository, { organizationId: 'org_other' })).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_REPOSITORY_ORGANIZATION_BINDING_REQUIRED',
            statusCode: 503
        });
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
