import { describe, expect, it } from 'vitest';
import { classifyProjectBinding } from '../../../scripts/reconcile-project-graph-ssot.js';

const row = (overrides = {}) => ({
    project_code: 'brainbase',
    scope_id: 'project_brainbase',
    graph_entity_id: null,
    candidates: [],
    ...overrides
});

describe('project Graph SSOT reconciliation classification', () => {
    it('creates the canonical Graph subject when the registry has no candidate', () => {
        expect(classifyProjectBinding(row())).toMatchObject({ action: 'create_canonical', conflicts: [] });
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

    it('does not guess when multiple non-canonical Graph candidates exist', () => {
        const result = classifyProjectBinding(row({ candidates: [
            { id: 'legacy_a', payload: { code: 'brainbase' } },
            { id: 'legacy_b', payload: { code: 'brainbase' } }
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
});
