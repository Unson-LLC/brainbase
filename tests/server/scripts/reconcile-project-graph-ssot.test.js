import { describe, expect, it, vi } from 'vitest';
import {
    classifyProjectBinding,
    runProjectGraphReconciliation
} from '../../../scripts/reconcile-project-graph-ssot.js';

const row = (overrides = {}) => ({
    project_code: 'brainbase',
    scope_id: 'project_brainbase',
    graph_entity_id: null,
    canonical_id_occupancy: null,
    candidates: [],
    ...overrides
});

describe('project Graph SSOT reconciliation classification', () => {
    it('creates the canonical Graph subject when the registry has no candidate', () => {
        expect(classifyProjectBinding(row())).toMatchObject({ action: 'create_canonical', conflicts: [] });
    });

    it('uses the technical project identity when the code ID belongs to a non-project subject', () => {
        const result = classifyProjectBinding(row({
            canonical_id_occupancy: { entity_id: 'brainbase', entity_type: 'org' },
            candidates: [{ id: 'project_brainbase', payload: { name: 'Brainbase' } }]
        }));
        expect(result).toMatchObject({
            action: 'link_existing', canonical_entity_id: 'project_brainbase',
            merge_entity_ids: [], conflicts: []
        });
    });

    it('keeps an exact canonical subject and merges only the deterministic technical duplicate', () => {
        const result = classifyProjectBinding(row({ candidates: [
            { id: 'brainbase', payload: { catalog_project_id: 'brainbase' } },
            { id: 'project_brainbase', payload: { code: 'brainbase' } }
        ] }));
        expect(result).toMatchObject({
            action: 'link_existing', canonical_entity_id: 'brainbase',
            merge_entity_ids: ['project_brainbase'], conflicts: []
        });
    });

    it('keeps the exact catalog subject and merges legacy code-only duplicates', () => {
        const result = classifyProjectBinding(row({ candidates: [
            { id: 'brainbase', payload: { catalog_project_id: 'brainbase', code: 'brainbase' } },
            { id: 'project_legacy', payload: { code: 'brainbase' } }
        ] }));
        expect(result).toMatchObject({
            action: 'link_existing', canonical_entity_id: 'brainbase',
            merge_entity_ids: ['project_legacy'], conflicts: []
        });
    });

    it('creates the code-id canonical subject and merges multiple legacy code-only duplicates', () => {
        const result = classifyProjectBinding(row({ candidates: [
            { id: 'legacy_b', payload: { code: 'brainbase' } },
            { id: 'legacy_a', payload: { code: 'brainbase' } }
        ] }));
        expect(result).toMatchObject({
            action: 'create_canonical', canonical_entity_id: 'brainbase',
            merge_entity_ids: ['legacy_a', 'legacy_b'], conflicts: []
        });
    });

    it('does not guess when multiple non-canonical Graph candidates exist', () => {
        const result = classifyProjectBinding(row({ candidates: [
            { id: 'legacy_a', payload: { catalog_project_id: 'brainbase' } },
            { id: 'legacy_b', payload: { catalog_project_id: 'another-project' } }
        ] }));
        expect(result).toMatchObject({ action: 'ambiguous', canonical_entity_id: null });
        expect(result.conflicts).toEqual(['legacy_a', 'legacy_b']);
    });

    it('preserves an already linked non-code Graph identity', () => {
        const result = classifyProjectBinding(row({
            graph_entity_id: 'legacy_a',
            candidates: [{ id: 'legacy_a', payload: { code: 'brainbase' } }]
        }));
        expect(result).toMatchObject({ action: 'link_existing', canonical_entity_id: 'legacy_a' });
    });

    it('links the only candidate selected by the project-code identity predicates', () => {
        const result = classifyProjectBinding(row({
            candidates: [{ id: 'legacy_a', payload: { catalog_project_id: 'brainbase' } }]
        }));
        expect(result).toMatchObject({
            action: 'link_existing', canonical_entity_id: 'legacy_a',
            merge_entity_ids: [], conflicts: []
        });
    });

    it('is idempotent after a deterministic technical duplicate was marked merged', () => {
        const result = classifyProjectBinding(row({ candidates: [
            { id: 'brainbase', lifecycle_status: 'active' },
            { id: 'project_brainbase', lifecycle_status: 'merged', payload: { canonical_entity_id: 'brainbase' } }
        ] }));
        expect(result).toMatchObject({
            action: 'link_existing', canonical_entity_id: 'brainbase', merge_entity_ids: [], conflicts: []
        });
    });

    it('does not ignore a second active candidate after a binding already exists', () => {
        const result = classifyProjectBinding(row({
            graph_entity_id: 'brainbase',
            candidates: [{ id: 'brainbase' }, { id: 'legacy_other' }]
        }));
        expect(result).toMatchObject({
            action: 'ambiguous', canonical_entity_id: 'brainbase', conflicts: ['legacy_other']
        });
    });

    it('enumerates each organization and exposes all of its Graph storage scopes before reading RLS data', async () => {
        const query = vi.fn(async (sql) => {
            if (sql.includes('SELECT DISTINCT organization_id AS id')) return { rows: [{ id: 'org_a' }] };
            if (sql === 'SELECT code FROM projects WHERE organization_id=$1 ORDER BY code') {
                return { rows: [{ code: 'brainbase' }, { code: 'child-project' }] };
            }
            if (sql.includes('FROM project_registry pr')) {
                return { rows: [{
                    ...row({ project_code: 'child-project', scope_id: 'project_child_project' }),
                    organization_id: 'org_a', display_name: 'Child Project', kind: 'client',
                    catalog_version: 1, lifecycle_status: 'active',
                    organization_entity_id: 'org_a', owner_person_id: 'person_owner'
                }] };
            }
            return { rows: [] };
        });
        const client = { query, release: vi.fn() };
        const pool = { connect: vi.fn(async () => client) };

        await expect(runProjectGraphReconciliation({ pool })).resolves.toMatchObject({
            summary: { total: 1, planned: 1, unresolved: 0 },
            complete: true
        });

        const inventoryQuery = query.mock.calls.find(([sql]) => sql.includes('FROM project_registry pr'));
        expect(inventoryQuery[0]).toContain('graph_scope.organization_id=pr.organization_id');
        expect(inventoryQuery[0]).not.toContain('ge.project_id=p.id');
        expect(query).not.toHaveBeenCalledWith('SELECT id FROM organizations ORDER BY id');
        expect(query).toHaveBeenCalledWith(
            "SELECT set_config('app.project_codes',$1,true)",
            ['brainbase,child-project']
        );
        expect(client.release).toHaveBeenCalledOnce();
    });
});
