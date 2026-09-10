import { isActiveAt, validateCanonicalGraph } from './canonical-graph.js';
import type { EmbeddingProvider } from './embedding-provider.js';
import { getCanonicalRelation } from './relation-registry.js';
import type {
  CanonicalEdge,
  CanonicalEntity,
  CanonicalEntityKind,
  GraphFileV2,
  CoreRelation,
  PersonalOs,
  SearchResult
} from './types.js';

/** The deliberately small bounds keep a model-supplied relation plan finite. */
export const GRAPH_RETRIEVAL_MAX_SEEDS = 10;
export const GRAPH_RETRIEVAL_MAX_STEPS = 3;
export const GRAPH_RETRIEVAL_MAX_LIMIT = 50;

export type RetrievalDiscovery = 'semantic' | 'lexical' | 'seed' | 'traversal';

export interface GraphRetrievalStep {
  relation: CoreRelation;
  direction: 'incoming' | 'outgoing';
  targetType?: CanonicalEntityKind;
}

export interface GraphRetrievalInput {
  query: string;
  limit?: number;
  project?: string;
  asOf?: string;
  seedIds?: string[];
  steps?: GraphRetrievalStep[];
}

export interface GraphEvidence {
  source: 'legacy_decisions';
  sourceId: string;
  canonicalEntityId: string;
  statement: string;
}

export interface DecisionRationale {
  decisionId: string;
  title: string;
  decision: string;
  rationale?: string;
}

export interface GraphRetrievalCandidate extends SearchResult {
  discovery: RetrievalDiscovery;
  relationPath: string[];
  evidence: GraphEvidence[];
  decisionRationale?: DecisionRationale;
}

export interface ObservedRelation {
  relation: CoreRelation;
  meaning: string;
  direction: 'incoming' | 'outgoing';
  targetType: CanonicalEntityKind;
  edgeIds: string[];
  targetIds: string[];
}

export interface GraphRetrievalResponse {
  graphVersion: 1 | 2;
  schemaVersion: 1 | 2;
  status: 'ok' | 'migration_required';
  migrationRequired: boolean;
  authority: 'local_graph' | 'organization_graph';
  query: string;
  asOf: string;
  project?: { id: string; name: string };
  method: 'semantic' | 'lexical' | 'seed';
  semantic: {
    available: boolean;
    method: 'semantic' | 'lexical' | 'seed';
    providerId?: string;
  };
  candidates: GraphRetrievalCandidate[];
  results: GraphRetrievalCandidate[];
  observedRelations: ObservedRelation[];
  /** Alias kept explicit for consumers that call this a relation catalog. */
  observedRelationCatalog: ObservedRelation[];
  traversal: {
    seedIds: string[];
    steps: GraphRetrievalStep[];
    maxSeeds: number;
    maxSteps: number;
    maxLimit: number;
  };
  coverage: 'complete' | 'partial' | 'unknown';
  partialReasons: string[];
  missingEvidence: string[];
  evidence: GraphEvidence[];
  /** Search retrieves material; the model must still judge whether it answers the question. */
  sufficiency: 'needs_model_verification' | 'insufficient';
  /** Deliberately never inferred from an empty result set. */
  absenceConfirmed: false;
}

interface ScopedEntity {
  entity: CanonicalEntity;
  scopePath: string[];
}

interface CandidateState {
  entity: CanonicalEntity;
  score: number;
  discovery: RetrievalDiscovery;
  relationPath: string[];
}

interface EvidenceBundle {
  evidence: GraphEvidence[];
  rationale?: DecisionRationale;
}

const canonicalEntityKinds = new Set<CanonicalEntityKind>(['person', 'org', 'project', 'decision']);

/**
 * Retrieve canonical Graph v2 records in three explicit phases:
 * candidate discovery, bounded typed edge traversal, and evidence reporting.
 *
 * A provider is optional by design. Without one this function performs only
 * deterministic lexical discovery and marks that fact in the receipt; it does
 * not present lexical matches as semantic understanding.
 */
export async function retrieveGraph(
  os: PersonalOs,
  input: GraphRetrievalInput,
  provider?: EmbeddingProvider
): Promise<GraphRetrievalResponse> {
  const normalized = normalizeInput(input);
  validateCanonicalGraph(os.graph);
  if (os.graph.version === 1) return migrationResponse(normalized);

  const graph = os.graph;
  const activeEntities = graph.entities.filter((entity) => isActiveAt(entity, normalized.asOf));
  const activeIds = new Set(activeEntities.map((entity) => entity.id));
  const project = resolveProject(activeEntities, normalized.project);
  const partialReasons = [...normalized.partialReasons];
  if (normalized.project && !project) {
    partialReasons.push('project_scope_not_found_or_inactive');
  }

  const scoped = project ? scopeToProject(graph, activeEntities, activeIds, project, normalized.asOf) : normalized.project ? [] : activeEntities.map((entity) => ({ entity, scopePath: [] }));
  const byId = new Map(scoped.map((item) => [item.entity.id, item]));

  const requestedSeeds = normalized.seedIds;
  const validRequestedSeeds = requestedSeeds.filter((id) => byId.has(id));
  if (requestedSeeds.length > validRequestedSeeds.length) {
    partialReasons.push('seed_ids_out_of_scope_or_inactive');
  }

  let method: GraphRetrievalResponse['method'];
  let initial: CandidateState[];
  let providerId: string | undefined;

  if (requestedSeeds.length > 0) {
    method = 'seed';
    initial = validRequestedSeeds.map((id) => {
      const scopedEntity = byId.get(id)!;
      return {
        entity: scopedEntity.entity,
        score: 1,
        discovery: 'seed' as const,
        relationPath: [...scopedEntity.scopePath]
      };
    });
  } else if (provider) {
    method = 'semantic';
    providerId = assertProviderId(provider);
    initial = await discoverSemantic(scoped, normalized.query, normalized.limit, provider);
  } else {
    method = 'lexical';
    initial = discoverLexical(scoped, normalized.query, normalized.limit);
    partialReasons.push('semantic_provider_unavailable');
  }

  const traversalSeedLimit = normalized.steps.length > 0
    ? Math.min(GRAPH_RETRIEVAL_MAX_SEEDS, normalized.limit)
    : normalized.limit;
  const traversalSeeds = initial.slice(0, traversalSeedLimit).map((seed) => normalized.steps.length > 0
    ? { ...seed, relationPath: [] }
    : seed);
  if (initial.length > traversalSeeds.length) {
    partialReasons.push(normalized.steps.length > 0 ? 'seed_candidates_truncated_max_10' : 'result_limit_truncated');
  }
  const observedRelations = observeRelations(graph, traversalSeeds.map((candidate) => candidate.entity.id), new Set(byId.keys()), normalized.asOf);
  const traversed = normalized.steps.length > 0
    ? traverse(graph, byId, traversalSeeds, normalized.steps, activeIds, normalized.asOf, partialReasons)
    : traversalSeeds;
  const ranked = rankStates(traversed).slice(0, normalized.limit);
  if (traversed.length > ranked.length) partialReasons.push('result_limit_truncated');

  const candidates = ranked.map((state) => toCandidate(state, evidenceFor(os, state.entity)));
  const evidence = candidates.flatMap((candidate) => candidate.evidence);
  const missingEvidence = missingEvidenceFor(candidates);
  if (missingEvidence.length > 0) partialReasons.push('missing_evidence');
  const sufficiency: GraphRetrievalResponse['sufficiency'] = evidence.length > 0 ? 'needs_model_verification' : 'insufficient';
  const coverage: GraphRetrievalResponse['coverage'] = partialReasons.length > 0 ? 'partial' : 'complete';
  const observedRelationCatalog = observedRelations;

  return {
    graphVersion: 2,
    schemaVersion: 2,
    status: 'ok',
    migrationRequired: false,
    authority: 'local_graph',
    query: normalized.query,
    asOf: normalized.asOf,
    ...(project ? { project: { id: project.id, name: project.name } } : {}),
    method,
    semantic: {
      available: method === 'semantic',
      method,
      ...(providerId ? { providerId } : {})
    },
    candidates,
    results: candidates,
    observedRelations,
    observedRelationCatalog,
    traversal: {
      seedIds: traversalSeeds.map((candidate) => candidate.entity.id),
      steps: normalized.steps,
      maxSeeds: GRAPH_RETRIEVAL_MAX_SEEDS,
      maxSteps: GRAPH_RETRIEVAL_MAX_STEPS,
      maxLimit: GRAPH_RETRIEVAL_MAX_LIMIT
    },
    coverage,
    partialReasons: unique(partialReasons),
    missingEvidence,
    evidence,
    sufficiency,
    absenceConfirmed: false
  };
}

function normalizeInput(input: GraphRetrievalInput): GraphRetrievalInput & { asOf: string; limit: number; seedIds: string[]; steps: GraphRetrievalStep[]; partialReasons: string[] } {
  if (!input || typeof input !== 'object') throw new Error('GRAPH-RETRIEVAL-INPUT: input must be an object');
  if (typeof input.query !== 'string' || input.query.trim() === '') throw new Error('GRAPH-RETRIEVAL-QUERY: query must be a non-empty string');
  const asOf = input.asOf ?? new Date().toISOString();
  isActiveAt({}, asOf);
  const partialReasons: string[] = [];

  const requestedLimit = input.limit ?? 10;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new Error('GRAPH-RETRIEVAL-LIMIT: limit must be a positive integer');
  const limit = Math.min(requestedLimit, GRAPH_RETRIEVAL_MAX_LIMIT);
  if (requestedLimit > GRAPH_RETRIEVAL_MAX_LIMIT) partialReasons.push('limit_capped_max_50');

  if (input.seedIds !== undefined && (!Array.isArray(input.seedIds) || input.seedIds.some((id) => typeof id !== 'string' || id.trim() === ''))) {
    throw new Error('GRAPH-RETRIEVAL-SEEDS: seedIds must be an array of non-empty strings');
  }
  const allSeeds = unique((input.seedIds ?? []).map((id) => id.trim()));
  const seedIds = allSeeds.slice(0, GRAPH_RETRIEVAL_MAX_SEEDS);
  if (allSeeds.length > seedIds.length) partialReasons.push('seed_ids_capped_max_10');

  if (input.steps !== undefined && !Array.isArray(input.steps)) throw new Error('GRAPH-RETRIEVAL-STEPS: steps must be an array');
  const allSteps = (input.steps ?? []).map((step, index) => normalizeStep(step, index));
  const steps = allSteps.slice(0, GRAPH_RETRIEVAL_MAX_STEPS);
  if (allSteps.length > steps.length) partialReasons.push('steps_capped_max_3');

  return { ...input, query: input.query.trim(), asOf, limit, seedIds, steps, partialReasons };
}

function normalizeStep(step: GraphRetrievalStep, index: number): GraphRetrievalStep {
  if (!step || typeof step !== 'object') throw new Error(`GRAPH-RETRIEVAL-STEP-${index}: step must be an object`);
  try { getCanonicalRelation(step.relation); }
  catch (error) { throw new Error(`GRAPH-RETRIEVAL-STEP-${index}: ${error instanceof Error ? error.message : String(error)}`); }
  if (step.direction !== 'incoming' && step.direction !== 'outgoing') {
    throw new Error(`GRAPH-RETRIEVAL-STEP-${index}: direction must be incoming or outgoing`);
  }
  if (step.targetType !== undefined && !canonicalEntityKinds.has(step.targetType)) {
    throw new Error(`GRAPH-RETRIEVAL-STEP-${index}: targetType is not a canonical entity kind`);
  }
  return { relation: step.relation, direction: step.direction, ...(step.targetType ? { targetType: step.targetType } : {}) };
}

function assertProviderId(provider: EmbeddingProvider): string {
  if (typeof provider.id !== 'string' || provider.id.trim() === '') throw new Error('GRAPH-RETRIEVAL-EMBEDDING-PROVIDER: provider.id must be a non-empty string');
  return provider.id;
}

async function discoverSemantic(scoped: ScopedEntity[], query: string, _limit: number, provider: EmbeddingProvider): Promise<CandidateState[]> {
  const texts = scoped.map(({ entity }) => entityEmbeddingText(entity));
  const vectors = await provider.embed([...texts, query]);
  if (!Array.isArray(vectors) || vectors.length !== texts.length + 1) {
    throw new Error(`GRAPH-RETRIEVAL-EMBEDDING-COUNT: provider ${provider.id} returned ${Array.isArray(vectors) ? vectors.length : 'non-array'} vectors for ${texts.length + 1} texts`);
  }
  const queryVector = validateVector(vectors[vectors.length - 1], -1, provider.id);
  const scored = scoped.map((item, index) => ({
    entity: item.entity,
    score: cosine(queryVector, validateVector(vectors[index], index, provider.id)),
    discovery: 'semantic' as const,
    relationPath: [...item.scopePath]
  }));
  return scored.sort(compareStates);
}

function validateVector(value: unknown, index: number, providerId: string): number[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`GRAPH-RETRIEVAL-EMBEDDING-VECTOR: provider ${providerId} returned an empty vector at index ${index}`);
  if (value.some((component) => typeof component !== 'number' || !Number.isFinite(component))) {
    throw new Error(`GRAPH-RETRIEVAL-EMBEDDING-FINITE: provider ${providerId} returned a non-finite vector at index ${index}`);
  }
  if (Math.hypot(...value) === 0) throw new Error(`GRAPH-RETRIEVAL-EMBEDDING-ZERO: provider ${providerId} returned a zero vector at index ${index}`);
  return value;
}

function cosine(left: number[], right: number[]): number {
  if (left.length !== right.length) throw new Error(`GRAPH-RETRIEVAL-EMBEDDING-DIMENSION: vectors have dimensions ${left.length} and ${right.length}`);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! ** 2;
    rightNorm += right[index]! ** 2;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  if (!Number.isFinite(denominator) || denominator === 0) throw new Error('GRAPH-RETRIEVAL-EMBEDDING-COSINE: cannot calculate cosine similarity');
  return dot / denominator;
}

function discoverLexical(scoped: ScopedEntity[], query: string, _limit: number): CandidateState[] {
  return scoped
    .map((item) => ({
      entity: item.entity,
      score: lexicalScore(query, entitySearchFields(item.entity)),
      discovery: 'lexical' as const,
      relationPath: [...item.scopePath]
    }))
    .filter((candidate) => candidate.score > 0)
    .sort(compareStates);
}

function traverse(
  graph: GraphFileV2,
  scoped: Map<string, ScopedEntity>,
  seeds: CandidateState[],
  steps: GraphRetrievalStep[],
  activeIds: Set<string>,
  asOf: string,
  partialReasons: string[]
): CandidateState[] {
  let frontier = seeds;
  for (const [stepIndex, step] of steps.entries()) {
    const next = new Map<string, CandidateState>();
    for (const current of frontier) {
      for (const edge of graph.edges) {
        const targetId = edgeTarget(edge, step, current.entity.id);
        if (!targetId || !activeIds.has(edge.fromId) || !activeIds.has(edge.toId) || !isActiveAt(edge, asOf)) continue;
        const target = scoped.get(targetId);
        if (!target) continue;
        const state: CandidateState = {
          entity: target.entity,
          score: current.score * 0.9,
          discovery: 'traversal',
          relationPath: [...current.relationPath, edge.id]
        };
        const prior = next.get(targetId);
        if (!prior || compareStates(state, prior) < 0) next.set(targetId, state);
      }
    }
    if (next.size === 0) partialReasons.push(`no_matching_edge_for_step_${stepIndex + 1}`);
    frontier = [...next.values()];
    if (frontier.length === 0) break;
  }
  return frontier;
}

function edgeTarget(edge: CanonicalEdge, step: GraphRetrievalStep, currentId: string): string | undefined {
  if (edge.relation !== step.relation) return undefined;
  const relation = getCanonicalRelation(edge.relation);
  const targetId = step.direction === 'outgoing'
    ? edge.fromId === currentId ? edge.toId : undefined
    : edge.toId === currentId ? edge.fromId : undefined;
  if (!targetId) return undefined;
  const currentType = step.direction === 'outgoing' ? relation.from : relation.to;
  const targetType = step.direction === 'outgoing' ? relation.to : relation.from;
  // The graph validator already checks this, but keep the traversal rail local
  // so a future graph source cannot turn an untyped edge into a result.
  if (step.targetType && step.targetType !== targetType) return undefined;
  return currentType && targetType ? targetId : undefined;
}

function observeRelations(graph: GraphFileV2, seedIds: string[], visibleIds: Set<string>, asOf: string): ObservedRelation[] {
  const observed = new Map<string, ObservedRelation>();
  const seedSet = new Set(seedIds);
  for (const edge of graph.edges) {
    if (!visibleIds.has(edge.fromId) || !visibleIds.has(edge.toId) || !isActiveAt(edge, asOf)) continue;
    const relation = getCanonicalRelation(edge.relation);
    const observations: Array<{ direction: 'incoming' | 'outgoing'; targetId: string; targetType: CanonicalEntityKind }> = [];
    if (seedSet.has(edge.fromId)) observations.push({ direction: 'outgoing', targetId: edge.toId, targetType: relation.to });
    if (seedSet.has(edge.toId)) observations.push({ direction: 'incoming', targetId: edge.fromId, targetType: relation.from });
    for (const observation of observations) {
      const key = `${edge.relation}:${observation.direction}:${observation.targetType}`;
      const existing = observed.get(key) ?? {
        relation: edge.relation,
        meaning: relation.meaning,
        direction: observation.direction,
        targetType: observation.targetType,
        edgeIds: [],
        targetIds: []
      };
      if (!existing.edgeIds.includes(edge.id)) existing.edgeIds.push(edge.id);
      if (!existing.targetIds.includes(observation.targetId)) existing.targetIds.push(observation.targetId);
      observed.set(key, existing);
    }
  }
  return [...observed.values()].sort((left, right) => `${left.relation}:${left.direction}:${left.targetType}`.localeCompare(`${right.relation}:${right.direction}:${right.targetType}`));
}

function toCandidate(state: CandidateState, bundle: EvidenceBundle): GraphRetrievalCandidate {
  const entity = state.entity;
  return {
    source: 'graph',
    id: entity.id,
    title: entity.name,
    text: entitySearchText(entity),
    score: state.score,
    canonicalEntityId: entity.id,
    recordClass: 'canonical',
    authority: 'local_graph',
    relationPath: [...state.relationPath],
    discovery: state.discovery,
    evidence: bundle.evidence,
    ...(bundle.rationale ? { decisionRationale: bundle.rationale } : {})
  };
}

function evidenceFor(os: PersonalOs, entity: CanonicalEntity): EvidenceBundle {
  if (entity.type !== 'decision') return { evidence: [] };
  // Deliberately compare canonical IDs only. A matching title/name is not proof
  // that a legacy decision belongs to this Graph node.
  const decision = os.decisions.find((candidate) => candidate.id === entity.id);
  if (!decision) return { evidence: [] };
  const statement = [decision.decision, decision.rationale].filter((value): value is string => Boolean(value?.trim())).join('\n');
  if (!statement) return { evidence: [] };
  const rationale: DecisionRationale = {
    decisionId: decision.id,
    title: decision.title,
    decision: decision.decision,
    ...(decision.rationale ? { rationale: decision.rationale } : {})
  };
  return {
    evidence: [{ source: 'legacy_decisions', sourceId: decision.id, canonicalEntityId: entity.id, statement }],
    rationale
  };
}

function missingEvidenceFor(candidates: GraphRetrievalCandidate[]): string[] {
  if (candidates.length === 0) return ['no_candidate_evidence'];
  return candidates.filter((candidate) => candidate.evidence.length === 0).map((candidate) => `missing_evidence:${candidate.id}`);
}

function scopeToProject(graph: GraphFileV2, activeEntities: CanonicalEntity[], activeIds: Set<string>, project: CanonicalEntity, asOf: string): ScopedEntity[] {
  const activeEdges = graph.edges.filter((edge) => activeIds.has(edge.fromId) && activeIds.has(edge.toId) && isActiveAt(edge, asOf));
  return activeEntities.flatMap((entity) => {
    const scopePath = pathToProject(entity.id, project.id, activeEdges);
    return scopePath === undefined ? [] : [{ entity, scopePath }];
  });
}

function pathToProject(entityId: string, projectId: string, edges: CanonicalEdge[]): string[] | undefined {
  if (entityId === projectId) return [];
  const queue: Array<{ id: string; path: string[] }> = [{ id: entityId, path: [] }];
  const visited = new Set([entityId]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      const relation = getCanonicalRelation(edge.relation);
      if (relation.scopeTraversal === 'none' || relation.traversalDirection === 'none') continue;
      const next = relation.traversalDirection === 'forward'
        ? edge.fromId === current.id ? edge.toId : undefined
        : edge.toId === current.id ? edge.fromId : undefined;
      if (!next) continue;
      const path = [...current.path, edge.id];
      if (next === projectId) return path;
      if (relation.scopeTraversal === 'project_transitive' && !visited.has(next)) {
        visited.add(next);
        queue.push({ id: next, path });
      }
    }
  }
  return undefined;
}

function resolveProject(entities: CanonicalEntity[], requested: string | undefined): CanonicalEntity | undefined {
  if (!requested) return undefined;
  const needle = normalize(requested);
  const matches = entities.filter((entity) => entity.type === 'project' && [entity.id, entity.name, ...(entity.aliases ?? [])].some((value) => normalize(value) === needle));
  return matches.length === 1 ? matches[0] : undefined;
}

function entitySearchFields(entity: CanonicalEntity): string[] {
  return [entity.id, entity.type, entity.name, ...(entity.aliases ?? []), entity.summary ?? '', ...(entity.tags ?? []), metadataText(entity.metadata)];
}

function entityEmbeddingText(entity: CanonicalEntity): string { return entitySearchFields(entity).filter(Boolean).join('\n'); }
function entitySearchText(entity: CanonicalEntity): string { return [entity.summary ?? entity.name, metadataText(entity.metadata)].filter(Boolean).join('\n'); }
function metadataText(metadata: Record<string, unknown> | undefined): string { return metadata ? JSON.stringify(metadata) : ''; }

function lexicalScore(query: string, fields: string[]): number {
  let best = 0;
  for (const variant of queryAliases(query)) {
    const terms = searchTokens(variant);
    if (terms.length === 0) continue;
    const haystack = fields.join('\n').normalize('NFKC').toLowerCase();
    const phrase = variant.trim().normalize('NFKC').toLowerCase();
    const matched = terms.filter((term) => haystack.includes(term));
    best = Math.max(best, phrase && haystack.includes(phrase) ? terms.length + 20 : matched.length === terms.length ? terms.length + 10 : matched.length);
  }
  return best;
}

function queryAliases(query: string): string[] {
  const canonical = query.normalize('NFKC').trim();
  const alias = canonical.replace(/(?:さん|様|氏|くん|君|ちゃん)$/u, '').trim();
  return alias && alias !== canonical ? [canonical, alias] : [canonical];
}

function searchTokens(query: string): string[] {
  const seen = new Set<string>();
  return query.normalize('NFKC').replace(/[|/\\,;:()[\]{}"'`“”‘’、。・･，．：；（）［］｛｝「」『』【】]/g, ' ').replace(/[-_]+/g, ' ').toLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean).filter((term) => seen.has(term) ? false : (seen.add(term), true));
}

function normalize(value: string): string { return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase(); }

function rankStates(states: CandidateState[]): CandidateState[] { return [...states].sort(compareStates); }
function compareStates(left: CandidateState, right: CandidateState): number { return right.score - left.score || left.entity.id.localeCompare(right.entity.id); }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }

function migrationResponse(input: GraphRetrievalInput & { asOf: string; limit: number; seedIds: string[]; steps: GraphRetrievalStep[]; partialReasons: string[] }): GraphRetrievalResponse {
  const partialReasons = unique([...input.partialReasons, 'graph_v1_migration_required']);
  const empty: GraphRetrievalCandidate[] = [];
  return {
    graphVersion: 1,
    schemaVersion: 1,
    status: 'migration_required',
    migrationRequired: true,
    authority: 'local_graph',
    query: input.query,
    asOf: input.asOf,
    method: 'seed',
    semantic: { available: false, method: 'seed' },
    candidates: empty,
    results: empty,
    observedRelations: [],
    observedRelationCatalog: [],
    traversal: { seedIds: [], steps: input.steps, maxSeeds: GRAPH_RETRIEVAL_MAX_SEEDS, maxSteps: GRAPH_RETRIEVAL_MAX_STEPS, maxLimit: GRAPH_RETRIEVAL_MAX_LIMIT },
    coverage: 'unknown',
    partialReasons,
    missingEvidence: ['graph_v1_migration_required'],
    evidence: [],
    sufficiency: 'insufficient',
    absenceConfirmed: false
  };
}
