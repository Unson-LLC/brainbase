import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalEdgeId, isActiveAt, validateCanonicalGraph } from './canonical-graph.js';
import { getCanonicalRelation } from './relation-registry.js';

export interface GraphDiagnosis {
  status: 'healthy' | 'issues' | 'migration_required' | 'invalid' | 'unavailable';
  schemaVersion: number | null;
  ontology: unknown;
  asOf: string;
  migrationRequired: boolean;
  counts: { entities: number; edges: number; activeEdges: number; danglingEdges: number; invalidEdges: number; duplicateEdges: number; duplicateEntities: number; unresolvedRecords: number; projections: number };
  issues: Array<{ class: 'dangling' | 'invalid' | 'duplicate' | 'unresolved' | 'projection' | 'migration' | 'unavailable'; recordId?: string; detail: string }>;
}

export async function diagnoseGraph(dataDir: string, asOf = new Date().toISOString()): Promise<GraphDiagnosis> {
  let graph: any;
  let rawGraph: string;
  try { rawGraph = await readFile(join(dataDir, 'graph.json'), 'utf8'); }
  catch (error) { return emptyDiagnosis('unavailable', asOf, [{ class: 'unavailable', detail: error instanceof Error ? error.message : String(error) }]); }
  try { graph = JSON.parse(rawGraph); }
  catch { return emptyDiagnosis('invalid', asOf, [{ class: 'invalid', detail: 'graph.json is not valid JSON.' }]); }
  const schemaVersion = typeof graph?.version === 'number' ? graph.version : null;
  const entities: any[] = Array.isArray(graph?.entities) ? graph.entities : [];
  const edges: any[] = Array.isArray(graph?.edges) ? graph.edges : [];
  const issues: GraphDiagnosis['issues'] = [];
  if (schemaVersion === 1) issues.push({ class: 'migration', detail: 'Graph v1 must be migrated before ID-edge retrieval is available.' });
  const entityIds = new Set<string>();
  let duplicateEntities = 0;
  for (const entity of entities) {
    if (typeof entity?.id !== 'string') continue;
    if (entityIds.has(entity.id)) duplicateEntities += 1;
    entityIds.add(entity.id);
  }
  if (duplicateEntities > 0) issues.push({ class: 'duplicate', detail: `${duplicateEntities} duplicate entity IDs` });
  const edgeIds = new Set<string>();
  const tuples = new Set<string>();
  let danglingEdges = 0;
  let invalidEdges = 0;
  let duplicateEdges = 0;
  let activeEdges = 0;
  const entityById = new Map(entities.filter((entity) => typeof entity?.id === 'string').map((entity) => [entity.id, entity]));
  for (const edge of edges) {
    const tuple = JSON.stringify([edge?.fromId, edge?.relation, edge?.toId]);
    const duplicate = edgeIds.has(edge?.id) || tuples.has(tuple);
    if (duplicate) {
      duplicateEdges += 1;
      issues.push({ class: 'duplicate', recordId: String(edge?.id ?? ''), detail: 'Duplicate edge ID or tuple.' });
    }
    if (typeof edge?.id === 'string') edgeIds.add(edge.id);
    tuples.add(tuple);
    const from = entityById.get(edge?.fromId);
    const to = entityById.get(edge?.toId);
    if (!from || !to) {
      danglingEdges += 1;
      issues.push({ class: 'dangling', recordId: String(edge?.id ?? ''), detail: 'Edge endpoint does not resolve to an entity ID.' });
      continue;
    }
    let valid = true;
    try {
      const relation = getCanonicalRelation(edge.relation);
      valid = (from as any).type === relation.from && (to as any).type === relation.to && edge.id === canonicalEdgeId(edge);
      if (valid && !duplicate && isActiveAt(edge, asOf) && isActiveAt(from as any, asOf) && isActiveAt(to as any, asOf)) activeEdges += 1;
    } catch { valid = false; }
    if (!valid) {
      invalidEdges += 1;
      issues.push({ class: 'invalid', recordId: String(edge?.id ?? ''), detail: 'Edge relation, endpoint types, stable ID, or validity interval is invalid.' });
    }
  }
  const { projections, unresolvedRecords } = await diagnoseLegacyViews(dataDir, entities);
  if (projections > 0) issues.push({ class: 'projection', detail: `${projections} legacy records are projections of canonical entities.` });
  if (unresolvedRecords > 0) issues.push({ class: 'unresolved', detail: `${unresolvedRecords} legacy records do not resolve to a canonical entity ID.` });
  let structurallyInvalid = false;
  try { validateCanonicalGraph(graph); }
  catch { structurallyInvalid = schemaVersion !== 2 || (danglingEdges === 0 && invalidEdges === 0 && duplicateEdges === 0 && duplicateEntities === 0); }
  const status: GraphDiagnosis['status'] = schemaVersion === 1 ? 'migration_required' : structurallyInvalid ? 'invalid' : issues.length > 0 ? 'issues' : 'healthy';
  return { status, schemaVersion, ontology: graph?.ontology ?? null, asOf, migrationRequired: schemaVersion === 1,
    counts: { entities: entities.length, edges: edges.length, activeEdges, danglingEdges, invalidEdges, duplicateEdges, duplicateEntities, unresolvedRecords, projections }, issues };
}

async function diagnoseLegacyViews(dataDir: string, entities: any[]): Promise<{ projections: number; unresolvedRecords: number }> {
  const personKeys = canonicalKeys(entities.filter((entity) => entity.type === 'person'));
  const decisionKeys = canonicalKeys(entities.filter((entity) => entity.type === 'decision'));
  let projections = 0;
  let unresolvedRecords = 0;
  try {
    const relationships = JSON.parse(await readFile(join(dataDir, 'relationships.json'), 'utf8')).relationships;
    for (const record of Array.isArray(relationships) ? relationships : []) personKeys.has(normalize(String(record.person ?? ''))) ? projections += 1 : unresolvedRecords += 1;
  } catch { /* loadPersonalOs reports sidecar errors */ }
  try {
    for (const row of (await readFile(join(dataDir, 'decisions.jsonl'), 'utf8')).split(/\r?\n/u).filter(Boolean)) {
      const record = JSON.parse(row);
      decisionKeys.has(String(record.id ?? '')) || decisionKeys.has(normalize(String(record.title ?? ''))) ? projections += 1 : unresolvedRecords += 1;
    }
  } catch { /* loadPersonalOs reports sidecar errors */ }
  return { projections, unresolvedRecords };
}

function canonicalKeys(entities: any[]): Set<string> {
  return new Set(entities.flatMap((entity) => [String(entity.id ?? ''), normalize(String(entity.name ?? '')), ...(Array.isArray(entity.aliases) ? entity.aliases.map((alias: unknown) => normalize(String(alias))) : [])]));
}
function normalize(value: string): string { return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase() }
function emptyDiagnosis(status: GraphDiagnosis['status'], asOf: string, issues: GraphDiagnosis['issues']): GraphDiagnosis {
  return { status, schemaVersion: null, ontology: null, asOf, migrationRequired: false, counts: { entities: 0, edges: 0, activeEdges: 0, danglingEdges: 0, invalidEdges: 0, duplicateEdges: 0, duplicateEntities: 0, unresolvedRecords: 0, projections: 0 }, issues };
}
