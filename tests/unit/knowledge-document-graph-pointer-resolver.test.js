import { describe, expect, it, vi } from 'vitest';

import {
    KnowledgeDocumentGraphPointerResolver,
    resolveRegisteredDocumentPointer
} from '../../server/services/knowledge-document-graph-pointer-resolver.js';
import { KnowledgeDocumentGraphRepository } from '../../server/services/knowledge-document-graph-repository.js';

const access = {
    projectCodes: ['alpha'],
    personId: 'person_1',
    organizationId: 'org_1',
    role: 'member',
    clearance: ['internal']
};

function registration(overrides = {}) {
    return {
        organization_id: 'org_1',
        tenant_id: 'org_1',
        project_code: 'alpha',
        source_class: 'owning_repo',
        content_type: 'team_document',
        repository_owner: 'unson',
        repository_name: 'alpha-docs',
        branch: 'main',
        path_scope: 'docs',
        graph_project_id: 'graph-project-1',
        graph_entity_id: 'graph-project-subject-1',
        graph_entity_type: 'project',
        graph_entity_lifecycle_status: 'active',
        registration_status: 'active',
        registered_by: 'person_1',
        registry_repository: { mode: 'link_existing', owner: 'unson', repo: 'alpha-docs' },
        ...overrides
    };
}

describe('KnowledgeDocumentGraphPointerResolver', () => {
    it('resolves only a complete tenant-scoped active Graph registration', async () => {
        const graphRepository = {
            readDocumentSourceRegistration: vi.fn(async () => registration())
        };
        const resolver = new KnowledgeDocumentGraphPointerResolver({ graphRepository });

        await expect(resolver.resolve({ access, project_code: 'alpha' })).resolves.toMatchObject({
            status: 'resolved',
            source_class: 'owning_repo',
            content_type: 'team_document',
            canonical_location: {
                repository: 'project:alpha',
                owner: 'unson',
                repo: 'alpha-docs',
                tenant_id: 'org_1',
                branch: 'main',
                path: 'docs/'
            },
            graph_registration: {
                graph_project_id: 'graph-project-1',
                graph_entity_id: 'graph-project-subject-1'
            }
        });
        expect(graphRepository.readDocumentSourceRegistration).toHaveBeenCalledWith(
            { project_code: 'alpha' },
            { access }
        );
    });

    it('returns 503 when the Graph registration is absent or inactive', async () => {
        const resolver = new KnowledgeDocumentGraphPointerResolver({
            graphRepository: { readDocumentSourceRegistration: vi.fn(async () => null) }
        });
        await expect(resolver.resolve({ access, project_code: 'alpha' }))
            .rejects.toMatchObject({ code: 'knowledge_document_graph_pointer_required', status: 503 });

        expect(() => resolveRegisteredDocumentPointer(registration({ registration_status: 'revoked' }), {
            access,
            projectCode: 'alpha'
        })).toThrowError(expect.objectContaining({
            code: 'knowledge_document_graph_pointer_required',
            status: 503
        }));
    });

    it('rejects a registration whose tenant or registry repository differs from the request', () => {
        expect(() => resolveRegisteredDocumentPointer(registration({ tenant_id: 'org_other' }), {
            access,
            projectCode: 'alpha'
        })).toThrowError(expect.objectContaining({ code: 'knowledge_document_tenant_mismatch', status: 403 }));

        expect(() => resolveRegisteredDocumentPointer(registration({
            registry_repository: { mode: 'link_existing', owner: 'other', repo: 'alpha-docs' }
        }), { access, projectCode: 'alpha' })).toThrowError(expect.objectContaining({
            code: 'knowledge_document_graph_pointer_mismatch',
            status: 503
        }));
    });
});

describe('KnowledgeDocumentGraphRepository', () => {
    it('registers only the linked active Project Graph target and verifies readback', async () => {
        const row = registration();
        const client = {
            query: vi.fn(async (sql) => {
                const text = String(sql);
                if (text.includes('SELECT p.id AS graph_project_id')) {
                    return {
                        rows: [{
                            graph_project_id: row.graph_project_id,
                            project_code: row.project_code,
                            organization_id: row.organization_id,
                            graph_entity_id: row.graph_entity_id,
                            graph_binding_status: 'linked',
                            repository: row.registry_repository,
                            graph_entity_type: 'project',
                            graph_entity_lifecycle_status: 'active'
                        }]
                    };
                }
                if (text.includes('FROM knowledge_document_source_registrations')) return { rows: [row] };
                return { rows: [] };
            })
        };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, handler) => handler(client)),
            assertWriteAccess: vi.fn()
        };
        const repository = new KnowledgeDocumentGraphRepository({ infoSSOTService });

        const result = await repository.registerDocumentSourceRegistration({
            project_code: 'alpha',
            tenant_id: 'org_1',
            repository_owner: 'unson',
            repository_name: 'alpha-docs',
            branch: 'main',
            path_scope: 'docs/'
        }, { access });

        expect(result).toMatchObject({
            project_code: 'alpha',
            graph_entity_id: 'graph-project-subject-1',
            registration_status: 'active'
        });
        expect(infoSSOTService.assertWriteAccess).toHaveBeenCalledWith(access, {
            projectCode: 'alpha', roleMin: 'member', sensitivity: 'internal'
        });
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO knowledge_document_source_registrations')))
            .toBe(true);
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('FROM knowledge_document_source_registrations')))
            .toBe(true);
    });

    it('rejects owner/repository drift before persisting a registration', async () => {
        const client = {
            query: vi.fn(async (sql) => String(sql).includes('SELECT p.id AS graph_project_id')
                ? { rows: [{
                    graph_project_id: 'graph-project-1',
                    project_code: 'alpha',
                    organization_id: 'org_1',
                    graph_entity_id: 'graph-project-subject-1',
                    graph_binding_status: 'linked',
                    repository: { mode: 'link_existing', owner: 'unson', repo: 'alpha-docs' },
                    graph_entity_type: 'project',
                    graph_entity_lifecycle_status: 'active'
                }] }
                : { rows: [] })
        };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, handler) => handler(client)),
            assertWriteAccess: vi.fn()
        };
        const repository = new KnowledgeDocumentGraphRepository({ infoSSOTService });

        await expect(repository.registerDocumentSourceRegistration({
            project_code: 'alpha',
            tenant_id: 'org_1',
            repository_owner: 'other',
            repository_name: 'alpha-docs',
            branch: 'main',
            path_scope: 'docs'
        }, { access })).rejects.toMatchObject({
            code: 'knowledge_document_graph_repository_mismatch',
            status: 409
        });
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO knowledge_document_source_registrations')))
            .toBe(false);
    });

    it('requires an explicit tenant on registration input', async () => {
        const repository = new KnowledgeDocumentGraphRepository({
            infoSSOTService: {
                withAccessContext: vi.fn(),
                assertWriteAccess: vi.fn()
            }
        });

        await expect(repository.registerDocumentSourceRegistration({
            project_code: 'alpha',
            repository_owner: 'unson',
            repository_name: 'alpha-docs',
            branch: 'main',
            path_scope: 'docs'
        }, { access })).rejects.toMatchObject({
            code: 'knowledge_document_graph_registration_required',
            status: 403,
            details: { field: 'tenant_id' }
        });
    });
});
