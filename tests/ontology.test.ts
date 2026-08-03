import { describe, expect, it } from 'vitest';
import {
  assertOntologyValid,
  auditOntology,
  inferDecisions,
  portableOntology
} from '../src/ontology.js';
import type { DecisionRecord, PersonalOs } from '../src/types.js';

function personalOs(overrides: Partial<PersonalOs> = {}): PersonalOs {
  return {
    dataDir: '/tmp/personal-os',
    graph: {
      version: 1,
      entities: [
        { id: 'person-owner', type: 'person', name: 'Owner' },
        { id: 'project-brainbase', type: 'project', name: 'Brainbase' }
      ]
    },
    personalKg: [],
    relationships: {
      version: 1,
      relationships: [
        { id: 'relationship-owner', person: 'Owner', context: 'Owns Brainbase' }
      ]
    },
    decisions: [],
    sourceCount: 0,
    ...overrides
  };
}

describe('portable ontology kernel', () => {
  it('O-1 exposes the immutable 1.0.0 release with all five domains', () => {
    expect(portableOntology.version).toBe('1.0.0');
    expect(portableOntology.effectiveAt).toBe('2026-08-03T00:00:00.000Z');
    expect(portableOntology.compatibility).toBe('backward-compatible');
    expect(Object.keys(portableOntology.domains)).toEqual([
      'types',
      'relations',
      'constraints',
      'inference',
      'evolution'
    ]);
    expect(portableOntology.domains.types.concepts.map((concept) => concept.id)).toEqual(
      expect.arrayContaining(['person', 'project', 'relationship', 'decision'])
    );
    expect(portableOntology.domains.relations.vocabulary.length).toBeGreaterThan(0);
    expect(portableOntology.domains.constraints.rules.length).toBeGreaterThan(0);
    expect(portableOntology.domains.inference.rules.length).toBeGreaterThan(0);
    expect(portableOntology.domains.evolution.compatibility.length).toBeGreaterThan(0);
    expect(Object.isFrozen(portableOntology)).toBe(true);
  });

  it('O-2 audits duplicate IDs and unresolved relationships with stable rule IDs', () => {
    const os = personalOs({
      graph: {
        version: 1,
        entities: [
          { id: 'duplicate', type: 'person', name: 'Owner' },
          { id: 'duplicate', type: 'project', name: 'Brainbase' }
        ]
      },
      relationships: {
        version: 1,
        relationships: [{ id: 'relationship-missing', person: 'Missing', context: 'Unknown person' }]
      }
    });

    const result = auditOntology(os);

    expect(result.status).toBe('complete');
    expect(result.ontologyVersion).toBe('1.0.0');
    expect(result.violationCount).toBe(2);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'ONT-ENTITY-ID-UNIQUE',
        severity: 'error',
        path: 'graph.entities[1].id'
      }),
      expect.objectContaining({
        ruleId: 'ONT-RELATIONSHIP-PERSON-RESOLVES',
        severity: 'warning',
        path: 'relationships.relationships[0].person'
      })
    ]));
  });

  it('O-3 rejects invalid proposed writes without mutating the input', () => {
    const os = personalOs({
      decisions: [
        { id: 'decision-1', title: 'Old', decision: 'Old rule' },
        { id: 'decision-1', title: 'New', decision: 'New rule' }
      ]
    });
    const before = structuredClone(os);

    expect(() => assertOntologyValid(os)).toThrow(/ONT-DECISION-ID-UNIQUE/);
    expect(os).toEqual(before);
  });

  it('O-3 reports missing, self, and cyclic supersession references', () => {
    const result = auditOntology(personalOs({
      decisions: [
        { id: 'decision-a', title: 'A', decision: 'A', supersedes: ['decision-b', 'missing'] },
        { id: 'decision-b', title: 'B', decision: 'B', supersedes: ['decision-a', 'decision-b'] }
      ]
    }));

    expect(result.violations.map((violation) => violation.ruleId)).toEqual(expect.arrayContaining([
      'ONT-DECISION-SUPERSEDES-EXISTS',
      'ONT-DECISION-SUPERSEDES-SELF',
      'ONT-DECISION-SUPERSEDES-CYCLE'
    ]));
  });

  it('O-4 derives active and superseded decisions with evidence and a fixed as-of time', () => {
    const decisions: DecisionRecord[] = [
      { id: 'decision-old', title: 'Old deploy rule', decision: 'Manual deploy', topic: 'deployment' },
      {
        id: 'decision-new',
        title: 'New deploy rule',
        decision: 'Automated deploy',
        topic: 'deployment',
        supersedes: ['decision-old'],
        effectiveAt: '2026-08-01T00:00:00.000Z'
      }
    ];

    const result = inferDecisions(decisions, { asOf: '2026-08-03T00:00:00.000Z' });

    expect(result).toMatchObject({
      status: 'resolved',
      ontologyVersion: '1.0.0',
      asOf: '2026-08-03T00:00:00.000Z',
      activeDecisionIds: ['decision-new'],
      supersededDecisionIds: ['decision-old'],
      conflicts: []
    });
    expect(result.evidence).toContainEqual({
      sourceDecisionId: 'decision-new',
      targetDecisionId: 'decision-old',
      ruleId: 'ONT-INFER-EXPLICIT-SUPERSESSION'
    });
    expect(result.explanations.join(' ')).toContain('decision-new');
  });

  it('O-5 keeps legacy decisions readable and reports same-topic ambiguity as a conflict', () => {
    const result = inferDecisions([
      { id: 'legacy', title: 'Legacy', decision: 'Still readable' },
      { id: 'decision-a', title: 'A', decision: 'Use A', topic: 'deployment' },
      { id: 'decision-b', title: 'B', decision: 'Use B', topic: 'deployment' }
    ], { asOf: '2026-08-03T00:00:00.000Z' });

    expect(result.status).toBe('conflict');
    expect(result.activeDecisionIds).toEqual(expect.arrayContaining(['legacy', 'decision-a', 'decision-b']));
    expect(result.conflicts).toContainEqual({
      topic: 'deployment',
      decisionIds: ['decision-a', 'decision-b']
    });
  });
});
