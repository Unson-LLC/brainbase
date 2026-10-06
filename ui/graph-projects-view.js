/*
 * 「プロジェクトと関係者」: which projects exist, who takes part in or is
 * accountable for each one, and whether that record is right.
 *
 * Built on the organization edition's screen pattern (workspace kit): the
 * workspace has the page head, the source notice, summary metrics and the
 * project ledger; the right rail has the selected project — its outline, each
 * 関係者 and the corrections.  The first project is selected on load when the
 * host has not provided a selection.
 *
 * Reads `GET {base}/projects` and `GET {base}/projects/:id` and corrects
 * through `POST {base}/corrections` (see `graph-view-shared.js`).  「関係者」
 * are the people recorded as taking part in or being accountable for a
 * project; they are not logins or sharing settings.  Participation ends with
 * an end date and is never deleted.  The host injects the fetcher, base path,
 * launch token, right rail and page context; this module keeps no global state.
 *
 * Another host composes this part unchanged and adds only its own controls
 * through the options of `createGraphProjectsView` (read-only or partial
 * corrections, its source notice, page-head buttons, extra metrics, rail blocks,
 * selection sync, and the owner's own share in a separate section; see
 * `graph-own-share.js`).  Every option defaults to the behaviour above.
 */

import {
  activityBadge,
  badge,
  createGraphClient,
  createGraphCorrection,
  createGraphLayout,
  focusLedgerRow,
  getDocument,
  graphCommandList,
  graphCorrectionScope,
  graphPageContext,
  graphStateNotice,
  hostReadOnlyNote,
  hostSourceNotice,
  isEdgeView,
  isEntityView,
  isRecord,
  makeElement,
  ownLabel,
  readOnlyGraphClient,
  recordDetails,
  relationLabel,
  renderCorrectionHistory,
  renderGraphIssues,
  renderProvenance,
  shellArg,
  textOrNull,
  validityLabel,
  validityText,
  GRAPH_CORRECTION_FIELDS,
  GRAPH_RELATION_LABELS,
  graphHostEmptyNotice,
} from './graph-view-shared.js';
import { graphOwnShareSource, ownProjectDetail, ownShareSection, ownShareStateNotice } from './graph-own-share.js';
import { renderProjectIcon } from './project-icon.js';
import {
  createProjectKnowledgeWorkspace,
  normalizeProjectContext,
  renderProjectContext,
  renderProjectKnowledgeSkeleton,
} from './project-workspace.js';
import { mountProjectGraph as defaultMountProjectGraph } from './project-graph.js';
import {
  workspaceActions,
  workspaceButton,
  workspaceDefinition,
  workspaceDetailEmpty,
  workspaceHostActions,
  workspaceHostNotice,
  workspaceLedger,
  workspaceMetrics,
  workspaceNotice,
  workspacePageHeader,
  workspaceRailBlock,
  workspaceRailHead,
} from './workspace-kit.js';

export const GRAPH_PROJECTS_VIEW_CONTRACT_VERSION = 'brainbase.graph-projects-view.v2';

/** The two ways a person is related to a project in the OSS Graph. */
export const PARTICIPATION_LABELS = Object.freeze({ participates_in: '参加', accountable_for: '責任' });

export const GRAPH_PROJECT_LEDGER_COLUMNS = Object.freeze(['プロジェクト', '目的', '責任を持つ人', '状態', '関係者', '有効期間']);

const INVALID = Object.freeze({ state: 'invalid', reason: '応答の形式が不正です' });

function isProjectPerson(value) {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.accountable === 'boolean';
}

function isProjectItem(value) {
  return isEntityView(value) && value.type === 'project'
    && Number.isInteger(value.participantCount) && Number.isInteger(value.accountableCount)
    && (value.people === undefined || (Array.isArray(value.people) && value.people.every(isProjectPerson)));
}

/**
 * A project list is shown only when it is well formed.  An empty list is
 * `ok` only when the host confirmed that no project exists; otherwise the
 * absence is `unknown`, never zero items.
 */
export function normalizeProjectList(result) {
  if (result?.state !== 'ok') return result ?? INVALID;
  const payload = result.payload;
  if (!Array.isArray(payload.projects) || !payload.projects.every(isProjectItem)) return INVALID;
  if (payload.projects.length === 0 && payload.absenceConfirmed !== true) return { state: 'unknown' };
  return { state: 'ok', payload };
}

export function normalizeProjectDetail(result) {
  if (result?.state !== 'ok') return result ?? INVALID;
  const payload = result.payload;
  const project = payload.project;
  if (!isEntityView(project) || project.type !== 'project') return INVALID;
  if (!Array.isArray(payload.participants) || !payload.participants.every(isEdgeView)) return INVALID;
  if (payload.relations !== undefined && (!Array.isArray(payload.relations) || !payload.relations.every(isEdgeView))) return INVALID;
  return { state: 'ok', payload };
}

/**
 * The summary metrics.  関係者 counts each person once across projects and is
 * `null` (未確認, never zero) when the host did not name the people.
 */
export function summarizeProjects(projects) {
  const active = projects.filter((project) => project.active === true);
  const named = projects.every((project) => Array.isArray(project.people));
  return {
    total: projects.length,
    active: active.length,
    inProgress: active.filter((project) => textOrNull(project.status) === '進行中').length,
    people: named ? new Set(projects.flatMap((project) => project.people.map((person) => person.id))).size : null,
  };
}

function accountableCell(project) {
  if (Array.isArray(project.people)) {
    const names = project.people.filter((person) => person.accountable).map((person) => person.name);
    return names.length > 0 ? names.join('、') : { text: '未登録', className: 'is-unresolved' };
  }
  return project.accountableCount > 0 ? `${project.accountableCount}人` : { text: '未登録', className: 'is-unresolved' };
}

function textCell(value, fallback) {
  return textOrNull(value) ?? { text: fallback, className: 'is-unresolved' };
}

function isNode(value) {
  return value !== null && typeof value === 'object' && (typeof value.tagName === 'string' || typeof value.nodeType === 'number');
}

function failureText(error) {
  return textOrNull(error instanceof Error ? error.message : typeof error === 'string' ? error : null) ?? '理由不明';
}

/**
 * A host may know the selected project's identity before its Graph list is
 * available.  Keep this boundary deliberately small: the early shell only
 * accepts an id and display name, and never treats a host summary as Graph
 * data such as goal, status or participant counts.
 */
function normalizeProjectSummary(value) {
  if (!isRecord(value)) return null;
  const id = textOrNull(value.id ?? value.code);
  if (!id) return null;
  return { id, name: textOrNull(value.name) ?? id };
}

/**
 * Mounts 「プロジェクトと関係者」.
 *
 * @param {object} options
 * @param {Element} options.root Where the workspace is drawn.
 * @param {Element} [options.rail] The host's right rail; without it the rail content follows the workspace inside `root`.
 * @param {{ crumbs?: string[], source?: string }} [options.page] Breadcrumb and source label of the page head.
 * @param {Document} [options.document] The document to build elements with (default: the global one).
 * @param {Function} [options.fetcher] `fetch`-compatible function for the Graph routes.
 * @param {string} [options.basePath='/api/graph'] Where the Graph routes are served.
 * @param {string} [options.token] Launch token sent with a correction.
 * @param {string} [options.tokenHeader] Header name for the token.
 * @param {boolean} [options.autoLoad=true] Reads the list on mount.
 * @param {() => Date} [options.now] The owner's clock (end-date default).
 * @param {boolean} [options.canCorrect=true] When false, no correction control is drawn anywhere
 *   (関係者を加える, 役割を直す, 関わりを終える / 終了日を直す, プロジェクトを直す, and the pointer to
 *   corrections under そのほかの関係), and the client refuses every correction before sending it.
 * @param {{ entityTypes?: string[], fields?: string[], edges?: boolean, createEdges?: boolean }} [options.correctionScope]
 *   With corrections allowed, only these (see `graphCorrectionScope`): `entityTypes: ['project']` keeps
 *   プロジェクトを直す, `fields` limits its form, `edges: false` withholds 役割を直す and 関わりを終える /
 *   終了日を直す, and `createEdges: false` withholds 関係者を加える.  A withheld control is not drawn and the
 *   client refuses such a correction before sending it.  Without it every correction is allowed.
 * @param {string | ((record: { id: string, type: string | null, metadata: object } | null) => string | Element | null)} [options.readOnlyNote]
 *   With `canCorrect: false`, or where `correctionScope` withholds a
 *   control of the selected project, a note shown in the rail where the correction buttons would be.
 *   Without it the rail says nothing about corrections.
 * @param {{ label?: string, text: string | Element }} [options.emptyNotice] Replaces the 未登録 notice
 *   and its `brainbase onboard:*` commands when the host's Graph has nothing registered.
 * @param {{ label?: string, text: string | Element }} [options.sourceNotice] Replaces the default 出典
 *   notice.  The rail's 概要 then drops its default 出典 row, which names this Mac's Graph.
 * @param {Array<{ text: string, variant?: 'default' | 'primary' | 'danger' | 'quiet', onClick?: Function, disabled?: boolean }>} [options.pageActions]
 *   Extra buttons in the page head, owned by the host.  Read on every render, so a host may change
 *   an item and call `render()`.
 * @param {(listPayload: object) => Array<{ label: string, value: string | number | null, note?: string }>} [options.extraMetrics]
 *   Metrics appended after the built-in ones while the list is shown; `value: null` shows 未確認.
 *   A throw is shown as a notice instead of breaking the workspace.
 * @param {(projectId: string, detailPayload: object | null, helpers: { document: Document }) => Node | Node[] | null} [options.renderRailExtensions]
 *   Host-owned blocks appended in the rail after 関係者 (before そのほかの関係 and the corrections
 *   history).  Called synchronously on every rail render while a project is selected, with the read
 *   project detail, or null while it loads or when it could not be read.  A throw or a value that is
 *   not a node is shown as a small danger notice instead of breaking the rail.
 * @param {string} [options.selectedId] The project to select first. When it
 *   is absent, the first project is selected. When it is not in the list, the
 *   requested id stays selected and the rail shows not found.
 * @param {(id: string) => void} [options.onSelect] Called when the view changes the selection itself
 *   (a ledger row, or the automatic first project).  Not called for `select(id)`.
 * @param {{ basePath: string, fetcher?: Function, label?: string }} [options.ownShare]
 *   The owner's own snapshot the host keeps for them (`graph-own-share.js`): its projects are read
 *   from `{basePath}/projects` and shown read-only in a separate section after the host's content,
 *   labelled 「引き継いだ自分の分（組織には未反映）」 unless `label` says otherwise.  They are never
 *   added to the ledger, the metrics or the rail, and a failed read shows only in that section.
 *   Without it nothing of the kind is drawn or read.
 * @param {(projectId: string, options?: { onProgress?: (snapshot: object) => void }) => Promise<object>} [options.loadProjectContext]
 *   Optional read-only supplementary sections (tasks/knowledge). The host may
 *   call `onProgress` with a complete `{ sections: [...] }` snapshot as each
 *   section resolves; a failed context read is kept separate from the Graph
 *   detail read.
 * @param {Array<{ id: string, name?: string }> | (() => Array<{ id: string, name?: string }>)} [options.projectSummaries]
 *   Optional host-known project identities.  These are used only to draw the
 *   selected project's early loading shell before the Graph list is read.
 * @param {(container: Element, options: object) => { destroy?: Function }} [options.mountProjectGraph]
 *   Host-injected Sigma.js graph mount. When omitted, the shared browser
 *   entry is used. The workspace keeps an accessible relation list when
 *   mounting is unavailable or fails.
 * @returns The controller: `state`, `correction`, `render()`, `load()`, `loadDetail(id)`,
 *   `selectProject(id)`, `openProject(id)`, `select(id)` for the host's own navigation, and with
 *   `ownShare` `loadOwn()` and `selectOwnProject(id)`.
 */
export function createGraphProjectsView({
  root,
  rail,
  page,
  document: explicitDocument,
  fetcher,
  basePath = '/api/graph',
  token,
  tokenHeader,
  autoLoad = true,
  now = () => new Date(),
  canCorrect = true,
  correctionScope,
  readOnlyNote,
  sourceNotice,
  emptyNotice,
  pageActions,
  extraMetrics,
  showProjectLedger = true,
  renderRailExtensions,
  selectedId: initialSelectedId,
  onSelect,
  ownShare,
  loadProjectContext,
  projectSummaries,
  mountProjectGraph,
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = getDocument(explicitDocument);
  const graphClient = createGraphClient({ fetcher, basePath, token, ...(tokenHeader ? { tokenHeader } : {}) });
  const projectGraphMount = typeof mountProjectGraph === 'function' ? mountProjectGraph : defaultMountProjectGraph;
  const own = graphOwnShareSource(ownShare, { fetcher });
  const writable = canCorrect !== false;
  const client = writable ? graphClient : readOnlyGraphClient(graphClient);
  const scope = graphCorrectionScope(correctionScope);
  // Relations are corrected only when the host allows it (here and under そのほかの関係).
  const edgesWritable = writable && scope.edges;
  const context = graphPageContext(page);
  const layout = createGraphLayout(doc, {
    root,
    rail,
    label: 'プロジェクトと関係者',
    className: 'bb-gp',
    contractVersion: GRAPH_PROJECTS_VIEW_CONTRACT_VERSION,
  });
  // `panelAt` is where the open correction shows: a relation id (inside that
  // 関係者) or anything else (below the project actions).
  const state = {
    list: { state: 'loading' },
    selectedId: textOrNull(initialSelectedId),
    detail: null,
    context: null,
    panelAt: null,
    // The owner's own share: its own list and selection, apart from the host's.
    own: own ? { list: { state: 'loading' }, selectedId: null, detail: null } : null,
  };
  let focusRow = null;
  let knowledgeWorkspace = null;
  let contextRequest = 0;
  let detailRequest = 0;
  let hostListRequest = 0;
  // An explicitly selected project may be read in parallel with the host
  // list, but the list remains authoritative for whether its detail is shown.
  let initialSelectionGate = null;
  let viewDestroyed = false;

  const correction = createGraphCorrection({
    client,
    now,
    scope: correctionScope,
    rerender: () => controller.render(),
    onSaved: async () => {
      await Promise.all([
        state.detail ? controller.loadDetail(state.detail.id, { keep: true }) : null,
        controller.load({ keep: true }),
      ]);
    },
    onConflict: async () => {
      if (state.detail) await controller.loadDetail(state.detail.id, { keep: true });
    },
  });

  function listItem(id) {
    return state.list.state === 'ok' ? state.list.payload.projects.find((project) => project.id === id) ?? null : null;
  }

  function projectSummaryFor(id) {
    const target = textOrNull(id);
    if (!target) return null;
    let summaries = projectSummaries;
    try {
      if (typeof summaries === 'function') summaries = summaries();
    } catch {
      summaries = null;
    }
    if (Array.isArray(summaries)) {
      const summary = summaries.map(normalizeProjectSummary).find((item) => item?.id === target);
      if (summary) return summary;
    }
    const listed = listItem(target);
    return listed ? { id: listed.id, name: listed.name } : { id: target, name: target };
  }

  function renderProjectKnowledgeLoading(id, readState, { onRetry } = {}) {
    const target = textOrNull(id);
    if (!target) return null;
    const project = projectSummaryFor(target);
    const loading = makeElement(doc, 'section', {
      className: 'bb-pkw bb-pkw-loading',
      attrs: {
        'aria-label': 'プロジェクトの知識',
        'data-project-id': target,
      },
    });
    loading.append(makeElement(doc, 'div', { className: 'bb-pkw-kicker', text: 'プロジェクトの記録' }));
    const header = makeElement(doc, 'header', { className: 'bb-pkw-header' });
    header.append(
      makeElement(doc, 'h2', { text: project.name }),
      makeElement(doc, 'p', { className: 'bb-pkw-lead', text: '目的・関係・判断の根拠を、実際に記録された情報からたどれます。' }),
    );
    loading.append(header);
    const notice = graphStateNotice(doc, readState, {
      onRetry,
      loadingText: 'プロジェクトの記録を読み込んでいます。',
    });
    if (notice) loading.append(notice);
    if (readState?.state === 'loading') {
      loading.append(renderProjectKnowledgeSkeleton(doc, { context: state.context?.projectId === target ? state.context : null }));
    } else if (state.context?.projectId === target) {
      const contextBlock = renderProjectContext(doc, state.context);
      if (contextBlock) loading.append(contextBlock);
    }
    return loading;
  }

  function openCorrection(at, open) {
    state.panelAt = at;
    open();
  }

  function notifySelect(id) {
    if (typeof onSelect === 'function' && id) onSelect(id);
  }

  // -------------------------------------------------------------------------
  // Host extensions

  /** The host's extra metrics; a throw or a malformed answer becomes a notice. */
  function hostMetrics(payload) {
    if (typeof extraMetrics !== 'function') return { metrics: [], failure: null };
    try {
      const metrics = extraMetrics(payload);
      if (!Array.isArray(metrics) || !metrics.every((item) => isRecord(item) && textOrNull(item.label))) {
        throw new Error('集計の形式が正しくありません');
      }
      return {
        metrics: metrics.map((item) => ({ label: item.label, value: item.value ?? null, note: textOrNull(item.note) ?? undefined })),
        failure: null,
      };
    } catch (error) {
      return {
        metrics: [],
        failure: workspaceNotice(doc, { label: '表示できません', text: `ホストが加えた集計を表示できませんでした（${failureText(error)}）。`, tone: 'danger' }),
      };
    }
  }

  /** The host's rail blocks for the selected project; a throw or a value that is not a node becomes a notice. */
  function railExtensions(projectId, payload) {
    if (typeof renderRailExtensions !== 'function') return [];
    try {
      const result = renderRailExtensions(projectId, payload, { document: doc });
      const nodes = (Array.isArray(result) ? result : [result]).filter((node) => node !== null && node !== undefined && node !== false);
      if (!nodes.every(isNode)) throw new Error('欄の形式が正しくありません');
      return nodes;
    } catch (error) {
      return [workspaceNotice(doc, { label: '表示できません', text: `ホストが加えた欄を表示できませんでした（${failureText(error)}）。`, tone: 'danger' })];
    }
  }

  /** Reads supplementary sections independently of the Graph project detail. */
  async function loadProjectContextFor(id, { keep = false, deferUntilHostList = null } = {}) {
    if (viewDestroyed) return state.context;
    if (typeof loadProjectContext !== 'function') {
      if (state.context?.projectId !== id) state.context = null;
      return null;
    }
    if (keep && state.context?.projectId === id && ['ok', 'failed', 'unavailable'].includes(state.context.state)) return state.context;
    const request = ++contextRequest;
    state.context = normalizeProjectContext(id, { state: 'loading' });
    controller.render();
    const applyContext = (snapshot, { flushDeferred = false } = {}) => {
      const normalized = normalizeProjectContext(id, snapshot);
      if (viewDestroyed || request !== contextRequest || state.selectedId !== id) return false;
      if (deferUntilHostList && !deferUntilHostList.confirmed && !flushDeferred) {
        if (!deferUntilHostList.cancelled && initialSelectionGate === deferUntilHostList) {
          deferUntilHostList.pendingContext = normalized;
          deferUntilHostList.flushContext = () => applyContext(normalized, { flushDeferred: true });
        }
        return false;
      }
      state.context = normalized;
      // Context progress must not rebuild the workspace: rebuilding destroys
      // Sigma's viewport and resets the user's active tab/selection. Detail
      // loading still uses the shell render so the project name is immediate.
      if (knowledgeWorkspace && state.detail?.id === id && state.detail.state === 'ok') {
        knowledgeWorkspace.setContext?.(normalized);
      } else {
        controller.render();
      }
      return true;
    };
    let result;
    try {
      result = await loadProjectContext(id, { onProgress: (snapshot) => { applyContext(snapshot); } });
    } catch (error) {
      result = { state: 'failed', message: `補足情報を読み取れませんでした（${failureText(error)}）。` };
    }
    applyContext(result);
    return state.context;
  }

  // -------------------------------------------------------------------------
  // Workspace

  /** The owner's own share, after everything of the host's (whatever state the host's list is in). */
  function renderWorkspace() {
    const children = renderHostWorkspace();
    if (own) children.push(renderOwnShare());
    return children;
  }

  function renderOwnShare() {
    const ownState = state.own;
    const notice = ownShareStateNotice(doc, ownState.list, { onRetry: () => controller.loadOwn(), loadingText: '引き継いだ自分の分を読み込んでいます。' });
    if (notice) return ownShareSection(doc, { label: own.label, children: [notice] });
    const { payload } = ownState.list;
    const children = [];
    if (payload.projects.length === 0) {
      children.push(makeElement(doc, 'p', { className: 'bb-graph-empty', text: 'この束には、プロジェクトの記録がありません。' }));
    } else {
      children.push(workspaceLedger(doc, {
        className: 'bb-graph-project-ledger bb-graph-own-ledger',
        ariaLabel: `${own.label}のプロジェクト`,
        columns: GRAPH_PROJECT_LEDGER_COLUMNS,
        rows: payload.projects.map((project) => ({
          key: project.id,
          selected: project.id === ownState.selectedId,
          className: project.active ? '' : 'is-ended',
          onSelect: (id) => { void controller.selectOwnProject(id); },
          cells: [
            { primary: project.name, secondary: project.id },
            textCell(project.goal, '目的未記入'),
            accountableCell(project),
            textCell(project.status, '未記入'),
            `${project.participantCount}人`,
            validityLabel(project, payload.asOf),
          ],
        })),
      }));
    }
    if (ownState.selectedId) {
      children.push(ownProjectDetail(doc, ownState.detail?.id === ownState.selectedId ? ownState.detail : { id: ownState.selectedId, state: 'loading' }, {
        onClose: () => controller.selectOwnProject(null),
        onRetry: () => controller.selectOwnProject(ownState.selectedId),
      }));
    }
    return ownShareSection(doc, { label: own.label, handover: payload.handover, children });
  }

  function renderHostWorkspace() {
    const pageHeader = workspacePageHeader(doc, {
      crumbs: context.crumbs,
      title: 'プロジェクトと関係者',
      lead: writable ? '目的・関係者・判断・根拠を、記録からたどり、必要な記録を直します。' : '目的・関係者・判断・根拠を、記録からたどります。',
      source: context.source,
      actions: workspaceHostActions(pageActions),
    });
    // These blocks belong to the legacy registration surface. The knowledge
    // workspace owns the first viewport while its graph tab is active, so the
    // old framing must not keep pushing the graph below the fold.
    const legacyChrome = [pageHeader];
    const children = [pageHeader];
    const dir = state.list.state === 'ok' ? textOrNull(state.list.payload.source?.dataDir) : null;
    // The record a host's 出典 notice may point at: the selected project once its detail is read.
    const sourceDetail = state.detail?.id === state.selectedId && state.detail.state === 'ok' ? state.detail.payload.project : null;
    const sourceSubject = sourceDetail ? { id: sourceDetail.id, type: 'project', metadata: sourceDetail.metadata ?? {} } : null;
    const sourceBlock = workspaceHostNotice(doc, hostSourceNotice(sourceNotice, sourceSubject)) ?? workspaceNotice(doc, {
      label: '出典',
      text: `このMacのGraph${dir ? `（${dir}）` : ''}から読み、ここで直した内容もそこへ保存します。関係者は、プロジェクトに参加している人や責任を持つ人の記録で、ログインや共有の設定ではありません。`,
    });
    children.push(sourceBlock);
    legacyChrome.push(sourceBlock);
    if (state.detail?.state === 'ok') {
      const issues = renderGraphIssues(doc, state.detail.payload.issues);
      if (issues) {
        children.push(issues);
        legacyChrome.push(issues);
      }
    }

    const setKnowledgeTabChrome = (tab) => {
      const graphActive = tab === 'graph';
      root.setAttribute('data-project-graph-active', String(graphActive));
      for (const node of legacyChrome) {
        if (node) node.hidden = graphActive;
      }
      if (!rail) return;
      rail.hidden = graphActive;
      if (graphActive) rail.setAttribute('aria-hidden', 'true');
      else rail.removeAttribute('aria-hidden');
      // In the organization shell the slot's parent is the actual grid
      // column. Hide that column as well; hiding only the slot leaves the
      // empty 380px rail in the layout.
      const parent = rail.parentElement;
      const railColumn = rail.closest?.('.bb-shell-rail')
        ?? (typeof parent?.className === 'string' && parent.className.split(/\s+/u).includes('bb-shell-rail') ? parent : null);
      if (railColumn) railColumn.hidden = graphActive;
    };

    const stateNotice = graphStateNotice(doc, state.list, { onRetry: () => controller.load(), loadingText: 'プロジェクトを読み込んでいます。' });
    if (stateNotice) {
      children.push(stateNotice);
      if (state.selectedId) {
        children.push(renderProjectKnowledgeLoading(state.selectedId, state.list, { onRetry: () => controller.load() }));
      }
      return children;
    }
    const { payload } = state.list;
    const summary = summarizeProjects(payload.projects);
    const extras = hostMetrics(payload);
    const summaryBlock = workspaceMetrics(doc, [
      { label: 'プロジェクト', value: summary.active, note: `有効なもの（全${summary.total}件）` },
      { label: '進行中', value: summary.inProgress, note: '状態が「進行中」の有効なもの' },
      { label: '関係者', value: summary.people, note: summary.people === null ? '人数を確かめられません' : '有効な関わりがある人（重複なし）' },
      ...extras.metrics,
    ], { ariaLabel: 'プロジェクトの集計' });
    children.push(summaryBlock);
    legacyChrome.push(summaryBlock);
    if (extras.failure) {
      children.push(extras.failure);
      legacyChrome.push(extras.failure);
    }

    // The selected project is the primary reading surface.  Keep the ledger
    // below it as a switcher so a large project list cannot bury its context.
    if (state.detail?.id === state.selectedId && state.detail.state === 'ok') {
      knowledgeWorkspace = createProjectKnowledgeWorkspace({
        document: doc,
        detail: state.detail.payload,
        context: state.context,
        mountGraph: projectGraphMount,
        readEntity: (id) => graphClient.read(`/entities/${encodeURIComponent(id)}`),
        onTabChange: setKnowledgeTabChrome,
      });
      children.push(knowledgeWorkspace.element);
    } else if (state.selectedId) {
      children.push(renderProjectKnowledgeLoading(state.selectedId, state.detail ?? { state: 'loading' }, {
        onRetry: () => controller.loadDetail(state.selectedId),
      }));
    }

    if (payload.projects.length === 0) {
      const hostEmpty = graphHostEmptyNotice(doc, emptyNotice);
      if (hostEmpty) {
        children.push(hostEmpty);
        return children;
      }
      const body = makeElement(doc, 'div', { className: 'bb-graph-notice-body' });
      body.append(
        makeElement(doc, 'p', { text: 'まだ登録がありません。このGraphには、プロジェクトがまだ登録されていません。次のコマンドで登録できます。CodexやClaude Codeからは、MCPのオンボーディング（brainbase_onboarding_start）で資料から候補を作り、確かめてから登録できます。' }),
        graphCommandList(doc, [`brainbase onboard:projects --name <名前> --goal <目的> --write${dir ? ` --dir ${shellArg(dir)}` : ''}`]),
      );
      children.push(workspaceNotice(doc, { label: '未登録', text: body, tone: 'info', role: 'status' }));
      return children;
    }

    if (showProjectLedger) children.push(workspaceLedger(doc, {
      className: 'bb-graph-project-ledger',
      ariaLabel: 'プロジェクトの一覧',
      columns: GRAPH_PROJECT_LEDGER_COLUMNS,
      rows: payload.projects.map((project) => ({
        key: project.id,
        selected: project.id === state.selectedId,
        className: project.active ? '' : 'is-ended',
        onSelect: (id) => {
          focusRow = id;
          const changed = id !== state.selectedId;
          const reading = controller.selectProject(id);
          if (changed) notifySelect(id);
          void reading;
        },
        cells: [
          { primary: project.name, secondary: project.id, leading: renderProjectIcon(doc, project.icon, project.name, { size: 'sm' }) },
          textCell(project.goal, '目的未記入'),
          accountableCell(project),
          textCell(project.status, '未記入'),
          `${project.participantCount}人`,
          validityLabel(project, payload.asOf),
        ],
      })),
    }));
    return children;
  }

  // -------------------------------------------------------------------------
  // Right rail

  function participantItem(edge, project, asOf) {
    const item = makeElement(doc, 'li', { className: `bb-graph-compact${edge.active ? '' : ' is-ended'}` });
    const head = makeElement(doc, 'div', { className: 'bb-graph-compact-head' });
    const how = ownLabel(PARTICIPATION_LABELS, edge.relation) ?? relationLabel(edge.relation);
    head.append(
      makeElement(doc, 'strong', { className: 'bb-graph-compact-title', text: edge.counterpart.name }),
      badge(doc, how, edge.relation === 'accountable_for' ? 'accent' : ''),
      activityBadge(doc, edge, asOf),
    );
    item.append(head);
    if (edge.counterpart.active === false) item.append(makeElement(doc, 'small', { className: 'bb-graph-help', text: '人物の記録は終了しています' }));
    item.append(workspaceDefinition(doc, [
      ['役割', textOrNull(edge.role)],
      ...(textOrNull(edge.context) ? [['文脈', edge.context]] : []),
      ['有効期間', validityText(edge.validFrom, edge.validTo)],
      ['出典', renderProvenance(doc, edge.provenance)],
    ]));
    const subject = `${edge.counterpart.name}（${how}、${project.name}）`;
    if (edgesWritable) {
      item.append(workspaceActions(doc, [
        workspaceButton(doc, { text: '役割を直す', variant: 'quiet', onClick: () => openCorrection(edge.id, () => correction.openEdge(edge, { mode: 'role', subject })) }),
        edge.active
          ? workspaceButton(doc, { text: '関わりを終える', variant: 'quiet', onClick: () => openCorrection(edge.id, () => correction.openEdge(edge, { mode: 'end', subject })) })
          : workspaceButton(doc, { text: '終了日を直す', variant: 'quiet', onClick: () => openCorrection(edge.id, () => correction.openEdge(edge, { mode: 'end', title: '終了日を直す', subject })) }),
      ]));
    }
    item.append(recordDetails(doc, [['関係ID', edge.id], ['人物ID', edge.counterpart.id], ['digest', edge.digest]]));
    if (edgesWritable && state.panelAt === edge.id) {
      const panel = correction.render(doc);
      if (panel) item.append(panel);
    }
    return item;
  }

  function renderParticipants(payload) {
    const { project } = payload;
    const content = [makeElement(doc, 'p', { className: 'bb-graph-block-lead', text: '参加している人と、責任を持つ人です。終わった関わりも、終了日つきで残ります。' })];
    if (payload.participants.length === 0) {
      content.push(makeElement(doc, 'p', { className: 'bb-graph-empty', text: 'このプロジェクトには、まだ関係者の登録がありません。' }));
    } else {
      const list = makeElement(doc, 'ul', { className: 'bb-graph-compact-list' });
      for (const edge of payload.participants) list.append(participantItem(edge, project, payload.asOf));
      content.push(list);
    }
    return workspaceRailBlock(doc, { title: '関係者', content });
  }

  function renderOtherRelations(payload) {
    const relations = Array.isArray(payload.relations) ? payload.relations : [];
    if (relations.length === 0) return null;
    const list = makeElement(doc, 'ul', { className: 'bb-graph-plain-list' });
    for (const edge of relations) {
      const labels = ownLabel(GRAPH_RELATION_LABELS, edge.relation);
      const phrase = labels ? (edge.direction === 'outgoing' ? labels.outgoing : labels.incoming) : '';
      const item = makeElement(doc, 'li');
      item.append(badge(doc, relationLabel(edge.relation), 'muted'), makeElement(doc, 'span', { text: ` ${edge.counterpart.name}${phrase} ` }), activityBadge(doc, edge, payload.asOf));
      list.append(item);
    }
    return workspaceRailBlock(doc, {
      title: 'そのほかの関係',
      content: [makeElement(doc, 'p', {
        className: 'bb-graph-block-lead',
        text: edgesWritable ? '所有する組織や、進め方を決める判断などです。直すときは「情報と関係」を使います。' : '所有する組織や、進め方を決める判断などです。',
      }), list],
    });
  }

  function statusValue(project, asOf) {
    const wrap = makeElement(doc, 'span', { className: 'bb-graph-inline-value' });
    wrap.append(makeElement(doc, 'span', { text: textOrNull(project.status) ?? '未記入' }), activityBadge(doc, project, asOf));
    return wrap;
  }

  function renderRail() {
    // The first project is selected once the list is read; until then the rail stays empty
    // (a project the host asked for is shown only once its detail is being read).
    if (state.list.state === 'loading' && state.detail?.id !== state.selectedId) return [];
    if (!state.selectedId) {
      return [workspaceDetailEmpty(doc, {
        mark: 'P',
        title: 'プロジェクトを選択',
        text: '一覧から選ぶと、目的・判断の原則と、関係者の役割・有効期間・出典を表示します。',
      })];
    }
    const detail = state.detail;
    const loaded = detail?.id === state.selectedId && detail.state === 'ok' ? detail.payload : null;
    const project = loaded?.project ?? listItem(state.selectedId) ?? { id: state.selectedId, name: state.selectedId };
    // The record a host's read-only note may point at.
    const noteSubject = { id: project.id, type: 'project', metadata: loaded?.project?.metadata ?? {} };
    const children = [workspaceRailHead(doc, { kicker: 'プロジェクト', title: project.name, sub: project.id, leading: renderProjectIcon(doc, project.icon, project.name) })];
    if (!loaded) {
      const readState = detail?.id === state.selectedId
        ? detail
        : state.list.state === 'ok' ? { state: 'loading' } : state.list;
      children.push(graphStateNotice(doc, readState, {
        onRetry: () => controller.loadDetail(state.selectedId),
        loadingText: 'このプロジェクトの関係者を読み込んでいます。',
      }));
      children.push(...railExtensions(state.selectedId, null));
      return children;
    }
    const principles = Array.isArray(project.decisionPrinciples) ? project.decisionPrinciples.filter((item) => typeof item === 'string' && item.trim()) : [];
    let principleList = null;
    if (principles.length > 0) {
      principleList = makeElement(doc, 'ul', { className: 'bb-graph-plain-list' });
      for (const principle of principles) principleList.append(makeElement(doc, 'li', { text: principle }));
    }
    children.push(workspaceRailBlock(doc, {
      title: '概要',
      content: [
        workspaceDefinition(doc, [
          ['状態', statusValue(project, loaded.asOf)],
          ['目的', textOrNull(project.goal)],
          ['判断の原則', principleList ?? { text: 'まだ登録がありません', className: 'is-unrecorded' }],
          ['有効期間', validityText(project.validFrom, project.validTo)],
          // A host with its own source names it in its notice; this row names only this Mac's Graph.
          ...(isRecord(sourceNotice) ? [] : [['出典', 'このMacのGraph（graph.json）']]),
        ]),
        recordDetails(doc, [['プロジェクトID', project.id], ['digest', project.digest], ['読み取った時点', loaded.asOf]]),
      ],
    }));
    children.push(renderParticipants(loaded));
    if (writable) {
      const canAdd = scope.createEdges;
      const projectFields = scope.entity('project') ? scope.fields(['name', 'goal', 'status', 'icon']) : [];
      const actions = [
        canAdd ? workspaceButton(doc, {
          text: '関係者を加える',
          variant: 'primary',
          onClick: () => openCorrection('project', () => correction.openCreate(project, {
            relations: ['participates_in', 'accountable_for'],
            relationNames: PARTICIPATION_LABELS,
            relationLabel: '関わり方',
            title: '関係者を加える',
            subject: `プロジェクト「${project.name}」`,
          })),
        }) : null,
        projectFields.length > 0 ? workspaceButton(doc, {
          text: 'プロジェクトを直す',
          onClick: () => openCorrection('project', () => correction.openEntity(project, {
            fields: projectFields,
            title: 'プロジェクトを直す',
            subject: `プロジェクト「${project.name}」の${projectFields.map((field) => GRAPH_CORRECTION_FIELDS[field].label).join('・')}`,
          })),
        }) : null,
      ].filter(Boolean);
      if (actions.length > 0) children.push(workspaceActions(doc, actions));
      // A correction opened on a 関係者 shows inside that item; any other shows here.
      if (!loaded.participants.some((edge) => edge.id === state.panelAt)) children.push(correction.render(doc));
      // The host's reason for a control it withholds, where that control would be.
      const withheld = !canAdd || projectFields.length === 0 || (!scope.edges && loaded.participants.length > 0);
      if (withheld) children.push(hostReadOnlyNote(doc, readOnlyNote, noteSubject));
    } else {
      children.push(hostReadOnlyNote(doc, readOnlyNote, noteSubject));
    }
    children.push(...railExtensions(state.selectedId, loaded));
    children.push(renderOtherRelations(loaded));
    children.push(renderCorrectionHistory(doc, loaded.history));
    return children;
  }

  function cancelInitialSelectionGate(gate, { reset = true } = {}) {
    if (!gate || gate.cancelled || gate.confirmed) return;
    gate.cancelled = true;
    gate.pendingContext = null;
    gate.pendingDetail = null;
    gate.flushContext = null;
    gate.flushDetail = null;
    if (initialSelectionGate === gate) initialSelectionGate = null;
    // A caller may have selected another project while this gate was pending.
    // Do not invalidate that newer project's reads in that case.
    if (!reset || state.selectedId !== gate.id) return;
    detailRequest += 1;
    contextRequest += 1;
    if (state.detail?.id === gate.id && state.detail.state === 'loading') state.detail = null;
    if (state.context?.projectId === gate.id && state.context.state === 'loading') state.context = null;
  }

  function confirmInitialSelectionGate(gate) {
    if (!gate || gate.cancelled) return;
    gate.confirmed = true;
    if (initialSelectionGate === gate) initialSelectionGate = null;
    // Responses which finished before the list are safe to expose now.  A
    // response still in flight will apply through its normal completion path.
    gate.flushDetail?.();
    gate.flushContext?.();
    gate.pendingDetail = null;
    gate.pendingContext = null;
    gate.flushDetail = null;
    gate.flushContext = null;
  }

  /** Reads the host's project list (see `load`). */
  async function loadHostList({ keep = false } = {}) {
    const request = ++hostListRequest;
    if (viewDestroyed) return state.list;
    if (!(keep && state.list.state === 'ok')) {
      state.list = { state: 'loading' };
      controller.render();
    }
    let selectionGate = null;
    let selectionDetailReading = null;
    const selectedBeforeList = state.selectedId;
    if (selectedBeforeList) {
      if (initialSelectionGate?.id === selectedBeforeList && !initialSelectionGate.cancelled && !initialSelectionGate.confirmed) {
        selectionGate = initialSelectionGate;
        selectionDetailReading = selectionGate.detailReading;
      } else if (state.detail === null) {
        selectionGate = {
          id: selectedBeforeList,
          confirmed: false,
          cancelled: false,
          pendingContext: null,
          pendingDetail: null,
          flushContext: null,
          flushDetail: null,
          detailReading: null,
        };
        initialSelectionGate = selectionGate;
        selectionDetailReading = controller.loadDetail(selectedBeforeList, {
          keep,
          deferUntilHostList: selectionGate,
        });
        selectionGate.detailReading = selectionDetailReading;
      }
    }
    const result = await client.read('/projects');
    if (viewDestroyed || request !== hostListRequest) return state.list;
    state.list = normalizeProjectList(result);
    if (state.list.state !== 'ok') {
      cancelInitialSelectionGate(selectionGate);
      controller.render();
      return state.list;
    }
    const { projects } = state.list.payload;
    if (selectionGate && (selectionGate.cancelled || state.selectedId !== selectionGate.id)) {
      cancelInitialSelectionGate(selectionGate, { reset: false });
      selectionGate = null;
    }
    if (!state.selectedId) {
      if (correction.form) correction.close();
      state.panelAt = null;
      state.detail = null;
      state.context = null;
      contextRequest += 1;
      state.selectedId = projects[0]?.id ?? null;
      if (state.selectedId) {
        if (viewDestroyed || request !== hostListRequest) return state.list;
        const reading = controller.loadDetail(state.selectedId);
        notifySelect(state.selectedId);
        await reading;
        if (viewDestroyed || request !== hostListRequest) return state.list;
        return state.list;
      }
    } else if (!projects.some((project) => project.id === state.selectedId)) {
      // An explicit host selection, or a project selected by the user, must
      // never be replaced with the first row when the refreshed list no
      // longer contains it.  Keeping the id makes the missing target visible
      // and lets the host decide whether its identity or access changed.
      cancelInitialSelectionGate(selectionGate);
      if (correction.form) correction.close();
      detailRequest += 1;
      state.panelAt = null;
      state.detail = {
        id: state.selectedId,
        state: 'not_found',
        reason: 'このプロジェクトは一覧から見つかりません。一覧を読み直してください。',
      };
      state.context = null;
      contextRequest += 1;
    } else if (selectionGate && selectionGate.id === state.selectedId) {
      confirmInitialSelectionGate(selectionGate);
      if (selectionDetailReading) await selectionDetailReading;
      if (viewDestroyed || request !== hostListRequest) return state.list;
      return state.list;
    } else if (state.detail?.id !== state.selectedId || state.detail?.state === 'not_found') {
      // The project the host asked for is listed; read it for the rail.
      if (viewDestroyed || request !== hostListRequest) return state.list;
      await controller.loadDetail(state.selectedId);
      if (viewDestroyed || request !== hostListRequest) return state.list;
      return state.list;
    }
    if (viewDestroyed || request !== hostListRequest) return state.list;
    controller.render();
    return state.list;
  }

  const controller = {
    get state() { return state; },
    get correction() { return correction; },
    render() {
      if (viewDestroyed) return controller;
      if (knowledgeWorkspace) {
        knowledgeWorkspace.destroy();
        knowledgeWorkspace = null;
      }
      layout.render(renderWorkspace(), renderRail());
      if (focusRow) {
        focusLedgerRow(root, focusRow);
        focusRow = null;
      }
      return controller;
    },
    destroy() {
      if (viewDestroyed) return;
      viewDestroyed = true;
      hostListRequest += 1;
      detailRequest += 1;
      contextRequest += 1;
      initialSelectionGate = null;
      knowledgeWorkspace?.destroy();
      knowledgeWorkspace = null;
      correction.close();
    },
    /**
     * Reads the list; the first project is selected when none is.  `keep` shows the current list until
     * the new one has been read.  The owner's own share is read alongside, unless `keep` finds it read.
     */
    async load({ keep = false } = {}) {
      const owning = own && !(keep && state.own.list.state === 'ok') ? controller.loadOwn() : null;
      const [list] = await Promise.all([loadHostList({ keep }), owning]);
      return list;
    },
    /** Reads the owner's own projects (with `ownShare`); a failure stays in that section. */
    async loadOwn() {
      if (!own) return null;
      state.own.list = { state: 'loading' };
      controller.render();
      const result = normalizeProjectList(await own.client.read('/projects'));
      // `not_handed_over` passes through as its own state.
      state.own.list = result;
      if (result.state !== 'ok' || !result.payload.projects.some((project) => project.id === state.own.selectedId)) {
        state.own.selectedId = null;
        state.own.detail = null;
      }
      controller.render();
      return state.own.list;
    },
    /** Opens (or with null closes) a project of the owner's own share below its ledger. */
    async selectOwnProject(id) {
      if (!own) return null;
      const target = textOrNull(id);
      state.own.selectedId = target;
      if (!target) {
        state.own.detail = null;
        controller.render();
        return null;
      }
      state.own.detail = { id: target, state: 'loading' };
      controller.render();
      const result = await own.client.read(`/projects/${encodeURIComponent(target)}`);
      if (state.own.selectedId !== target) return state.own.detail;
      state.own.detail = result.state === 'error' && result.status === 404
        ? { id: target, state: 'not_found', reason: 'このプロジェクトは束の中に見つかりません。' }
        : { id: target, ...normalizeProjectDetail(result) };
      controller.render();
      return state.own.detail;
    },
    /** `keep` shows the current detail until the new one has been read. */
    async loadDetail(id, { keep = false, deferUntilHostList = null } = {}) {
      if (viewDestroyed) return state.detail;
      const request = ++detailRequest;
      const previous = state.detail;
      if (!(keep && previous?.id === id && previous.state === 'ok')) {
        state.detail = { id, state: 'loading' };
        controller.render();
      }
      const contextReading = loadProjectContextFor(id, { keep, deferUntilHostList });
      const result = await client.read(`/projects/${encodeURIComponent(id)}`);
      if (viewDestroyed || request !== detailRequest || state.selectedId !== id) return state.detail;
      const detail = result.state === 'error' && result.status === 404
        ? { id, state: 'not_found', reason: 'このプロジェクトは見つかりません。一覧を読み直してください。' }
        : { id, ...normalizeProjectDetail(result) };
      const applyDetail = () => {
        if (viewDestroyed || request !== detailRequest || state.selectedId !== id) return false;
        state.detail = detail;
        controller.render();
        return true;
      };
      if (deferUntilHostList && !deferUntilHostList.confirmed) {
        if (!deferUntilHostList.cancelled && initialSelectionGate === deferUntilHostList) {
          deferUntilHostList.pendingDetail = detail;
          deferUntilHostList.flushDetail = applyDetail;
        }
        return state.detail;
      }
      applyDetail();
      // The context is intentionally independent.  Its completion may trigger
      // one more render, but never changes the Graph detail result.
      void contextReading;
      return state.detail;
    },
    /** Selects a row: the rail shows that project, and an open correction is closed. */
    async selectProject(id) {
      // A host selection supersedes a prefetched initial detail.  Cancel the
      // gate before changing the id so A -> B -> A cannot make a later list
      // response wait for the first A read.
      cancelInitialSelectionGate(initialSelectionGate, { reset: false });
      if (correction.form) correction.close();
      state.panelAt = null;
      state.selectedId = id;
      state.context = null;
      contextRequest += 1;
      return controller.loadDetail(id, { keep: true });
    },
    /** The same as selecting the project's row. */
    async openProject(id) {
      return controller.selectProject(id);
    },
    /**
     * Selects a project from the host's own navigation without calling `onSelect`.
     * Selecting the project already selected changes nothing (an open correction stays).
     */
    async select(id) {
      const target = textOrNull(id);
      if (!target || target === state.selectedId) return state.detail;
      return controller.selectProject(target);
    },
  };
  controller.render();
  if (autoLoad) void controller.load();
  return controller;
}

export default createGraphProjectsView;
