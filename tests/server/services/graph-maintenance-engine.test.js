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
    it('external_entitiesを持たないlegacy snapshotのhash互換性を維持する', () => {
        const legacy = { project_code: 'brainbase', entities: [], edges: [] };
        expect(hashGraphSnapshot(legacy)).toBe('sha256:dcf222d0c4dfb351d591e4041ca4d56906632ab9d5588813e4107b100048024d');
    });

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
        })).not.toThrow();
    });

    it('既存のorphanを増やさない保守planを許可し、新しい違反は拒否する', () => {
        const existingOrphan = {
            project_code: 'brainbase',
            entities: [
                { id: 'person_bad', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'person_good', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ],
            edges: [
                { id: 'edge_orphan', from_id: 'missing', to_id: 'person_good', rel_type: 'knows', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ]
        };
        const plan = buildGraphPlan(existingOrphan, {
            project_code: 'brainbase', idempotency_key: 'cleanup-existing-invalid', reason: 'quarantine malformed person',
            operations: [
                { operation: 'retire_entity', entity_id: 'person_bad', expected_version: 1 },
                { operation: 'upsert_edge', edge_id: 'edge_superseded', from_id: 'person_bad', to_id: 'person_good', rel_type: 'superseded_by', expected_version: 0 }
            ]
        });
        expect(plan.validation).toMatchObject({ valid: false, counts: { orphans: 1 } });
        expect(plan.after.edges).toHaveLength(2);

        expect(() => applyGraphOperations(existingOrphan, [{
            operation: 'upsert_edge', edge_id: 'edge_new_orphan', from_id: 'person_bad', to_id: 'missing',
            rel_type: 'knows', expected_version: 0
        }], { projectCode: 'brainbase' })).toThrow('Unknown entity: missing');
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
    it('rehomeは旧所属をretireし、新所属をactiveで作成し、無関係edgeを変更しない', () => {
        const rehomeSnapshot = {
            project_code: 'brainbase',
            entities: [
                { id: 'decision_vibepro', entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 3 },
                { id: 'project_brainbase', entity_type: 'project', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2 },
                { id: 'project_vibepro', entity_type: 'project', project_code: 'vibepro', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 4 },
                { id: 'incident', entity_type: 'incident', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ],
            edges: [
                { id: 'belongs_old', from_id: 'decision_vibepro', to_id: 'project_brainbase', rel_type: 'belongs_to_project', project_code: 'brainbase', payload: { source: 'legacy' }, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 5 },
                { id: 'incident_edge', from_id: 'decision_vibepro', to_id: 'incident', rel_type: 'triggered_by', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 7 }
            ]
        };

        const after = applyGraphOperations(rehomeSnapshot, [{
            operation: 'rehome_entity', entity_id: 'decision_vibepro', expected_version: 3,
            target_project_code: 'vibepro', target_project_entity_id: 'project_vibepro', target_project_expected_version: 4,
            membership_edge_id: 'belongs_old', membership_expected_version: 5,
            new_membership_edge_id: 'belongs_new', new_membership_expected_version: 0
        }], { projectCode: 'brainbase' });

        expect(after.entities.find((entity) => entity.id === 'decision_vibepro')).toMatchObject({ project_code: 'vibepro', version: 4 });
        expect(after.edges.find((edge) => edge.id === 'belongs_old')).toMatchObject({
            to_id: 'project_brainbase', project_code: 'brainbase', lifecycle_status: 'retired', version: 6
        });
        expect(after.edges.find((edge) => edge.id === 'belongs_new')).toMatchObject({
            from_id: 'decision_vibepro', to_id: 'project_vibepro', rel_type: 'belongs_to_project',
            project_code: 'vibepro', lifecycle_status: 'active', version: 1
        });
        expect(after.edges.find((edge) => edge.id === 'incident_edge')).toEqual(rehomeSnapshot.edges[1]);
        expect(validateGraphSnapshot(after)).toMatchObject({ valid: true });
    });

    it('rehomeはversion、target Project、旧所属、新edgeの事前条件をfail closedにする', () => {
        const rehomeSnapshot = {
            project_code: 'brainbase',
            entities: [
                { id: 'decision', entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'project_old', entity_type: 'project', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'project_new', entity_type: 'project', project_code: 'vibepro', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2 }
            ],
            edges: [{ id: 'belongs_old', from_id: 'decision', to_id: 'project_old', rel_type: 'belongs_to_project', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 3 }]
        };
        const operation = {
            operation: 'rehome_entity', entity_id: 'decision', expected_version: 1,
            target_project_code: 'vibepro', target_project_entity_id: 'project_new', target_project_expected_version: 2,
            membership_edge_id: 'belongs_old', membership_expected_version: 3,
            new_membership_edge_id: 'belongs_new', new_membership_expected_version: 0
        };

        expect(() => applyGraphOperations(rehomeSnapshot, [{ ...operation, expected_version: 2 }], { projectCode: 'brainbase' })).toThrow('expected_version conflict');
        expect(() => applyGraphOperations(rehomeSnapshot, [{ ...operation, target_project_entity_id: 'missing' }], { projectCode: 'brainbase' })).toThrow('Unknown entity: missing');
        expect(() => applyGraphOperations(rehomeSnapshot, [{ ...operation, target_project_expected_version: 1 }], { projectCode: 'brainbase' })).toThrow('expected_version conflict');
        expect(() => applyGraphOperations(rehomeSnapshot, [{ ...operation, membership_expected_version: 2 }], { projectCode: 'brainbase' })).toThrow('expected_version conflict');
        expect(() => applyGraphOperations(rehomeSnapshot, [{ ...operation, new_membership_expected_version: 1 }], { projectCode: 'brainbase' })).toThrow('expected_version conflict');
        expect(() => applyGraphOperations(rehomeSnapshot, [{ ...operation, target_project_code: 'other' }], { projectCode: 'brainbase' })).toThrow('target Project scope mismatch');

        const inactiveTarget = structuredClone(rehomeSnapshot);
        inactiveTarget.entities.find((entity) => entity.id === 'project_new').lifecycle_status = 'retired';
        expect(() => applyGraphOperations(inactiveTarget, [operation], { projectCode: 'brainbase' })).toThrow('target Project must be active');
    });

    it('active belongs_to_projectのsource・edge・target scope不一致を検出する', () => {
        const invalidMembership = {
            project_code: 'brainbase',
            entities: [
                { id: 'decision', entity_type: 'decision', project_code: 'vibepro', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'project_old', entity_type: 'project', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ],
            edges: [{ id: 'belongs', from_id: 'decision', to_id: 'project_old', rel_type: 'belongs_to_project', project_code: 'vibepro', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }]
        };

        expect(validateGraphSnapshot(invalidMembership).issues).toContainEqual({ category: 'membership_scope', id: 'belongs' });
        const validMembership = structuredClone(invalidMembership);
        validMembership.entities[0].project_code = 'brainbase';
        validMembership.edges[0].project_code = 'brainbase';
        expect(() => buildGraphPlan(validMembership, {
            project_code: 'brainbase', idempotency_key: 'invalid-membership', reason: 'reject introduced membership mismatch',
            operations: [{ operation: 'move_scope', entity_id: 'decision', expected_version: 1, target_project_code: 'vibepro' }]
        })).toThrow('Graph operations introduced invalid state: membership_scope');
    });

    it('AC-003 INV-001 source-owned governs edge only', () => {
        const snapshot = {
            project_code: 'brainbase',
            entities: [{ id: 'decision', entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2 }],
            external_entities: [{ id: 'product_aitle', entity_type: 'product', project_code: 'aitle', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 4 }],
            edges: []
        };
        const operation = {
            operation: 'link_decision_subject', decision_id: 'decision', decision_expected_version: 2,
            subject_entity_id: 'product_aitle', subject_expected_version: 4, target_project_code: 'aitle',
            edge_id: 'edge_subject', expected_version: 0, human_gate_receipt: 'gate_1'
        };
        const after = applyGraphOperations(snapshot, [operation], { projectCode: 'brainbase' });
        expect(after.entities).toEqual(snapshot.entities);
        expect(after.external_entities).toEqual(snapshot.external_entities);
        expect(after.edges).toEqual([expect.objectContaining({
            id: 'edge_subject', from_id: 'decision', to_id: 'product_aitle', rel_type: 'governs',
            project_code: 'brainbase', role_min: 'ceo', sensitivity: 'restricted', version: 1,
            payload: { target_project_code: 'aitle', cross_tenant: true }
        })]);
        expect(validateGraphSnapshot(after).valid).toBe(true);
    });

    it('cross-tenant Decision subjectは型、version、Human Gateをfail closedにする', () => {
        const snapshot = {
            project_code: 'brainbase',
            entities: [{ id: 'decision', entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2 }],
            external_entities: [{ id: 'product_aitle', entity_type: 'product', project_code: 'aitle', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 4 }],
            edges: []
        };
        const operation = {
            operation: 'link_decision_subject', decision_id: 'decision', decision_expected_version: 2,
            subject_entity_id: 'product_aitle', subject_expected_version: 4, target_project_code: 'aitle',
            edge_id: 'edge_subject', expected_version: 0
        };
        expect(() => applyGraphOperations(snapshot, [operation], { projectCode: 'brainbase' })).toThrow('human_gate_receipt is required');
        expect(() => applyGraphOperations(snapshot, [{ ...operation, human_gate_receipt: 'gate_1', subject_expected_version: 3 }], { projectCode: 'brainbase' })).toThrow('expected_version conflict');
        expect(() => applyGraphOperations(snapshot, [{ ...operation, human_gate_receipt: 'gate_1', target_project_code: 'wrong' }], { projectCode: 'brainbase' })).toThrow('Product target scope mismatch');
        const wrongType = structuredClone(snapshot);
        wrongType.external_entities[0].entity_type = 'person';
        expect(() => applyGraphOperations(wrongType, [{ ...operation, human_gate_receipt: 'gate_1' }], { projectCode: 'brainbase' })).toThrow('active Product subject is required');

        const malformed = structuredClone(snapshot);
        malformed.edges = [{
            id: 'edge_malformed', from_id: 'decision', to_id: 'product_aitle', rel_type: 'related_to',
            project_code: 'brainbase', payload: { target_project_code: 'wrong' }, role_min: 'gm',
            sensitivity: 'internal', lifecycle_status: 'active', version: 1
        }];
        expect(validateGraphSnapshot(malformed).issues).toContainEqual({ category: 'cross_tenant_edge', id: 'edge_malformed' });
    });

    it('Catalog Projectを最小projectionとして生成し同一PlanでDecision subjectへ接続する', () => {
        const before = {
            project_code: 'brainbase',
            entities: [{
                id: 'decision_ua', entity_type: 'decision', project_code: 'brainbase', payload: {},
                role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
            }],
            edges: []
        };
        const after = applyGraphOperations(before, [{
            operation: 'materialize_project_subject',
            entity_id: 'brainbase-universal-arts-ai-support',
            catalog_project_id: 'brainbase-universal-arts-ai-support',
            catalog_version: 1,
            name: 'Universal Arts 3ヶ月AIコンサル',
            source_ref: 'project-catalog:brainbase-universal-arts-ai-support@1',
            expected_version: 0
        }, {
            operation: 'link_decision_project_subject',
            decision_id: 'decision_ua', decision_expected_version: 1,
            subject_entity_id: 'brainbase-universal-arts-ai-support', subject_expected_version: 1,
            edge_id: 'edge_ua_subject', expected_version: 0,
            human_gate_receipt: 'gate_ua'
        }], { projectCode: 'brainbase' });

        expect(after.entities).toContainEqual({
            id: 'brainbase-universal-arts-ai-support', entity_type: 'project', project_code: 'brainbase',
            payload: {
                name: 'Universal Arts 3ヶ月AIコンサル',
                catalog_project_id: 'brainbase-universal-arts-ai-support',
                catalog_version: 1,
                source_ref: 'project-catalog:brainbase-universal-arts-ai-support@1'
            },
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
        });
        expect(after.edges).toContainEqual(expect.objectContaining({
            id: 'edge_ua_subject', from_id: 'decision_ua',
            to_id: 'brainbase-universal-arts-ai-support', rel_type: 'governs',
            project_code: 'brainbase', lifecycle_status: 'active', version: 1
        }));
        expect(validateGraphSnapshot(after).valid).toBe(true);
    });

    it('Project subject materializeはidentity・型・version・Human Gateをfail closedにする', () => {
        const before = {
            project_code: 'brainbase',
            entities: [{ id: 'decision', entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }],
            edges: []
        };
        const materialize = {
            operation: 'materialize_project_subject', entity_id: 'project_ua',
            catalog_project_id: 'project_ua', catalog_version: 1, name: 'UA',
            source_ref: 'project-catalog:project_ua@1', expected_version: 0
        };
        expect(() => applyGraphOperations(before, [{ ...materialize, catalog_project_id: 'other' }], { projectCode: 'brainbase' }))
            .toThrow('Catalog Project ID must match Graph Entity ID');
        expect(() => applyGraphOperations(before, [{ ...materialize, expected_version: 1 }], { projectCode: 'brainbase' }))
            .toThrow('expected_version conflict');
        expect(() => applyGraphOperations(before, [{ ...materialize, catalog_version: 0 }], { projectCode: 'brainbase' }))
            .toThrow('catalog_version must be a positive integer');
        expect(() => applyGraphOperations(before, [{ ...materialize, source_ref: 'project-catalog:other@1' }], { projectCode: 'brainbase' }))
            .toThrow('source_ref must match Catalog Project identity and version');

        const withProject = applyGraphOperations(before, [materialize], { projectCode: 'brainbase' });
        const link = {
            operation: 'link_decision_project_subject', decision_id: 'decision', decision_expected_version: 1,
            subject_entity_id: 'project_ua', subject_expected_version: 1,
            edge_id: 'edge_subject', expected_version: 0
        };
        expect(() => applyGraphOperations(withProject, [link], { projectCode: 'brainbase' }))
            .toThrow('human_gate_receipt is required for Decision project subject link');
        const wrongType = structuredClone(withProject);
        wrongType.entities.find((entity) => entity.id === 'project_ua').entity_type = 'person';
        expect(() => applyGraphOperations(wrongType, [{ ...link, human_gate_receipt: 'gate' }], { projectCode: 'brainbase' }))
            .toThrow('active Project subject is required');
    });
});
