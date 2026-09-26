import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalEdgeId, isActiveAt, validateCanonicalGraph } from './canonical-graph.js';
import { stableHash } from './import-extract.js';
import { canonicalPortableJson } from './portable-graph.js';
import { getCanonicalRelation } from './relation-registry.js';
import { loadPersonalOs, mutatePersonalOsWithSidecar, readPersonalOsSidecar } from './ssot.js';
import type { CanonicalEdge, CanonicalEntity, CoreRelation, GraphFileV2, RelationshipRecord } from './types.js';

/**
 * Owner corrections for the canonical local Graph v2.
 *
 * Graph entities and edges are stored without revisions, so every correction
 * carries the digest of the record it was based on, a one-sentence reason and
 * leaves an append-only history line. The history line, the Graph change and
 * the relationships.json projection are committed in one SSOT transaction.
 */

export const GRAPH_CORRECTION_SCHEMA = 'brainbase-graph-correction.v1' as const;
/** Relative to the data directory. Committed as a sidecar of the canonical SSOT transaction. */
export const GRAPH_CORRECTIONS_FILE = 'evidence/graph-corrections.jsonl';
export const GRAPH_CORRECTION_ENTITY_FIELDS = ['name', 'aliases', 'summary', 'validFrom', 'validTo'] as const;
export const GRAPH_CORRECTION_PROJECT_FIELDS = ['goal', 'status'] as const;
export const GRAPH_CORRECTION_EDGE_FIELDS = ['role', 'context', 'validTo'] as const;
export const GRAPH_CORRECTION_NEW_EDGE_RELATIONS = ['participates_in', 'accountable_for', 'member_of'] as const;
/** MCP tools that read the same graph.json on every call and therefore see a saved correction next time. */
export const GRAPH_CORRECTION_APPLIES_TO = ['search', 'get_context', 'resolve_entity'] as const;

const MAX_REASON_LENGTH = 500;
const MAX_NAME_LENGTH = 200;
const MAX_TEXT_LENGTH = 2000;
const MAX_ALIASES = 50;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PROJECTED_RELATIONS: ReadonlySet<CoreRelation> = new Set(['participates_in', 'accountable_for']);

export type GraphCorrectionKind = 'update_entity' | 'update_edge' | 'create_edge';
export type GraphNewEdgeRelation = typeof GRAPH_CORRECTION_NEW_EDGE_RELATIONS[number];

export interface GraphEntityCorrectionChanges {
  name?: string;
  aliases?: string[];
  summary?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  /** Projects only. Stored as `metadata.goal`. */
  goal?: string | null;
  /** Projects only. Stored as `metadata.status`. */
  status?: string | null;
}

export interface GraphEdgeCorrectionChanges {
  role?: string | null;
  context?: string | null;
  /** Ending a relation is expressed with an end date; relations are never deleted. */
  validTo?: string | null;
}

export interface GraphEdgeCreation {
  fromId: string;
  relation: GraphNewEdgeRelation;
  toId: string;
  role?: string;
  context?: string;
  validFrom?: string;
}

export type GraphCorrectionInput =
  | { kind: 'update_entity'; entityId: string; expectedDigest: string; reason: string; changes: GraphEntityCorrectionChanges }
  | { kind: 'update_edge'; edgeId: string; expectedDigest: string; reason: string; changes: GraphEdgeCorrectionChanges }
  | { kind: 'create_edge'; reason: string; edge: GraphEdgeCreation };

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface GraphProjectionChange {
  edgeId: string;
  relationshipId: string | null;
  action: 'created' | 'updated' | 'removed' | 'shared_unchanged';
  beforeDigest: string | null;
  afterDigest: string | null;
  /** The projection record as it was before this correction, so a removal stays recoverable. */
  before: RelationshipRecord | null;
}

export interface GraphCorrectionRecord {
  schema: typeof GRAPH_CORRECTION_SCHEMA;
  id: string;
  at: string;
  kind: GraphCorrectionKind;
  target: { recordType: 'entity' | 'edge'; id: string };
  reason: string;
  changedFields: string[];
  changes: Record<string, { before: JsonValue; after: JsonValue }>;
  beforeDigest: string | null;
  afterDigest: string;
  projections: GraphProjectionChange[];
}

export interface GraphCorrectionResult {
  status: 'saved';
  correction: GraphCorrectionRecord;
  recordType: 'entity' | 'edge';
  /** The record as read back from graph.json after the commit. */
  record: CanonicalEntity | CanonicalEdge;
  digest: string;
  readback: { verified: true; digest: string; historyRecorded: true };
  appliesTo: readonly string[];
}

export type GraphCorrectionErrorKind = 'invalid' | 'not_found' | 'conflict' | 'migration_required' | 'readback_mismatch';

export class GraphCorrectionError extends Error {
  readonly name = 'GraphCorrectionError';
  constructor(
    readonly kind: GraphCorrectionErrorKind,
    readonly code: string,
    message: string,
    readonly current?: { recordType: 'entity' | 'edge'; record: CanonicalEntity | CanonicalEdge; digest: string }
  ) {
    super(message);
  }
}

/** SHA-256 over canonical JSON (recursively sorted keys) of one stored record. */
export function graphRecordDigest(record: CanonicalEntity | CanonicalEdge | RelationshipRecord): string {
  return `sha256:${createHash('sha256').update(canonicalPortableJson(record), 'utf8').digest('hex')}`;
}

/**
 * Validates an untrusted correction request. Only the fields listed in the
 * correction contract are accepted; ids, types, relation types, provenance and
 * deletions are rejected with a specific code.
 */
export function parseGraphCorrectionInput(value: unknown): GraphCorrectionInput {
  if (!isRecord(value)) invalid('correction_invalid', 'Correction must be a JSON object');
  const kind = value.kind;
  if (typeof kind === 'string' && /(^|_)(delete|remove)(_|$)/u.test(kind)) {
    invalid('correction_delete_not_allowed', 'Graph records are never deleted; set validTo to end an entity or relation');
  }
  if (kind === 'update_entity') {
    assertOnlyKeys(value, ['kind', 'entityId', 'expectedDigest', 'reason', 'changes'], '');
    return {
      kind,
      entityId: requireId(value.entityId, 'entityId'),
      expectedDigest: requireDigest(value.expectedDigest),
      reason: requireReason(value.reason),
      changes: parseEntityChanges(value.changes)
    };
  }
  if (kind === 'update_edge') {
    assertOnlyKeys(value, ['kind', 'edgeId', 'expectedDigest', 'reason', 'changes'], '');
    return {
      kind,
      edgeId: requireId(value.edgeId, 'edgeId'),
      expectedDigest: requireDigest(value.expectedDigest),
      reason: requireReason(value.reason),
      changes: parseEdgeChanges(value.changes)
    };
  }
  if (kind === 'create_edge') {
    assertOnlyKeys(value, ['kind', 'reason', 'edge'], '');
    return { kind, reason: requireReason(value.reason), edge: parseEdgeCreation(value.edge) };
  }
  invalid('correction_kind_unsupported', 'kind must be update_entity, update_edge or create_edge');
}

/**
 * Applies one owner correction to the canonical Graph v2 in `dataDir`.
 *
 * The Graph write, the relationships.json projection and the history line in
 * `evidence/graph-corrections.jsonl` are committed together through
 * `mutatePersonalOsWithSidecar`, so a crash never leaves a Graph change without
 * its history line (or the reverse). After the commit the record is read back
 * and its digest must equal the digest computed before saving.
 */
export async function applyGraphCorrection(
  dataDir: string,
  input: unknown,
  options: { now?: Date } = {}
): Promise<GraphCorrectionResult> {
  if (typeof dataDir !== 'string' || dataDir.trim() === '') throw new TypeError('dataDir is required');
  const correction = parseGraphCorrectionInput(input);
  const at = (options.now ?? new Date()).toISOString();
  const present = await Promise.all(['graph.json', 'relationships.json', 'personal-kg.jsonl', 'decisions.jsonl']
    .map((file) => fileExists(join(dataDir, file))));
  if (!present.some(Boolean)) {
    // Checked before taking the SSOT lock so a correction never creates the data directory.
    throw new GraphCorrectionError('not_found', 'graph_not_initialized', 'No local Graph exists yet; start with brainbase onboard:start');
  }

  const outcome = await mutatePersonalOsWithSidecar(dataDir, GRAPH_CORRECTIONS_FILE, (current, existingHistory) => {
    if (current.graph.version !== 2) {
      throw new GraphCorrectionError(
        'migration_required',
        'migration_required',
        'Graph v1 cannot be corrected; migrate graph.json to Graph v2 with brainbase ontology:migrate first'
      );
    }
    const planned = planCorrection(current.graph, current.relationships.relationships, correction, at);
    const history = appendJsonl(existingHistory, planned.record);
    return {
      next: { ...current, graph: planned.graph, relationships: { version: 1, relationships: planned.relationships } },
      sidecarContent: history,
      result: planned
    };
  });

  const reloaded = await loadPersonalOs(dataDir);
  if (reloaded.graph.version !== 2) {
    throw new GraphCorrectionError('readback_mismatch', 'readback_mismatch', 'graph.json is no longer Graph v2 after the correction');
  }
  const stored = outcome.recordType === 'entity'
    ? reloaded.graph.entities.find((entity) => entity.id === outcome.record.target.id)
    : reloaded.graph.edges.find((edge) => edge.id === outcome.record.target.id);
  if (!stored || graphRecordDigest(stored) !== outcome.record.afterDigest) {
    throw new GraphCorrectionError('readback_mismatch', 'readback_mismatch', 'The saved record does not match the corrected record');
  }
  const historyText = await readPersonalOsSidecar(dataDir, GRAPH_CORRECTIONS_FILE);
  const recorded = (historyText ?? '').split('\n').some((line) => {
    if (!line.trim()) return false;
    try {
      return (JSON.parse(line) as { id?: unknown }).id === outcome.record.id;
    } catch {
      return false;
    }
  });
  if (!recorded) {
    throw new GraphCorrectionError('readback_mismatch', 'readback_mismatch', 'The correction history line was not found after saving');
  }
  const digest = graphRecordDigest(stored);
  return {
    status: 'saved',
    correction: outcome.record,
    recordType: outcome.recordType,
    record: stored,
    digest,
    readback: { verified: true, digest, historyRecorded: true },
    appliesTo: GRAPH_CORRECTION_APPLIES_TO
  };
}

export interface GraphCorrectionHistoryIssue {
  file: typeof GRAPH_CORRECTIONS_FILE;
  line?: number;
  reason: string;
}

/**
 * Reads the correction history in append order. A missing file means no
 * correction has been saved; an unreadable line is reported as an issue and
 * never silently dropped.
 */
export async function readGraphCorrectionHistory(
  dataDir: string
): Promise<{ records: GraphCorrectionRecord[]; issues: GraphCorrectionHistoryIssue[] }> {
  let text: string;
  try {
    text = await readFile(join(dataDir, GRAPH_CORRECTIONS_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { records: [], issues: [] };
    return { records: [], issues: [{ file: GRAPH_CORRECTIONS_FILE, reason: error instanceof Error ? error.message : String(error) }] };
  }
  const records: GraphCorrectionRecord[] = [];
  const issues: GraphCorrectionHistoryIssue[] = [];
  text.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const value = JSON.parse(line) as unknown;
      if (!isGraphCorrectionRecord(value)) throw new Error('not a graph correction record');
      records.push(value);
    } catch (error) {
      issues.push({ file: GRAPH_CORRECTIONS_FILE, line: index + 1, reason: error instanceof Error ? error.message : String(error) });
    }
  });
  return { records, issues };
}

function isGraphCorrectionRecord(value: unknown): value is GraphCorrectionRecord {
  if (!isRecord(value) || value.schema !== GRAPH_CORRECTION_SCHEMA) return false;
  const target = value.target;
  return typeof value.id === 'string'
    && typeof value.at === 'string'
    && (value.kind === 'update_entity' || value.kind === 'update_edge' || value.kind === 'create_edge')
    && isRecord(target) && (target.recordType === 'entity' || target.recordType === 'edge') && typeof target.id === 'string'
    && typeof value.reason === 'string'
    && Array.isArray(value.changedFields) && value.changedFields.every((field) => typeof field === 'string')
    && isRecord(value.changes)
    && (value.beforeDigest === null || typeof value.beforeDigest === 'string')
    && typeof value.afterDigest === 'string'
    && Array.isArray(value.projections);
}

interface PlannedCorrection {
  graph: GraphFileV2;
  relationships: RelationshipRecord[];
  record: GraphCorrectionRecord;
  recordType: 'entity' | 'edge';
}

function planCorrection(
  graph: GraphFileV2,
  relationships: RelationshipRecord[],
  correction: GraphCorrectionInput,
  at: string
): PlannedCorrection {
  if (correction.kind === 'update_entity') return planEntityUpdate(graph, relationships, correction, at);
  if (correction.kind === 'update_edge') return planEdgeUpdate(graph, relationships, correction, at);
  return planEdgeCreation(graph, relationships, correction, at);
}

function planEntityUpdate(
  graph: GraphFileV2,
  relationships: RelationshipRecord[],
  correction: Extract<GraphCorrectionInput, { kind: 'update_entity' }>,
  at: string
): PlannedCorrection {
  const matches = graph.entities.filter((entity) => entity.id === correction.entityId);
  if (matches.length === 0) notFound('entity_not_found', `No entity ${correction.entityId}`);
  if (matches.length > 1) invalid('entity_id_ambiguous', `Entity id ${correction.entityId} is duplicated in graph.json; repair it with the CLI first`);
  const before = matches[0]!;
  assertExpectedDigest('entity', before, correction.expectedDigest);
  const changes = correction.changes;
  if ((changes.goal !== undefined || changes.status !== undefined) && before.type !== 'project') {
    invalid('correction_field_not_allowed', 'goal and status can be corrected only on a project');
  }

  const after: CanonicalEntity = structuredClone(before);
  const diff: GraphCorrectionRecord['changes'] = {};
  if (changes.name !== undefined) setField(after, 'name', changes.name, before, diff);
  if (changes.aliases !== undefined) setField(after, 'aliases', changes.aliases.length > 0 ? changes.aliases : null, before, diff);
  if (changes.summary !== undefined) setField(after, 'summary', changes.summary, before, diff);
  if (changes.validFrom !== undefined) setField(after, 'validFrom', changes.validFrom, before, diff);
  if (changes.validTo !== undefined) setField(after, 'validTo', changes.validTo, before, diff);
  if (changes.goal !== undefined || changes.status !== undefined) {
    const metadata: Record<string, unknown> = { ...(before.metadata ?? {}) };
    for (const key of ['goal', 'status'] as const) {
      const next = changes[key];
      if (next === undefined) continue;
      const previous = typeof metadata[key] === 'string' ? metadata[key] as string : null;
      if (previous === next) continue;
      if (next === null) delete metadata[key];
      else metadata[key] = next;
      diff[`metadata.${key}`] = { before: previous, after: next };
    }
    if (Object.keys(metadata).length > 0) after.metadata = metadata;
    else delete after.metadata;
  }
  const entities = graph.entities.map((entity) => entity.id === before.id ? after : entity);
  const nextGraph = validatedGraph({ ...graph, entities });

  const incident = nextGraph.edges.filter((edge) => PROJECTED_RELATIONS.has(edge.relation)
    && (edge.fromId === before.id || edge.toId === before.id)).map((edge) => edge.id);
  const projected = syncProjections(nextGraph, relationships, incident, at, { createFor: undefined, previous: before });
  return finalize('update_entity', 'entity', before, after, diff, correction.reason, at, nextGraph, projected);
}

function planEdgeUpdate(
  graph: GraphFileV2,
  relationships: RelationshipRecord[],
  correction: Extract<GraphCorrectionInput, { kind: 'update_edge' }>,
  at: string
): PlannedCorrection {
  const before = graph.edges.find((edge) => edge.id === correction.edgeId);
  if (!before) notFound('edge_not_found', `No relation ${correction.edgeId}`);
  assertExpectedDigest('edge', before, correction.expectedDigest);
  const after: CanonicalEdge = structuredClone(before);
  const diff: GraphCorrectionRecord['changes'] = {};
  const changes = correction.changes;
  if (changes.role !== undefined) setField(after, 'role', changes.role, before, diff);
  if (changes.context !== undefined) setField(after, 'context', changes.context, before, diff);
  if (changes.validTo !== undefined) setField(after, 'validTo', changes.validTo, before, diff);
  const nextGraph = validatedGraph({ ...graph, edges: graph.edges.map((edge) => edge.id === before.id ? after : edge) });
  const projected = PROJECTED_RELATIONS.has(after.relation)
    ? syncProjections(nextGraph, relationships, [after.id], at, { createFor: after.id })
    : { relationships, changes: [] };
  return finalize('update_edge', 'edge', before, after, diff, correction.reason, at, nextGraph, projected);
}

function planEdgeCreation(
  graph: GraphFileV2,
  relationships: RelationshipRecord[],
  correction: Extract<GraphCorrectionInput, { kind: 'create_edge' }>,
  at: string
): PlannedCorrection {
  const input = correction.edge;
  const definition = getCanonicalRelation(input.relation);
  const from = graph.entities.find((entity) => entity.id === input.fromId);
  const to = graph.entities.find((entity) => entity.id === input.toId);
  if (!from) notFound('entity_not_found', `No entity ${input.fromId}`);
  if (!to) notFound('entity_not_found', `No entity ${input.toId}`);
  if (from.type !== definition.from || to.type !== definition.to) {
    invalid('correction_endpoint_type_invalid', `${input.relation} requires ${definition.from} -> ${definition.to}`);
  }
  const id = canonicalEdgeId(input);
  const existing = graph.edges.find((edge) => edge.id === id);
  if (existing) {
    throw new GraphCorrectionError(
      'conflict',
      'edge_already_exists',
      'This relation already exists; correct it (for example clear validTo) instead of adding it again',
      { recordType: 'edge', record: existing, digest: graphRecordDigest(existing) }
    );
  }
  const correctionId = graphCorrectionId(at, 'create_edge', id, null, correction.reason);
  const edge: CanonicalEdge = compact({
    id,
    fromId: input.fromId,
    relation: input.relation,
    toId: input.toId,
    role: input.role,
    context: input.context,
    validFrom: input.validFrom,
    provenance: { sourceKind: 'user_approved', sourceId: correctionId }
  });
  const nextGraph = validatedGraph({ ...graph, edges: [...graph.edges, edge] });
  const diff: GraphCorrectionRecord['changes'] = {};
  for (const [key, value] of Object.entries(edge)) {
    if (key === 'id') continue;
    diff[key] = { before: null, after: value as JsonValue };
  }
  const projected = PROJECTED_RELATIONS.has(edge.relation)
    ? syncProjections(nextGraph, relationships, [edge.id], at, { createFor: edge.id })
    : { relationships, changes: [] };
  return finalize('create_edge', 'edge', null, edge, diff, correction.reason, at, nextGraph, projected, correctionId);
}

function finalize(
  kind: GraphCorrectionKind,
  recordType: 'entity' | 'edge',
  before: CanonicalEntity | CanonicalEdge | null,
  after: CanonicalEntity | CanonicalEdge,
  diff: GraphCorrectionRecord['changes'],
  reason: string,
  at: string,
  graph: GraphFileV2,
  projected: { relationships: RelationshipRecord[]; changes: GraphProjectionChange[] },
  presetId?: string
): PlannedCorrection {
  const beforeDigest = before ? graphRecordDigest(before) : null;
  const afterDigest = graphRecordDigest(after);
  if (Object.keys(diff).length === 0 || beforeDigest === afterDigest) {
    invalid('correction_no_change', 'The correction does not change the record');
  }
  const record: GraphCorrectionRecord = {
    schema: GRAPH_CORRECTION_SCHEMA,
    id: presetId ?? graphCorrectionId(at, kind, after.id, beforeDigest, reason),
    at,
    kind,
    target: { recordType, id: after.id },
    reason,
    changedFields: Object.keys(diff),
    changes: diff,
    beforeDigest,
    afterDigest,
    projections: projected.changes
  };
  return { graph, relationships: projected.relationships, record, recordType };
}

/**
 * Keeps relationships.json aligned with person -> project relations, using the
 * record shape written by project registration: the person's name, the role,
 * `"<project name>: <context>"`, and the `project`/`relationship` tags.
 *
 * A projection record is linked to an edge when its id is the edge's
 * provenance sourceId (project registration, seed), the id import writes for
 * the same person and context, or `relationship-<edge id>` (records created
 * here). Records linked to more than one edge are left untouched. A record is
 * removed when its relation or an endpoint is no longer active; the removed
 * record is kept in the history line. Only the relation targeted by the
 * correction may gain a new projection record.
 */
function syncProjections(
  graph: GraphFileV2,
  relationships: RelationshipRecord[],
  edgeIds: string[],
  at: string,
  options: { createFor: string | undefined; previous?: CanonicalEntity }
): { relationships: RelationshipRecord[]; changes: GraphProjectionChange[] } {
  let next = [...relationships];
  const changes: GraphProjectionChange[] = [];
  const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const projectedEdges = graph.edges.filter((edge) => PROJECTED_RELATIONS.has(edge.relation));
  for (const edgeId of edgeIds) {
    const edge = projectedEdges.find((candidate) => candidate.id === edgeId);
    if (!edge) continue;
    const person = entities.get(edge.fromId);
    const project = entities.get(edge.toId);
    if (!person || !project) continue;
    const personVersions = options.previous?.id === person.id ? [person, options.previous] : [person];
    const ids = linkedProjectionIds(edge, personVersions);
    const linked = next.filter((record) => ids.has(record.id));
    const shared = linked.filter((record) => projectedEdges.some((other) => other.id !== edge.id
      && linkedProjectionIds(other, [entities.get(other.fromId)]).has(record.id)));
    for (const record of shared) {
      changes.push({ edgeId, relationshipId: record.id, action: 'shared_unchanged', beforeDigest: graphRecordDigest(record), afterDigest: graphRecordDigest(record), before: null });
    }
    const exclusive = linked.filter((record) => !shared.includes(record));
    const active = isActiveAt(edge, at) && isActiveAt(person, at) && isActiveAt(project, at);
    if (!active) {
      for (const record of exclusive) {
        next = next.filter((candidate) => candidate.id !== record.id);
        changes.push({ edgeId, relationshipId: record.id, action: 'removed', beforeDigest: graphRecordDigest(record), afterDigest: null, before: record });
      }
      continue;
    }
    const targets = exclusive.length > 0 || shared.length > 0 || options.createFor !== edge.id
      ? exclusive
      : [undefined];
    for (const existing of targets) {
      const rendered = renderProjection(edge, person, project, existing, at);
      if (existing && sameProjection(existing, rendered)) continue;
      if (existing) next = next.map((candidate) => candidate.id === existing.id ? rendered : candidate);
      else next.push(rendered);
      changes.push({
        edgeId,
        relationshipId: rendered.id,
        action: existing ? 'updated' : 'created',
        beforeDigest: existing ? graphRecordDigest(existing) : null,
        afterDigest: graphRecordDigest(rendered),
        before: existing ?? null
      });
    }
  }
  return { relationships: next, changes };
}

function linkedProjectionIds(edge: CanonicalEdge, persons: ReadonlyArray<CanonicalEntity | undefined>): Set<string> {
  const ids = new Set<string>([projectionIdFor(edge)]);
  if (edge.provenance?.sourceId) ids.add(edge.provenance.sourceId);
  for (const person of persons) {
    // Import (`onboard:apply`, connected onboarding) writes this id for a
    // relationship candidate with the same person name and context.
    if (person && edge.context) ids.add(`relationship-${stableHash(`${person.name}|${edge.context}`)}`);
  }
  return ids;
}

function projectionIdFor(edge: CanonicalEdge): string {
  return `relationship-${edge.id}`;
}

function renderProjection(
  edge: CanonicalEdge,
  person: CanonicalEntity,
  project: CanonicalEntity,
  existing: RelationshipRecord | undefined,
  at: string
): RelationshipRecord {
  return compact({
    id: existing?.id ?? projectionIdFor(edge),
    person: person.name,
    role: edge.role,
    context: edge.context ? `${project.name}: ${edge.context}` : project.name,
    tags: existing?.tags ?? ['project', 'relationship'],
    updatedAt: at
  });
}

function sameProjection(left: RelationshipRecord, right: RelationshipRecord): boolean {
  const { updatedAt: _left, ...leftRest } = left;
  const { updatedAt: _right, ...rightRest } = right;
  return canonicalPortableJson(leftRest) === canonicalPortableJson(rightRest);
}

function validatedGraph(graph: GraphFileV2): GraphFileV2 {
  try {
    validateCanonicalGraph(graph);
  } catch (error) {
    invalid('correction_invalid', error instanceof Error ? error.message : String(error));
  }
  return graph;
}

function assertExpectedDigest(recordType: 'entity' | 'edge', record: CanonicalEntity | CanonicalEdge, expected: string): void {
  const digest = graphRecordDigest(record);
  if (digest !== expected) {
    throw new GraphCorrectionError(
      'conflict',
      'digest_conflict',
      'The record changed after it was read; review the current record and correct it again',
      { recordType, record, digest }
    );
  }
}

function setField<T extends object>(
  target: T,
  key: string,
  value: JsonValue | undefined,
  before: T,
  diff: GraphCorrectionRecord['changes']
): void {
  const previous = ((before as Record<string, unknown>)[key] ?? null) as JsonValue;
  const next = value ?? null;
  if (canonicalPortableJson(previous) === canonicalPortableJson(next)) return;
  if (next === null) delete (target as Record<string, unknown>)[key];
  else (target as Record<string, unknown>)[key] = next;
  diff[key] = { before: previous, after: next };
}

function graphCorrectionId(at: string, kind: GraphCorrectionKind, targetId: string, beforeDigest: string | null, reason: string): string {
  return `graph-correction-${createHash('sha256').update(JSON.stringify([at, kind, targetId, beforeDigest, reason]), 'utf8').digest('hex').slice(0, 24)}`;
}

function appendJsonl(existing: string | undefined, record: GraphCorrectionRecord): string {
  const prefix = existing === undefined || existing === '' ? '' : existing.endsWith('\n') ? existing : `${existing}\n`;
  return `${prefix}${JSON.stringify(record)}\n`;
}

function parseEntityChanges(value: unknown): GraphEntityCorrectionChanges {
  if (!isRecord(value) || Object.keys(value).length === 0) invalid('correction_changes_required', 'changes must be a non-empty object');
  assertOnlyKeys(value, [...GRAPH_CORRECTION_ENTITY_FIELDS, ...GRAPH_CORRECTION_PROJECT_FIELDS], 'changes.');
  const changes: GraphEntityCorrectionChanges = {};
  if (value.name !== undefined) {
    const name = optionalText(value.name, 'changes.name', MAX_NAME_LENGTH);
    if (name === null) invalid('correction_invalid', 'changes.name must be a non-empty string');
    changes.name = name;
  }
  if (value.aliases !== undefined) changes.aliases = parseAliases(value.aliases);
  if (value.summary !== undefined) changes.summary = optionalText(value.summary, 'changes.summary', MAX_TEXT_LENGTH);
  if (value.validFrom !== undefined) changes.validFrom = optionalDateTime(value.validFrom, 'changes.validFrom');
  if (value.validTo !== undefined) changes.validTo = optionalDateTime(value.validTo, 'changes.validTo');
  if (value.goal !== undefined) changes.goal = optionalText(value.goal, 'changes.goal', MAX_TEXT_LENGTH);
  if (value.status !== undefined) changes.status = optionalText(value.status, 'changes.status', MAX_NAME_LENGTH);
  return changes;
}

function parseEdgeChanges(value: unknown): GraphEdgeCorrectionChanges {
  if (!isRecord(value) || Object.keys(value).length === 0) invalid('correction_changes_required', 'changes must be a non-empty object');
  assertOnlyKeys(value, GRAPH_CORRECTION_EDGE_FIELDS, 'changes.');
  const changes: GraphEdgeCorrectionChanges = {};
  if (value.role !== undefined) changes.role = optionalText(value.role, 'changes.role', MAX_NAME_LENGTH);
  if (value.context !== undefined) changes.context = optionalText(value.context, 'changes.context', MAX_TEXT_LENGTH);
  if (value.validTo !== undefined) changes.validTo = optionalDateTime(value.validTo, 'changes.validTo');
  return changes;
}

function parseEdgeCreation(value: unknown): GraphEdgeCreation {
  if (!isRecord(value)) invalid('correction_invalid', 'edge must be an object');
  assertOnlyKeys(value, ['fromId', 'relation', 'toId', 'role', 'context', 'validFrom'], 'edge.');
  const relation = value.relation;
  if (typeof relation !== 'string' || !(GRAPH_CORRECTION_NEW_EDGE_RELATIONS as readonly string[]).includes(relation)) {
    invalid('correction_relation_not_allowed', `edge.relation must be one of ${GRAPH_CORRECTION_NEW_EDGE_RELATIONS.join(', ')}`);
  }
  const role = value.role === undefined ? null : optionalText(value.role, 'edge.role', MAX_NAME_LENGTH);
  const context = value.context === undefined ? null : optionalText(value.context, 'edge.context', MAX_TEXT_LENGTH);
  const validFrom = value.validFrom === undefined ? null : optionalDateTime(value.validFrom, 'edge.validFrom');
  return compact({
    fromId: requireId(value.fromId, 'edge.fromId'),
    relation: relation as GraphNewEdgeRelation,
    toId: requireId(value.toId, 'edge.toId'),
    role: role ?? undefined,
    context: context ?? undefined,
    validFrom: validFrom ?? undefined
  });
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], prefix: string): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    if (key === 'id') invalid('correction_id_change_not_allowed', `${prefix}id cannot be changed`);
    if (key === 'type') invalid('correction_type_change_not_allowed', `${prefix}type cannot be changed`);
    if (key === 'relation') {
      invalid('correction_relation_change_not_allowed', 'A relation type cannot be changed; end this relation with validTo and add a new one');
    }
    if (key === 'fromId' || key === 'toId') {
      invalid('correction_endpoint_change_not_allowed', 'A relation endpoint cannot be changed; end this relation with validTo and add a new one');
    }
    invalid('correction_field_not_allowed', `${prefix}${key} cannot be corrected`);
  }
}

function parseAliases(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ALIASES) {
    invalid('correction_invalid', `changes.aliases must be an array of at most ${MAX_ALIASES} strings`);
  }
  const aliases: string[] = [];
  for (const [index, alias] of value.entries()) {
    const text = optionalText(alias, `changes.aliases[${index}]`, MAX_NAME_LENGTH);
    if (text === null) invalid('correction_invalid', `changes.aliases[${index}] must be a non-empty string`);
    if (!aliases.includes(text)) aliases.push(text);
  }
  return aliases;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalid('correction_invalid', `${field} must be a string or null`);
  const text = value.trim();
  if (text.length > max) invalid('correction_invalid', `${field} must be at most ${max} characters`);
  return text === '' ? null : text;
}

function optionalDateTime(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalid('correction_invalid', `${field} must be an RFC 3339 date-time or null`);
  try {
    isActiveAt({}, value);
  } catch {
    invalid('correction_invalid', `${field} must be an RFC 3339 date-time such as 2026-09-30T00:00:00Z`);
  }
  return value;
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 500) invalid('correction_invalid', `${field} must be a non-empty id`);
  return value;
}

function requireDigest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    invalid('correction_digest_required', 'expectedDigest must be the sha256 digest of the record that was read');
  }
  return value;
}

function requireReason(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') invalid('correction_reason_required', 'A one-sentence reason is required');
  const reason = value.trim();
  if (/[\r\n]/u.test(reason) || reason.length > MAX_REASON_LENGTH) {
    invalid('correction_reason_invalid', `The reason must be one sentence on one line and at most ${MAX_REASON_LENGTH} characters`);
  }
  return reason;
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(code: string, message: string): never {
  throw new GraphCorrectionError('invalid', code, message);
}

function notFound(code: string, message: string): never {
  throw new GraphCorrectionError('not_found', code, message);
}
