import { describe, expect, it } from 'vitest';
import {
    applyGraphOperations,
    buildGraphPlan,
    hashGraphSnapshot,
    validateGraphSnapshot
} from '../../../server/services/graph-maintenance-engine.js';

const snapshot = {
    project_code: 'brainbase',
    entities: [{
        id: 'dec_phase0', entity_type: 'decision', project_code: 'brainbase',
        payload: { title: 'Phase 0', status: 'draft', aliases: ['P0'] },
        role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
    }],
    edges: []
};

describe('Graph maintenance Phase 0 contract', () => {
    it('Snapshot → Dry Run → Patch → Validation → Rollbackで元状態へ戻る', () => {
        const before = structuredClone(snapshot);
        before.hash = hashGraphSnapshot(before);
        const plan = buildGraphPlan(before, {
            project_code: 'brainbase',
            idempotency_key: 'phase0-acceptance-1',
            reason: 'Phase 0 acceptance test',
            operations: [{
                operation: 'patch_entity', entity_id: 'dec_phase0', expected_version: 1,
                patch: { status: 'approved' }
            }]
        });

        expect(plan.dry_run).toBe(true);
        expect(plan.before_hash).toBe(before.hash);
        expect(plan.after.entities[0]).toMatchObject({ version: 2, payload: { status: 'approved' } });
        expect(validateGraphSnapshot(plan.after).valid).toBe(true);

        const rolledBack = structuredClone(plan.before);
        rolledBack.hash = hashGraphSnapshot(rolledBack);
        expect(rolledBack).toEqual(before);
    });

    it('理由、件数上限、expected_version、scopeを必須ガードにする', () => {
        expect(() => buildGraphPlan(snapshot, { project_code: 'brainbase', idempotency_key: 'x', operations: [] }))
            .toThrow('reason is required');
        expect(() => buildGraphPlan(snapshot, {
            project_code: 'other', idempotency_key: 'x', reason: 'test', operations: []
        })).toThrow('project scope mismatch');
        expect(() => buildGraphPlan(snapshot, {
            project_code: 'brainbase', idempotency_key: 'x', reason: 'test', max_operations: 1,
            operations: [
                { operation: 'patch_entity', entity_id: 'dec_phase0', expected_version: 1, patch: {} },
                { operation: 'patch_entity', entity_id: 'dec_phase0', expected_version: 1, patch: {} }
            ]
        })).toThrow('bulk operation limit exceeded');
        expect(() => applyGraphOperations(snapshot, [{
            operation: 'patch_entity', entity_id: 'dec_phase0', expected_version: 2, patch: {}
        }], { projectCode: 'brainbase' })).toThrow('expected_version conflict');
    });

    it('Sensitivity引き下げとActive DecisionのGateなしRetireを拒否する', () => {
        const restricted = structuredClone(snapshot);
        restricted.entities[0].sensitivity = 'restricted';
        expect(() => applyGraphOperations(restricted, [{
            operation: 'patch_entity', entity_id: 'dec_phase0', expected_version: 1,
            sensitivity: 'internal', patch: {}
        }], { projectCode: 'brainbase' })).toThrow('sensitivity cannot be lowered');
        expect(() => applyGraphOperations(snapshot, [{
            operation: 'retire_entity', entity_id: 'dec_phase0', expected_version: 1
        }], { projectCode: 'brainbase' })).toThrow('human_gate_receipt is required');
    });

    it('edge version、edge ID重複、endpoint key重複を検証し、top-level validを常に返す', () => {
        const entities = [
            { id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
            { id: 'entity_b', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
        ];
        const invalid = {
            project_code: 'brainbase', entities,
            edges: [
                { id: 'edge_duplicate', from_id: 'entity_a', to_id: 'entity_b', rel_type: 'reports_to', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 0 },
                { id: 'edge_duplicate', from_id: 'entity_a', to_id: 'entity_b', rel_type: 'reports_to', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ]
        };
        const validation = validateGraphSnapshot(invalid);
        expect(validation.valid).toBe(false);
        expect(validation).toMatchObject({ valid: false, counts: { issues: 3 } });
        expect(validation.issues.map((issue) => issue.category)).toEqual(expect.arrayContaining(['edge_version', 'duplicate_edge_id', 'duplicate_edge']));
        expect(() => buildGraphPlan(invalid, {
            project_code: 'brainbase', idempotency_key: 'invalid-edge', reason: 'reject invalid edge state', operations: []
        })).toThrow('Graph snapshot is invalid');
    });

    it('cross-scope edge IDを再利用せず、endpoint scopeと既存edge IDの取り違えを拒否する', () => {
        const crossScope = {
            project_code: 'brainbase',
            entities: [
                { id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'entity_b', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'entity_other', entity_type: 'person', project_code: 'other', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ],
            edges: [{ id: 'edge_from_other_tenant', from_id: 'entity_other', to_id: 'entity_a', rel_type: 'knows', project_code: 'other', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }]
        };
        expect(() => applyGraphOperations(crossScope, [{
            operation: 'upsert_edge', edge_id: 'edge_from_other_tenant', from_id: 'entity_a', to_id: 'entity_b',
            rel_type: 'knows', expected_version: 0
        }], { projectCode: 'brainbase' })).toThrow('edge id conflict');
        expect(() => applyGraphOperations(crossScope, [{
            operation: 'upsert_edge', from_id: 'entity_a', to_id: 'entity_other', rel_type: 'knows', expected_version: 0,
            edge_id: 'edge_new'
        }], { projectCode: 'brainbase' })).toThrow('edge endpoint project scope mismatch');
    });

    it('mergeでsourceのsensitivityをtargetの低い水準へ落とさず、rewire後のduplicate keyを拒否する', () => {
        const mergeSnapshot = {
            project_code: 'brainbase',
            entities: [
                { id: 'source', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'gm', sensitivity: 'restricted', lifecycle_status: 'active', version: 1 },
                { id: 'target', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'gm', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'peer', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ],
            edges: []
        };
        expect(() => applyGraphOperations(mergeSnapshot, [{
            operation: 'merge_entities', source_entity_id: 'source', target_entity_id: 'target',
            source_expected_version: 1, target_expected_version: 1
        }], { projectCode: 'brainbase' })).toThrow('sensitivity cannot be lowered');

        const duplicateKeySnapshot = structuredClone(mergeSnapshot);
        duplicateKeySnapshot.entities.find((entity) => entity.id === 'target').sensitivity = 'restricted';
        duplicateKeySnapshot.edges = [
            { id: 'edge_source', from_id: 'source', to_id: 'peer', rel_type: 'knows', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
            { id: 'edge_target', from_id: 'target', to_id: 'peer', rel_type: 'knows', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
        ];
        expect(() => applyGraphOperations(duplicateKeySnapshot, [{
            operation: 'merge_entities', source_entity_id: 'source', target_entity_id: 'target',
            source_expected_version: 1, target_expected_version: 1
        }], { projectCode: 'brainbase' })).toThrow('duplicate_edge');
    });
});
