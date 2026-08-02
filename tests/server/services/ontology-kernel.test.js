import { describe, expect, it, vi } from 'vitest';
import { OntologyKernel, OntologyError } from '../../../server/services/ontology-kernel.js';

const manifest = {
    schema_version: '1.0.0',
    version: '1.0.0',
    initial_status: 'proposed',
    effective_at: '2026-08-01T00:00:00.000Z',
    entity_types: {
        org: { meaning: '法的または運営上の組織' },
        app: { meaning: '利用者が操作するソフトウェア', required_relations: ['owned_by'] },
        product: { meaning: '顧客価値と収益責任を持つ提供物' },
        brand: { meaning: '市場で識別される約束と表現体系' },
        project: { meaning: '期限と成果物を持つ実行単位' },
        person: { meaning: '人' },
        decision: { meaning: '適用期間を持つ判断' }
    },
    relation_types: {
        owned_by: { meaning: '責任主体', from: ['app', 'product', 'brand', 'project'], to: ['org', 'person'] },
        belongs_to: { meaning: '包含先', from: ['app', 'product', 'brand', 'project'], to: ['org', 'product', 'brand', 'project'] },
        governs: { meaning: '規律対象', from: ['decision'], to: ['app', 'product', 'brand', 'project', 'org'] },
        supersedes: { meaning: '旧判断の置換', from: ['decision'], to: ['decision'] },
        derived_from: { meaning: '由来', from: ['app', 'product', 'brand', 'project', 'decision'], to: ['app', 'product', 'brand', 'project', 'decision'] },
        accountable_for: { meaning: '最終説明責任', from: ['person', 'org'], to: ['app', 'product', 'brand', 'project', 'decision'] }
    },
    constraints: [
        { id: 'app-owner-required', target: 'app', kind: 'required_relation', relation: 'owned_by' },
        { id: 'active-decision-context-required', target: 'decision', kind: 'required_fields_when', when: { status: 'active' }, fields: ['decider_id', 'scope_ids'] }
    ],
    inference_rules: [{ id: 'decision-supersession', relation: 'supersedes' }],
    evolution_rules: { breaking: 'major', additive: 'minor', editorial: 'patch' }
};
Object.assign(manifest, {
    previous_version: null,
    compatibility: { classification: 'initial', compatible_from: null },
    migration: { required: false, plan: null },
    rollback: { strategy: 'restore_previous_current', target_version: null },
    governance: { decision_id: null, scope_entity_id: null, proposer_entity_id: null, decider_entity_id: null, applier_entity_id: null },
    changes: []
});
manifest.evolution_rules.history_required_for = ['rename', 'merge', 'split'];

for (const definition of Object.values(manifest.entity_types)) {
    Object.assign(definition, {
        description: definition.meaning,
        identity: 'fixture identity',
        usage: 'fixture usage',
        examples: ['fixture example'],
        counter_examples: ['fixture counter example'],
        owner: 'fixture owner'
    });
}
for (const definition of Object.values(manifest.relation_types)) {
    Object.assign(definition, {
        direction: 'outbound',
        cardinality: 'many_to_many',
        inverse: null,
        lifecycle: 'effective_dated',
        provenance: 'explicit'
    });
}

const kernel = () => new OntologyKernel({ manifest, status: 'proposed' });

describe('OntologyKernel', () => {
    it('rejects an invalid manifest at construction', () => {
        expect(() => new OntologyKernel({ manifest: { version: '1.0.0' } })).toThrow(OntologyError);
    });

    it('defines distinct semantics for app, product, brand, and project', () => {
        const meanings = ['app', 'product', 'brand', 'project'].map((type) => kernel().getType(type).meaning);
        expect(new Set(meanings).size).toBe(4);
    });

    it('validates relation endpoints with a stable rule id', () => {
        expect(kernel().validateEdge({ from_type: 'decision', to_type: 'app', relation: 'governs' })).toMatchObject({ valid: true });
        expect(kernel().validateEdge({ from_type: 'app', to_type: 'decision', relation: 'governs' })).toMatchObject({
            valid: false,
            violations: [{ rule_id: 'relation-endpoint-governs' }]
        });
    });

    it('requires an owner org edge for app snapshots', () => {
        const result = kernel().validateSnapshot({
            entities: [{ id: 'app_1', type: 'app', payload: {} }],
            edges: []
        });
        expect(result).toMatchObject({ valid: false, violations: [{ rule_id: 'app-owner-required', entity_id: 'app_1' }] });
    });

    it('requires decider and scope for an active decision', () => {
        expect(kernel().validateEntity({ id: 'dec_1', type: 'decision', payload: { status: 'active' } })).toMatchObject({
            valid: false,
            violations: [{ rule_id: 'active-decision-context-required' }]
        });
    });

    it('marks a superseded decision inactive with evidence and explanation', () => {
        const result = kernel().inferDecisions({
            as_of: '2026-08-02T00:00:00.000Z',
            entities: [
                { id: 'dec_old', type: 'decision', payload: { status: 'active', decider_id: 'person_1', scope_ids: ['app_1'] } },
                { id: 'dec_new', type: 'decision', payload: { status: 'active', decider_id: 'person_1', scope_ids: ['app_1'], effective_at: '2026-08-02T00:00:00.000Z' } }
            ],
            edges: [{ from_id: 'dec_new', to_id: 'dec_old', relation: 'supersedes' }]
        });
        expect(result.decisions.dec_old).toMatchObject({ status: 'superseded', explicit: true, inferred: true });
        expect(result).toMatchObject({ ontology_version: '1.0.0', as_of: '2026-08-02T00:00:00.000Z' });
        expect(result.evidence).toHaveLength(1);
        expect(result.explanation).toContain('dec_new');
    });

    it('marks overlapping active decisions without supersedes as conflict', () => {
        const result = kernel().inferDecisions({
            entities: [
                { id: 'dec_a', type: 'decision', payload: { status: 'active', scope_ids: ['app_1'] } },
                { id: 'dec_b', type: 'decision', payload: { status: 'active', scope_ids: ['app_1'] } }
            ],
            edges: []
        });
        expect(result.decisions.dec_a).toMatchObject({ status: 'conflict', inferred: true });
        expect(result.evidence).toContainEqual(expect.objectContaining({ rule_id: 'decision-active-conflict' }));
    });

    it('classifies impact and reports missing snapshots as unverified', () => {
        expect(kernel().impact({ change: { kind: 'add_relation' }, snapshot: null })).toMatchObject({
            semver: 'minor',
            verification: 'unverified',
            migration_required: false,
            match_count: null
        });
    });

    it('finds relation and rule impact across edges and entities', () => {
        const snapshot = {
            entities: [{ id: 'app_1', type: 'app' }, { id: 'decision_1', type: 'decision' }],
            edges: [{ from_id: 'decision_1', to_id: 'app_1', relation: 'governs' }]
        };
        expect(kernel().impact({ change: { kind: 'narrow_endpoint', relation: 'governs' }, snapshot })).toMatchObject({
            match_count: 1,
            representative_ids: ['decision_1:governs:app_1']
        });
        expect(kernel().impact({ change: { kind: 'editorial', rule_id: 'active-decision-context-required' }, snapshot })).toMatchObject({
            match_count: 1,
            representative_ids: ['decision_1']
        });
    });

    it('requires canonical identity and provenance fields for rename history', () => {
        expect(() => kernel().planEvolution({ kind: 'rename' })).toThrowError(expect.objectContaining({
            code: 'ONTOLOGY_EVOLUTION_HISTORY_REQUIRED'
        }));
        expect(kernel().planEvolution({
            kind: 'rename',
            canonical_id: 'app:brainbase',
            source_ids: ['app:old-brainbase'],
            effective_at: '2026-08-02T00:00:00.000Z',
            provenance: ['decision:rename-brainbase']
        })).toMatchObject({
            canonical_id: 'app:brainbase',
            aliases: ['app:old-brainbase'],
            conflict_policy: 'explicit_decision_required'
        });
    });

    it('never calls persistence during dry-run validation', () => {
        const persist = vi.fn();
        kernel().validateSnapshot({ entities: [], edges: [] }, { persist });
        expect(persist).not.toHaveBeenCalled();
    });
});
