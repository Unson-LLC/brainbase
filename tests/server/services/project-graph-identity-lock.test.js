import { describe, expect, it, vi } from 'vitest';
import { assertCatalogProjectSubjectMutation } from '../../../server/services/project-graph-identity-lock.js';

function clientWithProject(overrides = {}) {
    const query = vi.fn()
        .mockResolvedValueOnce({ rows: [{ project_registry: 'project_registry' }] })
        .mockResolvedValueOnce({ rows: [{
            project_code: 'brainbase',
            graph_entity_id: 'brainbase',
            graph_binding_status: 'linked',
            project_scope_compatible: true,
            ...overrides
        }] });
    return { query };
}

describe('canonical Project Graph identity guard', () => {
    it('allows Graph to change business metadata without matching a stale Registry projection', async () => {
        const client = clientWithProject();
        await expect(assertCatalogProjectSubjectMutation(client, {
            id: 'brainbase', entityType: 'project', projectId: 'project_brainbase',
            payload: {
                name: 'Brainbase canonical name', catalog_project_id: 'brainbase',
                catalog_version: 7, kind: 'product'
            },
            allowCompatible: true, identityLocked: true
        })).resolves.toMatchObject({ protected: true, compatible: true });
    });

    it('rejects a linked Registry row being rebound to a different Graph identity', async () => {
        const client = clientWithProject({ graph_entity_id: 'other-id' });
        await expect(assertCatalogProjectSubjectMutation(client, {
            id: 'brainbase', entityType: 'project', projectId: 'project_brainbase',
            payload: { name: 'Brainbase', catalog_project_id: 'brainbase', catalog_version: 1 },
            allowCompatible: true, identityLocked: true
        })).rejects.toMatchObject({
            code: 'GRAPH_PROJECT_CATALOG_SUBJECT_PROTECTED',
            details: { reason: 'canonical_graph_identity_mismatch' }
        });
    });
});
