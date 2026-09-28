/*
 * Small, shared project graph contract.
 *
 * This module deliberately contains no Sigma or DOM imports.  The OSS screen
 * can therefore use the projection and layout in tests, while the browser
 * entry loads the bundled renderer only when a graph is mounted.
 */

export const PROJECT_GRAPH_CONTRACT_VERSION = 'brainbase.project-graph.v1';

const TYPE_ORDER = Object.freeze(['project', 'decision', 'person', 'org']);

/**
 * One colour per semantic type keeps a graph readable when it contains more
 * than the four types known by an older host.  Unknown types intentionally
 * remain visible and use the neutral colour.
 */
export const PROJECT_GRAPH_TYPE_COLORS = Object.freeze({
  project: '#4f46e5',
  decision: '#b45309',
  person: '#0f766e',
  org: '#166534',
  unknown: '#64748b',
});

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finitePositive(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function typeRank(type) {
  const index = TYPE_ORDER.indexOf(type);
  return index === -1 ? TYPE_ORDER.length : index;
}

function stableCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNodes(left, right) {
  const type = typeRank(left.type) - typeRank(right.type);
  if (type) return type;
  const byType = stableCompare(left.type, right.type);
  if (byType) return byType;
  const label = stableCompare(left.label, right.label);
  if (label) return label;
  return stableCompare(left.id, right.id);
}

function compareEdges(left, right) {
  const source = stableCompare(left.source, right.source);
  if (source) return source;
  const target = stableCompare(left.target, right.target);
  if (target) return target;
  return stableCompare(left.id, right.id);
}

function uniqueKey(candidate, used) {
  const base = candidate || 'edge';
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}~${suffix}`)) suffix += 1;
  const key = `${base}~${suffix}`;
  used.add(key);
  return key;
}

/**
 * Converts host data into the small shape consumed by Sigma.
 *
 * Invalid records are reported under `issues` and omitted.  In particular an
 * edge whose source or target is not present is never used to invent a node.
 * The first occurrence of a node id wins, preserving the host's order while
 * keeping the result deterministic.
 */
export function normalizeProjectGraph(input = {}) {
  const rawNodes = Array.isArray(input?.nodes) ? input.nodes : EMPTY_ARRAY;
  const rawEdges = Array.isArray(input?.edges) ? input.edges : EMPTY_ARRAY;
  const nodes = [];
  const nodeIds = new Set();
  const issues = [];

  rawNodes.forEach((raw, index) => {
    const id = isRecord(raw) ? stringValue(raw.id) : null;
    if (!id) {
      issues.push({ kind: 'invalid_node', index, reason: 'id_required' });
      return;
    }
    if (nodeIds.has(id)) {
      issues.push({ kind: 'duplicate_node', index, id, reason: 'id_already_seen' });
      return;
    }
    nodeIds.add(id);
    const type = stringValue(raw.type) || 'unknown';
    const label = stringValue(raw.label) || id;
    nodes.push({
      id,
      label,
      type,
      color: stringValue(raw.color) || PROJECT_GRAPH_TYPE_COLORS[type] || PROJECT_GRAPH_TYPE_COLORS.unknown,
      size: finitePositive(raw.size, type === 'project' ? 13 : 9),
    });
  });

  const edges = [];
  const edgeIds = new Set();
  rawEdges.forEach((raw, index) => {
    const source = isRecord(raw) ? stringValue(raw.source) : null;
    const target = isRecord(raw) ? stringValue(raw.target) : null;
    const requestedId = isRecord(raw) ? stringValue(raw.id) : null;
    const issue = !source
      ? 'source_required'
      : !target
        ? 'target_required'
        : !nodeIds.has(source)
          ? 'source_not_found'
          : !nodeIds.has(target)
            ? 'target_not_found'
            : null;
    if (issue) {
      issues.push({ kind: 'invalid_edge', index, id: requestedId, source, target, reason: issue });
      return;
    }
    const id = uniqueKey(requestedId || `edge-${index + 1}`, edgeIds);
    edges.push({
      id,
      originalId: requestedId || id,
      source,
      target,
      label: stringValue(raw.label) || '',
      color: stringValue(raw.color) || '#cbd5e1',
    });
  });

  const sortedNodes = nodes.slice().sort(compareNodes);
  const sortedEdges = edges.slice().sort(compareEdges);
  return {
    nodes: sortedNodes,
    edges: sortedEdges,
    issues,
    invalidNodeCount: issues.filter((issue) => issue.kind === 'invalid_node' || issue.kind === 'duplicate_node').length,
    invalidEdgeCount: issues.filter((issue) => issue.kind === 'invalid_edge').length,
  };
}

/** Returns the ids attached to `selectedId`, including only real endpoints. */
export function projectGraphNeighborIds(nodes, edges, selectedId) {
  const ids = new Set((Array.isArray(nodes) ? nodes : EMPTY_ARRAY).map((node) => node?.id).filter(Boolean));
  if (!selectedId || !ids.has(selectedId)) return new Set();
  const neighbors = new Set();
  for (const edge of Array.isArray(edges) ? edges : EMPTY_ARRAY) {
    if (!ids.has(edge?.source) || !ids.has(edge?.target)) continue;
    if (edge.source === selectedId) neighbors.add(edge.target);
    if (edge.target === selectedId) neighbors.add(edge.source);
  }
  return neighbors;
}

/**
 * Computes a stable clustered layout.  The selected node is the anchor when
 * it exists; its direct neighbours form the first ring and the remaining
 * nodes are grouped by their declared type.  No random seed or force solver
 * is involved, so the same Graph snapshot produces the same positions.
 */
export function computeProjectGraphLayout(nodes, edges = EMPTY_ARRAY, { selectedId = null } = {}) {
  const list = (Array.isArray(nodes) ? nodes : EMPTY_ARRAY).filter((node) => stringValue(node?.id));
  if (!list.length) return {};
  const byId = new Map(list.map((node) => [node.id, node]));
  const anchorId = selectedId && byId.has(selectedId) ? selectedId : list.slice().sort(compareNodes)[0].id;
  const neighborIds = projectGraphNeighborIds(list, edges, anchorId);
  // A null-prototype map keeps a host supplied id such as "__proto__" from
  // changing the layout object itself.
  const positions = Object.create(null);
  positions[anchorId] = { x: 0, y: 0 };

  const neighbors = list
    .filter((node) => neighborIds.has(node.id))
    .sort(compareNodes);
  const neighborRadius = Math.max(1.5, 0.5 + neighbors.length * 0.38);
  neighbors.forEach((node, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(1, neighbors.length);
    positions[node.id] = { x: Math.cos(angle) * neighborRadius, y: Math.sin(angle) * neighborRadius };
  });

  const remaining = list.filter((node) => !positions[node.id]);
  const groups = new Map();
  for (const node of remaining) {
    const group = groups.get(node.type) || [];
    group.push(node);
    groups.set(node.type, group);
  }
  const groupTypes = Array.from(groups.keys()).sort((left, right) => {
    const rank = typeRank(left) - typeRank(right);
    return rank || stableCompare(left, right);
  });
  const groupRadius = Math.max(neighborRadius + 1.15, 2.25);
  groupTypes.forEach((type, groupIndex) => {
    const group = groups.get(type).sort(compareNodes);
    const angle = -Math.PI / 2 + (2 * Math.PI * groupIndex) / Math.max(1, groupTypes.length);
    const centerX = Math.cos(angle) * groupRadius;
    const centerY = Math.sin(angle) * groupRadius;
    const innerRadius = Math.max(0.35, 0.28 + group.length * 0.1);
    group.forEach((node, index) => {
      const nodeAngle = (2 * Math.PI * index) / Math.max(1, group.length) + angle;
      positions[node.id] = {
        x: centerX + Math.cos(nodeAngle) * innerRadius,
        y: centerY + Math.sin(nodeAngle) * innerRadius,
      };
    });
  });
  return positions;
}

/** Creates the fully positioned graph model used by the browser entry. */
export function createProjectGraphModel(input = {}, options = {}) {
  const normalized = normalizeProjectGraph(input);
  const positions = computeProjectGraphLayout(normalized.nodes, normalized.edges, options);
  return {
    ...normalized,
    nodes: normalized.nodes.map((node) => ({ ...node, ...positions[node.id] })),
  };
}

/**
 * Lazy browser entry.  Keeping the renderer behind this boundary means the
 * local Graph screen can import this module in Node-based UI tests without
 * evaluating WebGL or browser globals.
 */
export async function mountProjectGraph(container, options = {}) {
  if (options?.signal?.aborted) throw abortError();
  let entry;
  try {
    entry = await import('./project-graph-entry.js');
  } catch (error) {
    // This includes browsers that expose no WebGL2/WebGL globals while the
    // Sigma vendor module is evaluated. Hosts can use the code to switch to
    // their accessible list fallback without swallowing the cause.
    if (error && typeof error === 'object' && !error.code) error.code = 'project_graph_renderer_unavailable';
    throw error;
  }
  if (options?.signal?.aborted) throw abortError();
  return entry.mountProjectGraph(container, options);
}

function abortError() {
  const error = new Error('project_graph_mount_aborted');
  error.name = 'AbortError';
  return error;
}

export default createProjectGraphModel;
