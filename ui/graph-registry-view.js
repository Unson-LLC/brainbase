/*
 * 「情報と関係」: what the local Graph holds, how records are connected, and
 * where to correct a mistake so the next MCP use sees the fix.
 *
 * 「調べる」 (premise ledger D14, story-graph-registry-immediate-feedback-v1):
 * the list has the search, the kinds as tabs with counts, 詳しい条件 (an
 * earlier day), the conditions in force as removable chips and the results.
 * Everything applies as it changes.  A record opens as its own screen with an
 * address the host keeps (`onRouteChange`): what it is, its connections read
 * as sentences and grouped by the other record's kind, 根拠と履歴 (folded:
 * source, period, corrections, ids) and 直す, which first shows what a fix
 * reaches.  The right rail stays empty.
 *
 * This screen answers what the Graph knows (ledger D14).  The kinds of
 * information and relations (the ontology) are definitions, drawn by
 * `graph-ontology-view.js` under the host's settings; the owner's own snapshot
 * is drawn by `createOwnShareView` (`graph-own-share.js`) where the owner takes
 * records in.  Neither is drawn here.
 *
 * Reads `GET {base}/search`, `GET {base}/entities/:id` and `GET {base}/ontology`
 * (for the kinds and their counts) and corrects through `POST {base}/corrections`
 * (see `graph-view-shared.js`).  The host injects the fetcher, base path, launch
 * token, page context and the record's address; this module keeps no global
 * state.  Another host composes it unchanged and adds only its own controls
 * through the options of `createGraphRegistryView`.
 */

import {
  activityBadge,
  button,
  createGraphClient,
  createGraphCorrection,
  createGraphLayout,
  dayToRfc3339,
  focusLedgerRow,
  formatDay,
  getDocument,
  graphCommandList,
  graphCorrectionScope,
  graphEntityCorrectionFields,
  graphPageContext,
  graphStateNotice,
  hostReadOnlyNote,
  hostSourceNotice,
  isEdgeView,
  isEntityView,
  makeElement,
  newRelationOptions,
  ownLabel,
  readOnlyGraphClient,
  recordDetails,
  relationLabel,
  renderEvidenceAndHistory,
  renderProvenance,
  shellArg,
  textOrNull,
  typeLabel,
  validityLabel,
  validityText,
  GRAPH_RELATION_LABELS,
  graphHostEmptyNotice,
} from './graph-view-shared.js';
import { normalizeOntology } from './graph-ontology-view.js';
import {
  workspaceActions,
  workspaceButton,
  workspaceDefinition,
  workspaceHostNotice,
  workspaceLedger,
  workspaceNotice,
  workspacePageHeader,
} from './workspace-kit.js';

export const GRAPH_REGISTRY_VIEW_CONTRACT_VERSION = 'brainbase.graph-registry-view.v3';
export const GRAPH_SEARCH_LIMIT = 50;
export const GRAPH_ENTITY_LEDGER_COLUMNS = Object.freeze(['名前', '種類', '説明', '最終更新']);

const INVALID = Object.freeze({ state: 'invalid', reason: '応答の形式が不正です' });
const DETAIL_ID = 'bb-gr-detail';

/**
 * People, companies and projects lead the tabs, under the names owners use for
 * them (ledger D14).  Every other kind uses the shared plain name; a kind
 * without one is internal and is never named.
 */
const LEADING_KINDS = Object.freeze({ person: '人', org: '会社', project: 'プロジェクト' });
const DEFAULT_KIND_TABS = Object.freeze(['person', 'org', 'project', 'decision']);

function kindLabel(type) {
  const leading = ownLabel(LEADING_KINDS, type);
  if (leading) return leading;
  const shared = typeLabel(type);
  return typeof type === 'string' && shared !== type ? shared : 'その他の記録';
}

function hasKindLabel(type) {
  return kindLabel(type) !== 'その他の記録';
}

/** Leading kinds first, the rest in the order given. */
function kindRank(type) {
  const index = Object.keys(LEADING_KINDS).indexOf(type);
  return index < 0 ? Object.keys(LEADING_KINDS).length : index;
}

/** How a relation reads from this record's side; a relation without a Japanese name only says they connect. */
function relationPhrase(edge) {
  const labels = ownLabel(GRAPH_RELATION_LABELS, edge.relation);
  if (!labels) return 'とつながる';
  return edge.direction === 'outgoing' ? labels.outgoing : labels.incoming;
}

/** The day a record last changed, when the host says so. */
function updatedDay(entity) {
  const value = textOrNull(entity?.updatedAt) ?? textOrNull(entity?.updated_at);
  return value ? (formatDay(value) ?? value.slice(0, 10)) : null;
}
/** Results are `ok` when well formed; no match is shown only when the whole Graph was searched. */
export function normalizeSearch(result) {
  if (result?.state !== 'ok') return result ?? INVALID;
  const payload = result.payload;
  if (!Array.isArray(payload.results) || !payload.results.every(isEntityView)) return INVALID;
  if (payload.results.length === 0 && payload.absenceConfirmed !== true) return { state: 'unknown' };
  return { state: 'ok', payload };
}

export function normalizeEntityDetail(result) {
  if (result?.state !== 'ok') return result ?? INVALID;
  const payload = result.payload;
  if (!isEntityView(payload.entity)) return INVALID;
  for (const key of ['outgoing', 'incoming']) {
    if (!Array.isArray(payload[key]) || !payload[key].every(isEdgeView)) return INVALID;
  }
  return { state: 'ok', payload };
}

const RELATION_UNAVAILABLE_STATES = new Set(['failed', 'incomplete', 'partial', 'stale', 'unknown', 'unavailable']);
const RELATION_EMPTY_STATES = new Set(['confirmed_empty', 'empty', 'none']);

function normalizedRelationState(value) {
  if (typeof value !== 'string') return null;
  const state = value.trim().toLowerCase().replace(/[- ]/gu, '_');
  if (RELATION_UNAVAILABLE_STATES.has(state)) return 'unknown';
  if (RELATION_EMPTY_STATES.has(state)) return 'confirmed_empty';
  if (['available', 'complete', 'ready'].includes(state)) return 'available';
  return null;
}

function firstText(...values) {
  for (const value of values) {
    const text = textOrNull(value);
    if (text) return text;
  }
  return null;
}

function relationStatusFrom(payload, direction) {
  const direct = [
    payload[`${direction}_status`],
    payload[`${direction}Status`],
    payload[`${direction}_availability`],
    payload[`${direction}Availability`],
  ].map(normalizedRelationState).find(Boolean);
  if (direct) return direct;
  return [
    payload.relations_status,
    payload.relationsStatus,
    payload.relation_status,
    payload.relationStatus,
    payload.edges_status,
    payload.edgesStatus,
  ].map(normalizedRelationState).find(Boolean) ?? null;
}

function participantStatusFrom(payload) {
  return [
    payload.participants_status,
    payload.participantsStatus,
    payload.participant_status,
    payload.participantStatus,
  ].map(normalizedRelationState).find(Boolean) ?? null;
}

function knownParticipantCount(payload) {
  const entity = payload.entity ?? {};
  const count = [
    entity.participantCount,
    entity.participant_count,
    entity.accountableCount,
    entity.accountable_count,
    payload.actual_known_count,
    payload.actualKnownCount,
  ].find((value) => Number.isInteger(value) && value > 0);
  if (count) return count;
  if (Array.isArray(entity.people) && entity.people.length > 0) return entity.people.length;
  if (Array.isArray(payload.people) && payload.people.length > 0) return payload.people.length;
  return null;
}

function relationUnavailableReason(payload) {
  const explicit = firstText(
    payload.relations_reason,
    payload.relationsReason,
    payload.relation_reason,
    payload.relationReason,
    payload.edges_reason,
    payload.edgesReason,
    payload.participants_reason,
    payload.participantsReason,
    payload.participants_unavailable_reason,
    payload.participantsUnavailableReason,
    payload.reason,
    payload.source?.reason,
    payload.source?.message,
  );
  if (explicit) return `${explicit} 関係の有無は確認できません。登録なしとは判断できません。`;
  const count = knownParticipantCount(payload);
  const known = count ? `関係者の件数（${count}人）は確認できていますが、` : '';
  return `${known}関係の有無を確認できません。関係の詳細が未取得のため、登録なしとは判断できません。`;
}

/**
 * Empty edge arrays are a confirmed empty result only when the host says so.
 * A project can carry a known participant count while its relation edges are
 * unavailable; rendering the empty copy in that case turns unknown data into
 * a product assertion.
 */
function relationAvailability(payload, direction) {
  if (payload[direction].length > 0) return { state: 'available' };
  const direct = relationStatusFrom(payload, direction);
  if (direct === 'unknown') return { state: 'unknown', reason: relationUnavailableReason(payload) };
  // A host may accidentally include a stale confirmed-empty status alongside
  // an incomplete relation payload. Completeness signals take precedence so
  // the UI cannot turn a known participant count into a false "none" claim.
  const edgesNotProvided = payload.source?.edges_not_provided === true || payload.source?.edgesNotProvided === true;
  const participantsUnknown = participantStatusFrom(payload) === 'unknown';
  const knownCount = knownParticipantCount(payload);
  if (edgesNotProvided || participantsUnknown || knownCount) {
    return { state: 'unknown', reason: relationUnavailableReason(payload) };
  }
  if (direct === 'confirmed_empty') return { state: 'confirmed_empty' };
  return { state: 'confirmed_empty' };
}

export { normalizeOntology };

function textCell(value, fallback) {
  return textOrNull(value) ?? { text: fallback, className: 'is-unresolved' };
}

/**
 * Mounts 「情報と関係」.
 *
 * @param {object} options
 * @param {Element} options.root Where the workspace is drawn.
 * @param {Element} [options.rail] The host's right rail.  It is left empty: the record opens in the workspace.
 * @param {{ crumbs?: string[], source?: string }} [options.page] Breadcrumb and source label of the page head.
 * @param {Document} [options.document] The document to build elements with (default: the global one).
 * @param {Function} [options.fetcher] `fetch`-compatible function for the Graph routes.
 * @param {string} [options.basePath='/api/graph'] Where the Graph routes are served.
 * @param {string} [options.token] Launch token sent with a correction.
 * @param {string} [options.tokenHeader] Header name for the token.
 * @param {boolean} [options.autoLoad=true] Runs the empty search and reads the kinds on mount.
 * @param {number} [options.searchDelayMs=300] How long the name field waits after the last keystroke
 *   before it searches (never while a Japanese conversion is still being composed).
 * @param {(entityId: string | null, options: { back: boolean }) => void} [options.onRouteChange]
 *   Called when the owner opens a record (its id) or goes back to the list (null, `back: true`), so the
 *   host can give the record's screen an address.  When that address changes from outside (the
 *   browser's back), the host calls `openEntity(id)` or `closeEntity()`; neither reports back.
 * @param {string} [options.initialEntityId] Opens this exact entity after the initial Graph read.
 * @param {() => Date} [options.now] The owner's clock.
 * @param {boolean} [options.canCorrect=true] When false, no correction control is drawn anywhere
 *   (この記録を直す, 関係を加える, この関係を直す, and この画面で直せること under the kinds of
 *   information), and the client refuses every correction before sending it.
 * @param {{ entityTypes?: string[], fields?: string[], edges?: boolean, createEdges?: boolean }} [options.correctionScope]
 *   With corrections allowed, only these (see `graphCorrectionScope`): `entityTypes` lists the kinds that
 *   offer この記録を直す, `fields` limits its form, `edges: false` withholds この関係を直す and
 *   `createEdges: false` withholds 関係を加える.  A withheld control is not drawn and the client refuses
 *   such a correction before sending it.  Without it every correction is allowed.
 * @param {string | ((record: { id: string, type: string | null, metadata: object } | null) => string | Element | null)} [options.readOnlyNote]
 *   With `canCorrect: false`, or where `correctionScope` withholds a
 *   control of the open record, a note shown under 直す where the correction buttons would be.
 *   Without it nothing is said about corrections.
 * @param {{ label?: string, text: string | Element }} [options.emptyNotice] Replaces the 未登録 notice
 *   and its `brainbase onboard:*` commands when the host's Graph has nothing registered.
 * @param {{ label?: string, text: string | Element }} [options.sourceNotice] Replaces the default 出典 notice
 *   inside the open record's 根拠と履歴.
 * @param {unknown} [options.ownShare] Ignored.  The owner's own snapshot is not part of this screen
 *   (ledger D14); a host mounts `createOwnShareView` from `graph-own-share.js` where the owner takes records in.
 *
 * The kind tabs list the entity types of the `/ontology` answer that have a
 * plain name, people, companies and projects first (the four local kinds until
 * it has been read).  A type without one is never named: it is listed under
 * すべて as その他の記録.
 *
 * @returns The controller: `state`, `correction`, `render()`, `load()`, `search()`,
 *   `clearFilter(key)`, `clearFilters()`, `refreshResults()`, `loadEntity(id)`, `navigate(id)`,
 *   `openEntity(id)`, `closeEntity()`, `backToList()`, `back()`, `loadOntology()`.
 */
export function createGraphRegistryView({
  root,
  rail,
  page,
  document: explicitDocument,
  fetcher,
  basePath = '/api/graph',
  token,
  tokenHeader,
  autoLoad = true,
  searchDelayMs = 300,
  initialEntityId,
  onRouteChange,
  now = () => new Date(),
  canCorrect = true,
  correctionScope,
  readOnlyNote,
  sourceNotice,
  emptyNotice,
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = getDocument(explicitDocument);
  const graphClient = createGraphClient({ fetcher, basePath, token, ...(tokenHeader ? { tokenHeader } : {}) });
  const writable = canCorrect !== false;
  const client = writable ? graphClient : readOnlyGraphClient(graphClient);
  const scope = graphCorrectionScope(correctionScope);
  const edgesWritable = writable && scope.edges;
  const context = graphPageContext(page);
  const layout = createGraphLayout(doc, {
    root,
    rail,
    label: '情報と関係',
    className: 'bb-gr',
    contractVersion: GRAPH_REGISTRY_VIEW_CONTRACT_VERSION,
  });
  const state = {
    // `query` follows the form; `applied` is the search the results were read with.
    query: { q: '', type: '', asOfDay: '' },
    applied: { q: '', type: '', asOfDay: '' },
    queryMessage: null,
    search: { state: 'loading' },
    // A new search is being read while the last results stay on screen.
    searching: false,
    // 詳しい条件 stays open across redraws once the owner opened it.
    advancedOpen: false,
    // `detail` is the open record: { id, state, payload?, pending? }.
    detail: null,
    // The row of the results the open record hangs from (the record the owner clicked).
    anchor: null,
    trail: [],
    ontology: { state: 'loading' },
    // Where the open correction shows: a relation id (inside that relation) or anything else (below the record actions).
    panelAt: null,
  };
  let focusRow = null;
  // The control to keep focused across a redraw, and the open record to bring into view once.
  let revealDetail = false;
  let composing = false;
  let renderDeferred = false;
  let searchTimer = null;

  const correction = createGraphCorrection({
    client,
    now,
    scope: correctionScope,
    rerender: () => controller.render(),
    onSaved: async () => {
      await Promise.all([
        state.detail ? controller.loadEntity(state.detail.id, { keep: true }) : null,
        controller.refreshResults(),
        controller.loadOntology({ keep: true }),
      ]);
    },
    onConflict: async () => {
      if (state.detail) await controller.loadEntity(state.detail.id, { keep: true });
    },
  });

  function asOfParam(day = state.applied.asOfDay) {
    return day ? dayToRfc3339(day) : null;
  }

  function openCorrection(at, open) {
    state.panelAt = at;
    open();
  }

  // -------------------------------------------------------------------------
  // Workspace

  function cancelScheduledSearch() {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = null;
  }

  /** The name field searches once typing pauses; nothing is searched mid-conversion. */
  function scheduleSearch() {
    cancelScheduledSearch();
    searchTimer = setTimeout(() => {
      searchTimer = null;
      void controller.search();
    }, Math.max(0, Number(searchDelayMs) || 0));
  }

  function renderSearchForm() {
    const section = makeElement(doc, 'section', { className: 'bb-gr-search-section', attrs: { 'aria-label': '検索' } });
    const form = makeElement(doc, 'form', { className: 'bb-graph-form bb-gr-search', attrs: { role: 'search', novalidate: true } });
    // Enter searches at once; every other change searches by itself.
    form.addEventListener('submit', (event) => {
      event?.preventDefault?.();
      cancelScheduledSearch();
      return controller.search();
    });
    const field = (id, label, control, className = '') => {
      const wrap = makeElement(doc, 'div', { className: `bb-graph-field${className ? ` ${className}` : ''}` });
      wrap.append(makeElement(doc, 'label', { text: label, attrs: { for: id } }), control);
      return wrap;
    };
    const q = makeElement(doc, 'input', { attrs: { id: 'bb-gr-q', name: 'q', type: 'search', maxlength: 200, placeholder: '名前・別名で探す（例: 田中）', autocomplete: 'off', 'data-focus-key': 'q' } });
    q.value = state.query.q;
    q.addEventListener('input', (event) => {
      state.query.q = event?.target?.value ?? q.value;
      if (event?.isComposing || composing) return;
      scheduleSearch();
    });
    q.addEventListener('compositionstart', () => { composing = true; });
    q.addEventListener('compositionend', (event) => {
      composing = false;
      state.query.q = event?.target?.value ?? q.value;
      scheduleSearch();
      if (renderDeferred) controller.render();
    });
    form.append(field('bb-gr-q', '名前・別名', q));
    // Looking at another day is rare: it stays under 詳しい条件.
    const asOf = makeElement(doc, 'input', { attrs: { id: 'bb-gr-as-of', name: 'as_of', type: 'date', 'data-focus-key': 'as_of' } });
    asOf.value = state.query.asOfDay;
    asOf.addEventListener('change', (event) => {
      state.query.asOfDay = event?.target?.value ?? asOf.value;
      cancelScheduledSearch();
      void controller.search();
    });
    const advanced = makeElement(doc, 'details', { className: 'bb-gr-advanced' });
    if (state.advancedOpen || state.query.asOfDay) advanced.setAttribute('open', '');
    advanced.addEventListener('toggle', () => { state.advancedOpen = Boolean(advanced.open); });
    advanced.append(
      makeElement(doc, 'summary', { text: '詳しい条件' }),
      field('bb-gr-as-of', '過去のある日の状態で見る', asOf, 'bb-gr-as-of-field'),
      makeElement(doc, 'p', { className: 'bb-gr-hint', text: '日付を選ぶと、その日に有効だった記録だけを、その日の状態で見ます。空なら今日です。' }),
    );
    section.append(form, renderTypeTabs(), advanced);
    if (state.queryMessage) section.append(workspaceNotice(doc, { label: '入力', text: state.queryMessage, tone: 'danger' }));
    const chips = renderActiveFilters();
    if (chips) section.append(chips);
    return section;
  }

  /**
   * The kinds as tabs with their counts: people, companies and projects first.
   * Only kinds with a plain name become tabs (an internal type id is never
   * shown); an unread or unfinished count is left off rather than shown as 0.
   */
  function renderTypeTabs() {
    const read = state.ontology.state === 'ok' && Array.isArray(state.ontology.payload?.entityTypes) ? state.ontology.payload.entityTypes : null;
    const counts = new Map((read ?? []).map((item) => [item.id, item]));
    const selected = state.query.type;
    const ids = (read ? read.map((item) => item.id).filter(hasKindLabel) : DEFAULT_KIND_TABS)
      .map((id, index) => ({ id, index }))
      .sort((left, right) => kindRank(left.id) - kindRank(right.id) || left.index - right.index)
      .map(({ id }) => id)
      .filter((id) => id === selected || counts.get(id)?.count !== 0);
    const tabs = makeElement(doc, 'div', { className: 'bb-gr-tabs', attrs: { role: 'tablist', 'aria-label': '種類' } });
    for (const id of ['', ...ids]) {
      const item = counts.get(id);
      const count = Number.isInteger(item?.count) ? String(item.count)
        : item?.countStatus === 'at_least' && Number.isInteger(item.atLeast) ? `${item.atLeast}+` : null;
      const tab = makeElement(doc, 'button', {
        className: `bb-gr-tab${id === selected ? ' is-selected' : ''}`,
        attrs: { type: 'button', role: 'tab', 'aria-selected': id === selected ? 'true' : 'false', 'data-type': id, 'data-focus-key': `type:${id}` },
      });
      tab.append(makeElement(doc, 'span', { text: id ? kindLabel(id) : 'すべて' }));
      if (count) tab.append(makeElement(doc, 'span', { className: 'bb-gr-tab-count', text: count }));
      tab.addEventListener('click', () => {
        if (state.query.type === id) return;
        state.query.type = id;
        cancelScheduledSearch();
        void controller.search();
      });
      tabs.append(tab);
    }
    return tabs;
  }

  /** The conditions the results were read with, each removable, and すべて外す. */
  function renderActiveFilters() {
    const applied = state.applied;
    const items = [
      applied.q.trim() ? ['q', `名前・別名: ${applied.q.trim()}`] : null,
      applied.type ? ['type', `種類: ${kindLabel(applied.type)}`] : null,
      applied.asOfDay ? ['asOfDay', `${applied.asOfDay} の状態で見ています`] : null,
    ].filter(Boolean);
    if (items.length === 0) return null;
    const bar = makeElement(doc, 'div', { className: 'bb-gr-filters', attrs: { role: 'group', 'aria-label': '今の絞り込み' } });
    bar.append(makeElement(doc, 'span', { className: 'bb-gr-filters-label', text: '絞り込み中' }));
    for (const [key, text] of items) {
      const chip = makeElement(doc, 'button', { className: 'bb-gr-filter-chip', attrs: { type: 'button', 'aria-label': `「${text}」を外す` } });
      chip.append(makeElement(doc, 'span', { text }), makeElement(doc, 'span', { className: 'bb-gr-filter-chip-x', text: '×', attrs: { 'aria-hidden': 'true' } }));
      chip.addEventListener('click', () => controller.clearFilter(key));
      bar.append(chip);
    }
    bar.append(button(doc, 'すべて外す', () => controller.clearFilters(), { className: 'bb-graph-link bb-gr-filters-clear' }));
    return bar;
  }

  function renderResults() {
    const section = makeElement(doc, 'section', { className: 'bb-gr-results', attrs: { 'aria-label': '検索結果', 'aria-busy': state.searching ? 'true' : 'false' } });
    const stateNotice = graphStateNotice(doc, state.search, { onRetry: () => controller.search(), loadingText: '記録を探しています。' });
    if (stateNotice) {
      section.append(stateNotice);
      return section;
    }
    const { payload } = state.search;
    if (payload.graphEmpty === true) {
      const hostEmpty = graphHostEmptyNotice(doc, emptyNotice);
      if (hostEmpty) {
        section.append(hostEmpty);
        return section;
      }
      const dir = textOrNull(payload.source?.dataDir);
      const body = makeElement(doc, 'div', { className: 'bb-graph-notice-body' });
      body.append(
        makeElement(doc, 'p', { text: 'まだ登録がありません。このGraphには、人物・組織・プロジェクト・判断がまだ登録されていません。次のコマンドで始められます。CodexやClaude Codeからは、MCPのオンボーディング（brainbase_onboarding_start）で資料から候補を作り、確かめてから登録できます。' }),
        graphCommandList(doc, [`brainbase onboard:start${dir ? ` --dir ${shellArg(dir)}` : ''}`]),
      );
      section.append(workspaceNotice(doc, { label: '未登録', text: body, tone: 'info', role: 'status' }));
      return section;
    }
    const asOf = payload.query?.asOf ?? null;
    // The day the owner picked; the host may answer the same instant in another time zone.
    const asOfDay = asOf ? state.applied.asOfDay || String(asOf).slice(0, 10) : null;
    section.append(makeElement(doc, 'p', {
      className: 'bb-gr-caption',
      attrs: { role: 'status' },
      text: `${Number.isInteger(payload.total) ? `検索結果 ${payload.total}件` : `検索結果 ${payload.results.length}件を表示（全体の件数は未確認）`}${asOfDay ? `（${asOfDay} の状態）` : ''}${state.searching ? '。新しい条件で探しています…' : ''}`,
    }));
    // 最終更新 is a column only when the host says when records changed; it is never filled with guesses.
    const updated = payload.results.some((entity) => updatedDay(entity));
    section.append(workspaceLedger(doc, {
      className: `bb-graph-entity-ledger${updated ? ' has-updated' : ''}`,
      ariaLabel: '検索結果の一覧',
      columns: updated ? GRAPH_ENTITY_LEDGER_COLUMNS : GRAPH_ENTITY_LEDGER_COLUMNS.slice(0, 3),
      empty: '条件に合う記録はありません。名前・別名や種類、日付の条件を変えるか、上の「すべて外す」で条件を外してください。',
      rows: payload.results.map((entity) => ({
        key: entity.id,
        className: entity.active ? '' : 'is-ended',
        label: `${entity.name}（${kindLabel(entity.type)}）を開く`,
        onSelect: (id) => { void controller.navigate(id); },
        cells: [
          entity.active ? { primary: entity.name } : { primary: entity.name, secondary: validityLabel(entity, asOf ?? now().toISOString()) },
          kindLabel(entity.type),
          textCell(entity.summary, '説明の記録なし'),
          ...(updated ? [updatedDay(entity) ?? { text: '未確認', className: 'is-unresolved' }] : []),
        ],
      })),
    }));
    if (payload.truncated) {
      section.append(workspaceNotice(doc, { label: '一部だけ', text: Number.isInteger(payload.total)
        ? `ほかに${payload.total - payload.results.length}件あります。条件を絞って探してください。`
        : 'ほかにもある可能性があります。条件を絞って探してください。', tone: 'info', role: 'status' }));
    }
    return section;
  }

  /** The record a host's 出典 notice may point at: the selected record once it is read. */
  function sourceSubject() {
    const entity = state.detail?.state === 'ok' ? state.detail.payload.entity : null;
    return entity ? { id: entity.id, type: entity.type, metadata: entity.metadata ?? {} } : null;
  }

  /** Where the records come from: the host's notice, or this Mac's Graph. */
  function sourceNoticeElement() {
    const dir = state.search.state === 'ok' ? textOrNull(state.search.payload.source?.dataDir) : null;
    return workspaceHostNotice(doc, hostSourceNotice(sourceNotice, sourceSubject())) ?? workspaceNotice(doc, {
      label: '出典',
      text: `このMacのGraph${dir ? `（${dir}）` : ''}だけを表示します。ここで直した内容は、同じGraphを読むMCPの search・get_context・resolve_entity で次から使われます。`,
    });
  }

  function renderWorkspace() {
    if (state.detail) return [renderDetailPage()];
    return [
      workspacePageHeader(doc, {
        crumbs: context.crumbs,
        title: '情報と関係',
        lead: writable ? 'Graphに何がどう登録されているかを確かめ、誤りを直します。' : 'Graphに何がどう登録されているかを確かめます。',
        source: context.source,
      }),
      renderSearchForm(),
      renderResults(),
    ];
  }

  // -------------------------------------------------------------------------
  // The record's own screen: what it is, how it connects, the evidence, and how to fix it.

  function openEntityHead() {
    const detail = state.detail;
    return (detail.state === 'ok' ? detail.payload.entity : null) ?? detail.pending ?? { id: detail.id, name: detail.id, type: null };
  }

  function pageSection(title, children, className = '') {
    const section = makeElement(doc, 'section', { className: `bb-gr-page-section${className ? ` ${className}` : ''}`, attrs: { 'aria-label': title } });
    section.append(makeElement(doc, 'h2', { className: 'bb-gr-page-title', text: title }), ...children.filter(Boolean));
    return section;
  }

  /** A relation read as a sentence about this record: 「Acme に所属」「田中 太郎 が参加」. */
  function relationSentence(edge, entity, { link = true } = {}) {
    const line = makeElement(doc, 'span', { className: 'bb-gr-sentence' });
    const name = link
      ? button(doc, edge.counterpart.name, () => controller.navigate(edge.counterpart.id, {
        from: entity,
        pending: { id: edge.counterpart.id, name: edge.counterpart.name, type: edge.counterpart.type },
      }), { className: 'bb-graph-link' })
      : makeElement(doc, 'strong', { text: edge.counterpart.name });
    line.append(name, makeElement(doc, 'span', { text: relationPhrase(edge) }));
    const notes = [textOrNull(edge.role) ? `役割: ${edge.role}` : null, textOrNull(edge.context)].filter(Boolean);
    if (notes.length > 0) line.append(makeElement(doc, 'span', { className: 'bb-gr-sentence-note', text: `（${notes.join('・')}）` }));
    return line;
  }

  /** つながり: every relation in one list, grouped by the kind of the other record. */
  function renderConnections(payload) {
    const { entity } = payload;
    const edges = [...payload.outgoing, ...payload.incoming];
    const children = [];
    const unknown = ['outgoing', 'incoming'].map((direction) => relationAvailability(payload, direction)).find((item) => item.state === 'unknown');
    if (unknown) {
      children.push(workspaceNotice(doc, { label: '確認できない', tone: 'warning', role: 'status', text: unknown.reason }));
      children.push(workspaceActions(doc, [workspaceButton(doc, { text: '再試行', variant: 'quiet', onClick: () => controller.loadEntity(entity.id, { keep: true }) })]));
    }
    if (edges.length === 0) {
      if (!unknown) children.push(makeElement(doc, 'p', { className: 'bb-graph-empty', text: 'この記録とつながる記録はありません。' }));
      return pageSection('つながり', children, 'bb-gr-connections');
    }
    const groups = new Map();
    for (const edge of edges) {
      const kind = kindLabel(edge.counterpart.type);
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push(edge);
    }
    const order = (kind) => {
      const index = Object.values(LEADING_KINDS).indexOf(kind);
      return index < 0 ? Object.keys(LEADING_KINDS).length : index;
    };
    for (const [kind, items] of [...groups].sort(([left], [right]) => order(left) - order(right))) {
      const group = makeElement(doc, 'div', { className: 'bb-gr-connection-group', attrs: { role: 'group', 'aria-label': kind } });
      group.append(makeElement(doc, 'h3', { className: 'bb-gr-connection-kind', text: `${kind}（${items.length}）` }));
      const list = makeElement(doc, 'ul', { className: 'bb-gr-connection-list' });
      for (const edge of items) {
        const item = makeElement(doc, 'li', { className: `bb-gr-connection${edge.active ? '' : ' is-ended'}` });
        item.append(relationSentence(edge, entity));
        // An ended or future relation says when, not only that it is not in effect.
        if (!edge.active) item.append(makeElement(doc, 'span', { className: 'bb-gr-connection-validity', text: validityLabel(edge, payload.asOf) }));
        list.append(item);
      }
      group.append(list);
      children.push(group);
    }
    return pageSection('つながり', children, 'bb-gr-connections');
  }

  /**
   * 根拠と履歴, folded (the shared part): where the record came from, records
   * that could not be read and the corrections, then its period, where each
   * connection came from, and the ids.
   */
  function renderEvidence(payload) {
    const { entity } = payload;
    const edges = [...payload.outgoing, ...payload.incoming];
    const details = renderEvidenceAndHistory(doc, { source: sourceNoticeElement(), issues: payload.issues, history: payload.history });
    const part = (title, ...children) => {
      const block = makeElement(doc, 'section', { className: 'bb-graph-evidence-part' });
      block.append(makeElement(doc, 'h4', { text: title }), ...children.filter(Boolean));
      details.append(block);
    };
    part('有効期間', workspaceDefinition(doc, [
      ['有効期間', validityText(entity.validFrom, entity.validTo)],
      ['読み取った日', formatDay(payload.asOf) ?? textOrNull(payload.asOf)],
    ]));
    if (edges.length > 0) {
      const list = makeElement(doc, 'ul', { className: 'bb-gr-evidence-list', attrs: { 'aria-label': 'つながりの出典' } });
      for (const edge of edges) {
        const item = makeElement(doc, 'li', { className: 'bb-gr-evidence-item' });
        item.append(relationSentence(edge, entity, { link: false }), workspaceDefinition(doc, [
          ['有効期間', validityText(edge.validFrom, edge.validTo)],
          ['出典', renderProvenance(doc, edge.provenance)],
        ]), recordDetails(doc, [
          ['関係ID', edge.id],
          ['関係の種類ID', edge.relation],
          ['起点ID', edge.fromId],
          ['終点ID', edge.toId],
          ['出典ID', edge.provenance.sourceId],
          ['digest', edge.digest],
        ], { title: 'この関係のID（技術情報）' }));
        list.append(item);
      }
      part('つながりの出典', list);
    }
    part('ID', recordDetails(doc, [['記録ID', entity.id], ['種類ID', entity.type], ['digest', entity.digest], ['読み取った時点', payload.asOf]], { title: 'この記録のID（技術情報）' }));
    // The fold's own summary names the part, so no heading repeats it.
    const section = makeElement(doc, 'section', { className: 'bb-gr-page-section bb-gr-evidence-section', attrs: { 'aria-label': '根拠と履歴' } });
    section.append(details);
    return section;
  }

  /** 直す: first what a fix reaches, then the entries; a correction opens where it was asked for. */
  function renderFix(payload) {
    const { entity } = payload;
    const noteSubject = { id: entity.id, type: entity.type, metadata: payload.entity?.metadata ?? {} };
    const edges = [...payload.outgoing, ...payload.incoming];
    if (!writable) {
      const note = hostReadOnlyNote(doc, readOnlyNote, noteSubject);
      return note ? pageSection('直す', [note], 'bb-gr-fix') : null;
    }
    const canFix = scope.entity(entity.type) && scope.fields(graphEntityCorrectionFields(entity.type)).length > 0;
    const relatable = newRelationOptions(entity.type).length > 0 && scope.createEdges;
    const editableEdges = scope.edges ? edges : [];
    const children = [];
    const counterparts = [...new Set(edges.map((edge) => edge.counterpart.name))];
    const reach = makeElement(doc, 'ul', { className: 'bb-graph-plain-list bb-gr-reach' });
    reach.append(makeElement(doc, 'li', { text: `この${kindLabel(entity.type)}を名前・別名で探す検索と、MCPの search・get_context・resolve_entity（次の呼び出しから）` }));
    if (counterparts.length > 0) {
      const shown = counterparts.slice(0, 5).join('、');
      reach.append(makeElement(doc, 'li', { text: `つながる${counterparts.length}件の記録（${shown}${counterparts.length > 5 ? ' ほか' : ''}）の詳細に出る、この記録の名前とつながり` }));
    }
    children.push(makeElement(doc, 'p', { className: 'bb-graph-block-lead', text: '直す前に、影響する先を確かめてください。直した内容は次に効きます。' }), reach);
    const entries = [
      canFix ? '「この記録を直す」' : null,
      relatable ? '「関係を加える」' : null,
      edgesWritable && editableEdges.length > 0 ? '関係ごとの「この関係を直す」' : null,
    ].filter(Boolean);
    if (entries.length > 0) {
      const last = entries.at(-1);
      const list = entries.length === 1 ? last : `${entries.slice(0, -1).join('、')}、または${last}`;
      children.push(makeElement(doc, 'p', {
        className: 'bb-gr-fix-flow',
        text: `誤りを見つけたときの訂正入口です。${list}から変更案を入力します。承認待ちの提出ではなく、保存するとその場でGraphに反映され、理由と変更前後が履歴に残ります。保存後に読み直して一致を確かめ、確認できた内容は、次のMCPの search・get_context・resolve_entity で使われます。`,
      }));
    }
    const actions = [
      canFix ? workspaceButton(doc, { text: 'この記録を直す', onClick: () => openCorrection('entity', () => correction.openEntity(entity, { title: 'この記録を直す' })) }) : null,
      relatable ? workspaceButton(doc, { text: '関係を加える', onClick: () => openCorrection('entity', () => correction.openCreate(entity, { title: '関係を加える' })) }) : null,
    ].filter(Boolean);
    if (actions.length > 0) children.push(workspaceActions(doc, actions));
    // A correction opened on a relation shows inside that relation; any other shows here.
    const inRelation = editableEdges.some((edge) => edge.id === state.panelAt);
    if (!inRelation) children.push(correction.render(doc));
    if (edgesWritable && editableEdges.length > 0) {
      const list = makeElement(doc, 'ul', { className: 'bb-gr-fix-relations', attrs: { 'aria-label': '関係を直す' } });
      for (const edge of editableEdges) {
        const item = makeElement(doc, 'li', { className: 'bb-gr-fix-relation' });
        const subject = edge.direction === 'outgoing'
          ? `${entity.name} → ${relationLabel(edge.relation)} → ${edge.counterpart.name}`
          : `${edge.counterpart.name} → ${relationLabel(edge.relation)} → ${entity.name}`;
        item.append(relationSentence(edge, entity, { link: false }), workspaceButton(doc, {
          text: 'この関係を直す',
          variant: 'quiet',
          onClick: () => openCorrection(edge.id, () => correction.openEdge(edge, { mode: 'edit', subject })),
        }));
        if (state.panelAt === edge.id) {
          const panel = correction.render(doc);
          if (panel) item.append(panel);
        }
        list.append(item);
      }
      children.push(list);
    }
    // The host's reason for a control it withholds, where that control would be.
    if (!canFix || (newRelationOptions(entity.type).length > 0 && !scope.createEdges) || (edges.length > 0 && !scope.edges)) {
      children.push(hostReadOnlyNote(doc, readOnlyNote, noteSubject));
    }
    return pageSection('直す', children, 'bb-gr-fix');
  }

  /**
   * The open record as its own screen: back to the list, its name and kind, then
   * 何者か → つながり → 根拠と履歴 → 直す.  使われた場所 is not drawn: no read path
   * reaches the work, judgments and minutes that mention a record yet.
   */
  function renderDetailPage() {
    const detail = state.detail;
    const loaded = detail.state === 'ok' ? detail.payload : null;
    const entity = openEntityHead();
    const page = makeElement(doc, 'article', { className: 'bb-gr-detail', attrs: { id: DETAIL_ID, 'aria-label': `${entity.name}の詳細` } });
    const nav = makeElement(doc, 'nav', { className: 'bb-gr-detail-nav', attrs: { 'aria-label': '戻る' } });
    nav.append(button(doc, '← 情報と関係の一覧に戻る', () => controller.backToList(), { className: 'bb-graph-link bb-gr-detail-back' }));
    const previous = state.trail[state.trail.length - 1];
    if (previous) nav.append(button(doc, `← 前の記録（${previous.name}）に戻る`, () => controller.back(), { className: 'bb-graph-link bb-gr-detail-back' }));
    page.append(nav);
    const head = makeElement(doc, 'header', { className: 'bb-gr-detail-head' });
    head.append(makeElement(doc, 'small', { className: 'bb-gr-detail-kind', text: entity.type ? kindLabel(entity.type) : '記録' }));
    // The heading keeps focus across the redraw that follows the record's read.
    const title = makeElement(doc, 'h1', { text: entity.name, attrs: { tabindex: '-1', 'data-detail-heading': '', 'data-focus-key': 'detail-heading' } });
    head.append(title);
    if (loaded && !loaded.entity.active) head.append(activityBadge(doc, loaded.entity, loaded.asOf));
    if (state.trail.length > 0) head.append(makeElement(doc, 'p', { className: 'bb-gr-detail-trail', text: `「${state.trail[0].name}」のつながりからたどっています。` }));
    page.append(head);
    if (!loaded) {
      page.append(graphStateNotice(doc, detail, { onRetry: () => controller.loadEntity(detail.id), loadingText: 'この記録を読み込んでいます。' }));
      return page;
    }
    const record = loaded.entity;
    page.append(
      pageSection('何者か', [workspaceDefinition(doc, [
        ['種類', kindLabel(record.type)],
        ['説明', textOrNull(record.summary) ?? { text: '説明の記録なし', className: 'is-unrecorded' }],
        ['別名', record.aliases.length > 0 ? record.aliases.join('、') : { text: 'なし', className: 'is-unrecorded' }],
        ...(record.type === 'project' ? [['目的', textOrNull(record.goal)], ['状態', textOrNull(record.status)]] : []),
        ...(state.applied.asOfDay ? [['見ている日', `${state.applied.asOfDay} の状態`]] : []),
      ])], 'bb-gr-identity'),
      renderConnections(loaded),
      renderEvidence(loaded),
    );
    const fix = renderFix(loaded);
    if (fix) page.append(fix);
    return page;
  }

  /** The rail stays empty: the record opens as its own screen in the workspace. */
  function renderRail() {
    return [];
  }

  function closeCorrection() {
    if (correction.form) correction.close();
    state.panelAt = null;
  }

  function searchParams(query) {
    return { q: query.q.trim(), type: query.type, as_of: asOfParam(query.asOfDay), limit: GRAPH_SEARCH_LIMIT };
  }

  async function readSearch(query) {
    return normalizeSearch(await client.read('/search', searchParams(query)));
  }

  /** The focused search control, so a redraw (which rebuilds the form) can give focus back. */
  function focusedControl() {
    const active = doc.activeElement;
    const key = active?.getAttribute?.('data-focus-key');
    if (!key || typeof root.contains !== 'function' || !root.contains(active)) return null;
    return { key, start: active.selectionStart ?? null, end: active.selectionEnd ?? null };
  }

  function restoreFocus(saved) {
    if (!saved || typeof root.querySelector !== 'function') return;
    const control = root.querySelector(`[data-focus-key="${saved.key}"]`);
    if (!control || doc.activeElement === control) return;
    control.focus?.({ preventScroll: true });
    if (saved.start !== null && typeof control.setSelectionRange === 'function') {
      try { control.setSelectionRange(saved.start, saved.end ?? saved.start); } catch { /* a date field has no caret */ }
    }
  }

  /** Puts the opened record's screen at the top, with focus on its name. */
  function showDetail() {
    if (typeof root.querySelector !== 'function') return;
    const heading = root.querySelector('[data-detail-heading]');
    if (!heading) return;
    heading.scrollIntoView?.({ block: 'start' });
    heading.focus?.({ preventScroll: true });
  }

  // Escape on the record's screen goes back to the list, like 「← 一覧に戻る」.
  root.addEventListener?.('keydown', (event) => {
    if (event?.key !== 'Escape' || !state.detail || correction.form) return;
    event.preventDefault?.();
    controller.backToList();
  });

  const controller = {
    get state() { return state; },
    get correction() { return correction; },
    render() {
      // Redrawing mid-conversion would drop the characters being composed; draw when it ends.
      if (composing) {
        renderDeferred = true;
        return controller;
      }
      renderDeferred = false;
      const saved = focusedControl();
      layout.render(renderWorkspace(), renderRail());
      if (focusRow && !state.detail) {
        // Back on the list: the row of the record just left, in view and focused.
        focusLedgerRow(root, focusRow);
        [...(root.querySelectorAll?.('.bb-ws-ledger-row[data-key]') ?? [])]
          .find((row) => row.getAttribute('data-key') === focusRow)?.scrollIntoView?.({ block: 'center' });
        focusRow = null;
      } else {
        restoreFocus(saved);
      }
      if (revealDetail && state.detail) {
        revealDetail = false;
        showDetail();
      }
      return controller;
    },
    /**
     * Runs the search in the form.  The last results stay on screen while the
     * new ones are read.
     */
    async search() {
      cancelScheduledSearch();
      if (state.query.asOfDay && !dayToRfc3339(state.query.asOfDay)) {
        state.queryMessage = '日付の形式が正しくありません。';
        controller.render();
        return state.search;
      }
      state.queryMessage = null;
      state.applied = { ...state.query };
      if (state.search.state === 'ok') state.searching = true;
      else state.search = { state: 'loading' };
      controller.render();
      const applied = state.applied;
      const result = await readSearch(applied);
      if (state.applied !== applied) return state.search;
      state.searching = false;
      state.search = result;
      controller.render();
      return state.search;
    },
    /** Removes one condition (`q`, `type` or `asOfDay`) and searches again. */
    async clearFilter(key) {
      if (!Object.hasOwn(state.query, key)) return state.search;
      state.query = { ...state.query, [key]: '' };
      const result = controller.search();
      root.querySelector?.('[data-focus-key="q"]')?.focus?.({ preventScroll: true });
      return result;
    },
    /** Removes every condition and searches again. */
    async clearFilters() {
      state.query = { q: '', type: '', asOfDay: '' };
      const result = controller.search();
      root.querySelector?.('[data-focus-key="q"]')?.focus?.({ preventScroll: true });
      return result;
    },
    /**
     * Closes the record's screen and shows the list again, with the row of the
     * record that was opened from it focused.  The host calls this when its
     * address no longer names a record (the browser's back).
     */
    closeEntity() {
      if (!state.detail) return null;
      closeCorrection();
      const anchor = state.anchor;
      state.detail = null;
      state.anchor = null;
      state.trail = [];
      if (anchor) focusRow = anchor;
      controller.render();
      return null;
    },
    /** 「← 一覧に戻る」 and Escape: closes the record and tells the host the address is the list again. */
    backToList() {
      controller.closeEntity();
      onRouteChange?.(null, { back: true });
      return null;
    },
    /** Opens a record the owner chose (a row, or a connection) and tells the host its address. */
    async navigate(id, options = {}) {
      // The address first, while the list is still where the owner left it (the browser keeps that scroll for 戻る).
      onRouteChange?.(id, { back: false });
      return controller.openEntity(id, options);
    },
    /** Reads the last search again without showing it as loading (after a correction). */
    async refreshResults() {
      const applied = state.applied;
      const result = await readSearch(applied);
      if (state.applied !== applied) return state.search;
      state.search = result;
      controller.render();
      return state.search;
    },
    /** `keep` shows the current record until the new one has been read. */
    async loadEntity(id, { keep = false, pending } = {}) {
      const previous = state.detail;
      if (!(keep && previous?.id === id && previous.state === 'ok')) {
        // What is already known about the record (name, kind) heads its detail while it loads.
        const known = pending ?? (previous?.id === id ? previous.payload?.entity ?? previous.pending ?? null : null);
        state.detail = { id, state: 'loading', pending: known ? { id, name: known.name, type: known.type } : null };
        controller.render();
      }
      const result = await client.read(`/entities/${encodeURIComponent(id)}`, { as_of: asOfParam() });
      if (state.detail?.id !== id) return state.detail;
      const base = { id, pending: state.detail.pending ?? null };
      state.detail = result.state === 'error' && result.status === 404
        ? { ...base, state: 'not_found', reason: 'この記録は見つかりません。検索結果から探し直してください。' }
        : { ...base, ...normalizeEntityDetail(result) };
      controller.render();
      return state.detail;
    },
    /**
     * Opens a record as its own screen.  `from` (the record being left) makes
     * 前の記録に戻る return to it; otherwise a new trail starts.  The host calls
     * this for an address that names a record; it does not report back.
     */
    async openEntity(id, { from, pending } = {}) {
      // The host's address catching up with a record already open changes nothing.
      if (!from && state.detail?.id === id) return state.detail;
      closeCorrection();
      if (from) state.trail.push({ id: from.id, name: from.name, type: from.type });
      else {
        state.trail = [];
        state.anchor = id;
      }
      revealDetail = true;
      const listed = state.search.state === 'ok' ? state.search.payload.results.find((entity) => entity.id === id) : null;
      return controller.loadEntity(id, { keep: true, pending: pending ?? listed ?? null });
    },
    async back() {
      closeCorrection();
      const previous = state.trail.pop();
      if (!previous) return state.detail;
      revealDetail = true;
      onRouteChange?.(previous.id, { back: false });
      return controller.loadEntity(previous.id, { pending: previous });
    },
    async loadOntology({ keep = false } = {}) {
      if (!(keep && state.ontology.state === 'ok')) {
        state.ontology = { state: 'loading' };
        controller.render();
      }
      state.ontology = normalizeOntology(await client.read('/ontology'));
      controller.render();
      return state.ontology;
    },
    async load() {
      await Promise.all([controller.search(), controller.loadOntology()]);
      return state;
    },
  };
  controller.render();
  if (autoLoad) {
    void controller.load().then(() => {
      if (initialEntityId) return controller.openEntity(initialEntityId);
      return undefined;
    });
  } else if (initialEntityId) {
    void controller.openEntity(initialEntityId);
  }
  return controller;
}

export default createGraphRegistryView;
