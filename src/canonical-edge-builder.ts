import { canonicalEdgeId, validateCanonicalGraph } from './canonical-graph.js';
import type { CanonicalEdge, CanonicalEntity, CanonicalGraphFile, GraphFileV2 } from './types.js';

export interface CanonicalWriteSet {
  entities: CanonicalEntity[];
  edges: CanonicalEdge[];
}

/**
 * Apply explicit canonical writes without deriving relations from labels or free text.
 * Existing records with other IDs keep their order and content; matching IDs are updated in place.
 */
export function applyCanonicalWrites(graph: CanonicalGraphFile, writes: CanonicalWriteSet): GraphFileV2 {
  if (graph.version !== 2) {
    throw new Error('migration_required: Graph v1 cannot store canonical ID edges; migrate graph.json to Graph v2 before writing');
  }

  const next: GraphFileV2 = {
    ...graph,
    entities: upsertById(graph.entities, writes.entities),
    edges: upsertById(graph.edges, writes.edges)
  };
  validateCanonicalGraph(next);
  return next;
}

export function buildCanonicalEdge(
  edge: Omit<CanonicalEdge, 'id'>
): CanonicalEdge {
  return { ...edge, id: canonicalEdgeId(edge) };
}

function upsertById<T extends { id: string }>(existing: T[], additions: T[]): T[] {
  const result = [...existing];
  const indexById = new Map(result.map((record, index) => [record.id, index]));
  for (const addition of additions) {
    const index = indexById.get(addition.id);
    if (index === undefined) {
      indexById.set(addition.id, result.length);
      result.push(addition);
    } else {
      result[index] = addition;
    }
  }
  return result;
}
