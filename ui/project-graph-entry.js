/*
 * Browser-only Sigma entry point.
 *
 * Keep all DOM/WebGL work behind this module.  The sibling contract module is
 * intentionally safe to import from Node tests and from hosts that render an
 * accessible list instead of a graph.
 */

import { MultiDirectedGraph, Sigma } from './project-graph-vendor.js';
import {
  PROJECT_GRAPH_TYPE_COLORS,
  createProjectGraphModel,
  projectGraphEdgePresentation,
  projectGraphNeighborIds,
  projectGraphNodePresentation,
} from './project-graph.js';

const DEFAULT_EDGE_COLOR = '#cbd5e1';
const SELECTED_COLOR = '#312e81';
const UNRELATED_COLOR = '#cbd5e1';
const UNRELATED_EDGE_COLOR = '#e2e8f0';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asDocument(container) {
  return container?.ownerDocument || (typeof document !== 'undefined' ? document : null);
}

function abortError() {
  const error = new Error('project_graph_mount_aborted');
  error.name = 'AbortError';
  return error;
}

function assertMountTarget(container) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new TypeError('mountProjectGraph requires a DOM container');
  }
  const doc = asDocument(container);
  if (!doc || typeof doc.createElement !== 'function') {
    throw new TypeError('mountProjectGraph requires a DOM document');
  }
  return doc;
}

function setText(element, text) {
  if (element) element.textContent = text;
}

function makeButton(doc, label, ariaLabel) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'bb-project-graph-control';
  button.setAttribute('aria-label', ariaLabel);
  button.textContent = label;
  return button;
}

function makeGraph(model) {
  const graph = new MultiDirectedGraph();
  for (const node of model.nodes) {
    graph.addNode(node.id, {
      x: Number.isFinite(node.x) ? node.x : 0,
      y: Number.isFinite(node.y) ? node.y : 0,
      size: node.size,
      label: node.label,
      color: node.color || PROJECT_GRAPH_TYPE_COLORS.unknown,
      baseColor: node.color || PROJECT_GRAPH_TYPE_COLORS.unknown,
      semanticType: node.type,
      // Sigma's renderer program type is deliberately separate from the
      // ontology type. Unknown ontology types must still draw as circles.
      type: 'circle',
      highlighted: false,
    });
  }
  for (const edge of model.edges) {
    graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, {
      label: edge.label || '',
      color: edge.color || DEFAULT_EDGE_COLOR,
      baseColor: edge.color || DEFAULT_EDGE_COLOR,
      size: 1,
      type: 'arrow',
    });
  }
  return graph;
}

/**
 * Mounts one project graph and returns an idempotent resource handle.
 *
 * The graph is built only from the supplied projection. Invalid endpoints have
 * already been removed by createProjectGraphModel, so this renderer never
 * invents a node merely to make an edge drawable.
 */
export function mountProjectGraph(container, options = {}) {
  const doc = assertMountTarget(container);
  const signal = options?.signal;
  if (signal?.aborted) throw abortError();

  const model = createProjectGraphModel(
    { nodes: options?.nodes, edges: options?.edges },
    { selectedId: options?.selectedId || null },
  );
  const mountRoot = doc.createElement('div');
  mountRoot.className = 'bb-project-graph';
  mountRoot.setAttribute('data-graph-contract', 'brainbase.project-graph.v1');

  const toolbar = doc.createElement('div');
  toolbar.className = 'bb-project-graph-controls';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'グラフ表示の操作');
  const zoomIn = makeButton(doc, '+', 'グラフを拡大');
  const zoomOut = makeButton(doc, '−', 'グラフを縮小');
  const reset = makeButton(doc, '全体', 'グラフ全体を表示');
  toolbar.append(zoomIn, zoomOut, reset);

  const status = doc.createElement('p');
  status.className = 'bb-project-graph-status';
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');

  const surface = doc.createElement('div');
  surface.className = 'bb-project-graph-surface';
  surface.setAttribute('role', 'img');
  surface.setAttribute('aria-label', 'プロジェクトの関係グラフ');
  surface.style.position = 'relative';
  surface.style.width = '100%';
  surface.style.height = '100%';

  mountRoot.append(toolbar, status, surface);
  container.appendChild(mountRoot);

  let renderer;
  let selectedId = null;
  let neighborIds = new Set();
  let destroyed = false;
  let abortListener = null;
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(model.edges.map((edge) => [edge.id, edge]));
  let onZoomIn;
  let onZoomOut;
  let onReset;

  const getNeighbors = () => neighborIds;

  const nodeReducer = (nodeId, data) => {
    const base = { ...data };
    const neighbors = getNeighbors();
    if (!selectedId) return base;
    const presentation = projectGraphNodePresentation(
      { id: nodeId, size: base.size },
      { selectedId, neighborIds: neighbors },
    );
    const { state, ...visuals } = presentation;
    if (state === 'selected') return { ...base, ...visuals, color: SELECTED_COLOR };
    if (state === 'neighbor') return {
      ...base,
      ...visuals,
      color: base.baseColor || PROJECT_GRAPH_TYPE_COLORS.unknown,
    };
    return {
      ...base,
      ...visuals,
      color: UNRELATED_COLOR,
    };
  };

  const edgeReducer = (edgeId, data) => {
    const edge = edgeById.get(edgeId);
    const base = { ...data };
    if (!selectedId || !edge) {
      return {
        ...base,
        label: null,
        forceLabel: false,
        color: base.baseColor || DEFAULT_EDGE_COLOR,
      };
    }
    const neighbors = getNeighbors();
    const presentation = projectGraphEdgePresentation(edge, {
      selectedId,
      neighborIds: neighbors,
    });
    if (!presentation.relevant) {
      return {
        ...base,
        label: null,
        forceLabel: false,
        color: UNRELATED_EDGE_COLOR,
        size: 0.5,
      };
    }
    return {
      ...base,
      label: presentation.showLabel ? edge.label : null,
      forceLabel: presentation.forceLabel,
      color: edge.color || DEFAULT_EDGE_COLOR,
      size: 1.5,
    };
  };

  const updateStatus = () => {
    if (!selectedId) {
      setText(status, `${model.nodes.length}件の対象、${model.edges.length}件の関係。点を選択すると周辺を強調します。`);
      return;
    }
    const selected = nodeById.get(selectedId);
    const neighbors = getNeighbors();
    setText(status, `${selected?.label || selectedId}を選択中。関連する対象${neighbors.size}件を強調しています。`);
  };

  const notifySelection = () => {
    if (typeof options?.onSelect === 'function') options.onSelect(selectedId);
  };

  const setSelected = (nextId, { notify = true } = {}) => {
    if (destroyed) return;
    selectedId = nextId && nodeById.has(nextId) ? nextId : null;
    neighborIds = projectGraphNeighborIds(model.nodes, model.edges, selectedId);
    updateStatus();
    if (renderer) renderer.refresh();
    if (notify) notifySelection();
  };

  try {
    renderer = new Sigma(makeGraph(model), surface, {
      allowInvalidContainer: true,
      renderLabels: true,
      renderEdgeLabels: true,
      labelDensity: 0.8,
      labelRenderedSizeThreshold: 8,
      labelGridCellSize: 120,
      defaultNodeType: 'circle',
      defaultEdgeType: 'arrow',
      defaultNodeColor: PROJECT_GRAPH_TYPE_COLORS.unknown,
      defaultEdgeColor: DEFAULT_EDGE_COLOR,
      nodeReducer,
      edgeReducer,
    });
  } catch (error) {
    // A missing WebGL context is a renderer capability failure. Let the host
    // choose its accessible list fallback while retaining the original cause.
    mountRoot.remove();
    if (isRecord(error)) error.code = 'project_graph_renderer_unavailable';
    throw error;
  }

  if (signal?.aborted) {
    renderer.kill();
    mountRoot.remove();
    throw abortError();
  }

  const onNodeClick = ({ node }) => setSelected(node);
  const onStageClick = () => setSelected(null);
  renderer.on('clickNode', onNodeClick);
  renderer.on('clickStage', onStageClick);
  onZoomIn = () => renderer?.getCamera().animatedZoom({ factor: 1.5 });
  onZoomOut = () => renderer?.getCamera().animatedUnzoom({ factor: 1.5 });
  onReset = () => renderer?.getCamera().animatedReset();
  zoomIn.addEventListener('click', onZoomIn);
  zoomOut.addEventListener('click', onZoomOut);
  reset.addEventListener('click', onReset);
  setSelected(options?.selectedId || null, { notify: false });

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
    renderer?.off('clickNode', onNodeClick);
    renderer?.off('clickStage', onStageClick);
    zoomIn.removeEventListener('click', onZoomIn);
    zoomOut.removeEventListener('click', onZoomOut);
    reset.removeEventListener('click', onReset);
    renderer?.kill();
    renderer = null;
    mountRoot.remove();
  };
  abortListener = () => destroy();
  signal?.addEventListener('abort', abortListener, { once: true });
  updateStatus();

  return {
    destroy,
    select: (nodeId) => setSelected(nodeId),
    getSelectedId: () => selectedId,
    getModel: () => model,
  };
}

export default mountProjectGraph;
