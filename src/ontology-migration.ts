import { createHash } from 'node:crypto';
import { canonicalEdgeId, validateCanonicalGraph } from './canonical-graph.js';
import { canonicalGraphOntologyRelease } from './templates.js';
import type {
  CanonicalEdge,
  CanonicalEntity,
  DecisionRecord,
  GraphFile,
  GraphFileV1,
  GraphFileV2,
  RelationshipRecord,
  RelationshipsFile
} from './types.js';

export type MigrationIssueCode =
  | 'ambiguous_person'
  | 'unresolved_person'
  | 'missing_project_evidence'
  | 'missing_project_endpoint'
  | 'ambiguous_decision_project'
  | 'missing_decision_endpoint'
  | 'decision_supersedes_self'
  | 'decision_supersedes_cycle'
  | 'unsupported_relationship_entity'
  | 'expected_input_digest_required'
  | 'input_digest_mismatch';

export interface MigrationIssue {
  code: MigrationIssueCode;
  recordId: string;
  detail: string;
}

export interface CanonicalGraphMigrationInput {
  graph: GraphFile;
  relationships?: RelationshipsFile;
  decisions?: DecisionRecord[];
}

export interface CanonicalGraphMigrationPlan {
  status: 'migration_required' | 'up_to_date' | 'blocked';
  graph: GraphFileV2;
  issues: MigrationIssue[];
  inputDigest: string;
  outputDigest: string;
  changes: {
    entitiesAdded: number;
    edgesAdded: number;
  };
}

/**
 * Produces a side-effect-free v1 -> v2 migration preview.
 *
 * Only explicit IDs and unique exact-name matches are promoted. Free-form
 * context is never interpreted as a canonical relationship.
 */
export function planCanonicalGraphMigration(input: CanonicalGraphMigrationInput): CanonicalGraphMigrationPlan {
  validateCanonicalGraph(input.graph);
  validateRelationshipIds(input.relationships?.relationships ?? []);
  validateDecisionRecordIds(input.decisions ?? []);
  const inputDigest = digest(normalizeMigrationInput(input));
  const issues: MigrationIssue[] = [];
  if (input.graph.version === 2) {
    const graph = structuredClone(input.graph);
    validateGraphSupersession(graph, issues);
    return {
      status: issues.length === 0 ? 'up_to_date' : 'blocked',
      graph,
      issues: issues.sort(compareIssues),
      inputDigest,
      outputDigest: digest(graph),
      changes: { entitiesAdded: 0, edgesAdded: 0 }
    };
  }
  validateDecisionEntityIds(input.graph, input.decisions ?? []);

  reportUnsupportedLegacyEntities(input.graph, issues);
  const invalidSupersessionSources = validateDecisionSupersession(input.decisions ?? [], issues);
  const entities = migrateEntities(input.graph, input.decisions ?? []);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const edges = new Map<string, CanonicalEdge>();

  addExplicitProjectMembershipEdges(input.graph, entityById, edges, issues);
  validateRelationshipEvidence(input.relationships?.relationships ?? [], entities, entityById, issues);
  addDecisionEdges(input.graph, input.decisions ?? [], entityById, edges, issues, invalidSupersessionSources);

  const owner = migrateOwner(input.graph, entities);
  const graph: GraphFileV2 = {
    version: 2,
    ontology: { ...canonicalGraphOntologyRelease.binding },
    ...(owner ? { owner } : {}),
    entities: [...entities].sort((left, right) => left.id.localeCompare(right.id, 'en')),
    edges: [...edges.values()].sort((left, right) => left.id.localeCompare(right.id, 'en'))
  };
  validateCanonicalGraph(graph);

  return {
    status: issues.length === 0 ? 'migration_required' : 'blocked',
    graph,
    issues: issues.sort(compareIssues),
    inputDigest,
    outputDigest: digest(graph),
    changes: {
      entitiesAdded: (input.decisions ?? []).filter((decision) => !input.graph.entities.some((entity) => entity.id === decision.id)).length,
      edgesAdded: graph.edges.length
    }
  };
}

function validateRelationshipIds(relationships: RelationshipRecord[]): void {
  const ids = new Set<string>();
  for (const relationship of relationships) {
    if (ids.has(relationship.id)) {
      throw new Error(`ONT-RELATIONSHIP-ID-UNIQUE: duplicate relationship ID ${relationship.id}`);
    }
    ids.add(relationship.id);
  }
}

function reportUnsupportedLegacyEntities(graph: GraphFileV1, issues: MigrationIssue[]): void {
  for (const entity of graph.entities) {
    if (entity.type !== 'relationship') continue;
    issues.push({
      code: 'unsupported_relationship_entity',
      recordId: entity.id,
      detail: 'Legacy relationship entities have no lossless canonical v2 representation; resolve them before writing migration output'
    });
  }
}

function validateDecisionSupersession(decisions: DecisionRecord[], issues: MigrationIssue[]): Set<string> {
  const decisionIds = new Set(decisions.map((decision) => decision.id));
  const adjacency = new Map<string, string[]>();
  const invalidSources = new Set<string>();

  for (const decision of decisions) {
    const targets = [...new Set(decision.supersedes ?? [])].sort((left, right) => left.localeCompare(right, 'en'));
    if (targets.includes(decision.id)) {
      invalidSources.add(decision.id);
      issues.push({
        code: 'decision_supersedes_self',
        recordId: decision.id,
        detail: 'ONT-DECISION-SUPERSEDES-SELF: a decision cannot supersede itself'
      });
    }
    adjacency.set(decision.id, targets.filter((target) => target !== decision.id && decisionIds.has(target)));
  }

  for (const decisionId of [...decisionIds].sort((left, right) => left.localeCompare(right, 'en'))) {
    if (!canReach(adjacency, decisionId, decisionId, new Set())) continue;
    invalidSources.add(decisionId);
    issues.push({
      code: 'decision_supersedes_cycle',
      recordId: decisionId,
      detail: 'ONT-DECISION-SUPERSEDES-CYCLE: decision supersession must be acyclic'
    });
  }

  return invalidSources;
}

function validateGraphSupersession(graph: GraphFileV2, issues: MigrationIssue[]): void {
  const decisionIds = new Set(graph.entities.filter((entity) => entity.type === 'decision').map((entity) => entity.id));
  const adjacency = new Map([...decisionIds].map((id) => [id, [] as string[]]));
  for (const edge of graph.edges) {
    if (edge.relation !== 'supersedes') continue;
    if (edge.fromId === edge.toId) {
      issues.push({
        code: 'decision_supersedes_self',
        recordId: edge.fromId,
        detail: 'ONT-DECISION-SUPERSEDES-SELF: a decision cannot supersede itself'
      });
      continue;
    }
    adjacency.get(edge.fromId)?.push(edge.toId);
  }
  for (const targets of adjacency.values()) targets.sort((left, right) => left.localeCompare(right, 'en'));
  for (const decisionId of [...decisionIds].sort((left, right) => left.localeCompare(right, 'en'))) {
    if (!canReach(adjacency, decisionId, decisionId, new Set())) continue;
    issues.push({
      code: 'decision_supersedes_cycle',
      recordId: decisionId,
      detail: 'ONT-DECISION-SUPERSEDES-CYCLE: decision supersession must be acyclic'
    });
  }
}

function canReach(adjacency: Map<string, string[]>, start: string, current: string, visited: Set<string>): boolean {
  if (visited.has(current)) return false;
  visited.add(current);
  for (const target of adjacency.get(current) ?? []) {
    if (target === start) return true;
    if (canReach(adjacency, start, target, visited)) return true;
  }
  return false;
}

function migrateEntities(graph: GraphFileV1, decisions: DecisionRecord[]): CanonicalEntity[] {
  const migrated = new Map<string, CanonicalEntity>();
  for (const entity of graph.entities) {
    if (entity.type === 'relationship') continue;
    migrated.set(entity.id, {
      id: entity.id,
      type: entity.type,
      name: entity.name,
      ...(entity.summary === undefined ? {} : { summary: entity.summary }),
      ...(entity.tags === undefined ? {} : { tags: [...entity.tags] }),
      ...(entity.metadata === undefined ? {} : { metadata: structuredClone(entity.metadata) })
    });
  }
  for (const decision of decisions) {
    migrated.set(decision.id, {
      id: decision.id,
      type: 'decision',
      name: decision.title,
      ...(decision.decision === decision.title ? {} : { aliases: [decision.decision] }),
      summary: decision.decision,
      ...(decision.effectiveAt === undefined ? {} : { validFrom: decision.effectiveAt }),
      ...(decision.tags === undefined ? {} : { tags: [...decision.tags] }),
      metadata: {
        ...(decision.topic === undefined ? {} : { topic: decision.topic }),
        ...(decision.rationale === undefined ? {} : { rationale: decision.rationale })
      }
    });
  }
  return [...migrated.values()];
}

function addExplicitProjectMembershipEdges(
  graph: GraphFileV1,
  entityById: Map<string, CanonicalEntity>,
  edges: Map<string, CanonicalEdge>,
  issues: MigrationIssue[]
): void {
  for (const entity of graph.entities) {
    if (entity.type !== 'person') continue;
    const projectId = stringMetadata(entity.metadata, 'projectId');
    if (!projectId) continue;
    if (entityById.get(projectId)?.type !== 'project') {
      issues.push({
        code: 'missing_project_endpoint',
        recordId: entity.id,
        detail: `Explicit project ID ${projectId} does not identify a canonical project`
      });
      continue;
    }
    addEdge(edges, {
      fromId: entity.id,
      relation: 'participates_in',
      toId: projectId,
      provenance: { sourceKind: 'migration', sourceId: entity.id }
    });
  }
}

function validateRelationshipEvidence(
  relationships: RelationshipRecord[],
  entities: CanonicalEntity[],
  entityById: Map<string, CanonicalEntity>,
  issues: MigrationIssue[]
): void {
  for (const relationship of relationships) {
    const people = entities.filter((entity) => entity.type === 'person' && entity.name === relationship.person);
    if (people.length === 0) {
      issues.push({ code: 'unresolved_person', recordId: relationship.id, detail: `No canonical person exactly matches ${relationship.person}` });
      continue;
    }
    if (people.length > 1) {
      issues.push({ code: 'ambiguous_person', recordId: relationship.id, detail: `${relationship.person} matches ${people.length} canonical people` });
      continue;
    }
    const person = people[0]!;
    const projectId = stringMetadata(person.metadata, 'projectId');
    if (!projectId || entityById.get(projectId)?.type !== 'project') {
      issues.push({
        code: 'missing_project_evidence',
        recordId: relationship.id,
        detail: 'Free-form relationship context cannot be promoted without an explicit canonical project ID'
      });
      continue;
    }
    // `role` and `context` are legacy display text, not typed relation evidence.
    // The explicit person.metadata.projectId edge above is the only safe
    // relationship promotion available in Graph v1.
  }
}

function validateDecisionEntityIds(graph: GraphFile, decisions: DecisionRecord[]): void {
  const occupied = new Set(graph.entities.map((entity) => entity.id));
  for (const decision of decisions) {
    if (occupied.has(decision.id)) {
      throw new Error(`MIGRATION-ENTITY-ID-COLLISION: decision ${decision.id} conflicts with an existing canonical entity`);
    }
  }
}

function validateDecisionRecordIds(decisions: DecisionRecord[]): void {
  const ids = new Set<string>();
  for (const decision of decisions) {
    if (ids.has(decision.id)) {
      throw new Error(`ONT-DECISION-ID-UNIQUE: duplicate decision ID ${decision.id}`);
    }
    ids.add(decision.id);
  }
}

function addDecisionEdges(
  graph: GraphFileV1,
  decisions: DecisionRecord[],
  entityById: Map<string, CanonicalEntity>,
  edges: Map<string, CanonicalEdge>,
  issues: MigrationIssue[],
  invalidSupersessionSources: Set<string>
): void {
  const projects = graph.entities.filter((entity) => entity.type === 'project');
  for (const decision of decisions) {
    const matchingProjects = projects.filter((project) => stringArrayMetadata(project.metadata, 'decisionPrinciples').includes(decision.decision));
    if (matchingProjects.length === 1) {
      addEdge(edges, {
        fromId: decision.id,
        relation: 'governs',
        toId: matchingProjects[0]!.id,
        ...(decision.effectiveAt === undefined ? {} : { validFrom: decision.effectiveAt }),
        provenance: { sourceKind: 'migration', sourceId: decision.id }
      });
    } else if (matchingProjects.length > 1) {
      issues.push({
        code: 'ambiguous_decision_project',
        recordId: decision.id,
        detail: `Decision text exactly matches ${matchingProjects.length} project principles`
      });
    }
    for (const supersededId of decision.supersedes ?? []) {
      if (invalidSupersessionSources.has(decision.id)) continue;
      if (entityById.get(supersededId)?.type !== 'decision') {
        issues.push({ code: 'missing_decision_endpoint', recordId: decision.id, detail: `Missing superseded decision ${supersededId}` });
        continue;
      }
      addEdge(edges, {
        fromId: decision.id,
        relation: 'supersedes',
        toId: supersededId,
        ...(decision.effectiveAt === undefined ? {} : { validFrom: decision.effectiveAt }),
        provenance: { sourceKind: 'migration', sourceId: decision.id }
      });
    }
  }
}

function addEdge(edges: Map<string, CanonicalEdge>, edge: Omit<CanonicalEdge, 'id'>): void {
  const complete = { ...edge, id: canonicalEdgeId(edge) };
  edges.set(JSON.stringify([edge.fromId, edge.relation, edge.toId]), complete);
}

function migrateOwner(graph: GraphFileV1, entities: CanonicalEntity[]): GraphFileV2['owner'] | undefined {
  if (!graph.owner) return undefined;
  const matches = graph.owner.name
    ? entities.filter((entity) => entity.type === 'person' && entity.name === graph.owner!.name)
    : [];
  return {
    ...(matches.length === 1 ? { id: matches[0]!.id } : {}),
    ...(graph.owner.name === undefined ? {} : { name: graph.owner.name }),
    ...(graph.owner.summary === undefined ? {} : { summary: graph.owner.summary })
  };
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function stringArrayMetadata(metadata: Record<string, unknown> | undefined, key: string): string[] {
  const value = metadata?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function normalizeMigrationInput(input: CanonicalGraphMigrationInput): CanonicalGraphMigrationInput {
  return {
    ...structuredClone(input),
    graph: {
      ...structuredClone(input.graph),
      entities: [...input.graph.entities].sort((left, right) => left.id.localeCompare(right.id, 'en')),
      ...(input.graph.version === 2
        ? { edges: [...input.graph.edges].sort((left, right) => left.id.localeCompare(right.id, 'en')) }
        : {})
    } as GraphFile,
    ...(input.relationships === undefined ? {} : {
      relationships: {
        ...structuredClone(input.relationships),
        relationships: [...input.relationships.relationships].sort((left, right) => left.id.localeCompare(right.id, 'en'))
      }
    }),
    ...(input.decisions === undefined ? {} : {
      decisions: [...input.decisions].sort((left, right) => left.id.localeCompare(right.id, 'en'))
    })
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([key, nested]) => [key, canonicalize(nested)]));
}

function compareIssues(left: MigrationIssue, right: MigrationIssue): number {
  return `${left.recordId}\u0000${left.code}`.localeCompare(`${right.recordId}\u0000${right.code}`, 'en');
}
