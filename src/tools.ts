import { isActiveAt } from './canonical-graph.js';
import { buildOperationalizationPlan } from './operationalization.js';
import { getCanonicalRelation } from './relation-registry.js';
import type { CanonicalEntity, EntityKind, GraphFileV2, PersonalOs, SearchResult } from './types.js';

export interface RetrievalOptions { project?: string; asOf?: string }
interface ScopedRecord { entity: CanonicalEntity; relationPath: string[] }

export function getContext(os: PersonalOs, options: RetrievalOptions = {}): Record<string, unknown> {
  const selfEntries = os.personalKg.filter((entry) => entry.type === 'self' || entry.type === 'value' || entry.type === 'judgment');
  const workEntries = os.personalKg.filter((entry) => entry.type === 'work' || entry.type === 'experience');
  const scoped = scopedRecords(os, options);
  const visibleIds = os.graph.version === 2 ? new Set(scoped.records.map((record) => record.entity.id)) : undefined;
  const projects = os.graph.entities
    .filter((entity) => entity.type === 'project' && (!visibleIds || visibleIds.has(entity.id)))
    .map((entity) => ({
      id: entity.id, name: entity.name, summary: entity.summary,
      goal: readMetadataString(entity.metadata, 'goal'), status: readMetadataString(entity.metadata, 'status'), role: readMetadataString(entity.metadata, 'role'),
      sources: Array.isArray(entity.metadata?.sources) ? entity.metadata.sources : [],
      taskSources: Array.isArray(entity.metadata?.taskSources) ? entity.metadata.taskSources : [],
      decisionPrinciples: Array.isArray(entity.metadata?.decisionPrinciples) ? entity.metadata.decisionPrinciples : []
    }));
  return {
    owner: os.graph.owner ?? {},
    self: selfEntries.map((entry) => entry.text),
    projects,
    work: [...projects.map((project) => project.summary ? `${project.name}: ${project.summary}` : project.name), ...workEntries.map((entry) => entry.text)],
    relationships: os.relationships.relationships.map((relationship) => ({ person: relationship.person, role: relationship.role, context: relationship.context })),
    decisions: os.decisions.map((decision) => ({ title: decision.title, decision: decision.decision, rationale: decision.rationale })),
    canonicalFiles: ['graph.json', 'personal-kg.jsonl', 'relationships.json', 'decisions.jsonl'],
    note: 'Canonical local SSOT data is preferred over raw sources.',
    ...(os.graph.version === 2 ? { canonicalGraph: {
      schemaVersion: 2,
      ontology: os.graph.ontology,
      authority: 'local_graph',
      asOf: scoped.asOf,
      project: scoped.project ? { id: scoped.project.id, name: scoped.project.name } : null,
      records: scoped.records.map(({ entity, relationPath }) => ({
        ...entity, canonicalEntityId: entity.id, recordClass: 'canonical', relationPath, authority: 'local_graph'
      }))
    } } : {})
  };
}

export function listEntities(os: PersonalOs, type?: EntityKind): Record<string, unknown> {
  const graphEntities = os.graph.entities.filter((entity) => !type || entity.type === type);
  const relationshipEntities = type && type !== 'relationship' ? [] : os.relationships.relationships.map((relationship) => ({
    id: relationship.id, type: 'relationship' as const, name: relationship.person, summary: relationship.context, tags: relationship.tags
  }));
  const decisionEntities = type && type !== 'decision' ? [] : os.decisions.map((decision) => ({
    id: decision.id, type: 'decision' as const, name: decision.title, summary: decision.decision, tags: decision.tags
  }));
  return { entities: [...graphEntities, ...relationshipEntities, ...decisionEntities] };
}

export function searchPersonalKg(os: PersonalOs, query: string, limit = 10): SearchResult[] {
  return rank(os.personalKg.map((entry) => ({
    source: 'personal-kg' as const, id: entry.id, title: entry.type, text: entry.text,
    score: scoreText(query, [entry.id, entry.type, entry.text, ...(entry.tags ?? [])]),
    recordClass: 'unresolved' as const, authority: 'personal_kg' as const
  })), limit);
}

export function searchAll(os: PersonalOs, query: string, limit = 10, options: RetrievalOptions = {}): SearchResult[] {
  const scoped = scopedRecords(os, options);
  const graphRecords = os.graph.version === 2
    ? scoped.records
    : os.graph.entities.map((entity) => ({ entity: entity as CanonicalEntity, relationPath: [] }));
  const graphResults: SearchResult[] = graphRecords.map(({ entity, relationPath }) => ({
    source: 'graph', id: entity.id, title: entity.name,
    text: [entity.summary ?? entity.name, metadataText(entity.metadata)].filter(Boolean).join('\n'),
    score: scoreText(query, [entity.id, entity.type, entity.name, ...(entity.aliases ?? []), entity.summary ?? '', metadataText(entity.metadata), ...(entity.tags ?? [])]),
    canonicalEntityId: entity.id, recordClass: 'canonical', relationPath, authority: 'local_graph'
  }));
  const visibleIds = new Set(scoped.records.map((record) => record.entity.id));
  const targets = os.graph.version === 2 ? projectionTargets(os.graph, scoped.asOf, visibleIds) : undefined;
  const relationshipResults: SearchResult[] = os.relationships.relationships.map((relationship) => {
    const projectionOf = targets?.person.get(normalize(relationship.person));
    return {
      source: 'relationships', id: relationship.id, title: relationship.person, text: relationship.context,
      score: scoreText(query, [relationship.id, relationship.person, relationship.role ?? '', relationship.context, ...(relationship.tags ?? [])]),
      ...(projectionOf ? { canonicalEntityId: projectionOf, projectionOf } : {}),
      recordClass: projectionOf ? 'projection' : 'unresolved', authority: 'legacy_relationships'
    };
  });
  const decisionResults: SearchResult[] = os.decisions.map((decision) => {
    const projectionOf = targets?.decision.get(decision.id) ?? targets?.decision.get(normalize(decision.title));
    return {
      source: 'decisions', id: decision.id, title: decision.title,
      text: [decision.decision, decision.rationale ?? ''].filter(Boolean).join('\n'),
      score: scoreText(query, [decision.id, decision.title, decision.decision, decision.rationale ?? '', ...(decision.tags ?? [])]),
      ...(projectionOf ? { canonicalEntityId: projectionOf, projectionOf } : {}),
      recordClass: projectionOf ? 'projection' : 'unresolved', authority: 'legacy_decisions'
    };
  });
  const additional = [...relationshipResults, ...decisionResults, ...(options.project ? [] : searchPersonalKg(os, query, limit))]
    .filter((result) => !options.project || Boolean(result.projectionOf));
  const canonicalById = new Map(graphResults.map((result) => [result.id, result]));
  const retained: SearchResult[] = [];
  for (const result of additional) {
    const canonical = result.projectionOf ? canonicalById.get(result.projectionOf) : undefined;
    if (canonical) {
      canonical.score = Math.max(canonical.score, result.score);
      if (result.source === 'relationships' || result.source === 'decisions') {
        canonical.projectionSources = [...new Set([...(canonical.projectionSources ?? []), result.source])];
      }
    }
    else retained.push(result);
  }
  return rank([...graphResults, ...retained], limit);
}

export function onboardingStatus(os: PersonalOs): Record<string, unknown> {
  const seeded = {
    self: Boolean(os.graph.owner?.name) || os.personalKg.some((entry) => entry.type === 'self'),
    work: os.graph.entities.some((entity) => entity.type === 'project') || os.personalKg.some((entry) => entry.type === 'work'),
    relationships: os.relationships.relationships.length > 0 || (os.graph.version === 2 && os.graph.edges.length > 0)
  };
  const missing = Object.entries(seeded).filter(([, value]) => !value).map(([key]) => key);
  const valueDemoReady = missing.length === 0;
  const operationalization = buildOperationalizationPlan({ dataDir: os.dataDir, firstValueReady: valueDemoReady });
  return {
    dataDir: os.dataDir, localBackend: { connected: true, backend: 'local' },
    agentMcp: { status: 'not_verified', verification: 'MCP設定を反映した新しいエージェントセッションで get_context / search を確認してください。' },
    operationallyReady: false, seeded, missing,
    valueDemo: { scope: 'local_cli_sample', ready: valueDemoReady, missing, command: `brainbase onboard:demo --dir ${shellArg(os.dataDir)} --scenario "<real request>"`, completionSignal: valueDemoReady ? 'cli_sample_ready' : 'needs_seed' },
    operationalization,
    counts: { graphEntities: os.graph.entities.length, graphEdges: os.graph.version === 2 ? os.graph.edges.length : 0, personalKgEntries: os.personalKg.length, relationships: os.relationships.relationships.length, decisions: os.decisions.length, rawSources: os.sourceCount }
  };
}

function scopedRecords(os: PersonalOs, options: RetrievalOptions): { records: ScopedRecord[]; project?: CanonicalEntity; asOf: string } {
  const asOf = options.asOf ?? new Date().toISOString();
  if (os.graph.version !== 2) return { records: [], asOf };
  const graph = os.graph;
  const active = graph.entities.filter((entity) => isActiveAt(entity, asOf));
  const activeIds = new Set(active.map((entity) => entity.id));
  const project = options.project ? resolveProject(active, options.project) : undefined;
  if (options.project && !project) return { records: [], asOf };
  if (!project) return { records: active.map((entity) => ({ entity, relationPath: [] })), asOf };
  const edges = graph.edges.filter((edge) => isActiveAt(edge, asOf) && activeIds.has(edge.fromId) && activeIds.has(edge.toId));
  return {
    records: active.flatMap((entity) => {
      const relationPath = pathToProject(entity.id, project.id, edges);
      return relationPath === undefined ? [] : [{ entity, relationPath }];
    }), project, asOf
  };
}

function pathToProject(entityId: string, projectId: string, edges: GraphFileV2['edges']): string[] | undefined {
  if (entityId === projectId) return [];
  const queue: Array<{ id: string; path: string[] }> = [{ id: entityId, path: [] }];
  const visited = new Set([entityId]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      const relation = getCanonicalRelation(edge.relation);
      if (relation.scopeTraversal === 'none' || relation.traversalDirection === 'none') continue;
      const next = relation.traversalDirection === 'forward' ? (edge.fromId === current.id ? edge.toId : undefined) : (edge.toId === current.id ? edge.fromId : undefined);
      if (!next) continue;
      const path = [...current.path, edge.id];
      if (next === projectId) return path;
      if (relation.scopeTraversal === 'project_transitive' && !visited.has(next)) {
        visited.add(next); queue.push({ id: next, path });
      }
    }
  }
  return undefined;
}

function resolveProject(entities: CanonicalEntity[], value: string): CanonicalEntity | undefined {
  const needle = normalize(value);
  const matches = entities.filter((entity) => entity.type === 'project' && [entity.id, entity.name, ...(entity.aliases ?? [])].some((candidate) => normalize(candidate) === needle));
  return matches.length === 1 ? matches[0] : undefined;
}

function projectionTargets(graph: GraphFileV2, asOf: string, visibleIds: Set<string>): { person: Map<string, string>; decision: Map<string, string> } {
  const person = new Map<string, string>();
  const decision = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const entity of graph.entities.filter((candidate) => visibleIds.has(candidate.id) && isActiveAt(candidate, asOf))) {
    const target = entity.type === 'person' ? person : entity.type === 'decision' ? decision : undefined;
    if (!target) continue;
    for (const value of [entity.id, entity.name, ...(entity.aliases ?? [])]) {
      const key = value === entity.id ? value : normalize(value);
      if (target.has(key) && target.get(key) !== entity.id) ambiguous.add(`${entity.type}:${key}`);
      else target.set(key, entity.id);
    }
  }
  for (const marker of ambiguous) {
    const [kind, ...parts] = marker.split(':');
    (kind === 'person' ? person : decision).delete(parts.join(':'));
  }
  return { person, decision };
}

function rank(results: SearchResult[], limit: number): SearchResult[] {
  const priority = { canonical: 0, projection: 1, unresolved: 2 } as const;
  return results.filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || priority[a.recordClass] - priority[b.recordClass] || a.title.localeCompare(b.title))
    .slice(0, Math.max(1, limit));
}

function scoreText(query: string, fields: string[]): number {
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
  return query.normalize('NFKC').replace(/[|/\\,;:()[\]{}"'`“”‘’、。・･，．：；（）［］｛｝「」『』【】]/g, ' ')
    .replace(/[-_]+/g, ' ').toLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean)
    .filter((term) => seen.has(term) ? false : (seen.add(term), true));
}

function normalize(value: string): string { return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase() }
function metadataText(metadata: Record<string, unknown> | undefined): string { return metadata ? JSON.stringify(metadata) : '' }
function readMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined { const value = metadata?.[key]; return typeof value === 'string' ? value : undefined }
function shellArg(value: string): string { return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value) }
