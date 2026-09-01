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
        belongs_to_project: { meaning: 'projectへの包含', from: ['decision'], to: ['project'] },
        governs: { meaning: '規律対象', from: ['decision'], to: ['app', 'product', 'brand', 'project', 'org'] },
        supersedes: { meaning: '旧判断の置換', from: ['decision'], to: ['decision'] },
        derived_from: { meaning: '由来', from: ['app', 'product', 'brand', 'project', 'decision'], to: ['app', 'product', 'brand', 'project', 'decision'] },
        accountable_for: { meaning: '最終説明責任', from: ['person', 'org'], to: ['app', 'product', 'brand', 'project', 'decision'] }
    },
    constraints: [
        { id: 'app-owner-required', target: 'app', kind: 'required_relation', relation: 'owned_by', related_types: ['org'] },
        { id: 'active-decision-context-required', target: 'decision', kind: 'required_fields_when', when: { status: 'active' }, fields: ['decider_id', 'scope_ids'] },
        { id: 'effective-decision-decider-required', target: 'decision', kind: 'required_relation_when', when: { status: ['active', 'decided'] }, relation: 'owned_by', related_types: ['person'] },
        { id: 'effective-decision-scope-required', target: 'decision', kind: 'required_relation_when', when: { status: ['active', 'decided'] }, relation: 'belongs_to_project', related_types: ['project'] }
    ],
    inference_rules: [{ id: 'decision-supersession', relation: 'supersedes', effective_statuses: ['active', 'decided'] }],
    evolution_rules: { breaking: 'major', additive: 'minor', editorial: 'patch' }
};
Object.assign(manifest, {
    previous_version: null,
    compatibility: { classification: 'initial', compatible_from: null },
    migration: { required: false, plan: null },
    rollback: { strategy: 'restore_previous_current', target_version: null },
    governance: { decision_id: null, scope_entity_id: null, proposer_entity_id: null, decider_entity_id: null, applier_entity_id: null },
    impact_scope: { graph_scope: 'project:brainbase', affected_apis: [], affected_agents: [], migration_required: false },
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
manifest.relation_types.owned_by.cardinality = 'many_to_one';

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

    it('does not treat a person owner as the required owner org', () => {
        const result = kernel().validateSnapshot({
            entities: [
                { id: 'app_1', type: 'app', payload: {} },
                { id: 'person_1', type: 'person', payload: {} }
            ],
            edges: [{ from_id: 'app_1', to_id: 'person_1', relation: 'owned_by' }]
        });
        expect(result).toMatchObject({ valid: false });
        expect(result.violations).toContainEqual(expect.objectContaining({
            rule_id: 'app-owner-required',
            entity_id: 'app_1'
        }));
    });

    it('validates reference integrity and declared relation cardinality', () => {
        const result = kernel().validateSnapshot({
            entities: [
                { id: 'app_1', type: 'app', payload: {} },
                { id: 'org_1', type: 'org', payload: {} },
                { id: 'org_2', type: 'org', payload: {} }
            ],
            edges: [
                { id: 'edge_1', from_id: 'app_1', to_id: 'org_1', relation: 'owned_by' },
                { id: 'edge_2', from_id: 'app_1', to_id: 'org_2', relation: 'owned_by' },
                { id: 'edge_3', from_id: 'missing', to_id: 'org_1', relation: 'owned_by' }
            ]
        });
        expect(result.violations).toEqual(expect.arrayContaining([
            expect.objectContaining({ rule_id: 'relation-cardinality-owned_by', entity_id: 'app_1' }),
            expect.objectContaining({ rule_id: 'edge-reference-integrity', missing_endpoint_ids: ['missing'] })
        ]));
    });

    it('requires decider and scope for an active decision', () => {
        expect(kernel().validateEntity({ id: 'dec_1', type: 'decision', payload: { status: 'active' } })).toMatchObject({
            valid: false,
            violations: expect.arrayContaining([expect.objectContaining({ rule_id: 'active-decision-context-required' })])
        });
    });

    it('validates effective Decision authority from canonical Graph edges', () => {
        const accepted = kernel().validateSnapshot({
            entities: [
                { id: 'dec_1', type: 'decision', payload: { status: 'decided' } },
                { id: 'person_1', type: 'person', payload: {} },
                { id: 'project_1', type: 'project', payload: {} }
            ],
            edges: [
                { from_id: 'dec_1', to_id: 'person_1', relation: 'owned_by' },
                { from_id: 'dec_1', to_id: 'project_1', relation: 'belongs_to_project' }
            ]
        });
        expect(accepted.violations).not.toContainEqual(expect.objectContaining({ rule_id: 'effective-decision-decider-required' }));
        expect(accepted.violations).not.toContainEqual(expect.objectContaining({ rule_id: 'effective-decision-scope-required' }));

        const missingDecider = kernel().validateSnapshot({
            entities: [
                { id: 'dec_1', type: 'decision', payload: { status: 'decided' } },
                { id: 'project_1', type: 'project', payload: {} }
            ],
            edges: [{ from_id: 'dec_1', to_id: 'project_1', relation: 'belongs_to_project' }]
        });
        expect(missingDecider.violations).toContainEqual(expect.objectContaining({
            rule_id: 'effective-decision-decider-required',
            entity_id: 'dec_1'
        }));

        const missingScope = kernel().validateSnapshot({
            entities: [
                { id: 'dec_1', type: 'decision', payload: { status: 'decided' } },
                { id: 'person_1', type: 'person', payload: {} }
            ],
            edges: [{ from_id: 'dec_1', to_id: 'person_1', relation: 'owned_by' }]
        });
        expect(missingScope.violations).toContainEqual(expect.objectContaining({
            rule_id: 'effective-decision-scope-required',
            entity_id: 'dec_1'
        }));
    });

    it('required relationの対象外Entityもentity-level制約は検証する', () => {
        const result = kernel().validateSnapshot({
            entities: [
                { id: 'decision_active', type: 'decision', payload: { status: 'active' } },
                { id: 'decision_retired', type: 'decision', payload: { status: 'active' } }
            ],
            edges: [],
            required_relation_validation_entity_ids: ['decision_active']
        });

        expect(result.violations).toContainEqual(expect.objectContaining({
            rule_id: 'active-decision-context-required',
            entity_id: 'decision_retired'
        }));
        expect(result.violations).not.toContainEqual(expect.objectContaining({
            rule_id: 'effective-decision-decider-required',
            entity_id: 'decision_retired'
        }));
        expect(result.violations).toContainEqual(expect.objectContaining({
            rule_id: 'effective-decision-decider-required',
            entity_id: 'decision_active'
        }));
    });

    it('does not approve a decided Decision on the entity-only validation path', () => {
        const result = kernel().validateEntity({ id: 'dec_entity_only', type: 'decision', payload: { status: 'decided' } });
        expect(result.valid).toBe(false);
        expect(result.violations).toEqual(expect.arrayContaining([
            expect.objectContaining({ rule_id: 'effective-decision-decider-required', aggregate_required: true }),
            expect.objectContaining({ rule_id: 'effective-decision-scope-required', aggregate_required: true })
        ]));
    });

    it('infers Decision conflicts from canonical project scope edges', () => {
        const sharedScope = kernel().inferDecisions({
            entities: [
                { id: 'dec_a', type: 'decision', payload: { status: 'decided' } },
                { id: 'dec_b', type: 'decision', payload: { status: 'decided' } },
                { id: 'project_1', type: 'project', payload: {} }
            ],
            edges: [
                { from_id: 'dec_a', to_id: 'project_1', relation: 'belongs_to_project' },
                { from_id: 'dec_b', to_id: 'project_1', relation: 'belongs_to_project' }
            ]
        });
        expect(sharedScope.decisions.dec_a).toMatchObject({ status: 'conflict', inferred: true });
        expect(sharedScope.evidence).toContainEqual(expect.objectContaining({ rule_id: 'decision-active-conflict' }));

        const distinctScopes = kernel().inferDecisions({
            entities: [
                { id: 'dec_a', type: 'decision', payload: { status: 'decided' } },
                { id: 'dec_b', type: 'decision', payload: { status: 'decided' } },
                { id: 'project_1', type: 'project', payload: {} },
                { id: 'project_2', type: 'project', payload: {} }
            ],
            edges: [
                { from_id: 'dec_a', to_id: 'project_1', relation: 'belongs_to_project' },
                { from_id: 'dec_b', to_id: 'project_2', relation: 'belongs_to_project' }
            ]
        });
        expect(distinctScopes.evidence).not.toContainEqual(expect.objectContaining({ rule_id: 'decision-active-conflict' }));

        const invalidScopes = kernel().inferDecisions({
            entities: [
                { id: 'dec_a', type: 'decision', payload: { status: 'decided' } },
                { id: 'dec_b', type: 'decision', payload: { status: 'decided' } },
                { id: 'person_1', type: 'person', payload: {} }
            ],
            edges: [
                { from_id: 'dec_a', to_id: 'person_1', relation: 'belongs_to_project' },
                { from_id: 'dec_b', to_id: 'person_1', relation: 'belongs_to_project' },
                { from_id: 'dec_a', to_id: 'missing_project', relation: 'belongs_to_project' },
                { from_id: 'dec_b', to_id: 'missing_project', relation: 'belongs_to_project' }
            ]
        });
        expect(invalidScopes.evidence).not.toContainEqual(expect.objectContaining({ rule_id: 'decision-active-conflict' }));
        expect(invalidScopes.decisions.dec_a).toMatchObject({ status: 'decided' });
        expect(invalidScopes.decisions.dec_b).toMatchObject({ status: 'decided' });
    });

    it('treats decided Decisions as effective for supersession inference', () => {
        const result = kernel().inferDecisions({
            entities: [
                { id: 'dec_old', type: 'decision', payload: { status: 'decided', scope_ids: ['app_1'] } },
                { id: 'dec_new', type: 'decision', payload: { status: 'decided', scope_ids: ['app_1'] } }
            ],
            edges: [{ from_id: 'dec_new', to_id: 'dec_old', relation: 'supersedes' }]
        });
        expect(result.decisions.dec_old).toMatchObject({ status: 'superseded', inferred: true });
    });

    it('marks a superseded decision inactive with evidence and explanation', () => {
        const result = kernel().inferDecisions({
            as_of: '2026-08-02T00:00:00.000Z',
            entities: [
                { id: 'dec_old', type: 'decision', payload: { status: 'active', decider_id: 'person_1', scope_ids: ['app_1'] } },
                { id: 'dec_new', type: 'decision', payload: { status: 'active', decider_id: 'person_1', scope_ids: ['app_1'], effective_at: '2026-08-02T00:00:00.000Z' } }
            ],
            edges: [{ from_id: 'dec_new', to_id: 'dec_old', relation: 'supersedes' }]
        }, { derivedAt: '2026-08-02T00:00:01.000Z' });
        expect(result.decisions.dec_old).toMatchObject({ status: 'superseded', explicit: true, inferred: true });
        expect(result).toMatchObject({
            ontology_version: '1.0.0',
            as_of: '2026-08-02T00:00:00.000Z',
            derived_at: '2026-08-02T00:00:01.000Z'
        });
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

    it('does not let a future supersession suppress a current conflict', () => {
        const result = kernel().inferDecisions({
            as_of: '2026-08-02T00:00:00.000Z',
            entities: [
                { id: 'dec_old', type: 'decision', payload: { status: 'active', scope_ids: ['app_1'] } },
                { id: 'dec_future', type: 'decision', payload: { status: 'active', scope_ids: ['app_1'], effective_at: '2026-08-03T00:00:00.000Z' } }
            ],
            edges: [{ from_id: 'dec_future', to_id: 'dec_old', relation: 'supersedes' }]
        });
        expect(result.decisions.dec_old).toMatchObject({ status: 'conflict', inferred: true });
        expect(result.decisions.dec_future).toMatchObject({ status: 'conflict', inferred: true });
        expect(result.evidence).toContainEqual(expect.objectContaining({ rule_id: 'decision-active-conflict' }));
    });

    it('does not let a past edge override the future effective date of its replacement decision', () => {
        const result = kernel().inferDecisions({
            as_of: '2026-08-02T00:00:00.000Z',
            entities: [
                { id: 'dec_old', type: 'decision', payload: { status: 'active', scope_ids: ['app_1'] } },
                { id: 'dec_future', type: 'decision', payload: { status: 'active', scope_ids: ['app_1'], effective_at: '2026-08-03T00:00:00.000Z' } }
            ],
            edges: [{
                from_id: 'dec_future',
                to_id: 'dec_old',
                relation: 'supersedes',
                effective_at: '2026-08-01T00:00:00.000Z'
            }]
        });
        expect(result.decisions.dec_old).toMatchObject({ status: 'conflict', inferred: true });
        expect(result.decisions.dec_future).toMatchObject({ status: 'conflict', inferred: true });
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

    it('replays evolution events by effective time without destroying historical ids', () => {
        const event = kernel().planEvolution({
            kind: 'merge',
            canonical_id: 'person:canonical',
            source_ids: ['person:duplicate'],
            effective_at: '2026-08-03T00:00:00.000Z',
            provenance: ['decision:dedup']
        });
        const snapshot = {
            entities: [{ id: 'person:duplicate', type: 'person', payload: { name: 'Before' } }],
            edges: [{ from_id: 'person:duplicate', to_id: 'org:unson', relation: 'member_of' }],
            evolution_events: [event]
        };
        expect(kernel().interpretHistory(snapshot, { asOf: '2026-08-02T00:00:00.000Z' }).entities[0])
            .toMatchObject({ historical_id: 'person:duplicate', canonical_id: 'person:duplicate' });
        const after = kernel().interpretHistory(snapshot, { asOf: '2026-08-04T00:00:00.000Z' });
        expect(after.entities[0]).toMatchObject({
            historical_id: 'person:duplicate',
            canonical_id: 'person:canonical',
            evolution_provenance: ['decision:dedup']
        });
        expect(after.edges[0]).toMatchObject({ historical_from_id: 'person:duplicate', from_id: 'person:canonical' });
        expect(after.applied_event_ids).toEqual([event.event_id]);
    });

    it('preserves the complete provenance chain and rejects ambiguous history', () => {
        const events = [
            kernel().planEvolution({ kind: 'rename', canonical_id: 'org:middle', source_ids: ['org:legacy'], effective_at: '2026-08-02T00:00:00.000Z', provenance: ['decision:first'] }),
            kernel().planEvolution({ kind: 'merge', canonical_id: 'org:canonical', source_ids: ['org:middle'], effective_at: '2026-08-03T00:00:00.000Z', provenance: ['decision:second'] })
        ];
        const interpreted = kernel().interpretHistory({ entities: [{ id: 'org:legacy', type: 'org' }], evolution_events: events }, { asOf: '2026-08-04T00:00:00.000Z' });
        expect(interpreted.entities[0]).toMatchObject({
            historical_id: 'org:legacy',
            canonical_id: 'org:canonical',
            evolution_provenance: ['decision:first', 'decision:second']
        });

        const conflict = { ...events[0], event_id: 'event:conflict', canonical_id: 'org:other' };
        expect(() => kernel().interpretHistory({ evolution_events: [events[0], conflict] }, { asOf: '2026-08-04T00:00:00.000Z' }))
            .toThrow(expect.objectContaining({ code: 'ONTOLOGY_EVOLUTION_CONFLICT' }));
        const cycle = { ...events[1], event_id: 'event:cycle', canonical_id: 'org:legacy', source_ids: ['org:canonical'] };
        expect(() => kernel().interpretHistory({ entities: [{ id: 'org:legacy', type: 'org' }], evolution_events: [...events, cycle] }, { asOf: '2026-08-04T00:00:00.000Z' }))
            .toThrow(expect.objectContaining({ code: 'ONTOLOGY_EVOLUTION_CYCLE' }));
    });

    it('never calls persistence during dry-run validation', () => {
        const persist = vi.fn();
        kernel().validateSnapshot({ entities: [], edges: [] }, { persist });
        expect(persist).not.toHaveBeenCalled();
    });
});
