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

function makeGraph(model, detailLayout = false) {
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
      detailCos: node.detailCos,
    });
  }
  for (const edge of model.edges) {
    graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, {
      label: edge.label || '',
      color: edge.color || DEFAULT_EDGE_COLOR,
      baseColor: edge.color || DEFAULT_EDGE_COLOR,
      size: 1,
      type: detailLayout ? 'line' : 'arrow',
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
  const detailLayout = options.layout === 'project-detail';
  const themeColor = (key, fallback) => typeof theme[key] === 'string' && theme[key].trim() ? theme[key] : fallback;

  const model = createProjectGraphModel(
    { nodes: options?.nodes, edges: options?.edges },
    { selectedId: options?.rootId || options?.selectedId || null, layout: options.layout },
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
  let hoveredId = null;
  let focusedId = null;
  const nodeControls = new Map();
  let rootFallback = null;
  let rootFallbackState = null;
  let popFrame = null;
  let popProgress = 0;
  let popElapsed = 0;
  const nodeById = new Map(model.nodes.map(node => [node.id, node]));
  const edgeById = new Map(model.edges.map(edge => [edge.id, edge]));
  const nodeTimings = new Map(), edgeTimings = new Map();
  const resume = (items, target, records) => { for (const item of Array.isArray(items) ? items : []) if (records.has(item.id) && Number.isFinite(item.elapsed) && Number.isFinite(item.delay) && item.elapsed < item.delay + 500) target.set(item.id, { offset: item.elapsed, delay: item.delay }); };
  if (detailLayout) { resume(options.revealState?.nodes, nodeTimings, nodeById); resume(options.revealState?.edges, edgeTimings, edgeById); }
  const fresh = (Array.isArray(options.freshNodeIds) ? options.freshNodeIds : []).filter(id => nodeById.has(id));
  const delay = detailLayout ? Math.max(0, Number(options.revealDelay) || 0) : 0;
  const stagger = detailLayout ? Math.max(0, Number(options.revealStagger) || 0) : 0;
  fresh.forEach((id, index) => { if (!nodeTimings.has(id)) nodeTimings.set(id, { offset: 0, delay: delay + index * stagger }); });
  if (detailLayout && (delay || stagger)) {
    const peerRank = new Map(model.nodes.filter(node => node.id !== options.rootId).map((node, index) => [node.id, index]));
    for (const edge of model.edges) if (!edgeTimings.has(edge.id) && (fresh.includes(edge.source) || fresh.includes(edge.target))) edgeTimings.set(edge.id, { offset: 0, delay: Math.max(peerRank.get(edge.source) ?? 0, peerRank.get(edge.target) ?? 0) * stagger });
  }
  const revealDuration = Math.max(0, ...[...nodeTimings.values(), ...edgeTimings.values()].map(timing => timing.delay + 500 - timing.offset));
  const motionWindow = doc.defaultView;
  const animateNewNodes = revealDuration > 0 && typeof motionWindow?.requestAnimationFrame === 'function' && !motionWindow.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!animateNewNodes) popProgress = 1;
  let onZoomIn;
  let onZoomOut;
  let onReset;

  const getNeighbors = () => neighborIds;
  const viewScale = () => surface.clientWidth / 760;
  const isMobile = () => detailLayout && motionWindow?.innerWidth <= 760;
  const visualScale = () => { const scale = viewScale() / (renderer?.getCamera().ratio ?? 1); return isMobile() ? Math.max(1, scale) : scale; };
  const metricScale = () => visualScale() * (renderer?.getCamera().ratio ?? 1);
  const opacityColor = (color, opacity) => {
    const hex = /^#([0-9a-f]{6})$/i.exec(color);
    const rgb = hex ? [0, 2, 4].map(offset => parseInt(hex[1].slice(offset, offset + 2), 16)) : color.match(/[\d.]+/g)?.slice(0, 3);
    const alpha = color.startsWith('rgba') ? Number(color.match(/[\d.]+/g)?.[3] ?? 1) : 1;
    // Sigma uses ONE / ONE_MINUS_SRC_ALPHA, so WebGL colors must be premultiplied.
    // Canvas label/ring opacity is handled separately in drawDetailLabel.
    return rgb?.length === 3 ? `rgba(${rgb.map(component => Math.round(Number(component) * opacity)).join(',')},${alpha * opacity})` : color;
  };
  const fadedColor = color => opacityColor(color, .16);
  const cubicEase = (progress, x1, y1, x2, y2) => {
    if (progress <= 0 || progress >= 1) return progress;
    const cubic = (u, a, b) => 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u ** 2 * b + u ** 3;
    let low = 0, high = 1;
    for (let i = 0; i < 16; i += 1) { const middle = (low + high) / 2; if (cubic(middle, x1, x2) < progress) low = middle; else high = middle; }
    return cubic((low + high) / 2, y1, y2);
  };

  const popNode = (nodeId, data) => {
    if (theme.preserveRootLabel === true && nodeId === options.rootId) data = { ...data, label: nodeById.get(nodeId)?.label ?? data.label, forceLabel: true };
    if (!nodeTimings.has(nodeId) || popProgress >= 1) return data;
    const timing = nodeTimings.get(nodeId);
    const progress = Math.max(0, Math.min(1, (popElapsed + timing.offset - timing.delay) / 500));
    const t = progress - 1;
    let scale = 1 + 2.70158 * t * t * t + 1.70158 * t * t;
    if (detailLayout) {
      scale = cubicEase(progress, .3, 1.4, .5, 1);
    }
    const factor = 0.2 + 0.8 * scale;
    const opacity = Math.min(1, Math.max(0, scale));
    return { ...data, size: data.size * factor, ...(detailLayout ? { color: opacityColor(data.color, opacity), detailPopScale: factor, detailPopOpacity: opacity } : {}) };
  };
  const nodeReducer = (nodeId, data) => {
    const base = { ...data };
    if (detailLayout) {
      const root = nodeId === options.rootId;
      const selected = nodeId === selectedId && !root;
      const dim = !root && (filterIds && !filterIds.has(nodeId) || selectedId && selectedId !== options.rootId && !selected);
      return popNode(nodeId, { ...base, size: (root ? 17 : selected ? 10 : 8) * metricScale(), color: dim ? fadedColor(base.baseColor) : base.baseColor, label: base.label, forceLabel: true, highlighted: false, detailRoot: root, detailSelected: selected || root && (!selectedId || selectedId === options.rootId), detailDim: Boolean(dim) });
    }
    if (filterIds && !filterIds.has(nodeId)) return popNode(nodeId, { ...base, color: themeColor('unrelated', UNRELATED_COLOR), label: null, forceLabel: false, size: Math.min(base.size, 4) });
    const neighbors = getNeighbors();
    if (!selectedId) return popNode(nodeId, base);
    const presentation = projectGraphNodePresentation(
      { id: nodeId, size: base.size },
      { selectedId, neighborIds: neighbors },
    );
    const { state, ...visuals } = presentation;
    if (state === 'selected') return popNode(nodeId, { ...base, ...visuals, color: theme.preserveSelectedTypeColor === true ? base.baseColor || base.color || themeColor('selected', SELECTED_COLOR) : themeColor('selected', SELECTED_COLOR) });
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
    if (detailLayout && edge) {
      const selected = selectedId && selectedId !== options.rootId && (edge.source === selectedId || edge.target === selectedId);
      const dim = Boolean(filterIds && (!filterIds.has(edge.source) || !filterIds.has(edge.target)) || selectedId && selectedId !== options.rootId && !selected);
      const color = themeColor(selected ? 'selected' : 'edge', base.baseColor || DEFAULT_EDGE_COLOR);
      let displayColor = dim ? fadedColor(color) : color;
      const timing = edgeTimings.get(edgeId);
      if (timing && popProgress < 1) displayColor = opacityColor(displayColor, cubicEase(Math.max(0, Math.min(1, (popElapsed + timing.offset - timing.delay) / 500)), 0, 0, .58, 1));
      return { ...base, label: null, forceLabel: false, // EdgeRectangleProgram feathers one device pixel inside its geometric width.
        // Restore that coverage in screen space; keep the reference stroke width zoom-scaled.
        size: (selected ? 2 : 1.2) * metricScale() + (renderer?.getCamera().ratio ?? 1) / (motionWindow?.devicePixelRatio || 1), color: displayColor };
    }
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
    if (detailLayout) {
      const selected = nodeById.get(selectedId) ?? nodeById.get(options.rootId);
      setText(status, `${selected?.label ?? ''}を選択中。　線は、記録された関係だけを表します。`);
      status.setAttribute('aria-description', `${model.nodes.length}件の対象、${model.edges.length}件の関係。`);
      return;
    }
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
    for (const [id, button] of nodeControls) button.setAttribute('aria-pressed', String(id === selectedId));
    neighborIds = projectGraphNeighborIds(model.nodes, model.edges, selectedId);
    updateStatus();
    if (renderer) renderer.refresh();
    if (notify) notifySelection();
  };

  const drawDetailLabel = (context, data) => {
    const scale = visualScale() * (data.detailPopScale ?? 1);
    const root = data.detailRoot;
    const cos = data.detailCos;
    const right = !root && cos > .25, left = !root && cos < -.25;
    const dx = right ? 15 : left ? -15 : 0;
    const modelNode = nodeById.get(data.key);
    const dy = root ? 38 : right || left ? 4 : modelNode?.y > 290 ? -15 : 24;
    let label = root || data.label.length <= 11 ? data.label : `${data.label.slice(0, 10)}…`;
    context.save();context.globalAlpha = (data.detailDim ? .16 : 1) * (data.detailPopOpacity ?? 1);
    context.beginPath();context.arc(data.x, data.y, data.size, 0, Math.PI * 2);
    const focused = focusedId === data.key;
    context.strokeStyle = themeColor(focused ? 'focus' : data.detailSelected ? 'selected' : 'paper', '#ffffff');context.lineWidth = (focused ? 4 : data.detailSelected ? 2.5 : 3) * scale;context.stroke();
    context.font = `${root || data.detailSelected || hoveredId === data.key ? 700 : 500} ${(root ? 13 : 11.5) * scale}px ${theme.fontFamily || 'sans-serif'}`;
    if (isMobile()) {
      const x = data.x + dx * scale;
      const available = Math.max(0, right ? surface.clientWidth - x - 4 : left ? x - 4 : 2 * Math.min(x - 4, surface.clientWidth - x - 4));
      if (context.measureText(label).width > available) {
        let text = data.label;
        while (text.length && context.measureText(`${text}…`).width > available) text = text.slice(0, -1);
        label = context.measureText(`${text}…`).width <= available ? `${text}…` : '';
      }
    }
    context.textAlign = right ? 'left' : left ? 'right' : 'center';context.textBaseline = 'alphabetic';
    context.lineJoin = 'round';context.lineWidth = 4 * scale;context.strokeStyle = themeColor('paper', '#ffffff');
    context.strokeText(label, data.x + dx * scale, data.y + dy * scale);
    context.fillStyle = themeColor(root || data.detailSelected || hoveredId === data.key ? 'ink' : 'slate', '#24324b');context.fillText(label, data.x + dx * scale, data.y + dy * scale);context.restore();
  };
  try {
    renderer = new Sigma(makeGraph(model, detailLayout), surface, {
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
      ...(detailLayout ? { stagePadding: 0, itemSizesReference: 'screen', zoomToSizeRatioFunction: ratio => ratio, minCameraRatio: 1 / 1.8, maxCameraRatio: 1 / .7, enableCameraRotation: false, minEdgeThickness: .1, renderEdgeLabels: false, defaultDrawNodeLabel: drawDetailLabel, defaultDrawNodeHover: () => {} } : {}),
    });
  } catch (error) {
    // A missing WebGL context is a renderer capability failure. Let the host
    // choose its accessible list fallback while retaining the original cause.
    mountRoot.remove();
    if (isRecord(error)) error.code = 'project_graph_renderer_unavailable';
    throw error;
  }

  if (detailLayout) renderer.setCustomBBox({ x: [0, 760], y: [0, 540] });
  const onCameraUpdate = () => { if (isMobile()) renderer?.refresh(); };
  if (detailLayout) renderer.getCamera().on('updated', onCameraUpdate);

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
      popElapsed = time - started;
      popProgress = Math.min(1, popElapsed / revealDuration);
      renderer?.refresh();
      popFrame = popProgress < 1 ? motionWindow.requestAnimationFrame(advance) : null;
    };
    popFrame = motionWindow.requestAnimationFrame(advance);
  }

  const onNodeClick = ({ node }) => setSelected(node);
  const onStageClick = () => setSelected(null);
  renderer.on('clickNode', onNodeClick);
  renderer.on('clickStage', onStageClick);
  const detailZoom = delta => {
    const camera = renderer.getCamera(), state = camera.getState();
    const ratio = 1 / Math.min(1.8, Math.max(.7, 1 / state.ratio + delta));
    const root = { x: .5, y: .5 + 20 / 760 };
    const next = { ratio, x: root.x + (state.x - root.x) * ratio / state.ratio, y: root.y + (state.y - root.y) * ratio / state.ratio };
    camera.setState(next);
  };
  onZoomIn = () => detailLayout ? detailZoom(.2) : renderer?.getCamera().animatedZoom({ factor: 1.5 });
  onZoomOut = () => detailLayout ? detailZoom(-.2) : renderer?.getCamera().animatedUnzoom({ factor: 1.5 });
  onReset = () => detailLayout ? renderer?.getCamera().setState({ x: .5, y: .5, ratio: 1, angle: 0 }) : renderer?.getCamera().animatedReset();
  zoomIn.addEventListener('click', onZoomIn);
  zoomOut.addEventListener('click', onZoomOut);
  reset.addEventListener('click', onReset);
  setSelected(options?.selectedId || null, { notify: false });
  if (detailLayout) {
    const controls = doc.createElement('div');
    controls.setAttribute('role', 'group');controls.setAttribute('aria-label', 'プロジェクトの関係グラフ');
    for (const node of [...model.nodes.filter(node => node.id !== options.rootId), ...model.nodes.filter(node => node.id === options.rootId)]) {
      const button = makeButton(doc, node.label, node.label);
      button.className = 'bb-ws-visually-hidden bb-project-graph-node-focus';
      button.setAttribute('data-graph-node-id', node.id);
      button.setAttribute('aria-pressed', String(node.id === selectedId));
      button.addEventListener('focus', () => { focusedId = node.id; renderer?.refresh(); });
      button.addEventListener('blur', () => { if (focusedId === node.id) focusedId = null; renderer?.refresh(); });
      button.addEventListener('click', () => setSelected(node.id));
      nodeControls.set(node.id, button);controls.append(button);
    }
    mountRoot.insertBefore(controls, toolbar);
    rootFallback = container.querySelector('[data-graph-root-fallback]');
    if (rootFallback) {
      rootFallbackState = { hidden: rootFallback.hidden, tabindex: rootFallback.getAttribute('tabindex'), ariaHidden: rootFallback.getAttribute('aria-hidden') };
      rootFallback.hidden = true;rootFallback.setAttribute('tabindex', '-1');rootFallback.setAttribute('aria-hidden', 'true');
    }
  }
  const onEnterNode = ({ node }) => { hoveredId = node; if (detailLayout) { surface.title = nodeById.get(node)?.label ?? ''; renderer.refresh(); } };
  const onLeaveNode = () => { hoveredId = null; if (detailLayout) { surface.removeAttribute('title'); renderer.refresh(); } };
  if (detailLayout) { renderer.on('enterNode', onEnterNode);renderer.on('leaveNode', onLeaveNode); }

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (popFrame !== null) motionWindow?.cancelAnimationFrame?.(popFrame);
    if (rootFallback && rootFallbackState) {
      rootFallback.hidden = rootFallbackState.hidden;
      for (const [attribute, value] of [['tabindex', rootFallbackState.tabindex], ['aria-hidden', rootFallbackState.ariaHidden]]) if (value === null) rootFallback.removeAttribute(attribute);else rootFallback.setAttribute(attribute, value);
    }
    nodeControls.clear();
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
    renderer?.off('clickNode', onNodeClick);
    renderer?.off('clickStage', onStageClick);
    if (detailLayout) { renderer?.off('enterNode', onEnterNode);renderer?.off('leaveNode', onLeaveNode); }
    if (detailLayout) renderer?.getCamera().off('updated', onCameraUpdate);
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
    getRevealState: () => animateNewNodes && popProgress < 1 ? { nodes: [...nodeTimings].map(([id, t]) => ({ id, elapsed: t.offset + popElapsed, delay: t.delay })), edges: [...edgeTimings].map(([id, t]) => ({ id, elapsed: t.offset + popElapsed, delay: t.delay })) } : null,
    setFilter: (ids) => { filterIds = Array.isArray(ids) ? new Set(ids) : null; renderer?.refresh(); },
  };
}

export default mountProjectGraph;
