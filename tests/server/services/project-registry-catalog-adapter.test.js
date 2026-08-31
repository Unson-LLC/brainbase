import { describe, expect, it, vi } from 'vitest';
import { ProjectRegistryCatalogAdapter } from '../../../server/services/project-provisioning/project-registry-catalog-adapter.js';

describe('ProjectRegistryCatalogAdapter', () => {
    it('organizationなしのreadinessはRegistry schemaの実在を確認する', async () => {
        const repository = { checkAvailability: vi.fn(async () => false) };
        const adapter = new ProjectRegistryCatalogAdapter({ repository });

        await expect(adapter.checkIntegrity()).resolves.toMatchObject({
            source: { status: 'unavailable', scope: 'schema' },
            summary: { errors: 1 }
        });
        expect(repository.checkAvailability).toHaveBeenCalledOnce();
    });

    it('catalog readをorganization contextで分離する', async () => {
        const repository = {
            listProjects: vi.fn(async () => [{
                project_code: 'growin-ai', display_name: 'Growin AI', catalog_version: 1,
                lifecycle_status: 'active'
            }])
        };
        const adapter = new ProjectRegistryCatalogAdapter({ repository });

        const catalog = await adapter.runForOrganization('org_a', () => adapter.getProjects());

        expect(repository.listProjects).toHaveBeenCalledWith('org_a');
        expect(catalog.projects[0]).toMatchObject({ id: 'growin-ai', name: 'Growin AI' });
    });

    it('organization contextなしではregistryもlegacy catalogも権威にしない', async () => {
        const repository = { listProjects: vi.fn(async () => [{
            project_code: 'growin-ai', display_name: 'Growin AI', catalog_version: 1,
            lifecycle_status: 'active', session_select: true
        }]) };
        const fallbackConfigParser = { getProjects: vi.fn(async () => ({
            root: '/workspace', projects: [{ id: 'brainbase', name: 'Brainbase' }]
        })) };
        const adapter = new ProjectRegistryCatalogAdapter({ repository, fallbackConfigParser });

        await expect(adapter.getProjects()).resolves.toMatchObject({
            projects: [],
            source: { status: 'organization_context_required', mode: 'registry_scope_required' }
        });
        expect(repository.listProjects).not.toHaveBeenCalled();
        expect(fallbackConfigParser.getProjects).not.toHaveBeenCalled();
    });

    it('registry rowを重ねてもlegacy aliasesを保ちrepositoryをgithub metadataへ投影する', async () => {
        const repository = { listProjects: vi.fn(async () => [{
            project_code: 'growin-ai', display_name: 'Growin AI', catalog_version: 2,
            lifecycle_status: 'active', session_select: true,
            repository: { mode: 'link_existing', owner: 'Unson-LLC', repo: 'growin-project' }
        }]) };
        const fallbackConfigParser = { getProjects: vi.fn(async () => ({
            projects: [{ id: 'growin-ai', aliases: ['growin'], github: { branch: 'develop' } }]
        })) };
        const adapter = new ProjectRegistryCatalogAdapter({ repository, fallbackConfigParser });

        const catalog = await adapter.runForOrganization('org_a', () => adapter.getProjects());

        expect(catalog.projects[0]).toMatchObject({
            id: 'growin-ai', aliases: ['growin'],
            github: { owner: 'Unson-LLC', repo: 'growin-project', branch: 'develop' }
        });
    });

    it('Registry取得成功時は同一IDのlegacy metadataだけを補完しfallback-only行を混入させない', async () => {
        const repository = { listProjects: vi.fn(async () => [{
            project_code: 'growin-ai', display_name: 'Growin AI', catalog_version: 2,
            lifecycle_status: 'active', session_select: true
        }]) };
        const fallbackConfigParser = { getProjects: vi.fn(async () => ({
            projects: [
                { id: 'growin-ai', aliases: ['growin'] },
                { id: 'other-organization-project', aliases: ['other'] }
            ]
        })) };
        const adapter = new ProjectRegistryCatalogAdapter({ repository, fallbackConfigParser });

        const catalog = await adapter.runForOrganization('org_a', () => adapter.getProjects());

        expect(catalog.projects).toHaveLength(1);
        expect(catalog.projects[0]).toMatchObject({ id: 'growin-ai', aliases: ['growin'] });
        expect(catalog.source).toEqual({ status: 'loaded', mode: 'registry_scoped' });
    });

    it('Registry unavailable時はlegacy catalogをmembershipに使わず空一覧を返す', async () => {
        const missingTable = Object.assign(new Error('missing relation'), { code: '42P01' });
        const repository = { listProjects: vi.fn(async () => { throw missingTable; }) };
        const fallbackConfigParser = { getProjects: vi.fn(async () => ({ projects: [{ id: 'brainbase' }] })) };
        const adapter = new ProjectRegistryCatalogAdapter({ repository, fallbackConfigParser });

        await expect(adapter.runForOrganization('org_a', () => adapter.getProjects()))
            .resolves.toMatchObject({
                projects: [],
                source: { status: 'unavailable', mode: 'registry_unavailable', code: '42P01' }
            });
    });
});
