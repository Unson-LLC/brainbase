import type { DecisionRecord, PersonalOs } from './types.js';
import { canonicalRelationRegistry } from './relation-registry.js';

export const ONTOLOGY_V1_VERSION = '1.0.0' as const;
export const ONTOLOGY_VERSION = '2.0.0' as const;
export const SUPPORTED_ONTOLOGY_VERSIONS = ['0.0.0', ONTOLOGY_V1_VERSION, ONTOLOGY_VERSION] as const;
export type OntologyVersion = typeof SUPPORTED_ONTOLOGY_VERSIONS[number];

export type OntologySeverity = 'error' | 'warning';

export interface OntologyViolation {
  ruleId: string;
  severity: OntologySeverity;
  path: string;
  message: string;
}

export interface OntologyAuditResult {
  status: 'complete';
  ontologyVersion: OntologyVersion;
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
  ontologyVersion: OntologyVersion;
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

const releaseV1 = {
  version: ONTOLOGY_V1_VERSION,
  effectiveAt: '2026-08-03T00:00:00.000Z',
  compatibility: 'read-compatible-write-gated',
  name: 'Brainbase Portable Ontology Kernel',
  description: 'A local-first semantic contract for Brainbase Personal OS data.',
  domains: {
    types: {
      concepts: [
        {
          id: 'person',
          meaning: 'A human represented in the local Graph.',
          usageConditions: ['Use only for a human identity approved for the canonical local SSOT.']
        },
        {
          id: 'org',
          meaning: 'An organization represented in the local Graph.',
          usageConditions: ['Use for a named organizational actor, not for a project or product.']
        },
        {
          id: 'project',
          meaning: 'A bounded body of work represented in the local Graph.',
          usageConditions: ['Use when the entity has a bounded work objective; do not use it as an organization alias.']
        },
        {
          id: 'relationship',
          meaning: 'A contextual connection to a person.',
          usageConditions: ['The person field must resolve to a canonical person entity by name.']
        },
        {
          id: 'decision',
          meaning: 'A durable choice that may explicitly supersede another choice.',
          usageConditions: ['Use for an explicit durable choice; replacement requires a supersedes Decision ID.']
        }
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
        { id: 'ONT-ENTITY-ID-UNIQUE', severity: 'error', meaning: 'Graph entity IDs must be unique.' },
        { id: 'ONT-RELATIONSHIP-ID-UNIQUE', severity: 'error', meaning: 'Relationship IDs must be unique.' },
        { id: 'ONT-DECISION-ID-UNIQUE', severity: 'error', meaning: 'Decision IDs must be unique.' },
        { id: 'ONT-RELATIONSHIP-PERSON-RESOLVES', severity: 'warning', meaning: 'A relationship person should resolve to a canonical person entity by name.' },
        { id: 'ONT-DECISION-SUPERSEDES-EXISTS', severity: 'error', meaning: 'A supersedes reference must resolve to an existing decision.' },
        { id: 'ONT-DECISION-SUPERSEDES-SELF', severity: 'error', meaning: 'A decision must not supersede itself.' },
        { id: 'ONT-DECISION-SUPERSEDES-CYCLE', severity: 'error', meaning: 'Decision supersession edges must not form a cycle.' }
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
          toVersion: ONTOLOGY_V1_VERSION,
          level: 'read-compatible-write-gated',
          changes: [
            'Adds a versioned public semantic contract.',
            'Adds optional topic, supersedes, and effectiveAt decision fields.'
          ],
          migration: 'Before enabling 1.0.0 writes, back up the Personal OS directory and run ontology:audit with ontology version 1.0.0. Existing files remain readable, but error violations must be reviewed and repaired before a canonical write.',
          rollback: 'For the first npm release, run npm uninstall -g @unson/brainbase-mcp, restore the MCP client configuration and launch command captured before rollout, and restart the client. For later upgrades, reinstall the recorded last known working package version. Restore the pre-upgrade Personal OS backup only if a reviewed repair changed canonical files. Merely avoiding ontology commands does not disable the write guards.'
        }
      ]
    }
  }
} as const;

/** Historical public release. Never derive it from the active release. */
export const portableOntologyV1 = deepFreeze(releaseV1);

const releaseV2 = {
  version: ONTOLOGY_VERSION,
  effectiveAt: '2026-08-17T00:00:00.000Z',
  compatibility: 'read-compatible-write-gated',
  name: 'Brainbase Portable Ontology Kernel',
  description: 'A local-first semantic contract for canonical Graph entities and ID-based edges.',
  domains: {
    types: portableOntologyV1.domains.types,
    relations: {
      vocabulary: Object.values(canonicalRelationRegistry).map((definition) => ({
        id: definition.id,
        source: definition.from,
        target: definition.to
      }))
    },
    constraints: portableOntologyV1.domains.constraints,
    inference: portableOntologyV1.domains.inference,
    evolution: {
      compatibility: [
        {
          fromVersion: '0.0.0',
          toVersion: ONTOLOGY_VERSION,
          level: 'read-compatible-write-gated',
          changes: [
            'Adds a versioned public semantic contract.',
            'Adds canonical Graph v2 entities and ID-based edges governed by the Relation Registry.'
          ],
          migration: 'Before enabling 2.0.0 writes, back up the Personal OS directory, run ontology:audit, preview ontology:migrate, then write using the preview expectedInputDigest.',
          rollback: 'For an installation without a prior package, run npm uninstall -g @unson/brainbase-mcp, restore the captured MCP client configuration, and restart the client. Otherwise restore the pre-migration Personal OS backup and reinstall the recorded last known working package version.'
        },
        {
          fromVersion: ONTOLOGY_V1_VERSION,
          toVersion: ONTOLOGY_VERSION,
          level: 'read-compatible-write-gated',
          changes: [
            'Adds canonical Graph v2 entities and ID-based edges.',
            'Binds the portable ontology release to the canonical Relation Registry.'
          ],
          migration: 'Run ontology:audit --ontology-version 1.0.0, preview ontology:migrate, then write using the preview expectedInputDigest.',
          rollback: 'Restore the pre-migration Personal OS backup; the immutable 1.0.0 interpretation remains available for historical reads.'
        }
      ]
    }
  }
} as const;

export const portableOntology = deepFreeze(releaseV2);

export function auditOntology(
  os: PersonalOs,
  options: { ontologyVersion?: OntologyVersion } = {}
): OntologyAuditResult {
  const ontologyVersion = resolvePersonalOsOntologyVersion(os, options.ontologyVersion);
  const violations: OntologyViolation[] = [];

  // 0.0.0 names the pre-kernel legacy semantics. Canonical shape validation is
  // still performed by the SSOT reader, but no 1.0.0 semantic rules are
  // projected backward onto historical snapshots.
  if (ontologyVersion === '0.0.0') {
    return completeAudit(os, ontologyVersion, violations);
  }

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

  return completeAudit(os, ontologyVersion, violations);
}

export function assertOntologyValid(os: PersonalOs): void {
  const result = auditOntology(os);
  const errors = result.violations.filter((violation) => violation.severity === 'error');
  if (errors.length > 0) {
    throw new Error(`Ontology validation failed: ${errors.map((error) => `${error.ruleId} at ${error.path}: ${error.message}`).join('; ')}`);
  }
}

export interface DecisionInferenceEvidence {
  ruleId: string;
  sourceDecisionId?: string;
  targetDecisionId?: string;
  topic?: string;
  decisionIds?: string[];
}

export interface DecisionInferenceResult {
  status: 'empty' | 'resolved' | 'conflict' | 'invalid';
  ontologyVersion: OntologyVersion;
  asOf: string;
  activeDecisionIds: string[];
  supersededDecisionIds: string[];
  conflicts: Array<{ topic: string; decisionIds: string[] }>;
  evidence: DecisionInferenceEvidence[];
  explanations: string[];
  violations: OntologyViolation[];
}

export function inferPersonalOs(
  os: PersonalOs,
  options: { asOf?: string; ontologyVersion?: OntologyVersion } = {}
): DecisionInferenceResult {
  const ontologyVersion = resolvePersonalOsOntologyVersion(os, options.ontologyVersion);
  const audit = auditOntology(os, { ontologyVersion });
  const errors = audit.violations.filter((violation) => violation.severity === 'error');
  if (errors.length > 0) {
    return {
      status: 'invalid',
      ontologyVersion,
      asOf: options.asOf ?? new Date().toISOString(),
      activeDecisionIds: [],
      supersededDecisionIds: [],
      conflicts: [],
      evidence: [],
      explanations: ['Inference was not performed because the complete Personal OS snapshot is invalid.'],
      violations: errors
    };
  }
  return inferDecisions(os.decisions, { ...options, ontologyVersion });
}

export function inferDecisions(
  decisions: DecisionRecord[],
  options: { asOf?: string; ontologyVersion?: OntologyVersion } = {}
): DecisionInferenceResult {
  const ontologyVersion = resolveOntologyVersion(options.ontologyVersion);
  const asOf = options.asOf ?? new Date().toISOString();
  if (ontologyVersion === '0.0.0') {
    return {
      status: decisions.length === 0 ? 'empty' : 'resolved',
      ontologyVersion,
      asOf,
      activeDecisionIds: decisions.map((decision) => decision.id),
      supersededDecisionIds: [],
      conflicts: [],
      evidence: [],
      explanations: [
        'Ontology 0.0.0 is the pre-kernel legacy interpretation; 1.0.0 effectiveAt, supersession, and conflict rules were not applied.'
      ],
      violations: []
    };
  }
  const asOfInstant = Date.parse(asOf);
  if (Number.isNaN(asOfInstant)) {
    return {
      status: 'invalid',
      ontologyVersion,
      asOf,
      activeDecisionIds: [],
      supersededDecisionIds: [],
      conflicts: [],
      evidence: [],
      explanations: ['Inference was not performed because asOf is not a valid ISO date-time.'],
      violations: [{
        ruleId: 'ONT-INFERENCE-AS-OF-DATETIME',
        severity: 'error',
        path: 'asOf',
        message: `asOf must be a valid ISO date-time. Received: ${asOf}.`
      }]
    };
  }
  const effectiveDecisions = decisions.filter((decision) => {
    if (!decision.effectiveAt) return true;
    const effectiveInstant = Date.parse(decision.effectiveAt);
    return !Number.isNaN(effectiveInstant) && effectiveInstant <= asOfInstant;
  });
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
      ontologyVersion,
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
  const conflictedDecisionIds = new Set(conflicts.flatMap((conflict) => conflict.decisionIds));
  const current = active.filter((decision) => !conflictedDecisionIds.has(decision.id));
  evidence.push(...conflicts.map((conflict) => ({
    ruleId: 'ONT-INFER-SAME-TOPIC-CONFLICT',
    topic: conflict.topic,
    decisionIds: conflict.decisionIds
  })));

  return {
    status: decisions.length === 0 ? 'empty' : conflicts.length > 0 ? 'conflict' : 'resolved',
    ontologyVersion,
    asOf,
    activeDecisionIds: current.map((decision) => decision.id),
    supersededDecisionIds: effectiveDecisions.filter((decision) => superseded.has(decision.id)).map((decision) => decision.id),
    conflicts,
    evidence,
    explanations: [
      ...evidence
        .filter((item) => item.ruleId === 'ONT-INFER-EXPLICIT-SUPERSESSION')
        .map((item) => `${item.sourceDecisionId} explicitly supersedes ${item.targetDecisionId}.`),
      ...conflicts.map((conflict) => `Topic ${JSON.stringify(conflict.topic)} has multiple current candidates, so none is active: ${conflict.decisionIds.join(', ')}.`),
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

function completeAudit(
  os: PersonalOs,
  ontologyVersion: OntologyVersion,
  violations: OntologyViolation[]
): OntologyAuditResult {
  return {
    status: 'complete',
    ontologyVersion,
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

export function resolveOntologyVersion(version: string | undefined): OntologyVersion {
  const requested = version ?? ONTOLOGY_VERSION;
  if (!SUPPORTED_ONTOLOGY_VERSIONS.includes(requested as OntologyVersion)) {
    throw new Error(
      `Unsupported ontology version ${JSON.stringify(requested)}. Supported versions: ${SUPPORTED_ONTOLOGY_VERSIONS.join(', ')}.`
    );
  }
  return requested as OntologyVersion;
}

function resolvePersonalOsOntologyVersion(
  os: PersonalOs,
  requestedVersion: OntologyVersion | undefined
): OntologyVersion {
  if (requestedVersion !== undefined) return resolveOntologyVersion(requestedVersion);
  if (os.graph.version === 2) return resolveOntologyVersion(os.graph.ontology.version);
  return resolveOntologyVersion(undefined);
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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
