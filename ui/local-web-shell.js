/*
 * Shell of the local single-owner Web host (`brainbase web:serve`).
 *
 * It renders the organization edition's layout — a dark left rail with the
 * brand, the navigation and the source (data directory, Graph format,
 * organization Graph), a paper workspace, and a right detail rail for the
 * selected item — and mounts one screen per nav item. Each screen gets its own
 * rail slot and the page context (breadcrumb and source label) to put in its
 * page head, as the organization edition's screens do.  Only
 * screens that exist are listed.  A screen that reads the Graph is not
 * mounted until the host reports Graph v2; a v1 Graph shows the migration
 * commands instead of zero items, and the host never migrates by itself.
 *
 * Public screens are listed in LOCAL_WEB_SCREENS. Private products pass an
 * extended `screens` list through LocalWebHostOptions.extensions.
 */

import { createGraphProjectsView } from './graph-projects-view.js';
import { createGraphRegistryView } from './graph-registry-view.js';
import { createObjectiveEditorController } from './objective-editor.js';
import { createObjectiveEditorHttpPort } from './objective-editor-http-port.js';
import { createJudgmentHistoryUI } from './judgment-history.js';
import { createWorldModelView } from './world-model-view.js';
import { createGraphClient } from './graph-view-shared.js';

export const LOCAL_WEB_SHELL_CONTRACT_VERSION = 'brainbase.local-web-shell.v1';

const GRAPH_FORMAT_LABELS = Object.freeze({
  ready: (graph) => (graph.format === 'v2' ? 'v2' : String(graph.format ?? '不明')),
  migration_required: () => 'v1（移行が必要）',
  not_initialized: () => '未作成',
  unreadable: () => '読み取れません',
});

const UNREADABLE_LABELS = Object.freeze({
  authorization_denied: '読む権限がない',
  scope_violation: '扱える範囲の外',
});

// Stroke icons from the organization edition's sprite (apps/web/public/index.html).
const NAV_ICON_PATHS = Object.freeze({
  today: ['M5 20V10m7 10V4m7 16v-7'],
  objectives: ['M12 4 3 20h18z', 'M12 9v5m0 3h.01'],
  projects: ['M3 6.5h7l2 2h9v10H3z', 'M3 6.5v-2h7l2 2'],
  graph: ['M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2', 'M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2'],
  // World view (extension id `world`, ledger P17).
  world: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z'],
});
const SVG_NS = 'http://www.w3.org/2000/svg';

function makeIcon(doc, id) {
  const paths = NAV_ICON_PATHS[id] ?? NAV_ICON_PATHS.today;
  const create = (tag) => (typeof doc.createElementNS === 'function' ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag));
  const svg = create('svg');
  svg.setAttribute('class', 'bb-shell-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = create('path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function makeElement(doc, tag, { className, text, attrs = {} } = {}) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  return element;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parses the local shell's hash target without treating query data as a
 * screen id.  Only the Graph screen accepts an entity target; all other
 * screens deliberately discard query parameters.
 */
export function parseLocalWebTarget(target) {
  const raw = typeof target === 'string' ? target.replace(/^#/, '') : '';
  const separator = raw.indexOf('?');
  const screenId = separator < 0 ? raw : raw.slice(0, separator);
  if (!screenId) return { screenId: null, entityId: null };
  const query = separator < 0 ? '' : raw.slice(separator + 1);
  const params = new URLSearchParams(query);
  // 今日 accepts one judgment to open (`decision` = decision_attempt_id) and
  // プロジェクトと関係者 one project (`project` = Graph project id); other screens ignore them.
  const decisionId = screenId === 'today' ? params.get('decision')?.trim() || null : null;
  const projectId = screenId === 'projects' ? params.get('project')?.trim() || null : null;
  return {
    screenId,
    entityId: screenId === 'graph' ? params.get('entity_id')?.trim() || null : null,
    ...(decisionId ? { decisionId } : {}),
    ...(projectId ? { projectId } : {}),
  };
}

function graphSourceReader(context) {
  const client = createGraphClient({ fetcher: context.fetcher, basePath: '/api/graph', token: context.token });
  return async (source) => {
    if (!isRecord(source) || source.kind !== 'local_graph'
      || typeof source.entity_id !== 'string' || !source.entity_id.trim()
      || typeof source.entity_type !== 'string' || !source.entity_type.trim()) {
      return { state: 'unavailable', reason: 'source_contract_invalid' };
    }
    const result = await client.read(`/entities/${encodeURIComponent(source.entity_id)}`);
    if (result.state === 'error') {
      if (result.status === 404 || result.code === 'entity_not_found') return { state: 'not_found' };
      if (result.status === 403 || result.code === 'authorization_denied' || result.code === 'scope_violation') return { state: 'forbidden' };
      if (result.code === 'entity_id_ambiguous') return { state: 'ambiguous' };
      return { state: 'unavailable', reason: result.code };
    }
    if (result.state !== 'ok' || !isRecord(result.payload?.entity)) return { state: 'unavailable', reason: 'source_response_invalid' };
    const entity = result.payload.entity;
    if (entity.id !== source.entity_id || entity.type !== source.entity_type) {
      return { state: 'unavailable', reason: 'source_target_mismatch' };
    }
    if (source.digest && entity.digest !== source.digest) {
      return { state: 'unavailable', reason: 'source_digest_mismatch' };
    }
    // The local Graph response currently exposes a content digest, not a
    // revision number.  A requested version is therefore linkable only when
    // the provider returns the same explicit version field.
    if (source.version) {
      const currentVersion = entity.version ?? entity.revision ?? null;
      if (!currentVersion || currentVersion !== source.version) {
        return { state: 'unavailable', reason: 'source_version_mismatch' };
      }
    }
    return { state: 'available' };
  };
}

function makePage(container, context) {
  const page = makeElement(context.document, 'div', { className: 'bb-shell-page' });
  container.append(page);
  return page;
}

function mountToday(container, context) {
  return createJudgmentHistoryUI({
    root: makePage(container, context),
    rail: context.rail,
    page: context.page,
    document: context.document,
    fetcher: context.fetcher,
    token: context.token,
    basePath: '/api/value-proofs',
  });
}

function renderUnreadableObjectives(doc, slot, payload) {
  slot.replaceChildren();
  const count = Number.isInteger(payload?.unreadable?.count) ? payload.unreadable.count : 0;
  if (count <= 0) return;
  const reasons = (Array.isArray(payload.unreadable.codes) ? payload.unreadable.codes : [])
    .map((code) => UNREADABLE_LABELS[code] ?? code).join('、');
  slot.append(makeElement(doc, 'p', {
    className: 'bb-shell-notice is-warning',
    text: `読めない目的が${count}件あります${reasons ? `（${reasons}）` : ''}。読めた目的だけを一覧にしています。`,
    attrs: { role: 'alert' },
  }));
}

function mountObjectives(container, context) {
  const doc = context.document;
  const page = makePage(container, context);
  const unreadable = makeElement(doc, 'div', { className: 'bb-shell-slot' });
  const editorRoot = makeElement(doc, 'div', { className: 'bb-shell-objectives' });
  const worldRoot = makeElement(doc, 'div', { className: 'bb-shell-world-model' });
  // The unreadable-objectives notice belongs under the objectives, not above the page head.
  page.append(editorRoot, unreadable, worldRoot);
  const port = createObjectiveEditorHttpPort({
    fetcher: context.fetcher,
    token: context.token,
    onListResult: (payload) => renderUnreadableObjectives(doc, unreadable, payload),
  });
  const editor = createObjectiveEditorController({
    root: editorRoot,
    rail: context.rail,
    page: context.page,
    port,
    // The principal is decided by the host from the local Graph owner.
    context: {},
    canEdit: true,
    constraintsEditable: false,
    storyLinks: false,
  });
  const worldModel = createWorldModelView({
    root: worldRoot,
    rail: context.rail,
    document: doc,
    fetcher: context.fetcher,
    token: context.token,
  });
  return { editor, worldModel };
}

function mountGraphScreen(screenId, createView) {
  return (container, context) => {
    const viewRoot = makeElement(context.document, 'div');
    makePage(container, context).append(viewRoot);
    return createView({
      root: viewRoot,
      rail: context.rail,
      page: context.page,
      document: context.document,
      fetcher: context.fetcher,
      token: context.token,
      initialEntityId: context.initialEntityId,
    });
  };
}

export const LOCAL_WEB_SCREENS = Object.freeze([
  Object.freeze({ id: 'today', label: '今日', usesGraph: false, rail: true, source: '判断の記録', mount: mountToday }),
  Object.freeze({ id: 'objectives', label: '目的と現状', usesGraph: true, rail: true, source: '手元のGraph', mount: mountObjectives }),
  Object.freeze({ id: 'projects', label: 'プロジェクトと関係者', usesGraph: true, rail: true, source: '手元のGraph', mount: mountGraphScreen('projects', createGraphProjectsView) }),
  Object.freeze({ id: 'graph', label: '情報と関係', usesGraph: true, rail: true, source: '手元のGraph', mount: mountGraphScreen('graph', createGraphRegistryView) }),
]);

function renderGraphGate(doc, slot, status, onRecheck, label) {
  slot.replaceChildren();
  const box = makeElement(doc, 'section', { className: 'bb-shell-gate', attrs: { role: 'alert' } });
  if (status.phase !== 'ready') {
    box.append(
      makeElement(doc, 'h2', { text: status.phase === 'loading' ? 'データの状態を確認しています' : 'データの状態を確認できません' }),
      makeElement(doc, 'p', { text: status.phase === 'loading' ? '確認が終わるまで、この画面の内容は表示しません。' : `理由: ${status.error ?? '不明'}。0件ではありません。` }),
    );
  } else {
    const graph = status.data.graph;
    const title = graph.status === 'migration_required' ? 'Graphの移行が必要です'
      : graph.status === 'not_initialized' ? 'Brainbaseのデータがまだありません'
        : 'データを読み取れません';
    const lead = graph.status === 'migration_required'
      ? `このデータはGraph v1のため、「${label}」を読み書きできません。0件ではありません。ホストは自動で移行しません。次のコマンドで、内容を確かめてから移行してください。`
      : graph.status === 'not_initialized'
        ? `データの場所（${status.data.data_dir}）に正本のファイルがありません。次のコマンドで作成できます。`
        : `理由: ${graph.message ?? '不明'}。0件ではありません。`;
    box.append(makeElement(doc, 'h2', { text: title }), makeElement(doc, 'p', { text: lead }));
    const commands = Array.isArray(graph.commands) ? graph.commands.filter((command) => typeof command === 'string') : [];
    if (commands.length > 0) {
      const list = makeElement(doc, 'ol', { className: 'bb-shell-commands' });
      for (const command of commands) {
        const item = makeElement(doc, 'li');
        item.append(makeElement(doc, 'code', { text: command }));
        list.append(item);
      }
      box.append(list);
    }
  }
  if (status.phase !== 'loading') {
    const recheck = makeElement(doc, 'button', { className: 'bb-shell-button', text: '再確認', attrs: { type: 'button' } });
    recheck.addEventListener('click', () => void onRecheck());
    box.append(recheck);
  }
  slot.append(box);
}

function renderSource(doc, bar, status, onRecheck) {
  bar.replaceChildren();
  if (status.phase === 'loading') {
    bar.append(makeElement(doc, 'span', { text: 'データの場所を確認しています。' }));
    return;
  }
  if (status.phase === 'error') {
    bar.append(makeElement(doc, 'span', { className: 'is-danger', text: `データの状態を確認できません（${status.error ?? '不明'}）。` }));
    const retry = makeElement(doc, 'button', { className: 'bb-shell-link-button', text: '再確認', attrs: { type: 'button' } });
    retry.addEventListener('click', () => void onRecheck());
    bar.append(retry);
    return;
  }
  const { data } = status;
  const graphLabel = (GRAPH_FORMAT_LABELS[data.graph.status] ?? (() => '不明'))(data.graph);
  const fact = (label, value, className) => {
    const item = makeElement(doc, 'span', { className: `bb-shell-fact${className ? ` ${className}` : ''}` });
    item.append(makeElement(doc, 'span', { className: 'bb-shell-fact-label', text: label }), makeElement(doc, 'span', { className: 'bb-shell-fact-value', text: value }));
    return item;
  };
  bar.append(
    fact('データ', data.data_dir),
    fact('Graph', graphLabel, data.graph.status === 'ready' ? '' : 'is-warning'),
  );
}

function normalizeStatus(payload) {
  if (!isRecord(payload) || typeof payload.data_dir !== 'string' || !isRecord(payload.graph) || typeof payload.graph.status !== 'string') {
    return null;
  }
  return payload;
}

export function createLocalWebShell({
  root,
  document: explicitDocument,
  fetcher,
  token,
  statusPath = '/api/local/status',
  screens = LOCAL_WEB_SCREENS,
  initialScreen,
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = explicitDocument ?? (typeof document === 'undefined' ? null : document);
  if (!doc || typeof doc.createElement !== 'function') throw new Error('document_unavailable');
  const request = typeof fetcher === 'function'
    ? fetcher
    : typeof globalThis.fetch === 'function' ? (path, init) => globalThis.fetch(path, init) : null;
  const context = Object.freeze({ document: doc, fetcher: request, token });

  const status = { phase: 'loading', data: null, error: null };
  const mounted = new Map();
  const slots = new Map();
  const links = new Map();
  const pendingEntityIds = new Map();
  let active = null;

  const shell = makeElement(doc, 'div', { className: 'bb-shell', attrs: { 'data-contract-version': LOCAL_WEB_SHELL_CONTRACT_VERSION } });
  const sidebar = makeElement(doc, 'aside', { className: 'bb-shell-sidebar', attrs: { id: 'bb-shell-sidebar', 'aria-label': '主ナビゲーション' } });
  const brand = makeElement(doc, 'div', { className: 'bb-shell-brand', text: 'Brainbase' });
  const nav = makeElement(doc, 'nav', { className: 'bb-shell-nav', attrs: { 'aria-label': '画面' } });
  const menuButton = makeElement(doc, 'button', {
    className: 'bb-shell-menu-button',
    text: 'メニュー',
    attrs: { type: 'button', 'aria-controls': 'bb-shell-sidebar', 'aria-expanded': 'false' },
  });
  const backdrop = makeElement(doc, 'button', { className: 'bb-shell-backdrop', attrs: { type: 'button', 'aria-label': 'メニューを閉じる', tabindex: '-1' } });
  const setMenuOpen = (open) => {
    sidebar.className = open ? 'bb-shell-sidebar is-open' : 'bb-shell-sidebar';
    backdrop.className = open ? 'bb-shell-backdrop is-open' : 'bb-shell-backdrop';
    menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  menuButton.addEventListener('click', () => setMenuOpen(!sidebar.className.includes('is-open')));
  backdrop.addEventListener('click', () => setMenuOpen(false));
  for (const screen of screens) {
    const link = makeElement(doc, 'a', { className: 'bb-shell-nav-link', text: screen.label, attrs: { href: `#${screen.id}` } });
    // The label stays the link's own text; the icon goes in front where the DOM allows it.
    if (typeof link.prepend === 'function') link.prepend(makeIcon(doc, screen.id));
    link.addEventListener('click', () => {
      setMenuOpen(false);
      controller.show(screen.id);
    });
    links.set(screen.id, link);
    nav.append(link);
  }
  const source = makeElement(doc, 'section', { className: 'bb-shell-source', attrs: { 'aria-label': '出典' } });
  sidebar.append(brand, nav, source);
  const workspace = makeElement(doc, 'div', { className: 'bb-shell-workspace' });
  const mobileBar = makeElement(doc, 'div', { className: 'bb-shell-mobile-bar' });
  mobileBar.append(makeElement(doc, 'strong', { text: 'Brainbase' }), menuButton);
  const main = makeElement(doc, 'main', { className: 'bb-shell-main' });
  for (const screen of screens) {
    const slot = makeElement(doc, 'section', { className: 'bb-shell-screen', attrs: { 'data-screen': screen.id, 'aria-label': screen.label } });
    slot.hidden = true;
    slots.set(screen.id, slot);
    main.append(slot);
  }
  workspace.append(mobileBar, main);
  const railAside = makeElement(doc, 'aside', { className: 'bb-shell-rail', attrs: { 'aria-label': '選択中の項目' } });
  const rails = new Map();
  for (const screen of screens) {
    if (!screen.rail) continue;
    const railSlot = makeElement(doc, 'div', { className: 'bb-shell-rail-slot', attrs: { 'data-rail': screen.id } });
    railSlot.hidden = true;
    rails.set(screen.id, railSlot);
    railAside.append(railSlot);
  }
  shell.append(sidebar, backdrop, workspace, railAside);
  root.replaceChildren(shell);

  // The rail column shows only while the active screen is mounted and has one.
  function updateRail() {
    const showRail = rails.has(active) && mounted.has(active);
    shell.className = showRail ? 'bb-shell has-rail' : 'bb-shell';
    railAside.hidden = !showRail;
    for (const [screenId, railSlot] of rails) railSlot.hidden = !(showRail && screenId === active);
  }

  function ensureMounted(screen, entityId = pendingEntityIds.get(screen.id) ?? null) {
    if (mounted.has(screen.id)) {
      const view = mounted.get(screen.id);
      if (entityId && screen.id === 'graph' && typeof view?.openEntity === 'function') void view.openEntity(entityId);
      if (entityId && screen.id === 'today' && typeof view?.openDecision === 'function') view.openDecision(entityId);
      if (entityId && screen.id === 'projects' && typeof view?.openProject === 'function') void view.openProject(entityId);
      return;
    }
    const slot = slots.get(screen.id);
    if (screen.usesGraph && !(status.phase === 'ready' && status.data.graph.status === 'ready')) {
      renderGraphGate(doc, slot, status, controller.refreshStatus, screen.label);
      return;
    }
    slot.replaceChildren();
    const rail = rails.get(screen.id) ?? null;
    rail?.replaceChildren();
    const page = Object.freeze({ crumbs: Object.freeze(['あなたのBrainbase', screen.label]), source: screen.source ?? null });
    const view = screen.mount(slot, Object.freeze({ ...context, rail, page, initialEntityId: entityId })) ?? true;
    mounted.set(screen.id, view);
    if (entityId && screen.id === 'today' && typeof view?.openDecision === 'function') view.openDecision(entityId);
    if (entityId && screen.id === 'projects' && typeof view?.openProject === 'function') void view.openProject(entityId);
    updateRail();
  }

  const controller = {
    get state() {
      return { active, status, mounted: [...mounted.keys()] };
    },
    show(target) {
      const parsed = parseLocalWebTarget(target);
      const screen = screens.find((candidate) => candidate.id === parsed.screenId) ?? screens[0];
      pendingEntityIds.set(screen.id, screen.id === 'graph' ? parsed.entityId
        : screen.id === 'today' ? parsed.decisionId ?? null
          : screen.id === 'projects' ? parsed.projectId ?? null : null);
      active = screen.id;
      for (const [screenId, slot] of slots) slot.hidden = screenId !== screen.id;
      for (const [screenId, link] of links) {
        if (screenId === screen.id) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      ensureMounted(screen, pendingEntityIds.get(screen.id));
      updateRail();
      return controller;
    },
    async refreshStatus() {
      status.phase = 'loading';
      status.error = null;
      renderSource(doc, source, status, controller.refreshStatus);
      try {
        if (!request) throw new Error('取得先が設定されていません');
        const response = await request(statusPath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = normalizeStatus(await response.json());
        if (!data) throw new Error('応答の形式が不正です');
        status.phase = 'ready';
        status.data = data;
      } catch (error) {
        status.phase = 'error';
        status.data = null;
        status.error = error instanceof Error ? error.message : 'request_failed';
      }
      renderSource(doc, source, status, controller.refreshStatus);
      // Re-evaluate Graph-backed screens that are waiting behind the gate.
      for (const screen of screens) {
        if (screen.usesGraph && !mounted.has(screen.id) && (screen.id === active)) ensureMounted(screen, pendingEntityIds.get(screen.id));
      }
      return status;
    },
  };

  renderSource(doc, source, status, controller.refreshStatus);
  controller.show(initialScreen);
  void controller.refreshStatus();
  return controller;
}

export default createLocalWebShell;
