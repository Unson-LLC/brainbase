import { loadPersonalOs } from './ssot.js';
import type { DecisionRecord, PersonalOs } from './types.js';

export const ONTOLOGY_VERSION = '1.0.0' as const;

export type OntologySeverity = 'error' | 'warning';

export interface OntologyViolation {
  ruleId: string;
  severity: OntologySeverity;
  path: string;
  message: string;
}

export interface OntologyAuditResult {
  status: 'complete';
  ontologyVersion: typeof ONTOLOGY_VERSION;
  violationCount: number;
  violations: OntologyViolation[];
  counts: {
    entities: number;
    relationships: number;
    personalKg: number;
    decisions: number;
  };
  coverage: {
    complete: true;
    unavailableSources: [];
  };
  issues: [];
}

export interface UnverifiedOntologyAuditResult {
  status: 'unverified';
  ontologyVersion: typeof ONTOLOGY_VERSION;
  violationCount: null;
  violations: [];
  counts: null;
  coverage: {
    complete: false;
    unavailableSources: string[];
  };
  issues: OntologyViolation[];
}

export type PersonalOsOntologyAudit = OntologyAuditResult | UnverifiedOntologyAuditResult;

const release = {
  version: ONTOLOGY_VERSION,
  effectiveAt: '2026-08-03T00:00:00.000Z',
  compatibility: 'backward-compatible',
  name: 'Brainbase Portable Ontology Kernel',
  description: 'A local-first semantic contract for Brainbase Personal OS data.',
  domains: {
    types: {
      concepts: [
        { id: 'person', meaning: 'A human represented in the local Graph.' },
        { id: 'org', meaning: 'An organization represented in the local Graph.' },
        { id: 'project', meaning: 'A bounded body of work represented in the local Graph.' },
        { id: 'relationship', meaning: 'A contextual connection to a person.' },
        { id: 'decision', meaning: 'A durable choice that may explicitly supersede another choice.' }
      ]
    },
    relations: {
      vocabulary: [
        { id: 'relates_to', source: 'relationship', target: 'person' },
        { id: 'supersedes', source: 'decision', target: 'decision' },
        { id: 'about', source: 'decision', target: 'topic' }
      ]
    },
    constraints: {
      rules: [
        { id: 'ONT-ENTITY-ID-UNIQUE', severity: 'error' },
        { id: 'ONT-RELATIONSHIP-ID-UNIQUE', severity: 'error' },
        { id: 'ONT-DECISION-ID-UNIQUE', severity: 'error' },
        { id: 'ONT-RELATIONSHIP-PERSON-RESOLVES', severity: 'warning' },
        { id: 'ONT-DECISION-SUPERSEDES-EXISTS', severity: 'error' },
        { id: 'ONT-DECISION-SUPERSEDES-SELF', severity: 'error' },
        { id: 'ONT-DECISION-SUPERSEDES-CYCLE', severity: 'error' }
      ]
    },
    inference: {
      rules: [
        {
          id: 'ONT-INFER-EXPLICIT-SUPERSESSION',
          meaning: 'Only an explicit supersedes edge makes an older decision inactive.'
        },
        {
          id: 'ONT-INFER-SAME-TOPIC-CONFLICT',
          meaning: 'Multiple active decisions on the same explicit topic are reported as a conflict.'
        }
      ]
    },
    evolution: {
      compatibility: [
        {
          fromVersion: '0.0.0',
          toVersion: ONTOLOGY_VERSION,
          level: 'backward-compatible',
          changes: [
            'Adds a versioned public semantic contract.',
            'Adds optional topic, supersedes, and effectiveAt decision fields.'
          ],
          migration: 'No migration is required. Existing canonical Personal OS files remain readable.',
          rollback: 'Stop using the additive ontology commands and optional decision fields.'
        }
      ]
    }
  }
} as const;

export const portableOntology = deepFreeze(release);

export function auditOntology(os: PersonalOs): OntologyAuditResult {
  const violations: OntologyViolation[] = [];

  auditDuplicateIds(
    os.graph.entities,
    'graph.entities',
    'ONT-ENTITY-ID-UNIQUE',
    'Graph entity IDs must be unique.',
    violations
  );
  auditDuplicateIds(
    os.relationships.relationships,
    'relationships.relationships',
    'ONT-RELATIONSHIP-ID-UNIQUE',
    'Relationship IDs must be unique.',
    violations
  );
  auditDuplicateIds(
    os.decisions,
    'decisions',
    'ONT-DECISION-ID-UNIQUE',
    'Decision IDs must be unique.',
    violations
  );

  const personNames = new Set(
    os.graph.entities.filter((entity) => entity.type === 'person').map((entity) => entity.name)
  );
  os.relationships.relationships.forEach((relationship, index) => {
    if (!personNames.has(relationship.person)) {
      violations.push({
        ruleId: 'ONT-RELATIONSHIP-PERSON-RESOLVES',
        severity: 'warning',
        path: `relationships.relationships[${index}].person`,
        message: `Relationship person ${JSON.stringify(relationship.person)} does not resolve to a person entity.`
      });
    }
  });

  auditDecisionSupersession(os.decisions, violations);

  return {
    status: 'complete',
    ontologyVersion: ONTOLOGY_VERSION,
    violationCount: violations.length,
    violations,
    counts: {
      entities: os.graph.entities.length,
      relationships: os.relationships.relationships.length,
      personalKg: os.personalKg.length,
      decisions: os.decisions.length
    },
    coverage: { complete: true, unavailableSources: [] },
    issues: []
  };
}

export async function auditPersonalOsDirectory(dataDir: string): Promise<PersonalOsOntologyAudit> {
  try {
    return auditOntology(await loadPersonalOs(dataDir));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'unverified',
      ontologyVersion: ONTOLOGY_VERSION,
      violationCount: null,
      violations: [],
      counts: null,
      coverage: {
        complete: false,
        unavailableSources: canonicalSourcesFromError(message)
      },
      issues: [{
        ruleId: 'ONT-AUDIT-SOURCE-UNAVAILABLE',
        severity: 'error',
        path: dataDir,
        message
      }]
    };
  }
}

export function assertOntologyValid(os: PersonalOs): void {
  const result = auditOntology(os);
  const errors = result.violations.filter((violation) => violation.severity === 'error');
  if (errors.length > 0) {
    throw new Error(`Ontology validation failed: ${errors.map((error) => `${error.ruleId} at ${error.path}`).join('; ')}`);
  }
}

export interface DecisionInferenceResult {
  status: 'empty' | 'resolved' | 'conflict' | 'invalid';
  ontologyVersion: typeof ONTOLOGY_VERSION;
  asOf: string;
  activeDecisionIds: string[];
  supersededDecisionIds: string[];
  conflicts: Array<{ topic: string; decisionIds: string[] }>;
  evidence: Array<{ sourceDecisionId: string; targetDecisionId: string; ruleId: string }>;
  explanations: string[];
  violations: OntologyViolation[];
}

export function inferDecisions(
  decisions: DecisionRecord[],
  options: { asOf?: string } = {}
): DecisionInferenceResult {
  const asOf = options.asOf ?? new Date().toISOString();
  const effectiveDecisions = decisions.filter((decision) => !decision.effectiveAt || decision.effectiveAt <= asOf);
  const violations: OntologyViolation[] = [];
  auditDuplicateIds(
    effectiveDecisions,
    'decisions',
    'ONT-DECISION-ID-UNIQUE',
    'Decision IDs must be unique.',
    violations
  );
  auditDecisionSupersession(effectiveDecisions, violations);

  if (violations.some((violation) => violation.severity === 'error')) {
    return {
      status: 'invalid',
      ontologyVersion: ONTOLOGY_VERSION,
      asOf,
      activeDecisionIds: [],
      supersededDecisionIds: [],
      conflicts: [],
      evidence: [],
      explanations: ['Inference was not performed because the decision graph is invalid.'],
      violations
    };
  }

  const superseded = new Set<string>();
  const evidence: DecisionInferenceResult['evidence'] = [];
  for (const decision of effectiveDecisions) {
    for (const target of decision.supersedes ?? []) {
      superseded.add(target);
      evidence.push({
        sourceDecisionId: decision.id,
        targetDecisionId: target,
        ruleId: 'ONT-INFER-EXPLICIT-SUPERSESSION'
      });
    }
  }

  const active = effectiveDecisions.filter((decision) => !superseded.has(decision.id));
  const topicGroups = new Map<string, string[]>();
  for (const decision of active) {
    if (!decision.topic) {
      continue;
    }
    const ids = topicGroups.get(decision.topic) ?? [];
    ids.push(decision.id);
    topicGroups.set(decision.topic, ids);
  }
  const conflicts = [...topicGroups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([topic, decisionIds]) => ({ topic, decisionIds }));

  return {
    status: decisions.length === 0 ? 'empty' : conflicts.length > 0 ? 'conflict' : 'resolved',
    ontologyVersion: ONTOLOGY_VERSION,
    asOf,
    activeDecisionIds: active.map((decision) => decision.id),
    supersededDecisionIds: effectiveDecisions.filter((decision) => superseded.has(decision.id)).map((decision) => decision.id),
    conflicts,
    evidence,
    explanations: [
      ...evidence.map((item) => `${item.sourceDecisionId} explicitly supersedes ${item.targetDecisionId}.`),
      ...conflicts.map((conflict) => `Topic ${JSON.stringify(conflict.topic)} has multiple active decisions: ${conflict.decisionIds.join(', ')}.`),
      ...active.filter((decision) => !decision.topic).map((decision) => `${decision.id} has no topic and remains an independent legacy decision.`)
    ],
    violations
  };
}

export function getOntologyImpact(fromVersion: string = ONTOLOGY_VERSION): {
  fromVersion: string;
  toVersion: typeof ONTOLOGY_VERSION;
  supported: boolean;
  compatibility: string | null;
  changes: readonly string[];
  migration: string | null;
  rollback: string | null;
} {
  if (fromVersion === ONTOLOGY_VERSION) {
    return {
      fromVersion,
      toVersion: ONTOLOGY_VERSION,
      supported: true,
      compatibility: 'identical',
      changes: [],
      migration: 'No migration is required.',
      rollback: 'No rollback is required.'
    };
  }
  const release = portableOntology.domains.evolution.compatibility.find((item) => item.fromVersion === fromVersion);
  if (!release) {
    return {
      fromVersion,
      toVersion: ONTOLOGY_VERSION,
      supported: false,
      compatibility: null,
      changes: [],
      migration: null,
      rollback: null
    };
  }
  return {
    fromVersion,
    toVersion: ONTOLOGY_VERSION,
    supported: true,
    compatibility: release.level,
    changes: release.changes,
    migration: release.migration,
    rollback: release.rollback
  };
}

function auditDuplicateIds(
  records: ReadonlyArray<{ id: string }>,
  path: string,
  ruleId: string,
  message: string,
  violations: OntologyViolation[]
): void {
  const seen = new Set<string>();
  records.forEach((record, index) => {
    if (seen.has(record.id)) {
      violations.push({ ruleId, severity: 'error', path: `${path}[${index}].id`, message: `${message} Duplicate: ${record.id}.` });
    }
    seen.add(record.id);
  });
}

function auditDecisionSupersession(decisions: DecisionRecord[], violations: OntologyViolation[]): void {
  const ids = new Set(decisions.map((decision) => decision.id));
  const edges = new Map(decisions.map((decision) => [decision.id, decision.supersedes ?? []]));

  decisions.forEach((decision, decisionIndex) => {
    (decision.supersedes ?? []).forEach((target, targetIndex) => {
      const path = `decisions[${decisionIndex}].supersedes[${targetIndex}]`;
      if (!ids.has(target)) {
        violations.push({
          ruleId: 'ONT-DECISION-SUPERSEDES-EXISTS',
          severity: 'error',
          path,
          message: `Superseded decision ${JSON.stringify(target)} does not exist.`
        });
      }
      if (target === decision.id) {
        violations.push({
          ruleId: 'ONT-DECISION-SUPERSEDES-SELF',
          severity: 'error',
          path,
          message: 'A decision cannot supersede itself.'
        });
      }
    });
  });

  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const cycleNodes = new Set<string>();
  const visit = (id: string): void => {
    if (state.has(id)) {
      return;
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const target of edges.get(id) ?? []) {
      if (!ids.has(target)) {
        continue;
      }
      if (state.get(target) === 'visiting') {
        const cycleStart = stack.indexOf(target);
        for (const cycleId of stack.slice(cycleStart)) {
          cycleNodes.add(cycleId);
        }
      } else if (!state.has(target)) {
        visit(target);
      }
    }
    stack.pop();
    state.set(id, 'visited');
  };
  for (const id of ids) {
    visit(id);
  }
  for (const id of cycleNodes) {
    violations.push({
      ruleId: 'ONT-DECISION-SUPERSEDES-CYCLE',
      severity: 'error',
      path: `decisions.${id}.supersedes`,
      message: `Decision supersession cycle includes ${id}.`
    });
  }
}

function canonicalSourcesFromError(message: string): string[] {
  const sources = ['graph.json', 'relationships.json', 'personal-kg.jsonl', 'decisions.jsonl'];
  const matched = sources.filter((source) => message.includes(source));
  return matched.length > 0 ? matched : sources;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
