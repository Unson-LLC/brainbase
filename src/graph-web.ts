import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isActiveAt, validateCanonicalGraph } from './canonical-graph.js';
import { assertFoundationCatalog, findFoundationRecord } from './foundation-catalog.js';
import {
  GRAPH_CORRECTION_EDGE_FIELDS,
  GRAPH_CORRECTION_ENTITY_FIELDS,
  GRAPH_CORRECTION_NEW_EDGE_RELATIONS,
  GRAPH_CORRECTION_PROJECT_FIELDS,
  GRAPH_CORRECTIONS_FILE,
  graphRecordDigest,
  readGraphCorrectionHistory,
  type GraphCorrectionRecord
} from './graph-corrections.js';
import { ONTOLOGY_VERSION, portableOntology } from './ontology.js';
import { canonicalRelationRegistry, getCanonicalRelation } from './relation-registry.js';
import { loadPersonalOs } from './ssot.js';
import { bindPortableGraphOwner, validatePortableGraph, type PortableGraphBundle, type PortableGraphOwner } from './portable-graph.js';
import type { FoundationAdoptionState, FoundationOperator, ObjectiveDefinition, VariableDefinition } from './ontology-foundation.js';
import type { CanonicalEdge, CanonicalEntity, CanonicalEntityKind, CoreRelation, DecisionRecord, GraphFileV2, PersonalOs } from './types.js';

/**
 * Read views of the canonical local Graph for the local Web screens
 * "プロジェクトと関係者" and "情報と関係".
 *
 * Every function takes an explicit data directory chosen by the host, never by
 * the browser. A Graph v1 file is reported as `migration_required` and a
 * missing data set as `not_initialized`; neither is presented as zero items,
 * and a read failure is thrown instead of being returned as an empty list.
 *
 * `openOwnerPrivateGraph` gives the same read views over a portable bundle a
 * host keeps for its owner (the owner-private area), without a data directory.
 */

export const GRAPH_WEB_VERSION = 'graph-web.v1' as const;
export const GRAPH_WEB_START_COMMAND = 'brainbase onboard:start';
export const GRAPH_WEB_SEARCH_MAX_LIMIT = 100;

const CANONICAL_FILES = ['graph.json', 'relationships.json', 'personal-kg.jsonl', 'decisions.jsonl'] as const;
const ENTITY_KINDS: readonly CanonicalEntityKind[] = ['person', 'org', 'project', 'decision'];
/** The kinds of record a Graph v2 can hold; any other kind is absent from it. */
export const GRAPH_WEB_ENTITY_KINDS: readonly CanonicalEntityKind[] = ENTITY_KINDS;
const PARTICIPATION: ReadonlySet<CoreRelation> = new Set(['participates_in', 'accountable_for']);
const EXTRACTED_CANDIDATE_FILE = /^extracted-[^/\\]+\.json$/u;
const ONBOARDING_LEDGER_FILE = 'runs/connected-onboarding.json';
const ONBOARDING_LEDGER_SCHEMA = 'connected_onboarding.v1';

export interface GraphWebSource {
  dataDir: string;
  graphFormat: 1 | 2 | null;
  authority: 'local_graph';
}

/**
 * A portable bundle a host keeps for its owner: the owner's own records, not
 * the host's shared Graph.  There is no data directory.
 */
export interface GraphWebOwnerPrivateSource {
  dataDir: null;
  graphFormat: 2;
  authority: 'owner_private';
}

/**
 * The owner's organization Graph read through the host (ledger C1): read only,
 * held in memory, never written to the data directory.
 */
export interface GraphWebOrganizationSource {
  dataDir: null;
  graphFormat: 2;
  authority: 'organization_graph';
  /** Organization server origin, without credentials. */
  server: string;
  /** When the host last read the organization Graph. */
  readAt: string;
}

export type GraphWebAnySource = GraphWebSource | GraphWebOwnerPrivateSource | GraphWebOrganizationSource;

export interface GraphMigrationRequired {
  status: 'migration_required';
  source: GraphWebSource;
  /** Entities in the Graph v1 file. They exist but cannot be shown or corrected until migrated. */
  legacyEntityCount: number;
  /** Preview first; it prints the expectedInputDigest the write step needs. */
  command: string;
  writeCommand: string;
  message: string;
  absenceConfirmed: false;
}

export interface GraphNotInitialized {
  status: 'not_initialized';
  source: GraphWebSource;
  command: typeof GRAPH_WEB_START_COMMAND;
  message: string;
  /** No canonical file exists in the data directory, so nothing is registered. */
  absenceConfirmed: true;
}

export type GraphWebUnavailable = GraphMigrationRequired | GraphNotInitialized;

export interface GraphReadIssue {
  file: string;
  line?: number;
  reason: string;
}

export interface GraphEntityView {
  id: string;
  type: CanonicalEntityKind;
  name: string;
  aliases: string[];
  summary: string | null;
  tags: string[];
  validFrom: string | null;
  validTo: string | null;
  /** Active at the response `asOf`. */
  active: boolean;
  digest: string;
  goal?: string | null;
  status?: string | null;
}

export type GraphProvenanceReference =
  | { status: 'none' }
  | { status: 'unresolved'; sourceId: string }
  | {
    status: 'resolved';
    kind: 'extracted_candidate';
    file: string;
    candidateId: string;
    candidateKind: string | null;
    label: string | null;
  }
  | {
    status: 'resolved';
    kind: 'onboarding_run_candidate';
    file: typeof ONBOARDING_LEDGER_FILE;
    runId: string;
    candidateId: string;
    candidateKind: string | null;
    reviewStatus: string | null;
    label: string | null;
  }
  | {
    status: 'resolved';
    kind: 'graph_correction';
    file: typeof GRAPH_CORRECTIONS_FILE;
    correctionId: string;
    at: string;
    reason: string;
  };

export interface GraphProvenanceView {
  sourceKind: NonNullable<CanonicalEdge['provenance']>['sourceKind'] | null;
  sourceId: string | null;
  evidenceHash: string | null;
  reference: GraphProvenanceReference;
}

export interface GraphEdgeView {
  id: string;
  relation: CoreRelation;
  meaning: string;
  direction: 'incoming' | 'outgoing';
  fromId: string;
  toId: string;
  role: string | null;
  context: string | null;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  provenance: GraphProvenanceView;
  counterpart: { id: string; type: CanonicalEntityKind; name: string; active: boolean; digest: string };
  digest: string;
}

export interface GraphWebStatus<S extends GraphWebAnySource = GraphWebSource> {
  status: 'ok';
  version: typeof GRAPH_WEB_VERSION;
  source: S;
  asOf: string;
  ontology: { id: string; version: string; releaseDigest: string; currentVersion: string };
  counts: {
    entities: Record<CanonicalEntityKind, number> & { total: number };
    edges: { total: number; active: number };
    relationships: number;
    corrections: number;
  };
  issues: GraphReadIssue[];
}

export interface GraphProjectPersonView {
  id: string;
  name: string;
  /** True when one of the person's active relations to the project is accountable_for. */
  accountable: boolean;
}

export interface GraphProjectListItem extends GraphEntityView {
  type: 'project';
  goal: string | null;
  status: string | null;
  /** Distinct people with an active participates_in or accountable_for relation. */
  participantCount: number;
  accountableCount: number;
  /** The same people by name, accountable first, so a list can name them and count them across projects. */
  people: GraphProjectPersonView[];
}

export interface GraphProjectList<S extends GraphWebAnySource = GraphWebSource> {
  status: 'ok';
  source: S;
  asOf: string;
  projects: GraphProjectListItem[];
  /** True only when the readable Graph v2 holds no project at all. */
  absenceConfirmed: boolean;
}

export interface GraphProjectDetail<S extends GraphWebAnySource = GraphWebSource> {
  status: 'ok';
  source: S;
  asOf: string;
  project: GraphEntityView & { type: 'project'; goal: string | null; status: string | null; decisionPrinciples: string[]; metadata: Record<string, unknown> };
  /** Incoming participates_in / accountable_for relations, including ended ones. */
  participants: GraphEdgeView[];
  /** Other relations of the project (governs, owned_by, ...). */
  relations: GraphEdgeView[];
  history: GraphCorrectionRecord[];
  issues: GraphReadIssue[];
}

export interface GraphEntitySearchInput {
  q?: string;
  type?: string;
  asOf?: string;
  limit?: number;
  /** Used for each result's `active` flag when no as_of filter is given. */
  now?: Date;
}

export interface GraphEntitySearchResult<S extends GraphWebAnySource = GraphWebSource> {
  status: 'ok';
  source: S;
  query: { q: string; type: CanonicalEntityKind | null; asOf: string | null };
  results: GraphEntityView[];
  total: number;
  truncated: boolean;
  /**
   * True when the whole readable Graph v2 was scanned and nothing matched the
   * name/alias query and filters. Never true for Graph v1 or a read failure.
   */
  absenceConfirmed: boolean;
  /** True when the Graph v2 holds no entity at all (show "まだ登録がありません"). */
  graphEmpty: boolean;
}

export interface GraphEntityDetail<S extends GraphWebAnySource = GraphWebSource> {
  status: 'ok';
  source: S;
  asOf: string;
  entity: GraphEntityView & { metadata: Record<string, unknown> };
  outgoing: GraphEdgeView[];
  incoming: GraphEdgeView[];
  history: GraphCorrectionRecord[];
  issues: GraphReadIssue[];
  /**
   * For a decision of a portable bundle: its judgment record (判断根拠) from
   * the bundle's decisions, or null when the bundle has none for it.
   */
  decisionRecord?: GraphDecisionRecordView | null;
}

export interface GraphDecisionRecordView {
  title: string;
  decision: string;
  rationale: string | null;
  topic: string | null;
  effectiveAt: string | null;
  supersedes: string[];
}

/** A person named by an objective, with the name of their record in the same Graph (null when it has none). */
export interface GraphObjectivePersonView {
  id: string;
  name: string | null;
}

/** The latest revision of an objective defined in a Graph's foundation. */
export interface GraphObjectiveView {
  id: string;
  revision: string;
  meaning: string;
  desiredState: string;
  adoptionState: FoundationAdoptionState;
  evaluationPeriod: { from: string; until: string };
  criteria: Array<{
    variable: { id: string; revision: string; meaning: string | null; unit: string | null };
    operator: FoundationOperator;
    target: string | number | boolean | null;
  }>;
  accountable: GraphObjectivePersonView | null;
  beneficiaries: GraphObjectivePersonView[];
  visibility: string;
}

export interface GraphObjectiveList<S extends GraphWebAnySource = GraphWebSource> {
  status: 'ok';
  source: S;
  objectives: GraphObjectiveView[];
  /** `none` when the Graph has no foundation at all. */
  foundation: 'none' | 'ok';
  /** True when the foundation was read and holds no objective. */
  absenceConfirmed: boolean;
}

export interface GraphOntologySummary<S extends GraphWebAnySource = GraphWebSource> {
  status: 'ok';
  source: S;
  asOf: string;
  ontology: { id: string; version: string; releaseDigest: string; currentVersion: string; upToDate: boolean };
  entityTypes: Array<{ id: CanonicalEntityKind; meaning: string; count: number }>;
  relations: Array<{ id: CoreRelation; from: CanonicalEntityKind; to: CanonicalEntityKind; meaning: string; count: number; activeCount: number }>;
  corrections: {
    entityFields: readonly string[];
    projectFields: readonly string[];
    edgeFields: readonly string[];
    newEdgeRelations: readonly string[];
  };
}

export type GraphWebErrorKind = 'invalid' | 'not_found' | 'unavailable';

export class GraphWebError extends Error {
  readonly name = 'GraphWebError';
  constructor(readonly kind: GraphWebErrorKind, readonly code: string, message: string) {
    super(message);
  }
}

export interface GraphWebReadOptions {
  asOf?: string;
  now?: Date;
}

type LoadedGraph = { os: PersonalOs; graph: GraphFileV2; source: GraphWebSource };

export async function readGraphWebStatus(dataDir: string, options: GraphWebReadOptions = {}): Promise<GraphWebStatus | GraphWebUnavailable> {
  const loaded = await loadForRead(dataDir);
  if ('status' in loaded) return loaded;
  const asOf = resolveAsOf(options);
  const { graph } = loaded;
  const entities = Object.fromEntries(ENTITY_KINDS.map((kind) => [kind, graph.entities.filter((entity) => entity.type === kind).length])) as Record<CanonicalEntityKind, number>;
  const history = await readGraphCorrectionHistory(dataDir);
  return {
    status: 'ok',
    version: GRAPH_WEB_VERSION,
    source: loaded.source,
    asOf,
    ontology: { ...graph.ontology, currentVersion: ONTOLOGY_VERSION },
    counts: {
      entities: { ...entities, total: graph.entities.length },
      edges: { total: graph.edges.length, active: graph.edges.filter((edge) => isActiveAt(edge, asOf)).length },
      relationships: loaded.os.relationships.relationships.length,
      corrections: history.records.length
    },
    issues: history.issues
  };
}

export async function listGraphProjects(dataDir: string, options: GraphWebReadOptions = {}): Promise<GraphProjectList | GraphWebUnavailable> {
  const loaded = await loadForRead(dataDir);
  if ('status' in loaded) return loaded;
  return projectListOf(loaded.graph, loaded.source, resolveAsOf(options));
}

function projectListOf<S extends GraphWebAnySource>(graph: GraphFileV2, source: S, asOf: string): GraphProjectList<S> {
  const entities = entityIndex(graph);
  const projects = graph.entities.filter((entity) => entity.type === 'project').map((project) => {
    const participation = graph.edges.filter((edge) => edge.toId === project.id && PARTICIPATION.has(edge.relation)
      && isActiveAt(edge, asOf) && isEntityActive(entities.get(edge.fromId), asOf));
    const byPerson = new Map<string, GraphProjectPersonView>();
    for (const edge of participation) {
      const person = byPerson.get(edge.fromId) ?? { id: edge.fromId, name: entities.get(edge.fromId)?.name ?? edge.fromId, accountable: false };
      if (edge.relation === 'accountable_for') person.accountable = true;
      byPerson.set(edge.fromId, person);
    }
    const people = [...byPerson.values()].sort((left, right) => Number(right.accountable) - Number(left.accountable)
      || left.name.localeCompare(right.name, 'ja')
      || left.id.localeCompare(right.id, 'en'));
    return {
      ...projectView(project, asOf),
      participantCount: people.length,
      accountableCount: people.filter((person) => person.accountable).length,
      people
    } satisfies GraphProjectListItem;
  }).sort(byActiveThenName);
  return { status: 'ok', source, asOf, projects, absenceConfirmed: projects.length === 0 };
}

export async function readGraphProject(dataDir: string, projectId: string, options: GraphWebReadOptions = {}): Promise<GraphProjectDetail | GraphWebUnavailable> {
  const loaded = await loadForRead(dataDir);
  if ('status' in loaded) return loaded;
  const asOf = resolveAsOf(options);
  if (!loaded.graph.entities.some((entity) => entity.id === projectId && entity.type === 'project')) {
    throw new GraphWebError('not_found', 'project_not_found', `No project ${projectId}`);
  }
  return projectDetailOf(loaded.graph, loaded.source, projectId, asOf, await loadReferences(dataDir));
}

function projectDetailOf<S extends GraphWebAnySource>(graph: GraphFileV2, source: S, projectId: string, asOf: string, references: ReferenceIndex): GraphProjectDetail<S> {
  const project = graph.entities.find((entity) => entity.id === projectId && entity.type === 'project');
  if (!project) throw new GraphWebError('not_found', 'project_not_found', `No project ${projectId}`);
  const entities = entityIndex(graph);
  const edges = incidentEdges(graph, project.id, asOf, entities, references);
  const participants = edges.filter((edge) => edge.direction === 'incoming' && PARTICIPATION.has(edge.relation)).sort(byParticipation);
  const relations = edges.filter((edge) => !participants.includes(edge));
  const touched = new Set([project.id, ...edges.map((edge) => edge.id)]);
  return {
    status: 'ok',
    source,
    asOf,
    project: {
      ...projectView(project, asOf),
      decisionPrinciples: stringArray(project.metadata?.decisionPrinciples),
      metadata: project.metadata ?? {}
    },
    participants,
    relations,
    history: historyFor(references.history, touched),
    issues: references.issues
  };
}

export async function searchGraphEntities(dataDir: string, input: GraphEntitySearchInput = {}): Promise<GraphEntitySearchResult | GraphWebUnavailable> {
  const query = parseSearchInput(input);
  const loaded = await loadForRead(dataDir);
  if ('status' in loaded) return loaded;
  return entitySearchOf(loaded.graph, loaded.source, query);
}

interface ParsedSearchInput {
  q: string;
  type: CanonicalEntityKind | null;
  asOf: string | null;
  limit: number;
  now?: Date;
}

function parseSearchInput(input: GraphEntitySearchInput): ParsedSearchInput {
  const q = typeof input.q === 'string' ? input.q.trim() : '';
  if (q.length > 200) throw new GraphWebError('invalid', 'invalid_query', 'q must be at most 200 characters');
  const type = parseEntityType(input.type);
  const asOf = input.asOf === undefined || input.asOf === '' ? null : parseAsOf(input.asOf);
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > GRAPH_WEB_SEARCH_MAX_LIMIT) {
    throw new GraphWebError('invalid', 'invalid_query', `limit must be an integer from 1 to ${GRAPH_WEB_SEARCH_MAX_LIMIT}`);
  }
  return { q, type, asOf, limit, now: input.now };
}

function entitySearchOf<S extends GraphWebAnySource>(graph: GraphFileV2, source: S, { q, type, asOf, limit, now }: ParsedSearchInput): GraphEntitySearchResult<S> {
  const needle = normalize(q);
  const scored = graph.entities.flatMap((entity) => {
    if (type && entity.type !== type) return [];
    if (asOf && !isActiveAt(entity, asOf)) return [];
    const rank = matchRank(entity, needle);
    return rank === undefined ? [] : [{ entity, rank }];
  }).sort((left, right) => left.rank - right.rank
    || left.entity.type.localeCompare(right.entity.type, 'en')
    || left.entity.name.localeCompare(right.entity.name, 'ja')
    || left.entity.id.localeCompare(right.entity.id, 'en'));
  const viewAsOf = asOf ?? (now ?? new Date()).toISOString();
  const results = scored.slice(0, limit).map(({ entity }) => entityView(entity, viewAsOf));
  return {
    status: 'ok',
    source,
    query: { q, type, asOf },
    results,
    total: scored.length,
    truncated: scored.length > results.length,
    absenceConfirmed: scored.length === 0,
    graphEmpty: graph.entities.length === 0
  };
}

export async function readGraphEntity(dataDir: string, entityId: string, options: GraphWebReadOptions = {}): Promise<GraphEntityDetail | GraphWebUnavailable> {
  const loaded = await loadForRead(dataDir);
  if ('status' in loaded) return loaded;
  const asOf = resolveAsOf(options);
  uniqueEntity(loaded.graph, entityId, 'graph.json');
  return entityDetailOf(loaded.graph, loaded.source, entityId, asOf, await loadReferences(dataDir));
}

function uniqueEntity(graph: GraphFileV2, entityId: string, where: string): CanonicalEntity {
  const matches = graph.entities.filter((candidate) => candidate.id === entityId);
  if (matches.length === 0) throw new GraphWebError('not_found', 'entity_not_found', `No entity ${entityId}`);
  if (matches.length > 1) throw new GraphWebError('unavailable', 'entity_id_ambiguous', `Entity id ${entityId} is duplicated in ${where}`);
  return matches[0]!;
}

function entityDetailOf<S extends GraphWebAnySource>(graph: GraphFileV2, source: S, entityId: string, asOf: string, references: ReferenceIndex): GraphEntityDetail<S> {
  const entity = uniqueEntity(graph, entityId, 'the Graph');
  const edges = incidentEdges(graph, entity.id, asOf, entityIndex(graph), references);
  const touched = new Set([entity.id, ...edges.map((edge) => edge.id)]);
  return {
    status: 'ok',
    source,
    asOf,
    entity: { ...entityView(entity, asOf), metadata: entity.metadata ?? {} },
    outgoing: edges.filter((edge) => edge.direction === 'outgoing'),
    incoming: edges.filter((edge) => edge.direction === 'incoming'),
    history: historyFor(references.history, touched),
    issues: references.issues
  };
}

export async function readGraphOntology(dataDir: string, options: GraphWebReadOptions = {}): Promise<GraphOntologySummary | GraphWebUnavailable> {
  const loaded = await loadForRead(dataDir);
  if ('status' in loaded) return loaded;
  return ontologyOf(loaded.graph, loaded.source, resolveAsOf(options));
}

function ontologyOf<S extends GraphWebAnySource>(graph: GraphFileV2, source: S, asOf: string): GraphOntologySummary<S> {
  const concepts = new Map<string, string>(portableOntology.domains.types.concepts.map((concept) => [concept.id, concept.meaning]));
  return {
    status: 'ok',
    source,
    asOf,
    ontology: { ...graph.ontology, currentVersion: ONTOLOGY_VERSION, upToDate: graph.ontology.version === ONTOLOGY_VERSION },
    entityTypes: ENTITY_KINDS.map((kind) => ({
      id: kind,
      meaning: concepts.get(kind) ?? '',
      count: graph.entities.filter((entity) => entity.type === kind).length
    })),
    relations: Object.values(canonicalRelationRegistry).map((definition) => {
      const edges = graph.edges.filter((edge) => edge.relation === definition.id);
      return {
        id: definition.id,
        from: definition.from,
        to: definition.to,
        meaning: definition.meaning,
        count: edges.length,
        activeCount: edges.filter((edge) => isActiveAt(edge, asOf)).length
      };
    }),
    corrections: {
      entityFields: GRAPH_CORRECTION_ENTITY_FIELDS,
      projectFields: GRAPH_CORRECTION_PROJECT_FIELDS,
      edgeFields: GRAPH_CORRECTION_EDGE_FIELDS,
      newEdgeRelations: GRAPH_CORRECTION_NEW_EDGE_RELATIONS
    }
  };
}

// ---------------------------------------------------------------------------
// Owner-private snapshots

/** The source of every read view of an owner-private snapshot. */
export const GRAPH_WEB_OWNER_PRIVATE_SOURCE: Readonly<GraphWebOwnerPrivateSource> = Object.freeze({ dataDir: null, graphFormat: 2, authority: 'owner_private' });

/** Read views of one owner-private snapshot, the same shapes as the local Graph routes. */
export interface OwnerPrivateGraph {
  readonly source: GraphWebOwnerPrivateSource;
  listProjects(options?: GraphWebReadOptions): GraphProjectList<GraphWebOwnerPrivateSource>;
  readProject(projectId: string, options?: GraphWebReadOptions): GraphProjectDetail<GraphWebOwnerPrivateSource>;
  search(input?: GraphEntitySearchInput): GraphEntitySearchResult<GraphWebOwnerPrivateSource>;
  readEntity(entityId: string, options?: GraphWebReadOptions): GraphEntityDetail<GraphWebOwnerPrivateSource>;
  /** Throws `foundation_invalid` when the bundle's foundation does not pass the catalog check. */
  listObjectives(options?: GraphWebReadOptions): GraphObjectiveList<GraphWebOwnerPrivateSource>;
}

const NO_REFERENCES: ReferenceIndex = Object.freeze({
  extracted: new Map(),
  onboarding: new Map(),
  history: [],
  corrections: new Map(),
  issues: []
}) as unknown as ReferenceIndex;

/**
 * Opens a portable bundle a host keeps for its owner, read as that owner
 * (`bindPortableGraphOwner`: `self` becomes the owner's person ID and name).
 *
 * The bundle is checked with `validatePortableGraph` first
 * (`portable_graph_invalid` otherwise).  Its foundation is checked on its own
 * (the Graph check ignores it): a foundation that does not pass fails only the
 * objectives view.  Nothing is written anywhere, and relation sources
 * (candidate files, the onboarding ledger, corrections) stayed on the owner's
 * machine, so a relation's source ID is shown unresolved.
 */
export function openOwnerPrivateGraph(bundle: unknown, owner: PortableGraphOwner): OwnerPrivateGraph {
  try {
    validatePortableGraph(bundle);
  } catch (error) {
    throw new GraphWebError('unavailable', 'portable_graph_invalid', errorMessage(error));
  }
  let foundationError: string | null = null;
  try {
    assertFoundationCatalog(bundle.graph.foundation);
  } catch (error) {
    foundationError = errorMessage(error);
  }
  let bound: PortableGraphBundle;
  try {
    bound = bindPortableGraphOwner(bundle, owner);
  } catch (error) {
    throw new GraphWebError('unavailable', 'portable_graph_owner_conflict', errorMessage(error));
  }
  const graph = bound.graph;
  const source = GRAPH_WEB_OWNER_PRIVATE_SOURCE as GraphWebOwnerPrivateSource;
  const decisions = new Map<string, DecisionRecord>(bound.decisions.map((record) => [record.id, record]));
  return Object.freeze({
    source,
    listProjects: (options: GraphWebReadOptions = {}) => projectListOf(graph, source, resolveAsOf(options)),
    readProject: (projectId: string, options: GraphWebReadOptions = {}) => projectDetailOf(graph, source, projectId, resolveAsOf(options), NO_REFERENCES),
    search: (input: GraphEntitySearchInput = {}) => entitySearchOf(graph, source, parseSearchInput(input)),
    readEntity: (entityId: string, options: GraphWebReadOptions = {}) => {
      const detail = entityDetailOf(graph, source, entityId, resolveAsOf(options), NO_REFERENCES);
      if (detail.entity.type !== 'decision') return detail;
      const record = decisions.get(entityId);
      return { ...detail, decisionRecord: record ? decisionRecordView(record) : null };
    },
    listObjectives: () => {
      if (foundationError !== null) throw new GraphWebError('unavailable', 'foundation_invalid', foundationError);
      return objectiveListOf(graph, source);
    }
  });
}

/** Read views of one in-memory Graph v2 held by the host (no data directory, no corrections). */
export interface InMemoryGraphReader<S extends GraphWebAnySource> {
  readonly source: S;
  status(options?: GraphWebReadOptions): GraphWebStatus<S>;
  listProjects(options?: GraphWebReadOptions): GraphProjectList<S>;
  readProject(projectId: string, options?: GraphWebReadOptions): GraphProjectDetail<S>;
  search(input?: GraphEntitySearchInput): GraphEntitySearchResult<S>;
  readEntity(entityId: string, options?: GraphWebReadOptions): GraphEntityDetail<S>;
  ontology(options?: GraphWebReadOptions): GraphOntologySummary<S>;
}

/**
 * The same read views as the local Graph routes over a Graph v2 the host
 * holds in memory (the organization Graph read under C1).  The Graph is
 * checked with the canonical validator first; nothing is written, and there
 * are no correction records or relation sources to resolve.
 */
export function openInMemoryGraph<S extends GraphWebAnySource>(graph: GraphFileV2, source: S): InMemoryGraphReader<S> {
  try {
    validateCanonicalGraph(graph);
  } catch (error) {
    throw new GraphWebError('unavailable', 'graph_invalid', errorMessage(error));
  }
  return Object.freeze({
    source,
    status: (options: GraphWebReadOptions = {}) => {
      const asOf = resolveAsOf(options);
      const entities = Object.fromEntries(ENTITY_KINDS.map((kind) => [kind, graph.entities.filter((entity) => entity.type === kind).length])) as Record<CanonicalEntityKind, number>;
      return {
        status: 'ok' as const,
        version: GRAPH_WEB_VERSION,
        source,
        asOf,
        ontology: { ...graph.ontology, currentVersion: ONTOLOGY_VERSION },
        counts: {
          entities: { ...entities, total: graph.entities.length },
          edges: { total: graph.edges.length, active: graph.edges.filter((edge) => isActiveAt(edge, asOf)).length },
          relationships: 0,
          corrections: 0
        },
        issues: []
      };
    },
    listProjects: (options: GraphWebReadOptions = {}) => projectListOf(graph, source, resolveAsOf(options)),
    readProject: (projectId: string, options: GraphWebReadOptions = {}) => projectDetailOf(graph, source, projectId, resolveAsOf(options), NO_REFERENCES),
    search: (input: GraphEntitySearchInput = {}) => entitySearchOf(graph, source, parseSearchInput(input)),
    readEntity: (entityId: string, options: GraphWebReadOptions = {}) => entityDetailOf(graph, source, entityId, resolveAsOf(options), NO_REFERENCES),
    ontology: (options: GraphWebReadOptions = {}) => ontologyOf(graph, source, resolveAsOf(options))
  });
}

function decisionRecordView(record: DecisionRecord): GraphDecisionRecordView {
  return {
    title: record.title,
    decision: record.decision,
    rationale: record.rationale ?? null,
    topic: record.topic ?? null,
    effectiveAt: record.effectiveAt ?? null,
    supersedes: record.supersedes ?? []
  };
}

function objectiveListOf<S extends GraphWebAnySource>(graph: GraphFileV2, source: S): GraphObjectiveList<S> {
  const catalog = graph.foundation;
  if (!catalog) return { status: 'ok', source, objectives: [], foundation: 'none', absenceConfirmed: true };
  const entities = entityIndex(graph);
  const person = (id: string): GraphObjectivePersonView => ({ id, name: entities.get(id)?.name ?? null });
  const objectives = Object.values(catalog.latest)
    .filter((pointer) => pointer.type === 'objective')
    .flatMap((pointer) => {
      const definition = findFoundationRecord(catalog, pointer)?.definition as ObjectiveDefinition | undefined;
      if (!definition) return [];
      return [{
        id: definition.id,
        revision: definition.revision,
        meaning: definition.meaning,
        desiredState: definition.desiredState,
        adoptionState: definition.adoptionState,
        evaluationPeriod: { from: definition.evaluationPeriod.from, until: definition.evaluationPeriod.until },
        criteria: definition.criteria.map((criterion) => {
          const variable = findFoundationRecord(catalog, criterion.variableRef)?.definition as VariableDefinition | undefined;
          return {
            variable: { id: criterion.variableRef.id, revision: criterion.variableRef.revision, meaning: variable?.meaning ?? null, unit: variable?.unit ?? null },
            operator: criterion.operator,
            target: criterion.target ?? null
          };
        }),
        accountable: definition.accountableId ? person(definition.accountableId) : null,
        beneficiaries: definition.beneficiaryIds.map(person),
        visibility: definition.acl.visibility
      } satisfies GraphObjectiveView];
    })
    .sort((left, right) => left.meaning.localeCompare(right.meaning, 'ja') || left.id.localeCompare(right.id, 'en'));
  return { status: 'ok', source, objectives, foundation: 'ok', absenceConfirmed: objectives.length === 0 };
}

async function loadForRead(dataDir: string): Promise<LoadedGraph | GraphWebUnavailable> {
  if (typeof dataDir !== 'string' || dataDir.trim() === '') throw new TypeError('dataDir is required');
  const present = await Promise.all(CANONICAL_FILES.map((file) => exists(join(dataDir, file))));
  if (!present.some(Boolean)) {
    return {
      status: 'not_initialized',
      source: { dataDir, graphFormat: null, authority: 'local_graph' },
      command: GRAPH_WEB_START_COMMAND,
      message: 'No canonical Brainbase data exists in this data directory yet',
      absenceConfirmed: true
    };
  }
  let os: PersonalOs;
  try {
    os = await loadPersonalOs(dataDir);
  } catch (error) {
    throw new GraphWebError('unavailable', 'graph_unavailable', error instanceof Error ? error.message : String(error));
  }
  if (os.graph.version !== 2) {
    const dir = shellArg(dataDir);
    return {
      status: 'migration_required',
      source: { dataDir, graphFormat: 1, authority: 'local_graph' },
      legacyEntityCount: os.graph.entities.length,
      command: `brainbase ontology:migrate --dir ${dir}`,
      writeCommand: `brainbase ontology:migrate --dir ${dir} --write --expected-input-digest <preview expectedInputDigest>`,
      message: 'graph.json is Graph v1. Migrate it to Graph v2 with the CLI; this host never migrates automatically',
      absenceConfirmed: false
    };
  }
  return { os, graph: os.graph, source: { dataDir, graphFormat: 2, authority: 'local_graph' } };
}

interface ReferenceIndex {
  extracted: Map<string, { file: string; kind: string | null; label: string | null }>;
  onboarding: Map<string, { runId: string; kind: string | null; reviewStatus: string | null; label: string | null }>;
  history: GraphCorrectionRecord[];
  corrections: Map<string, GraphCorrectionRecord>;
  issues: GraphReadIssue[];
}

async function loadReferences(dataDir: string): Promise<ReferenceIndex> {
  const issues: GraphReadIssue[] = [];
  const extracted = new Map<string, { file: string; kind: string | null; label: string | null }>();
  let candidateFiles: string[] = [];
  try {
    candidateFiles = (await readdir(join(dataDir, 'candidates'))).filter((file) => EXTRACTED_CANDIDATE_FILE.test(file)).sort();
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') issues.push({ file: 'candidates', reason: errorMessage(error) });
  }
  for (const name of candidateFiles) {
    const file = `candidates/${name}`;
    try {
      const parsed = JSON.parse(await readFile(join(dataDir, file), 'utf8')) as unknown;
      const candidates = isRecord(parsed) && Array.isArray(parsed.candidates) ? parsed.candidates : undefined;
      if (!candidates) {
        issues.push({ file, reason: 'candidate file has no candidates array' });
        continue;
      }
      for (const candidate of candidates) {
        if (!isRecord(candidate) || typeof candidate.id !== 'string' || extracted.has(candidate.id)) continue;
        extracted.set(candidate.id, { file, kind: stringOrNull(candidate.kind), label: payloadLabel(candidate.payload) });
      }
    } catch (error) {
      issues.push({ file, reason: errorMessage(error) });
    }
  }

  const onboarding = new Map<string, { runId: string; kind: string | null; reviewStatus: string | null; label: string | null }>();
  try {
    const parsed = JSON.parse(await readFile(join(dataDir, ONBOARDING_LEDGER_FILE), 'utf8')) as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== ONBOARDING_LEDGER_SCHEMA || !Array.isArray(parsed.runs)) {
      issues.push({ file: ONBOARDING_LEDGER_FILE, reason: 'unsupported connected onboarding ledger schema' });
    } else {
      for (const run of parsed.runs) {
        if (!isRecord(run) || typeof run.id !== 'string' || !Array.isArray(run.candidates)) continue;
        for (const candidate of run.candidates) {
          if (!isRecord(candidate) || typeof candidate.id !== 'string') continue;
          onboarding.set(candidate.id, {
            runId: run.id,
            kind: stringOrNull(candidate.kind),
            reviewStatus: stringOrNull(candidate.reviewStatus),
            label: payloadLabel(candidate.payload)
          });
        }
      }
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') issues.push({ file: ONBOARDING_LEDGER_FILE, reason: errorMessage(error) });
  }

  const history = await readGraphCorrectionHistory(dataDir);
  issues.push(...history.issues);
  return {
    extracted,
    onboarding,
    history: history.records,
    corrections: new Map(history.records.map((record) => [record.id, record])),
    issues
  };
}

function resolveReference(edge: CanonicalEdge, references: ReferenceIndex): GraphProvenanceReference {
  const sourceId = edge.provenance?.sourceId;
  if (!sourceId) return { status: 'none' };
  const correction = references.corrections.get(sourceId);
  if (correction) {
    return { status: 'resolved', kind: 'graph_correction', file: GRAPH_CORRECTIONS_FILE, correctionId: correction.id, at: correction.at, reason: correction.reason };
  }
  const run = references.onboarding.get(sourceId);
  if (run) {
    return {
      status: 'resolved',
      kind: 'onboarding_run_candidate',
      file: ONBOARDING_LEDGER_FILE,
      runId: run.runId,
      candidateId: sourceId,
      candidateKind: run.kind,
      reviewStatus: run.reviewStatus,
      label: run.label
    };
  }
  const extracted = references.extracted.get(sourceId);
  if (extracted) {
    return { status: 'resolved', kind: 'extracted_candidate', file: extracted.file, candidateId: sourceId, candidateKind: extracted.kind, label: extracted.label };
  }
  return { status: 'unresolved', sourceId };
}

function incidentEdges(
  graph: GraphFileV2,
  entityId: string,
  asOf: string,
  entities: Map<string, CanonicalEntity>,
  references: ReferenceIndex
): GraphEdgeView[] {
  return graph.edges.flatMap((edge) => {
    const views: GraphEdgeView[] = [];
    if (edge.fromId === entityId) views.push(edgeView(edge, 'outgoing', entities.get(edge.toId), asOf, references));
    if (edge.toId === entityId) views.push(edgeView(edge, 'incoming', entities.get(edge.fromId), asOf, references));
    return views;
  }).sort((left, right) => Number(right.active) - Number(left.active)
    || left.relation.localeCompare(right.relation, 'en')
    || left.counterpart.name.localeCompare(right.counterpart.name, 'ja')
    || left.id.localeCompare(right.id, 'en'));
}

function edgeView(
  edge: CanonicalEdge,
  direction: 'incoming' | 'outgoing',
  counterpart: CanonicalEntity | undefined,
  asOf: string,
  references: ReferenceIndex
): GraphEdgeView {
  if (!counterpart) throw new GraphWebError('unavailable', 'graph_unavailable', `Relation ${edge.id} points to a missing entity`);
  return {
    id: edge.id,
    relation: edge.relation,
    meaning: getCanonicalRelation(edge.relation).meaning,
    direction,
    fromId: edge.fromId,
    toId: edge.toId,
    role: edge.role ?? null,
    context: edge.context ?? null,
    validFrom: edge.validFrom ?? null,
    validTo: edge.validTo ?? null,
    active: isActiveAt(edge, asOf),
    provenance: {
      sourceKind: edge.provenance?.sourceKind ?? null,
      sourceId: edge.provenance?.sourceId ?? null,
      evidenceHash: edge.provenance?.evidenceHash ?? null,
      reference: resolveReference(edge, references)
    },
    counterpart: {
      id: counterpart.id,
      type: counterpart.type,
      name: counterpart.name,
      active: isActiveAt(counterpart, asOf),
      digest: graphRecordDigest(counterpart)
    },
    digest: graphRecordDigest(edge)
  };
}

function entityView(entity: CanonicalEntity, asOf: string): GraphEntityView {
  return {
    id: entity.id,
    type: entity.type,
    name: entity.name,
    aliases: entity.aliases ?? [],
    summary: entity.summary ?? null,
    tags: entity.tags ?? [],
    validFrom: entity.validFrom ?? null,
    validTo: entity.validTo ?? null,
    active: isActiveAt(entity, asOf),
    digest: graphRecordDigest(entity),
    ...(entity.type === 'project' ? { goal: metadataString(entity, 'goal'), status: metadataString(entity, 'status') } : {})
  };
}

function projectView(project: CanonicalEntity, asOf: string): GraphEntityView & { type: 'project'; goal: string | null; status: string | null } {
  return { ...entityView(project, asOf), type: 'project', goal: metadataString(project, 'goal'), status: metadataString(project, 'status') };
}

function historyFor(records: GraphCorrectionRecord[], ids: Set<string>): GraphCorrectionRecord[] {
  return records.filter((record) => ids.has(record.target.id)).reverse();
}

function matchRank(entity: CanonicalEntity, needle: string): number | undefined {
  if (!needle) return 3;
  if (normalize(entity.id) === needle) return 0;
  let best: number | undefined;
  for (const value of [entity.name, ...(entity.aliases ?? [])]) {
    const candidate = normalize(value);
    const rank = candidate === needle ? 0 : candidate.startsWith(needle) ? 1 : candidate.includes(needle) ? 2 : undefined;
    if (rank !== undefined && (best === undefined || rank < best)) best = rank;
  }
  return best;
}

function parseEntityType(value: string | undefined): CanonicalEntityKind | null {
  if (value === undefined || value === '') return null;
  if (!(ENTITY_KINDS as readonly string[]).includes(value)) {
    throw new GraphWebError('invalid', 'invalid_query', `type must be one of ${ENTITY_KINDS.join(', ')}`);
  }
  return value as CanonicalEntityKind;
}

function resolveAsOf(options: GraphWebReadOptions): string {
  if (options.asOf !== undefined && options.asOf !== '') return parseAsOf(options.asOf);
  return (options.now ?? new Date()).toISOString();
}

function parseAsOf(value: string): string {
  try {
    isActiveAt({}, value);
  } catch {
    throw new GraphWebError('invalid', 'invalid_query', 'as_of must be an RFC 3339 date-time such as 2026-09-30T00:00:00Z');
  }
  return value;
}

function entityIndex(graph: GraphFileV2): Map<string, CanonicalEntity> {
  return new Map(graph.entities.map((entity) => [entity.id, entity]));
}

function isEntityActive(entity: CanonicalEntity | undefined, asOf: string): boolean {
  return entity !== undefined && isActiveAt(entity, asOf);
}

function byActiveThenName(left: GraphEntityView, right: GraphEntityView): number {
  return Number(right.active) - Number(left.active) || left.name.localeCompare(right.name, 'ja') || left.id.localeCompare(right.id, 'en');
}

function byParticipation(left: GraphEdgeView, right: GraphEdgeView): number {
  const order = (edge: GraphEdgeView) => edge.relation === 'accountable_for' ? 0 : 1;
  return Number(right.active) - Number(left.active)
    || order(left) - order(right)
    || left.counterpart.name.localeCompare(right.counterpart.name, 'ja')
    || left.id.localeCompare(right.id, 'en');
}

function metadataString(entity: CanonicalEntity, key: string): string | null {
  const value = entity.metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function payloadLabel(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  for (const key of ['name', 'person', 'title', 'text']) {
    if (typeof payload[key] === 'string' && payload[key]) return payload[key] as string;
  }
  return null;
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value) ? value : JSON.stringify(value);
}
