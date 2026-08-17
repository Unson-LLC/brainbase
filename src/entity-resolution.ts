import { createHash } from 'node:crypto';
import { isActiveAt, validateCanonicalGraph } from './canonical-graph.js';
import { getCanonicalRelation } from './relation-registry.js';
import type { CanonicalEntity, CanonicalEntityKind, GraphFileV2 } from './types.js';

export type SourceStatus = 'complete' | 'partial' | 'unavailable' | 'invalid';
export type MentionStatus = 'resolved' | 'ambiguous' | 'unresolved';
export type ResolutionStatus = 'complete' | 'partial' | 'none' | 'blocked';
export type ScopePolicy = 'strict' | 'prefer_project' | 'allow_global_fallback';

export interface ResolutionSource {
  authority: 'local_graph';
  status: SourceStatus;
  revision?: string;
  issues?: Array<{ code: string; message: string }>;
  graph?: GraphFileV2;
}

export interface ResolveTextInput {
  text: string;
  mentionSpans?: Array<{ start: number; end: number }>;
  projectScope?: { projectIds: string[]; policy?: ScopePolicy };
  asOf: string;
  entityTypes?: CanonicalEntityKind[];
  source: ResolutionSource;
}

export interface CandidateEvidence {
  kind: 'name_exact' | 'alias_exact' | 'honorific_variant' | 'project_scope' | 'relation_path' | 'valid_at';
  projectId?: string;
  edgeId?: string;
  edgeIds?: string[];
  asOf?: string;
}

export interface ResolutionCandidate {
  entityId: string;
  score: number;
  evidence: CandidateEvidence[];
}

export interface MentionResolution {
  span: { start: number; end: number };
  surface?: string;
  surfaceHash: string;
  normalized: string;
  status: MentionStatus;
  selectedEntityId?: string;
  candidates: ResolutionCandidate[];
}

export type PortableMentionResolution = Omit<MentionResolution, 'surface' | 'normalized'>;

export interface ResolutionReceiptV1 {
  schemaVersion: 1;
  resolverVersion: string;
  graphSchemaVersion: 2 | null;
  ontology: { id: string; version: string; releaseDigest: string } | null;
  request: {
    textSha256: string;
    textLength: number;
    projectScope?: { projectIds: string[]; policy: ScopePolicy };
    asOf: string;
    entityTypes?: CanonicalEntityKind[];
  };
  source: {
    authority: 'local_graph';
    status: SourceStatus;
    revisionSha256?: string;
    issueCodes: string[];
  };
  resolutionStatus: ResolutionStatus;
  mentions: PortableMentionResolution[];
  summary: { resolved: number; ambiguous: number; unresolved: number } | null;
  digest: string;
}

export const resolverVersion = '1.0.0';

export function resolveText(input: ResolveTextInput): { mentions: MentionResolution[]; receipt: ResolutionReceiptV1 } {
  assertResolveTextInput(input);
  const asOf = input.asOf;
  isActiveAt({}, asOf);
  const projectScope = input.projectScope
    ? { projectIds: [...new Set(input.projectScope.projectIds)].sort(), policy: input.projectScope.policy ?? 'strict' }
    : undefined;
  if (input.source.status === 'unavailable' || input.source.status === 'invalid') {
    return finalize(input, asOf, projectScope, [], 'blocked', null);
  }
  if (!input.source.graph) {
    throw new Error(`RESOLUTION-SOURCE-GRAPH-REQUIRED: source status ${input.source.status} requires a Graph snapshot`);
  }
  validateCanonicalGraph(input.source.graph);
  const graph = input.source.graph;
  const allowedTypes = input.entityTypes ? new Set(input.entityTypes) : undefined;
  const entities = graph.entities
    .filter((entity) => !allowedTypes || allowedTypes.has(entity.type))
    .filter((entity) => isActiveAt(entity, asOf));
  const mentions = collectMentions(input.text, input.mentionSpans ?? [], entities, graph, asOf, projectScope);
  const summary = {
    resolved: mentions.filter((mention) => mention.status === 'resolved').length,
    ambiguous: mentions.filter((mention) => mention.status === 'ambiguous').length,
    unresolved: mentions.filter((mention) => mention.status === 'unresolved').length
  };
  const status: ResolutionStatus = mentions.length === 0 || summary.resolved === 0
    ? 'none'
    : summary.ambiguous + summary.unresolved === 0 && input.source.status === 'complete'
      ? 'complete'
      : 'partial';
  return finalize(input, asOf, projectScope, mentions, status, summary);
}

function collectMentions(
  text: string,
  requestedSpans: Array<{ start: number; end: number }>,
  entities: CanonicalEntity[],
  graph: GraphFileV2,
  asOf: string,
  scope: { projectIds: string[]; policy: ScopePolicy } | undefined
): MentionResolution[] {
  const bySpan = new Map<string, { start: number; end: number; surface: string; normalized: string; matches: Array<{ entity: CanonicalEntity; evidence: CandidateEvidence[] }> }>();
  for (const span of requestedSpans) {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > text.length) {
      throw new Error(`Invalid mention span: ${span.start}:${span.end}`);
    }
    const surface = text.slice(span.start, span.end);
    bySpan.set(`${span.start}:${span.end}`, {
      ...span,
      surface,
      normalized: normalizeResolverText(surface),
      matches: []
    });
  }
  for (const entity of entities) {
    for (const alias of [entity.name, ...(entity.aliases ?? [])]) {
      for (const variant of resolverVariants(alias)) {
        for (const span of findAll(text, variant.value)) {
          const key = `${span.start}:${span.end}`;
          const bucket = bySpan.get(key) ?? { ...span, normalized: normalizeResolverText(span.surface), matches: [] };
          const evidence: CandidateEvidence[] = [{ kind: alias === entity.name ? 'name_exact' : 'alias_exact' }];
          if (variant.honorific) evidence.push({ kind: 'honorific_variant' });
          bucket.matches.push({ entity, evidence });
          bySpan.set(key, bucket);
        }
      }
    }
  }

  for (const bucket of bySpan.values()) {
    for (const entity of entities) {
      for (const alias of [entity.name, ...(entity.aliases ?? [])]) {
        const variant = resolverVariants(alias).find((item) => item.value === bucket.normalized);
        if (!variant) continue;
        const evidence: CandidateEvidence[] = [{ kind: alias === entity.name ? 'name_exact' : 'alias_exact' }];
        if (variant.honorific) evidence.push({ kind: 'honorific_variant' });
        bucket.matches.push({ entity, evidence });
      }
    }
  }

  return [...bySpan.values()]
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter((mention, index, all) => !all.some((other, otherIndex) => otherIndex !== index && other.start <= mention.start && other.end >= mention.end && (other.end - other.start) > (mention.end - mention.start)))
    .map((mention) => resolveMention(mention, graph, asOf, scope));
}

function resolveMention(
  mention: { start: number; end: number; surface: string; normalized: string; matches: Array<{ entity: CanonicalEntity; evidence: CandidateEvidence[] }> },
  graph: GraphFileV2,
  asOf: string,
  scope: { projectIds: string[]; policy: ScopePolicy } | undefined
): MentionResolution {
  const deduplicated = new Map<string, ResolutionCandidate>();
  for (const match of mention.matches) {
    const scopedPaths = scope ? projectPaths(match.entity, graph, asOf, scope.projectIds) : [];
    if (scope?.policy === 'strict' && scopedPaths.length === 0) continue;
    const evidence = [...match.evidence];
    for (const path of scopedPaths.sort((left, right) => stableJson(left).localeCompare(stableJson(right)))) {
      evidence.push(path.edgeIds.length === 0
        ? { kind: 'project_scope', projectId: path.projectId }
        : path.edgeIds.length === 1
          ? { kind: 'project_scope', projectId: path.projectId, edgeId: path.edgeIds[0] }
          : { kind: 'relation_path', edgeIds: path.edgeIds });
    }
    evidence.push({ kind: 'valid_at', asOf });
    const stableEvidence = deduplicateAndSortEvidence(evidence);
    const score = match.evidence[0]?.kind === 'name_exact' ? 100 : 95;
    const scopedScore = scopedPaths.length > 0 ? score + 20 : score;
    const existing = deduplicated.get(match.entity.id);
    if (!existing || existing.score < scopedScore) deduplicated.set(match.entity.id, { entityId: match.entity.id, score: scopedScore, evidence: stableEvidence });
  }
  let candidates = [...deduplicated.values()].sort((left, right) => right.score - left.score || left.entityId.localeCompare(right.entityId));
  if (scope?.policy === 'allow_global_fallback' && candidates.some((candidate) => candidate.evidence.some(isScopeEvidence))) {
    candidates = candidates.filter((candidate) => candidate.evidence.some(isScopeEvidence));
  }
  const topScore = candidates[0]?.score;
  const top = candidates.filter((candidate) => candidate.score === topScore);
  const status: MentionStatus = candidates.length === 0 ? 'unresolved' : top.length === 1 ? 'resolved' : 'ambiguous';
  return {
    span: { start: mention.start, end: mention.end },
    surface: mention.surface,
    surfaceHash: sha256(mention.surface),
    normalized: mention.normalized,
    status,
    ...(status === 'resolved' ? { selectedEntityId: top[0]!.entityId } : {}),
    candidates
  };
}

function projectPaths(
  entity: CanonicalEntity,
  graph: GraphFileV2,
  asOf: string,
  projectIds: string[]
): Array<{ projectId: string; edgeIds: string[] }> {
  const activeEntities = new Set(graph.entities
    .filter((candidate) => isActiveAt(candidate, asOf))
    .map((candidate) => candidate.id));
  const activeProjectIds = new Set(graph.entities
    .filter((candidate) => candidate.type === 'project' && activeEntities.has(candidate.id))
    .map((candidate) => candidate.id));
  const scopedProjectIds = projectIds.filter((projectId) => activeProjectIds.has(projectId));
  if (entity.type === 'project') {
    return scopedProjectIds.includes(entity.id) ? [{ projectId: entity.id, edgeIds: [] }] : [];
  }
  const activeEdges = graph.edges
    .filter((edge) => isActiveAt(edge, asOf) && activeEntities.has(edge.fromId) && activeEntities.has(edge.toId))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const queue: Array<{ entityId: string; edgeIds: string[] }> = [{ entityId: entity.id, edgeIds: [] }];
  const visited = new Set([entity.id]);
  const paths: Array<{ projectId: string; edgeIds: string[] }> = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of activeEdges) {
      const relation = getCanonicalRelation(edge.relation);
      if (relation.scopeTraversal === 'none' || relation.traversalDirection === 'none') continue;
      const nextEntityId = relation.traversalDirection === 'forward'
        ? edge.fromId === current.entityId ? edge.toId : undefined
        : edge.toId === current.entityId ? edge.fromId : undefined;
      if (!nextEntityId) continue;
      const edgeIds = [...current.edgeIds, edge.id];
      if (scopedProjectIds.includes(nextEntityId)) {
        paths.push({ projectId: nextEntityId, edgeIds });
      }
      if (relation.scopeTraversal === 'project_transitive' && !visited.has(nextEntityId)) {
        visited.add(nextEntityId);
        queue.push({ entityId: nextEntityId, edgeIds });
      }
    }
  }

  return [...new Map(paths.map((path) => [stableJson(path), path])).entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, path]) => path);
}

function isScopeEvidence(evidence: CandidateEvidence): boolean {
  return evidence.kind === 'project_scope' || evidence.kind === 'relation_path';
}

function deduplicateAndSortEvidence(evidence: CandidateEvidence[]): CandidateEvidence[] {
  return [...new Map(evidence.map((item) => [stableJson(item), item])).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, item]) => item);
}

function finalize(
  input: ResolveTextInput,
  asOf: string,
  projectScope: { projectIds: string[]; policy: ScopePolicy } | undefined,
  mentions: MentionResolution[],
  resolutionStatus: ResolutionStatus,
  summary: ResolutionReceiptV1['summary']
): { mentions: MentionResolution[]; receipt: ResolutionReceiptV1 } {
  const graph = input.source.graph;
  const payload: Omit<ResolutionReceiptV1, 'digest'> = {
    schemaVersion: 1,
    resolverVersion,
    graphSchemaVersion: graph?.version ?? null,
    ontology: graph?.ontology ?? null,
    request: {
      textSha256: sha256(input.text),
      textLength: input.text.length,
      ...(projectScope ? { projectScope } : {}),
      asOf,
      ...(input.entityTypes ? { entityTypes: [...new Set(input.entityTypes)].sort() } : {})
    },
    source: {
      authority: input.source.authority,
      status: input.source.status,
      ...(input.source.revision ? { revisionSha256: sha256(input.source.revision) } : {}),
      issueCodes: [...new Set((input.source.issues ?? []).map((issue) => issue.code))].sort()
    },
    resolutionStatus,
    mentions: mentions.map(({ surface: _surface, normalized: _normalized, ...mention }) => mention),
    summary
  };
  return { mentions, receipt: { ...payload, digest: sha256(stableJson(payload)) } };
}

export function verifyResolutionReceipt(
  receipt: ResolutionReceiptV1,
  expected: {
    text: string;
    asOf: string;
    sourceStatus: SourceStatus;
    sourceRevision?: string;
    sourceIssueCodes?: string[];
    graph?: GraphFileV2;
    mentionSpans?: Array<{ start: number; end: number }>;
    projectScope?: { projectIds: string[]; policy?: ScopePolicy };
    entityTypes?: CanonicalEntityKind[];
  }
): boolean {
  try {
    const { digest, ...payload } = receipt;
    if (receipt.schemaVersion !== 1 || receipt.resolverVersion !== resolverVersion) return false;
    if (sha256(stableJson(payload)) !== digest) return false;
    if (receipt.request.textSha256 !== sha256(expected.text) || receipt.request.textLength !== expected.text.length) return false;
    if (receipt.request.asOf !== expected.asOf) return false;
    if (receipt.source.status !== expected.sourceStatus) return false;
    if (receipt.source.revisionSha256 !== (expected.sourceRevision ? sha256(expected.sourceRevision) : undefined)) return false;
    const sourceBlocked = receipt.source.status === 'unavailable' || receipt.source.status === 'invalid';
    if (sourceBlocked !== (receipt.resolutionStatus === 'blocked')) return false;
    if (sourceBlocked) {
      if (receipt.summary !== null || receipt.graphSchemaVersion !== null || receipt.ontology !== null || receipt.mentions.length !== 0) return false;
    } else if (receipt.graphSchemaVersion !== 2 || !receipt.ontology || receipt.summary === null) {
      return false;
    }
    for (const mention of receipt.mentions) {
      const { start, end } = mention.span;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > expected.text.length) return false;
      if (mention.surfaceHash !== sha256(expected.text.slice(start, end))) return false;
      const selected = mention.selectedEntityId;
      const candidateIds = new Set(mention.candidates.map((candidate) => candidate.entityId));
      if ((mention.status === 'resolved') !== Boolean(selected)) return false;
      if (selected && !candidateIds.has(selected)) return false;
    }
    if (receipt.summary) {
      const computed = {
        resolved: receipt.mentions.filter((mention) => mention.status === 'resolved').length,
        ambiguous: receipt.mentions.filter((mention) => mention.status === 'ambiguous').length,
        unresolved: receipt.mentions.filter((mention) => mention.status === 'unresolved').length
      };
      if (stableJson(computed) !== stableJson(receipt.summary)) return false;
      const expectedStatus: ResolutionStatus = receipt.mentions.length === 0 || computed.resolved === 0
        ? 'none'
        : computed.ambiguous + computed.unresolved === 0 && receipt.source.status === 'complete'
          ? 'complete'
          : 'partial';
      if (receipt.resolutionStatus !== expectedStatus) return false;
    }
    const recomputed = resolveText({
      text: expected.text,
      ...(expected.mentionSpans ? { mentionSpans: expected.mentionSpans } : {}),
      ...(expected.projectScope ? { projectScope: expected.projectScope } : {}),
      asOf: expected.asOf,
      ...(expected.entityTypes ? { entityTypes: expected.entityTypes } : {}),
      source: {
        authority: 'local_graph',
        status: expected.sourceStatus,
        ...(expected.sourceRevision ? { revision: expected.sourceRevision } : {}),
        issues: (expected.sourceIssueCodes ?? []).map((code) => ({ code, message: '' })),
        ...(expected.graph ? { graph: expected.graph } : {})
      }
    }).receipt;
    return recomputed.digest === receipt.digest;
  } catch {
    return false;
  }
}

function assertResolveTextInput(input: ResolveTextInput): void {
  if (!input || typeof input !== 'object' || typeof input.text !== 'string') {
    throw new Error('RESOLUTION-INPUT-TEXT: text must be a string');
  }
  if (!input.source || input.source.authority !== 'local_graph' || !['complete', 'partial', 'unavailable', 'invalid'].includes(input.source.status)) {
    throw new Error('RESOLUTION-INPUT-SOURCE: source authority and status are invalid');
  }
  if ((input.source.status === 'complete' || input.source.status === 'partial') && !input.source.graph) {
    throw new Error(`RESOLUTION-SOURCE-GRAPH-REQUIRED: source status ${input.source.status} requires a Graph snapshot`);
  }
  if ((input.source.status === 'unavailable' || input.source.status === 'invalid') && input.source.graph) {
    throw new Error(`RESOLUTION-SOURCE-GRAPH-FORBIDDEN: source status ${input.source.status} must not carry a trusted Graph snapshot`);
  }
  if (input.source.revision !== undefined && typeof input.source.revision !== 'string') {
    throw new Error('RESOLUTION-INPUT-REVISION: source revision must be a string');
  }
  if (input.source.issues !== undefined && (!Array.isArray(input.source.issues) || input.source.issues.some((issue) => !issue || typeof issue.code !== 'string' || typeof issue.message !== 'string'))) {
    throw new Error('RESOLUTION-INPUT-ISSUES: source issues must contain string code and message');
  }
  if (input.projectScope) {
    if (!Array.isArray(input.projectScope.projectIds) || input.projectScope.projectIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
      throw new Error('RESOLUTION-INPUT-PROJECT-SCOPE: project IDs must be non-empty strings');
    }
    if (input.projectScope.policy !== undefined && !['strict', 'prefer_project', 'allow_global_fallback'].includes(input.projectScope.policy)) {
      throw new Error('RESOLUTION-INPUT-SCOPE-POLICY: unsupported project scope policy');
    }
  }
  if (input.entityTypes !== undefined && (!Array.isArray(input.entityTypes) || input.entityTypes.some((type) => !['person', 'org', 'project', 'decision'].includes(type)))) {
    throw new Error('RESOLUTION-INPUT-ENTITY-TYPES: unsupported canonical entity type');
  }
}

export function normalizeResolverText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/gu, ' ').trim();
}

function resolverVariants(value: string): Array<{ value: string; honorific: boolean }> {
  const normalized = normalizeResolverText(value);
  const values = new Map<string, boolean>([[normalized, false]]);
  for (const suffix of ['さん', '様', '氏']) values.set(`${normalized}${suffix}`, true);
  return [...values].map(([variant, honorific]) => ({ value: variant, honorific }));
}

function findAll(text: string, search: string): Array<{ start: number; end: number; surface: string }> {
  const { value: normalizedText, ranges } = normalizeWithRanges(text);
  const result: Array<{ start: number; end: number; surface: string }> = [];
  let from = 0;
  while (from <= normalizedText.length) {
    const start = normalizedText.indexOf(search, from);
    if (start < 0) break;
    const end = start + search.length;
    const sourceStart = ranges[start]?.start;
    const sourceEnd = ranges[end - 1]?.end;
    if (sourceStart !== undefined && sourceEnd !== undefined) {
      result.push({ start: sourceStart, end: sourceEnd, surface: text.slice(sourceStart, sourceEnd) });
    }
    from = start + Math.max(search.length, 1);
  }
  return result;
}

function normalizeWithRanges(text: string): { value: string; ranges: Array<{ start: number; end: number }> } {
  const segments = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)];
  const characters: string[] = [];
  const ranges: Array<{ start: number; end: number }> = [];
  let pendingWhitespaceStart: number | undefined;
  let pendingWhitespaceEnd: number | undefined;

  for (const segment of segments) {
    const normalized = segment.segment.normalize('NFKC').toLocaleLowerCase('ja-JP');
    const end = segment.index + segment.segment.length;
    if (/^\s+$/u.test(normalized)) {
      if (characters.length > 0) {
        pendingWhitespaceStart ??= segment.index;
        pendingWhitespaceEnd = end;
      }
      continue;
    }
    if (pendingWhitespaceStart !== undefined) {
      characters.push(' ');
      ranges.push({ start: pendingWhitespaceStart, end: pendingWhitespaceEnd! });
      pendingWhitespaceStart = undefined;
      pendingWhitespaceEnd = undefined;
    }
    for (const character of normalized) {
      characters.push(character);
      for (let index = 0; index < character.length; index += 1) {
        if (index > 0) characters.push('');
        ranges.push({ start: segment.index, end });
      }
    }
  }

  return { value: characters.join(''), ranges };
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
