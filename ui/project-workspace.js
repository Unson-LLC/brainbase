/*
 * Shared project knowledge workspace.
 *
 * The project screen is deliberately a projection of records already read by
 * the host.  It does not invent tasks, pending decisions, or graph edges from
 * a supplementary section.  Hosts provide a Sigma.js graph mount function and
 * an entity reader; this module keeps the accessible list and evidence panel
 * usable when the graph cannot be mounted.
 */

import {
  activityBadge,
  badge,
  formatDateTime,
  getDocument,
  isEdgeView,
  isEntityView,
  isRecord,
  makeElement,
  recordDetails,
  relationLabel,
  renderProvenance,
  textOrNull,
  typeLabel,
  validityText,
} from './graph-view-shared.js';
import { workspaceDefinition, workspaceNotice } from './workspace-kit.js';

export const PROJECT_WORKSPACE_CONTRACT_VERSION = 'brainbase.project-workspace.v1';

const CONTEXT_STATES = new Set(['ok', 'loading', 'unavailable', 'failed']);

function cleanId(value) {
  return textOrNull(value);
}

function cleanType(value) {
  return textOrNull(value) ?? 'unknown';
}

function cleanName(value, fallback = null) {
  return textOrNull(value) ?? fallback;
}

function firstText(...values) {
  for (const value of values) {
    const text = textOrNull(value);
    if (text) return text;
  }
  return null;
}

function sourceLabel(source) {
  if (typeof source === 'string') return textOrNull(source);
  if (!isRecord(source)) return null;
  return firstText(source.label, source.name, source.authority, source.dataDir);
}

function normalizeContextItem(item) {
  if (!isRecord(item)) return null;
  const id = cleanId(item.id);
  const title = cleanName(item.title, item.name);
  if (!id || !title) return null;
  const normalized = { id, title };
  for (const key of ['kind', 'status', 'summary', 'owner', 'dueAt', 'updatedAt']) {
    const value = textOrNull(item[key]);
    if (value) normalized[key] = value;
  }
  const source = sourceLabel(item.source);
  if (source) normalized.source = source;
  return normalized;
}

function normalizeContextSection(section) {
  if (!isRecord(section)) return null;
  const id = cleanId(section.id);
  const title = cleanName(section.title, section.name);
  if (!id || !title) return null;
  const state = CONTEXT_STATES.has(section.state) ? section.state : 'unavailable';
  const normalized = { id, title, state };
  const message = textOrNull(section.message);
  if (message) normalized.message = message;
  const asOf = textOrNull(section.asOf);
  if (asOf) normalized.asOf = asOf;
  normalized.items = Array.isArray(section.items) ? section.items.map(normalizeContextItem).filter(Boolean) : [];
  return normalized;
}

/**
 * Normalizes the optional host context contract without turning a failed read
 * into an empty, successful section.
 */
export function normalizeProjectContext(projectId, result) {
  const id = cleanId(projectId) ?? '';
  if (result?.state === 'failed' || result?.state === 'error') {
    return { projectId: id, state: 'failed', message: firstText(result.message, result.reason) ?? '補足情報を読み取れませんでした。', sections: [] };
  }
  if (result?.state === 'loading') {
    const partial = result?.payload && isRecord(result.payload) ? result.payload : result;
    const rawSections = Array.isArray(partial.sections) ? partial.sections : [];
    const normalized = {
      projectId: id,
      state: 'loading',
      sections: rawSections.map(normalizeContextSection).filter(Boolean),
    };
    const message = firstText(result.message, result.reason);
    if (message) normalized.message = message;
    return normalized;
  }
  if (result?.state === 'unavailable') {
    return { projectId: id, state: 'unavailable', message: firstText(result.message, result.reason) ?? '補足情報は接続されていません。', sections: [] };
  }
  const payload = result?.state === 'ok' && isRecord(result.payload) ? result.payload : result;
  if (!isRecord(payload) || !Array.isArray(payload.sections)) {
    return { projectId: id, state: 'unavailable', message: '補足情報の形式を確認できません。', sections: [] };
  }
  const sections = payload.sections.map(normalizeContextSection).filter(Boolean);
  if (sections.length === 0 && payload.sections.length > 0) {
    return { projectId: id, state: 'unavailable', message: '補足情報の形式を確認できません。', sections: [] };
  }
  return { projectId: id, state: sections.some((section) => section.state === 'loading') ? 'loading' : 'ok', sections };
}

function addEntity(map, candidate) {
  if (!isRecord(candidate)) return;
  const id = cleanId(candidate.id);
  const name = cleanName(candidate.name, candidate.title);
  if (!id || !name) return;
  const existing = map.get(id);
  map.set(id, {
    ...(existing ?? {}),
    ...candidate,
    id,
    type: cleanType(candidate.type ?? existing?.type),
    name,
  });
}

function counterpartEntity(edge) {
  if (!isRecord(edge?.counterpart)) return null;
  return edge.counterpart;
}

function edgeSourceTarget(edge, projectId) {
  if (!isRecord(edge)) return { source: null, target: null };
  let source = cleanId(edge.source ?? edge.fromId);
  let target = cleanId(edge.target ?? edge.toId);
  const counterpart = cleanId(edge.counterpart?.id);
  if (!source || !target) {
    if (edge.direction === 'incoming') {
      source = source ?? counterpart;
      target = target ?? projectId;
    } else {
      source = source ?? projectId;
      target = target ?? counterpart;
    }
  }
  return { source, target };
}

function edgeLabel(edge) {
  return firstText(edge?.label, relationLabel(edge?.relation)) ?? '関係';
}

function projectDetailPayload(detail) {
  if (!isRecord(detail)) return null;
  if (detail.project) return detail;
  if (detail.payload?.project) return detail.payload;
  return null;
}

/** Returns actual project/counterpart/optional knowledge entities, retaining custom types. */
export function projectKnowledgeEntities(detail) {
  const payload = projectDetailPayload(detail);
  const map = new Map();
  if (!payload) return [];
  addEntity(map, payload.project);
  for (const edge of [...(payload.participants ?? []), ...(payload.relations ?? [])]) addEntity(map, counterpartEntity(edge));
  for (const entity of payload.knowledge?.entities ?? []) addEntity(map, entity);
  return [...map.values()];
}

/** Returns actual relation edges only; supplementary section membership is never an edge. */
export function projectKnowledgeEdges(detail) {
  const payload = projectDetailPayload(detail);
  if (!payload || !cleanId(payload.project?.id)) return [];
  const projectId = payload.project.id;
  const byId = new Map();
  const addEdge = (edge) => {
    if (!isRecord(edge)) return;
    const id = cleanId(edge.id);
    const { source, target } = edgeSourceTarget(edge, projectId);
    if (!id || !source || !target) return;
    if (byId.has(id)) return;
    byId.set(id, {
      ...edge,
      id,
      source,
      target,
      relation: cleanId(edge.relation) ?? 'unknown',
      label: edgeLabel(edge),
    });
  };
  for (const edge of [...(payload.participants ?? []), ...(payload.relations ?? []), ...(payload.knowledge?.edges ?? [])]) addEdge(edge);
  return [...byId.values()];
}

/** Unknowns are explicit missing project fields/host supplied unknowns, never inferred pending work. */
export function projectKnowledgeUnknowns(detail) {
  const payload = projectDetailPayload(detail);
  if (!payload) return ['プロジェクトの記録'];
  const values = [];
  const add = (value) => {
    const text = typeof value === 'string' ? textOrNull(value) : textOrNull(value?.label ?? value?.title ?? value?.name);
    if (text && !values.includes(text)) values.push(text);
  };
  for (const item of payload.unknowns ?? []) add(item);
  if (!textOrNull(payload.project?.goal)) add('目的');
  if (!textOrNull(payload.project?.status)) add('状態');
  if (!payload.source) add('出典');
  if (!textOrNull(payload.asOf)) add('読み取った時点');
  return values;
}

function graphEntityMap(detail) {
  return new Map(projectKnowledgeEntities(detail).map((entity) => [entity.id, entity]));
}

function graphEvidenceEdges(detail) {
  return projectKnowledgeEdges(detail);
}

function resultEntity(result) {
  if (!isRecord(result)) return null;
  const payload = result.state === 'ok' && isRecord(result.payload) ? result.payload : result;
  if (isEntityView(payload.entity)) return payload;
  if (isEntityView(payload)) return { entity: payload };
  if (isRecord(payload.entity) && typeof payload.entity.id === 'string') return payload;
  return null;
}

function resultFailure(result) {
  return firstText(result?.message, result?.reason, result?.error?.message) ?? 'この記録の詳細を読み取れませんでした。';
}

function appendText(parent, doc, text, className = '') {
  if (!text) return;
  parent.append(makeElement(doc, 'p', { className, text }));
}

function recordLink(doc, label, id, onSelect, className = 'bb-pkw-record-link') {
  if (!id || typeof onSelect !== 'function') return makeElement(doc, 'strong', { text: label });
  const button = makeElement(doc, 'button', {
    className,
    text: label,
    attrs: { type: 'button', 'data-record-id': id },
  });
  button.addEventListener('click', () => onSelect(id));
  return button;
}

function relationEvidence(doc, edges, entityId, entities, asOf, onSelect) {
  const list = makeElement(doc, 'ul', { className: 'bb-pkw-evidence-list' });
  const incident = edges.filter((edge) => edge.source === entityId || edge.target === entityId);
  if (incident.length === 0) {
    list.append(makeElement(doc, 'li', { className: 'bb-pkw-muted', text: 'この画面で確認できる関係はありません。' }));
    return list;
  }
  for (const edge of incident) {
    const otherId = edge.source === entityId ? edge.target : edge.source;
    const other = entities.get(otherId);
    const item = makeElement(doc, 'li', { className: 'bb-pkw-evidence-item' });
    const head = makeElement(doc, 'div', { className: 'bb-pkw-evidence-head' });
    head.append(badge(doc, relationLabel(edge.relation), 'muted'), recordLink(doc, other?.name ?? otherId, otherId, onSelect));
    if (edge.active !== undefined) head.append(activityBadge(doc, edge, asOf));
    item.append(head);
    item.append(workspaceDefinition(doc, [
      ['意味', textOrNull(edge.meaning) ?? edge.label],
      ['役割', textOrNull(edge.role)],
      ['文脈', textOrNull(edge.context)],
      ['有効期間', validityText(edge.validFrom, edge.validTo)],
      ['出典', isRecord(edge.provenance) ? renderProvenance(doc, edge.provenance) : null],
    ]));
    item.append(recordDetails(doc, [['関係ID', edge.id], ['起点', edge.source], ['終点', edge.target], ['digest', edge.digest]]));
    list.append(item);
  }
  return list;
}

function renderEntityRelations(doc, edges, direction, entity, asOf, onSelect) {
  const candidates = Array.isArray(edges) ? edges : [];
  if (candidates.length === 0) return null;
  const list = makeElement(doc, 'ul', { className: 'bb-pkw-detail-relations' });
  for (const edge of candidates) {
    if (!isRecord(edge)) continue;
    const item = makeElement(doc, 'li');
    const counterpart = edge.counterpart ?? {};
    item.append(badge(doc, relationLabel(edge.relation), 'muted'), recordLink(doc, cleanName(counterpart.name, counterpart.id) ?? '名前不明', cleanId(counterpart.id), onSelect));
    if (edge.active !== undefined) item.append(activityBadge(doc, edge, asOf));
    if (edge.provenance) item.append(renderProvenance(doc, edge.provenance));
    list.append(item);
  }
  return list.children.length > 0 ? list : null;
}

function skeletonBars(doc, count = 3) {
  const stack = makeElement(doc, 'div', { className: 'bb-pkw-skeleton-stack', attrs: { 'aria-hidden': 'true' } });
  for (let index = 0; index < count; index += 1) {
    stack.append(makeElement(doc, 'span', {
      className: `bb-pkw-skeleton-bar bb-pkw-skeleton-bar-${(index % 3) + 1}`,
      attrs: { 'aria-hidden': 'true' },
    }));
  }
  return stack;
}

function contextSectionSkeleton(doc, { title = null, message = null } = {}) {
  const group = makeElement(doc, 'section', {
    className: 'bb-pkw-context-group bb-pkw-context-group-loading',
    attrs: { 'aria-label': title ?? '補足情報', 'aria-busy': 'true' },
  });
  if (title) group.append(makeElement(doc, 'h4', { text: title }));
  if (message) group.append(makeElement(doc, 'p', { className: 'bb-pkw-muted', text: message }));
  group.append(skeletonBars(doc));
  return group;
}

function renderProjectContextGroup(doc, item) {
  const group = makeElement(doc, 'section', {
    className: `bb-pkw-context-group${item.state === 'loading' ? ' bb-pkw-context-group-loading' : ''}`,
    attrs: { 'aria-label': item.title, ...(item.state === 'loading' ? { 'aria-busy': 'true' } : {}) },
  });
  const heading = makeElement(doc, 'div', { className: 'bb-pkw-context-heading' });
  heading.append(makeElement(doc, 'h4', { text: item.title }), badge(doc, item.state === 'ok' ? '利用可能' : item.state === 'loading' ? '読み込み中' : item.state === 'failed' ? '読み取り失敗' : '未接続', item.state === 'ok' ? 'success' : item.state === 'failed' ? 'danger' : 'muted'));
  group.append(heading);
  if (item.message && !['failed', 'unavailable'].includes(item.state)) group.append(makeElement(doc, 'p', { className: 'bb-pkw-muted', text: item.message }));
  if (item.asOf) group.append(makeElement(doc, 'small', { className: 'bb-pkw-muted', text: `読み取った時点: ${formatDateTime(item.asOf)}` }));
  if (item.state === 'loading') {
    group.append(skeletonBars(doc));
  } else if (item.state === 'failed') {
    group.append(workspaceNotice(doc, { label: '読み取り失敗', text: item.message ?? 'このセクションを読み取れませんでした。', tone: 'danger', role: 'alert' }));
  } else if (item.state === 'unavailable') {
    group.append(workspaceNotice(doc, { label: '未接続', text: item.message ?? 'このセクションは接続されていません。', tone: 'warning' }));
  } else if (item.items.length > 0) {
    const list = makeElement(doc, 'ul', { className: 'bb-pkw-context-list' });
    for (const entry of item.items) {
      const row = makeElement(doc, 'li');
      row.append(makeElement(doc, 'strong', { text: entry.title }));
      if (entry.status) row.append(badge(doc, entry.status, 'muted'));
      const facts = [entry.summary, entry.owner ? `担当: ${entry.owner}` : null, entry.dueAt ? `期限: ${entry.dueAt}` : null, entry.updatedAt ? `更新: ${entry.updatedAt}` : null, entry.source ? `出典: ${entry.source}` : null].filter(Boolean);
      if (facts.length > 0) row.append(makeElement(doc, 'p', { className: 'bb-pkw-muted', text: facts.join(' · ') }));
      list.append(row);
    }
    group.append(list);
  } else if (item.state === 'ok') {
    group.append(makeElement(doc, 'p', { className: 'bb-pkw-muted', text: 'このセクションに表示できる記録はありません。' }));
  }
  return group;
}

/** Renders supplementary context while preserving each section's own state. */
export function renderProjectContext(doc, context, {
  sections: selectedSections = null,
  includeStatus = true,
  includeHeading = true,
} = {}) {
  if (!context) return null;
  const sections = Array.isArray(selectedSections)
    ? selectedSections
    : Array.isArray(context.sections) ? context.sections : [];
  const section = makeElement(doc, 'section', {
    className: 'bb-pkw-section bb-pkw-context',
    attrs: { 'aria-label': '補足情報' },
  });
  if (includeHeading) section.append(makeElement(doc, 'h3', { text: '補足情報' }));
  if (includeStatus && context.state !== 'ok') {
    if (context.state === 'loading') {
      section.append(workspaceNotice(doc, { label: '読み込み中', text: context.message ?? '補足情報を読み込んでいます。', tone: 'info', role: 'status' }));
      if (sections.length === 0) section.append(contextSectionSkeleton(doc));
    } else {
      section.append(workspaceNotice(doc, { label: context.state === 'failed' ? '読み取り失敗' : '未接続', text: context.message ?? '補足情報を確認できません。', tone: context.state === 'failed' ? 'danger' : 'warning' }));
    }
  }
  if (includeStatus && context.state === 'ok' && sections.length === 0) {
    section.append(makeElement(doc, 'p', { className: 'bb-pkw-muted', text: '補足情報のセクションはありません。' }));
    return section;
  }
  for (const item of sections) section.append(renderProjectContextGroup(doc, item));
  return section;
}

/** Structural shell used while the Graph detail is loading; it contains no inferred values. */
export function renderProjectKnowledgeSkeleton(doc, { context = null } = {}) {
  const panel = makeElement(doc, 'div', {
    className: 'bb-pkw-panel bb-pkw-overview bb-pkw-overview-loading',
    attrs: { 'aria-label': '概要' },
  });
  const contextSections = Array.isArray(context?.sections) ? context.sections : [];
  const readySections = contextSections.filter((item) => item?.state === 'ok' && Array.isArray(item.items) && item.items.length > 0);
  const deferredSections = contextSections.filter((item) => !readySections.includes(item));
  if (readySections.length > 0) {
    panel.append(renderProjectContext(doc, context, { sections: readySections, includeStatus: false }));
  }
  const columns = makeElement(doc, 'div', { className: 'bb-pkw-columns' });
  for (const title of ['目的と現在地', '関係者と役割']) {
    const item = makeElement(doc, 'section', { className: 'bb-pkw-section bb-pkw-skeleton-section', attrs: { 'aria-label': title, 'aria-busy': 'true' } });
    item.append(makeElement(doc, 'h3', { text: title }), skeletonBars(doc));
    columns.append(item);
  }
  panel.append(columns);
  for (const title of ['記録された判断', '関連する情報']) {
    const item = makeElement(doc, 'section', { className: 'bb-pkw-section bb-pkw-skeleton-section', attrs: { 'aria-label': title, 'aria-busy': 'true' } });
    item.append(makeElement(doc, 'h3', { text: title }), skeletonBars(doc, 2));
    panel.append(item);
  }
  const contextBlock = readySections.length > 0
    ? (deferredSections.length > 0 ? renderProjectContext(doc, context, { sections: deferredSections, includeHeading: false }) : null)
    : renderProjectContext(doc, context ?? { state: 'loading', sections: [] });
  if (contextBlock) panel.append(contextBlock);
  return panel;
}

function renderOverview(doc, detail, context, edges, entities, onSelect, onContext) {
  const payload = projectDetailPayload(detail);
  const project = payload?.project;
  const panel = makeElement(doc, 'div', { className: 'bb-pkw-panel bb-pkw-overview', attrs: { role: 'tabpanel', 'aria-label': '概要' } });
  const columns = makeElement(doc, 'div', { className: 'bb-pkw-columns' });
  const summary = makeElement(doc, 'section', { className: 'bb-pkw-section', attrs: { 'aria-label': '目的と現在地' } });
  summary.append(makeElement(doc, 'h3', { text: '目的と現在地' }), workspaceDefinition(doc, [
    ['目的', textOrNull(project?.goal)],
    ['状態', textOrNull(project?.status)],
    ['有効期間', validityText(project?.validFrom, project?.validTo)],
    ['出典', sourceLabel(payload?.source)],
    ['読み取った時点', payload?.asOf ? formatDateTime(payload.asOf) : null],
  ]));
  columns.append(summary);

  const people = makeElement(doc, 'section', { className: 'bb-pkw-section', attrs: { 'aria-label': '関係者' } });
  people.append(makeElement(doc, 'h3', { text: '関係者と役割' }));
  const participantEdges = Array.isArray(payload?.participants) ? payload.participants : [];
  if (participantEdges.length === 0) {
    people.append(makeElement(doc, 'p', { className: 'bb-pkw-muted', text: '関係者の記録はありません。' }));
  } else {
    const list = makeElement(doc, 'ul', { className: 'bb-pkw-people-list' });
    for (const edge of participantEdges) {
      const item = makeElement(doc, 'li');
      const counterpart = edge.counterpart ?? {};
      item.append(recordLink(doc, cleanName(counterpart.name, counterpart.id) ?? '名前不明', cleanId(counterpart.id), onSelect), badge(doc, relationLabel(edge.relation), edge.relation === 'accountable_for' ? 'accent' : 'muted'));
      const facts = [textOrNull(edge.role) ? `役割: ${edge.role}` : null, textOrNull(edge.context) ? `文脈: ${edge.context}` : null].filter(Boolean);
      if (facts.length > 0) item.append(makeElement(doc, 'p', { className: 'bb-pkw-muted', text: facts.join(' · ') }));
      list.append(item);
    }
    people.append(list);
  }
  columns.append(people);
  panel.append(columns);

  const contextBlock = renderProjectContext(doc, context);
  if (contextBlock) {
    panel.append(contextBlock);
    if (typeof onContext === 'function') onContext(contextBlock);
  }

  const decisions = makeElement(doc, 'section', { className: 'bb-pkw-section', attrs: { 'aria-label': '記録された判断' } });
  decisions.append(makeElement(doc, 'h3', { text: '記録された判断' }));
  const decisionEdges = edges.filter((edge) => entities.get(edge.source)?.type === 'decision' || entities.get(edge.target)?.type === 'decision');
  if (decisionEdges.length === 0) decisions.append(makeElement(doc, 'p', { className: 'bb-pkw-muted', text: 'このプロジェクトに結びつく判断の記録はありません。' }));
  else {
    const list = makeElement(doc, 'ul', { className: 'bb-pkw-decision-list' });
    for (const edge of decisionEdges) {
      const decisionId = entities.get(edge.source)?.type === 'decision' ? edge.source : edge.target;
      const decision = entities.get(decisionId);
      const item = makeElement(doc, 'li');
      item.append(recordLink(doc, decision?.name ?? decisionId, decisionId, onSelect), badge(doc, relationLabel(edge.relation), 'muted'));
      if (decision?.summary) item.append(makeElement(doc, 'p', { className: 'bb-pkw-muted', text: decision.summary }));
      list.append(item);
    }
    decisions.append(list);
  }
  panel.append(decisions);

  const objects = makeElement(doc, 'section', { className: 'bb-pkw-section', attrs: { 'aria-label': '関連する情報' } });
  objects.append(makeElement(doc, 'h3', { text: '関連する情報' }));
  const groups = new Map();
  for (const entity of entities.values()) {
    if (entity.id === project?.id || entity.type === 'person' || entity.type === 'decision') continue;
    if (!groups.has(entity.type)) groups.set(entity.type, []);
    groups.get(entity.type).push(entity);
  }
  if (groups.size === 0) objects.append(makeElement(doc, 'p', { className: 'bb-pkw-muted', text: '関連する情報の記録はありません。' }));
  else {
    const grid = makeElement(doc, 'div', { className: 'bb-pkw-info-grid' });
    for (const [type, records] of groups) {
      const group = makeElement(doc, 'section', { className: 'bb-pkw-object', attrs: { 'aria-label': typeLabel(type) } });
      group.append(makeElement(doc, 'h4', { text: typeLabel(type) }));
      const list = makeElement(doc, 'ul');
      for (const record of records) {
        const item = makeElement(doc, 'li');
        item.append(recordLink(doc, record.name, record.id, onSelect));
        list.append(item);
      }
      group.append(list);
      grid.append(group);
    }
    objects.append(grid);
  }
  panel.append(objects);

  const unknowns = projectKnowledgeUnknowns(detail);
  if (unknowns.length > 0) {
    const missing = makeElement(doc, 'section', { className: 'bb-pkw-section bb-pkw-unknown', attrs: { 'aria-label': '未記録・未確認' } });
    missing.append(makeElement(doc, 'h3', { text: '未記録・未確認' }));
    const list = makeElement(doc, 'ul');
    for (const unknown of unknowns) list.append(makeElement(doc, 'li', { text: unknown }));
    missing.append(list);
    panel.append(missing);
  }
  return panel;
}

/**
 * Mounts the shared project knowledge UI.  `mountGraph` is normally backed by
 * Sigma.js in the host and is intentionally injected to keep this module
 * testable and usable by the organization shell.
 */
export function createProjectKnowledgeWorkspace({
  document: explicitDocument,
  detail,
  context = null,
  mountGraph,
  readEntity,
  onTabChange,
} = {}) {
  const doc = getDocument(explicitDocument);
  const payload = projectDetailPayload(detail);
  const project = payload?.project;
  if (!project) throw new TypeError('project detail is required');
  // Keep the project-bound projection separate from the mutable exploration
  // graph.  Reading a related entity may reveal arbitrary neighboring records,
  // but those records are not evidence that they belong to this project.
  const overviewEntities = graphEntityMap(payload);
  const overviewEdges = graphEvidenceEdges(payload);
  const entities = new Map(overviewEntities);
  const edges = [...overviewEdges];
  let destroyed = false;
  let selectedId = project.id;
  let activeTab = 'overview';
  let graphHandle = null;
  let graphTimer = null;
  let graphMountToken = 0;
  let graphFailure = null;
  let entityRead = null;
  let entityReadRequest = 0;
  let graphSearch = '';
  let graphType = '';
  let currentContext = context;
  // Keep direct references as well as the DOM lookup.  The local test harness
  // intentionally has no querySelector implementation, and a host can replace
  // the panel while a detail read is still in flight.
  let selectedPanel = null;
  let overviewPanel = null;
  let contextBlock = null;

  const root = makeElement(doc, 'section', { className: 'bb-pkw', attrs: { 'data-contract-version': PROJECT_WORKSPACE_CONTRACT_VERSION, 'aria-label': 'プロジェクトの知識' } });
  const body = makeElement(doc, 'div', { className: 'bb-pkw-body' });
  const tabs = makeElement(doc, 'div', { className: 'bb-pkw-tabs', attrs: { role: 'tablist', 'aria-label': 'プロジェクト情報の表示' } });
  const panels = makeElement(doc, 'div', { className: 'bb-pkw-panels' });
  root.append(makeElement(doc, 'div', { className: 'bb-pkw-kicker', text: 'プロジェクトの記録' }));
  const header = makeElement(doc, 'header', { className: 'bb-pkw-header' });
  header.append(makeElement(doc, 'h2', { text: project.name }), makeElement(doc, 'p', { className: 'bb-pkw-lead', text: '目的・関係・判断の根拠を、実際に記録された情報からたどれます。' }));
  const metadata = makeElement(doc, 'div', { className: 'bb-pkw-meta' });
  if (sourceLabel(payload.source)) metadata.append(badge(doc, `出典: ${sourceLabel(payload.source)}`, 'muted'));
  if (payload.asOf) metadata.append(badge(doc, `読み取り: ${formatDateTime(payload.asOf)}`, 'muted'));
  header.append(metadata);
  root.append(header);
  root.append(tabs, panels);
  root.append(body);

  function setTab(tab) {
    activeTab = tab === 'graph' ? 'graph' : 'overview';
    if (typeof onTabChange === 'function') onTabChange(activeTab);
    render();
  }

  function mergeEntityRead(read) {
    if (!isRecord(read?.entity)) return;
    addEntity(entities, read.entity);
    for (const edge of [...(read.incoming ?? []), ...(read.outgoing ?? [])]) {
      addEntity(entities, counterpartEntity(edge));
      const id = cleanId(edge?.id);
      const { source, target } = edgeSourceTarget(edge, read.entity.id);
      if (!id || !source || !target || edges.some((candidate) => candidate.id === id)) continue;
      edges.push({ ...edge, id, source, target, relation: cleanId(edge.relation) ?? 'unknown', label: edgeLabel(edge) });
    }
  }

  function select(id, { fromGraph = false } = {}) {
    const target = cleanId(id);
    if (!target || !entities.has(target) || destroyed) return;
    // A list click synchronizes Sigma by calling its `select`, which notifies
    // this workspace again. Keep the second notification from starting a
    // duplicate entity read (or resetting a completed detail read).
    if (selectedId === target) {
      if (!fromGraph && graphHandle?.select) graphHandle.select(target);
      return;
    }
    selectedId = target;
    entityRead = null;
    renderGraphList();
    renderSelectedPanel();
    if (!fromGraph && graphHandle?.select) graphHandle.select(target);
    if (target !== project.id && typeof readEntity === 'function') void loadEntity(target);
  }

  function selectAndExplore(id) {
    const target = cleanId(id);
    if (!target || !entities.has(target) || destroyed) return;
    activeTab = 'graph';
    select(target);
    render();
  }

  function tabButton(label, tab) {
    const button = makeElement(doc, 'button', { className: `bb-pkw-tab${activeTab === tab ? ' is-active' : ''}`, text: label, attrs: { type: 'button', role: 'tab', 'aria-selected': activeTab === tab ? 'true' : 'false', 'aria-controls': `bb-pkw-panel-${tab}` } });
    button.addEventListener('click', () => setTab(tab));
    return button;
  }

  function renderGraphList() {
    const list = root.querySelector?.('.bb-pkw-graph-list') ?? graphList;
    if (!list) return;
    list.replaceChildren();
    const visible = filteredGraphEntities();
    if (visible.length === 0) {
      list.append(makeElement(doc, 'li', { className: 'bb-pkw-muted', text: '条件に一致する記録はありません。' }));
      return;
    }
    for (const entity of visible) {
      const row = makeElement(doc, 'li');
      const button = makeElement(doc, 'button', { className: `bb-pkw-graph-item${selectedId === entity.id ? ' is-selected' : ''}`, attrs: { type: 'button', 'aria-pressed': selectedId === entity.id ? 'true' : 'false' } });
      button.append(makeElement(doc, 'strong', { text: entity.name }), badge(doc, typeLabel(entity.type), 'muted'));
      button.addEventListener('click', () => select(entity.id));
      row.append(button);
      list.append(row);
    }
  }

  const graphList = makeElement(doc, 'ul', { className: 'bb-pkw-graph-list', attrs: { 'aria-label': 'グラフの記録一覧' } });

  function filteredGraphEntities() {
    const query = graphSearch.trim().toLocaleLowerCase();
    return [...entities.values()].filter((entity) => {
      if (graphType && entity.type !== graphType) return false;
      if (!query) return true;
      return [entity.name, entity.type, entity.summary].filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(query));
    });
  }

  function renderSelectedPanel() {
    const panel = root.querySelector?.('.bb-pkw-selection') ?? selectedPanel;
    if (!panel) return;
    panel.replaceChildren();
    const entity = entities.get(selectedId);
    if (!entity) return;
    const read = entityRead?.id === selectedId ? entityRead : null;
    const fetched = selectedId === project.id ? { entity: project, incoming: [], outgoing: [] } : read?.entity ? read : null;
    const selectedEntity = fetched?.entity ?? entity;
    panel.append(makeElement(doc, 'h3', { text: '選択した記録' }), makeElement(doc, 'div', { className: 'bb-pkw-selected-head' }));
    const head = panel.children[1];
    head.append(makeElement(doc, 'strong', { text: selectedEntity.name }), badge(doc, typeLabel(selectedEntity.type), 'accent'));
    panel.append(workspaceDefinition(doc, [
      ['要約', textOrNull(selectedEntity.summary)],
      ['状態', textOrNull(selectedEntity.status)],
      ['目的', textOrNull(selectedEntity.goal)],
      ['有効期間', validityText(selectedEntity.validFrom, selectedEntity.validTo)],
    ]));
    panel.append(makeElement(doc, 'h4', { text: 'このプロジェクトとの関係' }), relationEvidence(doc, overviewEdges, selectedId, overviewEntities, payload.asOf, selectAndExplore));
    if (selectedId !== project.id && !fetched) {
      const failed = read?.state === 'failed';
      panel.append(workspaceNotice(doc, {
        label: failed ? '読み取り失敗' : read?.state === 'loading' ? '読み込み中' : '未接続',
        text: failed ? read.message : read?.state === 'loading' ? 'この記録の詳細を読み込んでいます。' : 'このホストでは記録の詳細取得先が接続されていません。',
        tone: failed ? 'danger' : 'info',
        role: failed ? 'alert' : 'status',
      }));
    }
    if (fetched?.entity) {
      const incoming = renderEntityRelations(doc, fetched.incoming, 'incoming', fetched.entity, payload.asOf, selectAndExplore);
      const outgoing = renderEntityRelations(doc, fetched.outgoing, 'outgoing', fetched.entity, payload.asOf, selectAndExplore);
      if (incoming) panel.append(makeElement(doc, 'h4', { text: '入ってくる関係' }), incoming);
      if (outgoing) panel.append(makeElement(doc, 'h4', { text: '出ていく関係' }), outgoing);
      const metadataValues = isRecord(fetched.entity.metadata) ? Object.entries(fetched.entity.metadata).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => [key, String(value)]) : [];
      if (metadataValues.length > 0) panel.append(makeElement(doc, 'h4', { text: 'メタデータ' }), workspaceDefinition(doc, metadataValues));
      panel.append(recordDetails(doc, [['記録ID', fetched.entity.id], ['digest', fetched.entity.digest], ['読み取った時点', fetched.asOf ?? payload.asOf]]));
    }
  }

  async function loadEntity(id) {
    const request = ++entityReadRequest;
    entityRead = { id, state: 'loading' };
    renderSelectedPanel();
    try {
      const result = await readEntity(id);
      if (destroyed || request !== entityReadRequest || selectedId !== id) return;
      const normalized = resultEntity(result);
      entityRead = normalized ? { id, ...normalized } : { id, state: 'failed', message: resultFailure(result) };
    } catch (error) {
      if (destroyed || request !== entityReadRequest || selectedId !== id) return;
      entityRead = { id, state: 'failed', message: firstText(error?.message) ?? 'この記録の詳細を読み取れませんでした。' };
    }
    if (entityRead?.entity) mergeEntityRead(entityRead);
    render();
  }

  function renderGraphPanel() {
    const panel = makeElement(doc, 'section', { className: 'bb-pkw-panel bb-pkw-graph-panel', attrs: { role: 'tabpanel', id: 'bb-pkw-panel-graph', 'aria-label': '情報を探す' } });
    const intro = makeElement(doc, 'div', { className: 'bb-pkw-graph-intro' });
    intro.append(makeElement(doc, 'div', { className: 'bb-pkw-section-title' }), makeElement(doc, 'p', { className: 'bb-pkw-muted', text: '線はGraphに記録された関係です。補足セクションの所属だけから線を作ることはありません。' }));
    intro.children[0].append(makeElement(doc, 'h3', { text: '関係をたどる' }), badge(doc, `${entities.size}件の記録 · ${edges.length}件の関係`, 'muted'));
    panel.append(intro);
    const filters = makeElement(doc, 'div', { className: 'bb-pkw-graph-filters', attrs: { 'aria-label': '記録一覧の絞り込み' } });
    filters.append(makeElement(doc, 'span', { className: 'bb-pkw-graph-filter-label', text: '記録一覧を絞り込む' }));
    const search = makeElement(doc, 'input', {
      className: 'bb-pkw-graph-search',
      attrs: { type: 'search', placeholder: '記録を検索', 'aria-label': '記録を検索' },
    });
    search.value = graphSearch;
    search.addEventListener('input', () => {
      graphSearch = search.value ?? '';
      renderGraphList();
    });
    const type = makeElement(doc, 'select', { className: 'bb-pkw-graph-type', attrs: { 'aria-label': '種類で絞り込む' } });
    type.append(makeElement(doc, 'option', { text: 'すべての種類', attrs: { value: '' } }));
    for (const value of new Set([...entities.values()].map((entity) => entity.type))) {
      type.append(makeElement(doc, 'option', { text: typeLabel(value), attrs: { value } }));
    }
    type.value = graphType;
    type.addEventListener('change', () => {
      graphType = type.value ?? '';
      renderGraphList();
    });
    filters.append(search, type);
    panel.append(filters);
    const graph = makeElement(doc, 'div', { className: 'bb-pkw-graph' });
    const canvas = makeElement(doc, 'div', { className: 'bb-pkw-graph-canvas', attrs: { 'aria-label': 'プロジェクトの関係グラフ' } });
    graph.append(canvas);
    if (graphFailure) graph.append(workspaceNotice(doc, { label: 'グラフを表示できません', text: '一覧から関係を確認できます。', tone: 'warning' }));
    graph.append(graphList);
    const selected = makeElement(doc, 'section', { className: 'bb-pkw-selection', attrs: { 'aria-label': '選択した記録' } });
    selectedPanel = selected;
    graph.append(selected);
    panel.append(graph);
    renderGraphList();
    renderSelectedPanel();
    if (activeTab === 'graph' && typeof mountGraph === 'function' && !graphFailure) {
      const nodes = [...entities.values()].map((entity) => ({ id: entity.id, label: entity.name, type: entity.type }));
      const initialSelectedId = selectedId;
      const token = ++graphMountToken;
      const mount = () => {
        graphTimer = null;
        if (destroyed || token !== graphMountToken || graphHandle) return;
        Promise.resolve()
          .then(() => mountGraph(canvas, { nodes, edges, selectedId: initialSelectedId, onSelect: (id) => select(id, { fromGraph: true }) }))
          .then((handle) => {
            if (destroyed || token !== graphMountToken || activeTab !== 'graph') {
              handle?.destroy?.();
              return;
            }
            graphHandle = handle ?? null;
            if (selectedId !== initialSelectedId) graphHandle?.select?.(selectedId);
          })
          .catch(() => {
            if (destroyed || token !== graphMountToken || activeTab !== 'graph') return;
            graphFailure = true;
            graph.append(workspaceNotice(doc, { label: 'グラフを表示できません', text: '一覧から関係を確認できます。', tone: 'warning' }));
          });
      };
      graphTimer = typeof setTimeout === 'function' ? setTimeout(mount, 0) : null;
      if (graphTimer === null && typeof queueMicrotask === 'function') queueMicrotask(mount);
    } else if (typeof mountGraph !== 'function') {
      graph.append(makeElement(doc, 'p', { className: 'bb-pkw-muted', text: 'グラフ表示はこのホストで未接続です。一覧から関係を確認できます。' }));
    }
    return panel;
  }

  function teardownGraph() {
    graphMountToken += 1;
    if (graphTimer !== null && typeof clearTimeout === 'function') clearTimeout(graphTimer);
    graphTimer = null;
    if (graphHandle?.destroy) graphHandle.destroy();
    graphHandle = null;
  }

  function replaceContextBlock(nextContext) {
    currentContext = nextContext;
    if (destroyed) return;
    const nextBlock = renderProjectContext(doc, currentContext);
    if (!nextBlock) {
      if (contextBlock?.parentNode?.removeChild) contextBlock.parentNode.removeChild(contextBlock);
      contextBlock = null;
      return;
    }
    if (contextBlock?.parentNode && typeof contextBlock.parentNode.replaceChild === 'function') {
      contextBlock.parentNode.replaceChild(nextBlock, contextBlock);
      contextBlock = nextBlock;
      return;
    }
    if (contextBlock?.replaceWith) {
      contextBlock.replaceWith(nextBlock);
      contextBlock = nextBlock;
      return;
    }
    if (overviewPanel && !contextBlock) {
      overviewPanel.append(nextBlock);
      contextBlock = nextBlock;
    }
  }

  function render() {
    if (destroyed) return;
    if (typeof onTabChange === 'function') onTabChange(activeTab);
    teardownGraph();
    tabs.replaceChildren(tabButton('概要', 'overview'), tabButton('情報を探す', 'graph'));
    panels.replaceChildren();
    contextBlock = null;
    const overview = renderOverview(doc, payload, currentContext, overviewEdges, overviewEntities, selectAndExplore, (node) => { contextBlock = node; });
    overview.id = 'bb-pkw-panel-overview';
    overview.hidden = activeTab !== 'overview';
    overviewPanel = overview;
    panels.append(overview);
    const graph = renderGraphPanel();
    graph.hidden = activeTab !== 'graph';
    panels.append(graph);
  }

  function destroy() {
    destroyed = true;
    entityReadRequest += 1;
    teardownGraph();
    if (typeof onTabChange === 'function') onTabChange('overview');
  }

  render();
  return Object.freeze({ element: root, destroy, select, setTab, setContext: replaceContextBlock });
}

export default createProjectKnowledgeWorkspace;
