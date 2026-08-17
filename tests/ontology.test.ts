import { describe, expect, it } from 'vitest';
import {
  assertOntologyValid,
  auditOntology,
  getOntologyImpact,
  inferDecisions,
  portableOntology,
  portableOntologyV1,
  SUPPORTED_ONTOLOGY_VERSIONS
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
  it('O-1 exposes Ontology 2.0.0 while preserving the immutable historical 1.0.0 release', () => {
    expect(portableOntology.version).toBe('2.0.0');
    expect(portableOntology.effectiveAt).toBe('2026-08-17T00:00:00.000Z');
    expect(portableOntology.compatibility).toBe('read-compatible-write-gated');
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
    expect(portableOntology.domains.types.concepts).toContainEqual(expect.objectContaining({
      id: 'project',
      meaning: expect.stringContaining('bounded body of work'),
      usageConditions: expect.arrayContaining([expect.stringContaining('bounded work objective')])
    }));
    expect(portableOntology.domains.relations.vocabulary.length).toBeGreaterThan(0);
    expect(portableOntology.domains.constraints.rules.length).toBeGreaterThan(0);
    expect(portableOntology.domains.constraints.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ONT-ENTITY-ID-UNIQUE',
          severity: 'error',
          meaning: expect.stringContaining('unique')
        })
      ])
    );
    for (const rule of portableOntology.domains.constraints.rules) {
      expect(rule.meaning.trim().length).toBeGreaterThan(0);
    }
    expect(portableOntology.domains.inference.rules.length).toBeGreaterThan(0);
    expect(portableOntology.domains.evolution.compatibility.length).toBeGreaterThan(0);
    expect(Object.isFrozen(portableOntology)).toBe(true);
    expect(portableOntologyV1.version).toBe('1.0.0');
    expect(portableOntologyV1.effectiveAt).toBe('2026-08-03T00:00:00.000Z');
    expect(portableOntologyV1.domains.relations.vocabulary).toEqual([
      { id: 'relates_to', source: 'relationship', target: 'person' },
      { id: 'supersedes', source: 'decision', target: 'decision' },
      { id: 'about', source: 'decision', target: 'topic' }
    ]);
    expect(Object.isFrozen(portableOntologyV1)).toBe(true);
    expect(SUPPORTED_ONTOLOGY_VERSIONS).toEqual(['0.0.0', '1.0.0', '2.0.0']);
  });

  it('selects Graph v2 ontology binding by default and never reports a 2.0.0 Graph as 1.0.0', () => {
    const graphV2 = personalOs({
      graph: {
        version: 2,
        ontology: { id: 'brainbase-personal-os', version: '2.0.0', releaseDigest: 'sha256:test' },
        entities: [],
        edges: []
      }
    });
    const historicalGraph = personalOs({
      graph: {
        version: 2,
        ontology: { id: 'brainbase-personal-os', version: '1.0.0', releaseDigest: 'sha256:historical' },
        entities: [],
        edges: []
      }
    });

    expect(auditOntology(graphV2).ontologyVersion).toBe('2.0.0');
    expect(auditOntology(historicalGraph).ontologyVersion).toBe('1.0.0');
    expect(auditOntology(graphV2, { ontologyVersion: '1.0.0' }).ontologyVersion).toBe('1.0.0');
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
    expect(result.ontologyVersion).toBe('2.0.0');
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

    expect(() => assertOntologyValid(os)).toThrow(
      /ONT-DECISION-ID-UNIQUE at decisions\[1\]\.id: Decision IDs must be unique\. Duplicate: decision-1\./
    );
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
      ontologyVersion: '2.0.0',
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

  it('O-4 normalizes RFC 3339 offsets before comparing effective instants', () => {
    const result = inferDecisions([
      {
        id: 'decision-offset-future',
        title: 'Offset future',
        decision: 'Not active yet',
        effectiveAt: '2026-08-02T23:30:00-02:00'
      },
      {
        id: 'decision-offset-active',
        title: 'Offset active',
        decision: 'Already active',
        effectiveAt: '2026-08-03T09:00:00+09:00'
      }
    ], { asOf: '2026-08-03T00:00:00Z' });

    expect(result.activeDecisionIds).toEqual(['decision-offset-active']);
    expect(result.activeDecisionIds).not.toContain('decision-offset-future');
  });

  it('O-4 fails explicitly when direct callers provide an invalid as-of value', () => {
    const result = inferDecisions([], { asOf: 'not-a-date' });

    expect(result).toMatchObject({
      status: 'invalid',
      activeDecisionIds: [],
      violations: [expect.objectContaining({ ruleId: 'ONT-INFERENCE-AS-OF-DATETIME', path: 'asOf' })]
    });
  });

  it('O-5 keeps legacy decisions readable and reports same-topic ambiguity as a conflict', () => {
    const result = inferDecisions([
      { id: 'legacy', title: 'Legacy', decision: 'Still readable' },
      { id: 'decision-a', title: 'A', decision: 'Use A', topic: 'deployment' },
      { id: 'decision-b', title: 'B', decision: 'Use B', topic: 'deployment' }
    ], { asOf: '2026-08-03T00:00:00.000Z' });

    expect(result.status).toBe('conflict');
    expect(result.activeDecisionIds).toEqual(['legacy']);
    expect(result.activeDecisionIds).not.toEqual(expect.arrayContaining(['decision-a', 'decision-b']));
    expect(result.conflicts).toContainEqual({
      topic: 'deployment',
      decisionIds: ['decision-a', 'decision-b']
    });
    expect(result.evidence).toContainEqual({
      ruleId: 'ONT-INFER-SAME-TOPIC-CONFLICT',
      topic: 'deployment',
      decisionIds: ['decision-a', 'decision-b']
    });
  });

  it('O-7 interprets a historical snapshot with the rules of its recorded ontology version', () => {
    const decisions: DecisionRecord[] = [
      { id: 'decision-old', title: 'Old', decision: 'Manual deploy', topic: 'deployment' },
      {
        id: 'decision-new',
        title: 'New',
        decision: 'Automated deploy',
        topic: 'deployment',
        supersedes: ['decision-old']
      },
      {
        id: 'decision-future',
        title: 'Future',
        decision: 'Future policy',
        effectiveAt: '2027-01-01T00:00:00.000Z'
      }
    ];

    const historicalAudit = auditOntology(personalOs({ decisions }), { ontologyVersion: '0.0.0' });
    const historicalInference = inferDecisions(decisions, {
      asOf: '2026-08-03T00:00:00.000Z',
      ontologyVersion: '0.0.0'
    });
    const currentInference = inferDecisions(decisions, {
      asOf: '2026-08-03T00:00:00.000Z',
      ontologyVersion: '2.0.0'
    });

    expect(historicalAudit.ontologyVersion).toBe('0.0.0');
    expect(historicalInference).toMatchObject({
      ontologyVersion: '0.0.0',
      activeDecisionIds: ['decision-old', 'decision-new', 'decision-future'],
      supersededDecisionIds: [],
      evidence: []
    });
    expect(historicalInference.explanations.join(' ')).toContain('0.0.0');
    expect(currentInference).toMatchObject({
      ontologyVersion: '2.0.0',
      activeDecisionIds: ['decision-new'],
      supersededDecisionIds: ['decision-old']
    });
  });

  it('O-7 exposes a safe upgrade and actual package rollback path for legacy semantic violations', () => {
    const legacySnapshot = personalOs({
      decisions: [
        { id: 'duplicate', title: 'Legacy A', decision: 'A' },
        { id: 'duplicate', title: 'Legacy B', decision: 'B' }
      ]
    });

    expect(auditOntology(legacySnapshot, { ontologyVersion: '0.0.0' }).violationCount).toBe(0);
    expect(auditOntology(legacySnapshot, { ontologyVersion: '1.0.0' }).violations).toContainEqual(
      expect.objectContaining({ ruleId: 'ONT-DECISION-ID-UNIQUE', severity: 'error' })
    );

    const impact = getOntologyImpact('0.0.0');
    expect(impact.compatibility).toBe('read-compatible-write-gated');
    expect(impact.migration).toContain('back up');
    expect(impact.migration).toContain('ontology:audit');
    expect(impact.rollback).toContain('@unson/brainbase-mcp');
    expect(impact.rollback).toContain('npm uninstall -g');
    expect(impact.rollback).toContain('MCP client configuration');
    expect(impact.rollback).toContain('restore');
  });
});
