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

  // Hosts may explicitly match an adopted surface with resolved existing
  // tokens. The default renderer palette and personal Graph stay unchanged.
  const theme = isRecord(options.visualTheme) ? options.visualTheme : {};
  const themeColor = (key, fallback) => typeof theme[key] === 'string' && theme[key].trim() ? theme[key] : fallback;

  const model = createProjectGraphModel(
    { nodes: options?.nodes, edges: options?.edges },
    { selectedId: options?.rootId || options?.selectedId || null },
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
  let filterIds = null;
  let abortListener = null;
  let popFrame = null;
  let popProgress = 0;
  const freshNodeIds = new Set(Array.isArray(options.freshNodeIds) ? options.freshNodeIds : []);
  const motionWindow = doc.defaultView;
  const animateNewNodes = freshNodeIds.size > 0 && typeof motionWindow?.requestAnimationFrame === 'function' && !motionWindow.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!animateNewNodes) popProgress = 1;
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(model.edges.map((edge) => [edge.id, edge]));
  let onZoomIn;
  let onZoomOut;
  let onReset;

  const getNeighbors = () => neighborIds;

  const popNode = (nodeId, data) => {
    if (!freshNodeIds.has(nodeId) || popProgress >= 1) return data;
    const t = popProgress - 1;
    const scale = 1 + 2.70158 * t * t * t + 1.70158 * t * t;
    return { ...data, size: data.size * (0.2 + 0.8 * scale) };
  };
  const nodeReducer = (nodeId, data) => {
    const base = { ...data };
    if (filterIds && !filterIds.has(nodeId)) return { ...base, color: themeColor('unrelated', UNRELATED_COLOR), label: null, forceLabel: false, size: Math.min(base.size, 4) };
    const neighbors = getNeighbors();
    if (!selectedId) return popNode(nodeId, base);
    const presentation = projectGraphNodePresentation(
      { id: nodeId, size: base.size },
      { selectedId, neighborIds: neighbors },
    );
    const { state, ...visuals } = presentation;
    if (state === 'selected') return popNode(nodeId, { ...base, ...visuals, color: themeColor('selected', SELECTED_COLOR) });
    if (state === 'neighbor') return popNode(nodeId, {
      ...base,
      ...visuals,
      color: base.baseColor || PROJECT_GRAPH_TYPE_COLORS.unknown,
    });
    return popNode(nodeId, {
      ...base,
      ...visuals,
      color: themeColor('unrelated', UNRELATED_COLOR),
    });
  };

  const edgeReducer = (edgeId, data) => {
    const edge = edgeById.get(edgeId);
    const base = { ...data };
    if (filterIds && edge && (!filterIds.has(edge.source) || !filterIds.has(edge.target))) return { ...base, label: null, forceLabel: false, color: themeColor('unrelatedEdge', UNRELATED_EDGE_COLOR), size: 0.5 };
    if (!selectedId || !edge) {
      return {
        ...base,
        label: null,
        forceLabel: false,
        color: themeColor('edge', base.baseColor || DEFAULT_EDGE_COLOR),
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
        color: themeColor('unrelatedEdge', UNRELATED_EDGE_COLOR),
        size: 0.5,
      };
    }
    return {
      ...base,
      label: presentation.showLabel ? edge.label : null,
      forceLabel: presentation.forceLabel,
      color: themeColor('edge', edge.color || DEFAULT_EDGE_COLOR),
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

  if (isRecord(options.cameraState) && ['x', 'y', 'angle', 'ratio'].every(key => Number.isFinite(options.cameraState[key])) && options.cameraState.ratio > 0) renderer.getCamera().setState(options.cameraState);
  if (animateNewNodes) {
    let started;
    const advance = time => {
      if (destroyed) return;
      started ??= time;
      popProgress = Math.min(1, (time - started) / 500);
      renderer?.refresh();
      popFrame = popProgress < 1 ? motionWindow.requestAnimationFrame(advance) : null;
    };
    popFrame = motionWindow.requestAnimationFrame(advance);
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
    if (popFrame !== null) motionWindow?.cancelAnimationFrame?.(popFrame);
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
    getCameraState: () => renderer?.getCamera().getState() ?? null,
    setFilter: (ids) => { filterIds = Array.isArray(ids) ? new Set(ids) : null; renderer?.refresh(); },
  };
}

export default mountProjectGraph;
