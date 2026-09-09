/**
 * Pure semantic and graph retrieval.
 *
 * This module deliberately does not decide what a natural-language relation
 * means. A caller supplies the relation plan after model interpretation; the
 * engine only follows the edges that are present in the supplied Graph data.
 */

export interface GraphNode {
  id: string;
  entity_type: string;
  project_code?: string;
  payload: Record<string, unknown>;
  lifecycle_state?: string;
  lifecycle_status?: string;
  semantic_state?: string;
}

export interface GraphEdge {
  id?: string;
  from_id: string;
  to_id: string;
  rel_type: string;
  lifecycle_state?: string;
  lifecycle_status?: string;
  semantic_state?: string;
  payload?: Record<string, unknown>;
}

export type Embedder = (texts: string[], kind: 'query' | 'passage') => Promise<number[][]>;

export interface RetrievalPlanStep {
  relation: string;
  direction: 'incoming' | 'outgoing';
  target_type?: string;
}

export interface RetrievalPlan {
  seed_ids: string[];
  steps: RetrievalPlanStep[];
}

export interface RetrievalPath {
  node_ids: string[];
  edges: GraphEdge[];
}

export interface RetrievalEvidence {
  content?: unknown;
  statement?: unknown;
  decision?: unknown;
  rationale?: unknown;
  body?: unknown;
  source_pointer?: unknown;
  provenance?: unknown;
}

export type RetrievalSufficiency = 'needs_model_verification' | 'insufficient';

export interface RetrievalCandidate {
  id: string;
  entity_type: string;
  project_code?: string;
  name: string | null;
  title: string | null;
  display_name: string | null;
  score: number | null;
  evidence: RetrievalEvidence;
  evidence_status: 'present' | 'missing';
  missing_evidence: BodyEvidenceField[];
  source_pointer_resolved: false;
  paths: RetrievalPath[];
}

export interface RetrieveGraphResult {
  candidates: RetrievalCandidate[];
  coverage: 'complete' | 'partial' | 'unknown';
  sufficiency: RetrievalSufficiency;
}

export interface RetrieveGraphOptions {
  query: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /**
   * Local embedding is retained as an injectable test seam. Production
   * callers should provide precomputedScores from the Graph API instead.
   */
  embed?: Embedder;
  /** Scores returned by the server-side vector search, keyed by node id. */
  precomputedScores?: ReadonlyMap<string, number | null>;
  top_k?: number;
  plan?: RetrievalPlan;
  coverage: 'complete' | 'partial' | 'unknown';
}

const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 100;
const MAX_PLAN_SEEDS = 10;
const MAX_PLAN_STEPS = 3;
const MAX_PATHS_PER_CANDIDATE = 20;
const MAX_GRAPH_RESULTS = 100;
const MAX_QUERY_LENGTH = 10_000;
const MAX_PLAN_VALUE_LENGTH = 1_000;

const RETIRED_LIFECYCLE_STATES = new Set(['retired', 'merged', 'inactive', 'superseded']);
const EVIDENCE_FIELDS = [
  'content',
  'statement',
  'decision',
  'rationale',
  'body',
  'source_pointer',
  'provenance',
] as const;
const BODY_EVIDENCE_FIELDS = ['content', 'statement', 'decision', 'rationale', 'body'] as const;

type BodyEvidenceField = (typeof BODY_EVIDENCE_FIELDS)[number];

interface InternalPath {
  node_ids: string[];
  edges: GraphEdge[];
}

interface ValidatedPlan {
  seed_ids: string[];
  steps: RetrievalPlanStep[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validationError(message: string): TypeError {
  return new TypeError(`retrieveGraph: ${message}`);
}

function validateQuery(query: unknown): string {
  if (typeof query !== 'string') throw validationError('query must be a string');
  const normalized = query.trim();
  if (!normalized) throw validationError('query must not be empty');
  if (normalized.length > MAX_QUERY_LENGTH) {
    throw validationError(`query must be at most ${MAX_QUERY_LENGTH} characters`);
  }
  return normalized;
}

function validateTopK(topK: unknown): number {
  const value = topK === undefined ? DEFAULT_TOP_K : topK;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_TOP_K) {
    throw validationError(`top_k must be an integer between 1 and ${MAX_TOP_K}`);
  }
  return value;
}

function validateCoverage(coverage: unknown): asserts coverage is RetrieveGraphResult['coverage'] {
  if (coverage !== 'complete' && coverage !== 'partial' && coverage !== 'unknown') {
    throw validationError('coverage must be complete, partial, or unknown');
  }
}

function validatePlanValue(value: unknown, field: string): string {
  if (typeof value !== 'string') throw validationError(`plan.${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw validationError(`plan.${field} must not be empty`);
  if (normalized.length > MAX_PLAN_VALUE_LENGTH) {
    throw validationError(`plan.${field} must be at most ${MAX_PLAN_VALUE_LENGTH} characters`);
  }
  return normalized;
}

function validatePlan(plan: unknown): ValidatedPlan {
  if (!isRecord(plan)) throw validationError('plan must be an object');
  if (!Array.isArray(plan.seed_ids)) throw validationError('plan.seed_ids must be an array');
  if (plan.seed_ids.length === 0 || plan.seed_ids.length > MAX_PLAN_SEEDS) {
    throw validationError(`plan.seed_ids must contain between 1 and ${MAX_PLAN_SEEDS} items`);
  }
  if (!Array.isArray(plan.steps)) throw validationError('plan.steps must be an array');
  if (plan.steps.length > MAX_PLAN_STEPS) {
    throw validationError(`plan.steps must contain at most ${MAX_PLAN_STEPS} items`);
  }

  const seedIds: string[] = [];
  const seenSeeds = new Set<string>();
  for (const seed of plan.seed_ids) {
    const seedId = validatePlanValue(seed, 'seed_ids item');
    if (!seenSeeds.has(seedId)) {
      seenSeeds.add(seedId);
      seedIds.push(seedId);
    }
  }

  const steps: RetrievalPlanStep[] = [];
  for (const [index, rawStep] of plan.steps.entries()) {
    if (!isRecord(rawStep)) throw validationError(`plan.steps[${index}] must be an object`);
    const relation = validatePlanValue(rawStep.relation, `steps[${index}].relation`);
    if (rawStep.direction !== 'incoming' && rawStep.direction !== 'outgoing') {
      throw validationError(`plan.steps[${index}].direction must be incoming or outgoing`);
    }
    let targetType: string | undefined;
    if (rawStep.target_type !== undefined) {
      targetType = validatePlanValue(rawStep.target_type, `steps[${index}].target_type`);
    }
    steps.push({ relation, direction: rawStep.direction, ...(targetType ? { target_type: targetType } : {}) });
  }

  return { seed_ids: seedIds, steps };
}

function validateNode(node: unknown, index: number): asserts node is GraphNode {
  if (!isRecord(node)) throw validationError(`nodes[${index}] must be an object`);
  if (typeof node.id !== 'string' || !node.id.trim()) throw validationError(`nodes[${index}].id must be a non-empty string`);
  if (typeof node.entity_type !== 'string' || !node.entity_type.trim()) {
    throw validationError(`nodes[${index}].entity_type must be a non-empty string`);
  }
  if (!isRecord(node.payload)) throw validationError(`nodes[${index}].payload must be an object`);
  if (node.project_code !== undefined && typeof node.project_code !== 'string') {
    throw validationError(`nodes[${index}].project_code must be a string when present`);
  }
  if (node.lifecycle_state !== undefined && typeof node.lifecycle_state !== 'string') {
    throw validationError(`nodes[${index}].lifecycle_state must be a string when present`);
  }
}

function validateEdge(edge: unknown, index: number): asserts edge is GraphEdge {
  if (!isRecord(edge)) throw validationError(`edges[${index}] must be an object`);
  for (const field of ['from_id', 'to_id', 'rel_type'] as const) {
    if (typeof edge[field] !== 'string' || !edge[field].trim()) {
      throw validationError(`edges[${index}].${field} must be a non-empty string`);
    }
  }
  if (edge.id !== undefined && (typeof edge.id !== 'string' || !edge.id.trim())) {
    throw validationError(`edges[${index}].id must be a non-empty string when present`);
  }
  if (edge.lifecycle_state !== undefined && typeof edge.lifecycle_state !== 'string') {
    throw validationError(`edges[${index}].lifecycle_state must be a string when present`);
  }
  if (edge.payload !== undefined && !isRecord(edge.payload)) {
    throw validationError(`edges[${index}].payload must be an object when present`);
  }
}

function lifecycleValues(value: unknown): unknown[] {
  if (!isRecord(value)) return [value];
  return [value.lifecycle_state, value.lifecycle_status, value.lifecycle, value.status, value.state, value.semantic_state];
}

function isExcludedLifecycle(
  topLevelState: unknown,
  payload: Record<string, unknown> | undefined,
  lifecycleStatus?: unknown,
  semanticState?: unknown,
): boolean {
  const values = [topLevelState, lifecycleStatus, semanticState, ...(payload ? lifecycleValues(payload) : [])];
  for (const value of values) {
    if (typeof value === 'string' && RETIRED_LIFECYCLE_STATES.has(value.trim().toLowerCase())) return true;
  }
  return false;
}

function isActiveNode(node: GraphNode): boolean {
  return !isExcludedLifecycle(node.lifecycle_state, node.payload, node.lifecycle_status, node.semantic_state);
}

function isActiveEdge(edge: GraphEdge): boolean {
  return !isExcludedLifecycle(edge.lifecycle_state, edge.payload, edge.lifecycle_status, edge.semantic_state);
}

function stringifyPayloadValue(value: unknown, seen: Set<object>): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => stringifyPayloadValue(item, seen)).filter(Boolean).join(' ');
  return Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${key}: ${stringifyPayloadValue(nested, seen)}`)
    .filter(Boolean)
    .join(' ');
}

function passageText(node: GraphNode): string {
  // Keep parity with the pilot benchmark and avoid embedding lifecycle metadata,
  // arbitrary fields, or source paths. Field order is part of the stable input.
  const fields = [
    'name',
    'title',
    'statement',
    'summary',
    'description',
    'content',
    'body',
    'decision',
    'rationale',
    'aliases',
    'code',
    'affected_terms',
  ];
  const values: string[] = [];
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(node.payload, field)) {
      const value = stringifyPayloadValue(node.payload[field], new Set<object>());
      if (value.trim()) values.push(value);
    }
  }
  return values.join('\n').slice(0, 8_000);
}

function hasSubstantiveValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function extractEvidence(payload: Record<string, unknown>): RetrievalEvidence {
  const evidence: RetrievalEvidence = {};
  for (const field of EVIDENCE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field) && payload[field] !== undefined) {
      evidence[field] = payload[field];
    }
  }
  return evidence;
}

function hasBodyEvidence(evidence: RetrievalEvidence): boolean {
  return BODY_EVIDENCE_FIELDS.some((field: BodyEvidenceField) => hasSubstantiveValue(evidence[field]));
}

function missingBodyEvidence(evidence: RetrievalEvidence): BodyEvidenceField[] {
  return BODY_EVIDENCE_FIELDS.filter((field: BodyEvidenceField) => !hasSubstantiveValue(evidence[field]));
}

function displayField(payload: Record<string, unknown>, field: 'name' | 'title'): string | null {
  const value = payload[field];
  return typeof value === 'string' && value.trim() ? value : null;
}

function validateVector(value: unknown, label: string, expectedDimension?: number): number[] {
  if (!Array.isArray(value) || value.length === 0) throw validationError(`${label} must be a non-empty number vector`);
  if (expectedDimension !== undefined && value.length !== expectedDimension) {
    throw validationError(`${label} dimension ${value.length} does not match ${expectedDimension}`);
  }
  let normSquared = 0;
  for (const component of value) {
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      throw validationError(`${label} must contain only finite numbers`);
    }
    normSquared += component * component;
  }
  if (!Number.isFinite(normSquared) || normSquared === 0) throw validationError(`${label} must have a non-zero norm`);
  return value;
}

function validatePrecomputedScore(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) {
    throw validationError(`${label} must be a finite number between -1 and 1 or null`);
  }
  return value;
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftNormSquared = 0;
  let rightNormSquared = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNormSquared += left[index] * left[index];
    rightNormSquared += right[index] * right[index];
  }
  return dot / Math.sqrt(leftNormSquared * rightNormSquared);
}

function cloneEdge(edge: GraphEdge): GraphEdge {
  return edge.payload === undefined ? { ...edge } : { ...edge, payload: { ...edge.payload } };
}

function selectPlanNodes(
  plan: ValidatedPlan,
  nodeById: Map<string, GraphNode>,
  activeEdges: GraphEdge[],
): { ids: string[]; pathsById: Map<string, InternalPath[]>; truncated: boolean } {
  const selectedIds: string[] = [];
  const selectedIdSet = new Set<string>();
  const pathsById = new Map<string, InternalPath[]>();
  const frontier = new Map<string, InternalPath[]>();
  let truncated = false;

  for (const seedId of plan.seed_ids) {
    const seed = nodeById.get(seedId);
    if (!seed || !isActiveNode(seed)) continue;
    if (!selectedIdSet.has(seedId) && selectedIds.length < MAX_GRAPH_RESULTS) {
      selectedIdSet.add(seedId);
      selectedIds.push(seedId);
    }
    pathsById.set(seedId, []);
    frontier.set(seedId, [{ node_ids: [seedId], edges: [] }]);
  }

  for (const step of plan.steps) {
    if (frontier.size === 0) break;
    const nextFrontier = new Map<string, InternalPath[]>();
    for (const [currentId, currentPaths] of frontier.entries()) {
      for (const edge of activeEdges) {
        const matchesDirection = step.direction === 'outgoing'
          ? edge.from_id === currentId
          : edge.to_id === currentId;
        if (!matchesDirection || edge.rel_type !== step.relation) continue;
        const targetId = step.direction === 'outgoing' ? edge.to_id : edge.from_id;
        const targetNode = nodeById.get(targetId);
        if (!targetNode || !isActiveNode(targetNode)) continue;
        if (step.target_type !== undefined && targetNode.entity_type !== step.target_type) continue;

        const paths = currentPaths.length > 0
          ? currentPaths
          : [{ node_ids: [currentId], edges: [] }];
        for (const path of paths) {
          if (path.node_ids.includes(targetId)) continue;
          const nextPath: InternalPath = {
            node_ids: [...path.node_ids, targetId],
            edges: [...path.edges, cloneEdge(edge)],
          };
          if (!selectedIdSet.has(targetId) && selectedIds.length >= MAX_GRAPH_RESULTS) {
            truncated = true;
            continue;
          }
          const existingPaths = nextFrontier.get(targetId) || [];
          if (existingPaths.length < MAX_PATHS_PER_CANDIDATE) existingPaths.push(nextPath);
          nextFrontier.set(targetId, existingPaths);

          const allPaths = pathsById.get(targetId) || [];
          if (allPaths.length < MAX_PATHS_PER_CANDIDATE) allPaths.push(nextPath);
          pathsById.set(targetId, allPaths);
          if (!selectedIdSet.has(targetId)) {
            selectedIdSet.add(targetId);
            selectedIds.push(targetId);
          }
        }
      }
    }
    frontier.clear();
    for (const [id, paths] of nextFrontier.entries()) frontier.set(id, paths);
  }

  const finalIds = plan.steps.length > 0 ? [...frontier.keys()] : [...selectedIds];
  return { ids: finalIds, pathsById, truncated };
}

function sortByScore<T extends { id: string; score: number | null }>(items: T[], inputOrder: Map<string, number>): T[] {
  return [...items].sort((left, right) => {
    if (left.score === null && right.score !== null) return 1;
    if (left.score !== null && right.score === null) return -1;
    if (left.score !== null && right.score !== null && left.score !== right.score) return right.score - left.score;
    return (inputOrder.get(left.id) || 0) - (inputOrder.get(right.id) || 0);
  });
}

async function calculateScores(query: string, nodes: GraphNode[], embed: Embedder): Promise<Map<string, number>> {
  if (nodes.length === 0) return new Map();
  if (typeof embed !== 'function') throw validationError('embed must be a function');

  const queryVectors = await embed([query], 'query');
  if (!Array.isArray(queryVectors) || queryVectors.length !== 1) {
    throw validationError('embed(query) must return exactly one vector');
  }
  const queryVector = validateVector(queryVectors[0], 'query vector');

  const passageVectors = await embed(nodes.map(passageText), 'passage');
  if (!Array.isArray(passageVectors) || passageVectors.length !== nodes.length) {
    throw validationError(`embed(passage) must return ${nodes.length} vectors`);
  }
  const scores = new Map<string, number>();
  for (const [index, node] of nodes.entries()) {
    const passageVector = validateVector(passageVectors[index], `passage vector ${index}`, queryVector.length);
    const score = cosineSimilarity(queryVector, passageVector);
    if (!Number.isFinite(score)) throw validationError(`cosine score for passage ${index} is not finite`);
    scores.set(node.id, score);
  }
  return scores;
}

/**
 * Retrieve active Graph nodes by semantic similarity and, when supplied, an
 * explicit model-authored relation plan. The function has no network access,
 * persistence, or natural-language relation parser.
 */
export async function retrieveGraph(options: RetrieveGraphOptions): Promise<RetrieveGraphResult> {
  if (!isRecord(options)) throw validationError('options must be an object');
  const query = validateQuery(options.query);
  const topK = validateTopK(options.top_k);
  validateCoverage(options.coverage);
  if (!Array.isArray(options.nodes)) throw validationError('nodes must be an array');
  if (!Array.isArray(options.edges)) throw validationError('edges must be an array');
  if (options.embed !== undefined && typeof options.embed !== 'function') throw validationError('embed must be a function');
  if (options.precomputedScores !== undefined && typeof options.precomputedScores !== 'object') {
    throw validationError('precomputedScores must be a map');
  }
  if (options.precomputedScores !== undefined) {
    for (const [id, score] of options.precomputedScores.entries()) {
      if (typeof id !== 'string' || !id.trim()) throw validationError('precomputedScores keys must be non-empty strings');
      validatePrecomputedScore(score, `precomputed score for ${id}`);
    }
  }
  const plan = options.plan === undefined ? undefined : validatePlan(options.plan);

  const nodeById = new Map<string, GraphNode>();
  const inputOrder = new Map<string, number>();
  for (const [index, node] of options.nodes.entries()) {
    validateNode(node, index);
    if (nodeById.has(node.id)) throw validationError(`nodes contain duplicate id ${node.id}`);
    nodeById.set(node.id, node);
    inputOrder.set(node.id, index);
  }

  const activeEdges: GraphEdge[] = [];
  for (const [index, edge] of options.edges.entries()) {
    validateEdge(edge, index);
    if (isActiveEdge(edge)) activeEdges.push(edge);
  }

  let candidateIds: string[];
  let pathsById = new Map<string, InternalPath[]>();
  let graphTruncated = false;
  if (plan) {
    const selection = selectPlanNodes(plan, nodeById, activeEdges);
    candidateIds = selection.ids;
    pathsById = selection.pathsById;
    graphTruncated = selection.truncated;
  } else {
    candidateIds = options.nodes.filter(isActiveNode).map(node => node.id);
  }

  const candidateNodes = candidateIds
    .map(id => nodeById.get(id))
    .filter((node): node is GraphNode => node !== undefined && isActiveNode(node));
  let scores: Map<string, number | null>;
  let scoreCoveragePartial = false;
  if (options.precomputedScores !== undefined) {
    scores = new Map<string, number | null>();
    for (const candidate of candidateNodes) {
      if (!options.precomputedScores.has(candidate.id)) {
        scoreCoveragePartial = true;
        continue;
      }
      scores.set(candidate.id, validatePrecomputedScore(
        options.precomputedScores.get(candidate.id),
        `precomputed score for ${candidate.id}`,
      ));
      if (scores.get(candidate.id) === null) scoreCoveragePartial = true;
    }
  } else if (plan) {
    // A relation plan intentionally returns graph-selected candidates without
    // ranking. Callers that need scores must provide the server response map.
    scores = new Map<string, number | null>();
  } else {
    if (typeof options.embed !== 'function') throw validationError('embed must be a function when precomputedScores are absent');
    scores = await calculateScores(query, candidateNodes, options.embed);
  }

  const allCandidates = sortByScore(candidateNodes.map(node => {
    const evidence = extractEvidence(node.payload);
    const missingEvidence = missingBodyEvidence(evidence);
    const name = displayField(node.payload, 'name');
    const title = displayField(node.payload, 'title');
    return {
    id: node.id,
    entity_type: node.entity_type,
    ...(node.project_code ? { project_code: node.project_code } : {}),
    name,
    title,
    display_name: title || name,
    score: scores.get(node.id) ?? null,
    evidence,
    evidence_status: missingEvidence.length < BODY_EVIDENCE_FIELDS.length ? 'present' as const : 'missing' as const,
    missing_evidence: missingEvidence,
    source_pointer_resolved: false as const,
    paths: (pathsById.get(node.id) || []).map(path => ({
      node_ids: [...path.node_ids],
      edges: path.edges.map(cloneEdge),
    })),
  }; }), inputOrder);
  const candidates = allCandidates.slice(0, topK);

  const sufficiency: RetrievalSufficiency = candidates.some(candidate => hasBodyEvidence(candidate.evidence))
    ? 'needs_model_verification'
    : 'insufficient';

  const coverage = options.coverage === 'complete' && (graphTruncated || allCandidates.length > topK || scoreCoveragePartial)
    ? 'partial'
    : options.coverage;
  return { candidates, coverage, sufficiency };
}
