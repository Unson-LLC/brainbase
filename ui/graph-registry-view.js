/*
 * 「情報と関係」: what the local Graph holds, how records are connected, and
 * where to correct a mistake so the next MCP use sees the fix.
 *
 * Built on the organization edition's screen pattern (workspace kit): the
 * workspace has the page head, the source notice, the search, the results
 * ledger and the kinds of information as two ledgers.  A record picked from
 * the results opens right below its row — its outline, the relations going
 * out and coming in, and the corrections — so the owner sees what the click
 * did where they clicked (story-graph-registry-immediate-feedback-v1).  The
 * right rail only says which record is open and moves there.  The search
 * applies as the conditions change, and the conditions in force show as
 * chips that each remove themselves.
 *
 * Reads `GET {base}/search`, `GET {base}/entities/:id` and `GET {base}/ontology`
 * and corrects through `POST {base}/corrections` (see `graph-view-shared.js`).
 * The kinds of information and relations are shown read-only; there is no
 * change proposal here.  The part reads only the Graph routes the host serves
 * at its base path (the local Graph on the OSS host).  The host injects the
 * fetcher, base path, launch token, right rail and page context; this module
 * keeps no global state.  Another host composes it unchanged and adds only its
 * own controls through the options of `createGraphRegistryView`, including the
 * owner's own share in a separate section (`graph-own-share.js`).
 */

import {
  activityBadge,
  badge,
  button,
  createGraphClient,
  createGraphCorrection,
  createGraphLayout,
  dayToRfc3339,
  focusLedgerRow,
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
  isRecord,
  makeElement,
  newRelationOptions,
  ownLabel,
  readOnlyGraphClient,
  recordDetails,
  relationLabel,
  renderCorrectionHistory,
  renderGraphIssues,
  renderProvenance,
  shellArg,
  textOrNull,
  typeLabel,
  validityLabel,
  validityText,
  GRAPH_CORRECTION_FIELDS,
  GRAPH_ENTITY_TYPE_LABELS,
  GRAPH_ENTITY_TYPE_MEANINGS,
  GRAPH_RELATION_LABELS,
  graphHostEmptyNotice,
} from './graph-view-shared.js';
import { graphOwnShareSource, ownEntityDetail, ownShareSection, ownShareStateNotice } from './graph-own-share.js';
import {
  workspaceActions,
  workspaceButton,
  workspaceCombobox,
  workspaceDefinition,
  workspaceDetailEmpty,
  workspaceHostNotice,
  workspaceLedger,
  workspaceNotice,
  workspacePageHeader,
  workspaceRailBlock,
  workspaceRailHead,
  workspaceSectionTitle,
} from './workspace-kit.js';

export const GRAPH_REGISTRY_VIEW_CONTRACT_VERSION = 'brainbase.graph-registry-view.v2';
export const GRAPH_SEARCH_LIMIT = 50;
export const GRAPH_ENTITY_LEDGER_COLUMNS = Object.freeze(['名前', '種類', '要約', '有効期間']);
export const GRAPH_RELATION_TYPE_LEDGER_COLUMNS = Object.freeze(['関係', '起点 → 終点', '意味', '件数']);
export const GRAPH_ENTITY_TYPE_LEDGER_COLUMNS = Object.freeze(['種類', '意味', '件数']);

const INVALID = Object.freeze({ state: 'invalid', reason: '応答の形式が不正です' });
const DETAIL_ID = 'bb-gr-detail';
const ALL_TYPES = Object.freeze(['', 'すべての種類']);
const TYPE_FILTERS = Object.freeze([ALL_TYPES, ...Object.entries(GRAPH_ENTITY_TYPE_LABELS)]);

/**
 * The kinds the search can filter by: the entity types the host's `/ontology`
 * answer lists (an unknown type shows its raw id), or the local Graph's four
 * kinds until that answer has been read.
 */
function graphTypeFilters(ontologyState) {
  const types = ontologyState?.state === 'ok' && Array.isArray(ontologyState.payload?.entityTypes) ? ontologyState.payload.entityTypes : [];
  if (types.length === 0) return TYPE_FILTERS;
  return [ALL_TYPES, ...types.map((item) => [item.id, typeLabel(item.id)])];
}

/** A type's meaning: the plain Japanese one for a local kind, otherwise what the host's answer says. */
function typeMeaning(item) {
  return ownLabel(GRAPH_ENTITY_TYPE_MEANINGS, item.id) ?? textOrNull(item.meaning) ?? '';
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

// A host that could not finish counting sends null (with countStatus
// 'unknown', or 'at_least' plus atLeast) rather than a number it cannot vouch for.
function isCount(value) {
  return value === null || Number.isInteger(value);
}

function countText(item, key = 'count') {
  if (Number.isInteger(item[key])) return `${item[key]}件`;
  if (key === 'count' && item.countStatus === 'at_least' && Number.isInteger(item.atLeast)) return `${item.atLeast}件以上`;
  return '件数は未確認';
}

export function normalizeOntology(result) {
  if (result?.state !== 'ok') return result ?? INVALID;
  const payload = result.payload;
  const entityTypesOk = Array.isArray(payload.entityTypes) && payload.entityTypes.every((item) => isRecord(item)
    && typeof item.id === 'string' && isCount(item.count));
  const relationsOk = Array.isArray(payload.relations) && payload.relations.every((item) => isRecord(item)
    && typeof item.id === 'string' && typeof item.from === 'string' && typeof item.to === 'string'
    && isCount(item.count) && isCount(item.activeCount));
  if (!entityTypesOk || !relationsOk || !isRecord(payload.ontology)) return INVALID;
  return { state: 'ok', payload };
}

function fieldNames(fields) {
  return (Array.isArray(fields) ? fields : []).map((field) => GRAPH_CORRECTION_FIELDS[field]?.label ?? field).join('・');
}

function textCell(value, fallback) {
  return textOrNull(value) ?? { text: fallback, className: 'is-unresolved' };
}

/**
 * Mounts 「情報と関係」.
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
 * @param {boolean} [options.autoLoad=true] Runs the empty search and reads the kinds on mount.
 * @param {number} [options.searchDelayMs=300] How long the name field waits after the last keystroke
 *   before it searches (never while a Japanese conversion is still being composed).
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
 *   control of the selected record, a note shown in the rail where the correction buttons would be.
 *   Without it the rail says nothing about corrections.
 * @param {{ label?: string, text: string | Element }} [options.emptyNotice] Replaces the 未登録 notice
 *   and its `brainbase onboard:*` commands when the host's Graph has nothing registered.
 * @param {{ label?: string, text: string | Element }} [options.sourceNotice] Replaces the default 出典 notice.
 * @param {{ basePath: string, fetcher?: Function, label?: string }} [options.ownShare]
 *   The owner's own snapshot the host keeps for them (`graph-own-share.js`): the same search runs on
 *   `{basePath}/search` and its results are shown read-only in a separate section after the host's
 *   results, labelled 「引き継いだ自分の分（組織には未反映）」 unless `label` says otherwise; a record
 *   opens below them from `{basePath}/entities/:id`, with a decision's judgment record.  They never
 *   enter the host's results or rail, and a failed read shows only in that section.  The host's
 *   results are then captioned as the organization's.  Without it nothing of the kind is drawn or read.
 *
 * The type filter lists the entity types of the `/ontology` answer once it has
 * been read (the four local kinds until then).  A type without a plain label
 * shows its raw id in the filter, the results ledger and the rail.
 *
 * @returns The controller: `state`, `correction`, `render()`, `load()`, `search()`,
 *   `refreshResults()`, `loadEntity(id)`, `openEntity(id)`, `back()`, `loadOntology()`, and with
 *   `ownShare` `searchOwn()` and `openOwnEntity(id)`.
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
  now = () => new Date(),
  canCorrect = true,
  correctionScope,
  readOnlyNote,
  sourceNotice,
  emptyNotice,
  ownShare,
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = getDocument(explicitDocument);
  const graphClient = createGraphClient({ fetcher, basePath, token, ...(tokenHeader ? { tokenHeader } : {}) });
  const own = graphOwnShareSource(ownShare, { fetcher });
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
    // The owner's own share: the same search on its own routes, and its own open record.
    own: own ? { search: { state: 'loading' }, detail: null } : null,
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
    const q = makeElement(doc, 'input', { attrs: { id: 'bb-gr-q', name: 'q', type: 'search', maxlength: 200, placeholder: '例: 田中', autocomplete: 'off', 'data-focus-key': 'q' } });
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
    const typeField = makeElement(doc, 'div', { className: 'bb-graph-field' });
    const typeBox = workspaceCombobox(doc, {
      label: '種類',
      options: graphTypeFilters(state.ontology).map(([value, label]) => ({ value, label })),
      value: state.query.type,
      placeholder: 'すべての種類',
      className: 'bb-gr-type-combobox',
      onChange: (value) => {
        state.query.type = value;
        cancelScheduledSearch();
        void controller.search();
      },
    });
    typeBox.trigger.setAttribute('id', 'bb-gr-type');
    typeBox.trigger.setAttribute('data-focus-key', 'type');
    typeField.append(makeElement(doc, 'label', { text: '種類', attrs: { for: 'bb-gr-type' } }), typeBox.root);
    // The day filter is kept out of the way: few owners need to look at another day.
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
      field('bb-gr-as-of', 'この日に有効だった記録だけ（空なら今日）', asOf, 'bb-gr-as-of-field'),
      makeElement(doc, 'p', { className: 'bb-gr-hint', text: '日付を選ぶと、その日にはまだ始まっていない記録と、もう終わっていた記録を外して見ます。' }),
    );
    form.append(field('bb-gr-q', '名前・別名', q), typeField);
    section.append(form, advanced);
    if (state.queryMessage) section.append(workspaceNotice(doc, { label: '入力', text: state.queryMessage, tone: 'danger' }));
    const chips = renderActiveFilters();
    if (chips) section.append(chips);
    return section;
  }

  /** The conditions the results were read with, each removable, and すべて外す. */
  function renderActiveFilters() {
    const applied = state.applied;
    const items = [
      applied.q.trim() ? ['q', `名前・別名: ${applied.q.trim()}`] : null,
      applied.type ? ['type', `種類: ${typeLabel(applied.type)}`] : null,
      applied.asOfDay ? ['asOfDay', `${applied.asOfDay} の時点で有効なもの`] : null,
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

  /** Where the open record hangs: under its row when the results list it, otherwise above them. */
  function anchoredRow() {
    if (!state.detail || state.search.state !== 'ok') return null;
    const key = state.anchor ?? state.detail.id;
    return state.search.payload.results.some((entity) => entity.id === key) ? key : null;
  }

  function renderResults() {
    const section = makeElement(doc, 'section', { className: 'bb-gr-results', attrs: { 'aria-label': '検索結果', 'aria-busy': state.searching ? 'true' : 'false' } });
    const stateNotice = graphStateNotice(doc, state.search, { onRetry: () => controller.search(), loadingText: '記録を探しています。' });
    const rowKey = anchoredRow();
    // A record not among the results (an address that named it, or a search still being read) opens above them.
    const detailAbove = state.detail && !rowKey ? renderDetail() : null;
    if (stateNotice) {
      section.append(...[detailAbove, stateNotice].filter(Boolean));
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
      // Next to the owner's own share, these results are named as the organization's.
      text: `${own ? '組織のGraphの' : ''}${Number.isInteger(payload.total) ? `検索結果 ${payload.total}件` : `検索結果 ${payload.results.length}件を表示（全体の件数は未確認）`}${asOfDay ? `（${asOfDay} の時点で有効なもの）` : ''}${state.searching ? '。新しい条件で探しています…' : ''}`,
    }));
    if (detailAbove) section.append(detailAbove);
    section.append(workspaceLedger(doc, {
      className: 'bb-graph-entity-ledger',
      ariaLabel: '検索結果の一覧',
      columns: GRAPH_ENTITY_LEDGER_COLUMNS,
      empty: '条件に合う記録はありません。名前・別名や種類、日付の条件を変えるか、上の「すべて外す」で条件を外してください。',
      rows: payload.results.map((entity) => ({
        key: entity.id,
        selected: entity.id === rowKey,
        className: entity.active ? '' : 'is-ended',
        expandable: true,
        // Pressing the open row again closes its detail.
        onSelect: (id) => {
          focusRow = id;
          if (id === rowKey) controller.closeEntity();
          else void controller.openEntity(id);
        },
        ...(entity.id === rowKey ? { detail: renderDetail(), detailId: DETAIL_ID } : {}),
        cells: [
          { primary: entity.name, secondary: entity.id },
          typeLabel(entity.type),
          textCell(entity.summary, '要約は未登録'),
          validityLabel(entity, asOf ?? now().toISOString()),
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

  function renderOntology() {
    const section = makeElement(doc, 'section', { className: 'bb-gr-ontology', attrs: { 'aria-label': '情報の種類とつながり方' } });
    section.append(workspaceSectionTitle(doc, {
      title: '情報の種類とつながり方',
      lead: 'Graphに登録できる情報の種類と、種類どうしのつながり方です。この欄は表示だけです。',
    }));
    const stateNotice = graphStateNotice(doc, state.ontology, { onRetry: () => controller.loadOntology(), loadingText: '情報の種類を読み込んでいます。' });
    if (stateNotice) {
      section.append(stateNotice);
      return section;
    }
    const { payload } = state.ontology;
    const ontology = payload.ontology;
    const version = textOrNull(ontology.version);
    const currentVersion = textOrNull(ontology.currentVersion);
    const freshness = ontology.upToDate === false && currentVersion
      ? `最新ではありません。最新は ${currentVersion}`
      : ontology.upToDate === true && version ? '最新' : '最新性は未確認';
    section.append(makeElement(doc, 'p', {
      className: 'bb-gr-caption',
      text: `定義の版 ${version ?? '未確認'}（${freshness}）`,
    }));
    section.append(makeElement(doc, 'h3', { className: 'bb-gr-subheading', text: 'つながり方' }));
    section.append(workspaceLedger(doc, {
      className: 'bb-graph-relation-type-ledger',
      ariaLabel: 'つながり方',
      columns: GRAPH_RELATION_TYPE_LEDGER_COLUMNS,
      rows: payload.relations.map((item) => ({
        key: item.id,
        cells: [
          relationLabel(item.id),
          `${typeLabel(item.from)} → ${typeLabel(item.to)}`,
          ownLabel(GRAPH_RELATION_LABELS, item.id)?.meaning ?? textOrNull(item.meaning) ?? '',
          Number.isInteger(item.count) && Number.isInteger(item.activeCount)
            ? `${item.count}件（うち有効 ${item.activeCount}件）`
            : countText(item),
        ],
      })),
    }));
    section.append(makeElement(doc, 'h3', { className: 'bb-gr-subheading', text: '情報の種類' }));
    section.append(workspaceLedger(doc, {
      className: 'bb-graph-entity-type-ledger',
      ariaLabel: '情報の種類',
      columns: GRAPH_ENTITY_TYPE_LEDGER_COLUMNS,
      rows: payload.entityTypes.map((item) => ({
        key: item.id,
        cells: [typeLabel(item.id), typeMeaning(item), countText(item)],
      })),
    }));
    const corrections = writable && isRecord(payload.corrections) ? payload.corrections : null;
    if (corrections) {
      section.append(makeElement(doc, 'h3', { className: 'bb-gr-subheading', text: 'この画面で直せること' }));
      const list = makeElement(doc, 'ul', { className: 'bb-graph-plain-list' });
      list.append(
        makeElement(doc, 'li', { text: `記録: ${fieldNames(corrections.entityFields)}（プロジェクトは${fieldNames(corrections.projectFields)}も）` }),
        makeElement(doc, 'li', { text: `関係: ${fieldNames(corrections.edgeFields)}` }),
        makeElement(doc, 'li', { text: `新しく加えられる関係: ${(Array.isArray(corrections.newEdgeRelations) ? corrections.newEdgeRelations : []).map(relationLabel).join('・')}` }),
        makeElement(doc, 'li', { text: '記録と関係は削除しません。終わったものは終了日で表します。関係の種類や相手を変えるときは、今の関係を終えてから新しく加えます。' }),
      );
      section.append(list);
    }
    section.append(recordDetails(doc, [
      ['定義ID', textOrNull(ontology.id) ?? '未確認'],
      ['定義の版', version ?? '未確認'],
      ['release digest', textOrNull(ontology.releaseDigest) ?? '未確認'],
    ], { title: 'この定義のID（技術情報）' }));
    return section;
  }

  /** The record a host's 出典 notice may point at: the selected record once it is read. */
  function sourceSubject() {
    const entity = state.detail?.state === 'ok' ? state.detail.payload.entity : null;
    return entity ? { id: entity.id, type: entity.type, metadata: entity.metadata ?? {} } : null;
  }

  function renderWorkspace() {
    const dir = state.search.state === 'ok' ? textOrNull(state.search.payload.source?.dataDir) : null;
    return [
      workspacePageHeader(doc, {
        crumbs: context.crumbs,
        title: '情報と関係',
        lead: writable ? 'Graphに何がどう登録されているかを確かめ、誤りを直します。' : 'Graphに何がどう登録されているかを確かめます。',
        source: context.source,
      }),
      workspaceHostNotice(doc, hostSourceNotice(sourceNotice, sourceSubject())) ?? workspaceNotice(doc, {
        label: '出典',
        text: `このMacのGraph${dir ? `（${dir}）` : ''}だけを表示します。ここで直した内容は、同じGraphを読むMCPの search・get_context・resolve_entity で次から使われます。`,
      }),
      renderSearchForm(),
      renderResults(),
      own ? renderOwnShare() : null,
      renderOntology(),
    ];
  }

  /** The owner's own share: the same search on its own routes, never among the host's results. */
  function renderOwnShare() {
    const ownState = state.own;
    const notice = ownShareStateNotice(doc, ownState.search, { onRetry: () => controller.searchOwn(), loadingText: '引き継いだ自分の分を探しています。' });
    if (notice) return ownShareSection(doc, { label: own.label, children: [notice] });
    const { payload } = ownState.search;
    const asOf = payload.query?.asOf ?? null;
    const children = [makeElement(doc, 'p', {
      className: 'bb-gr-caption',
      text: `${payload.graphEmpty === true ? '束に記録がありません' : `検索結果 ${payload.total}件`}${payload.truncated ? `（うち${payload.results.length}件を表示）` : ''}`,
    })];
    if (payload.graphEmpty !== true) {
      children.push(workspaceLedger(doc, {
        className: 'bb-graph-entity-ledger bb-graph-own-ledger',
        ariaLabel: `${own.label}の検索結果`,
        columns: GRAPH_ENTITY_LEDGER_COLUMNS,
        empty: '条件に合う記録は、この束にはありません。',
        rows: payload.results.map((entity) => ({
          key: entity.id,
          selected: entity.id === ownState.detail?.id,
          className: entity.active ? '' : 'is-ended',
          onSelect: (id) => { void controller.openOwnEntity(id); },
          cells: [
            { primary: entity.name, secondary: entity.id },
            typeLabel(entity.type),
            textCell(entity.summary, '要約は未登録'),
            validityLabel(entity, asOf ?? now().toISOString()),
          ],
        })),
      }));
    }
    if (ownState.detail) {
      children.push(ownEntityDetail(doc, ownState.detail, {
        onClose: () => controller.openOwnEntity(null),
        onRetry: () => controller.openOwnEntity(ownState.detail.id),
        onOpen: (id) => controller.openOwnEntity(id),
      }));
    }
    return ownShareSection(doc, { label: own.label, handover: payload.handover, children });
  }

  // -------------------------------------------------------------------------
  // Right rail

  function relationItem(edge, entity, asOf) {
    const labels = ownLabel(GRAPH_RELATION_LABELS, edge.relation);
    const item = makeElement(doc, 'li', { className: `bb-graph-compact${edge.active ? '' : ' is-ended'}` });
    const head = makeElement(doc, 'div', { className: 'bb-graph-compact-head' });
    const phrase = makeElement(doc, 'span', { className: 'bb-graph-relation' });
    phrase.append(
      badge(doc, relationLabel(edge.relation), 'accent'),
      button(doc, edge.counterpart.name, () => controller.openEntity(edge.counterpart.id, {
        from: entity,
        pending: { id: edge.counterpart.id, name: edge.counterpart.name, type: edge.counterpart.type },
      }), { className: 'bb-graph-link' }),
      makeElement(doc, 'span', { text: labels ? (edge.direction === 'outgoing' ? labels.outgoing : labels.incoming) : '' }),
    );
    head.append(phrase, activityBadge(doc, edge, asOf));
    item.append(head, workspaceDefinition(doc, [
      ['関係の意味', labels?.meaning ?? edge.relation],
      ['相手の種類', typeLabel(edge.counterpart.type)],
      ['役割', textOrNull(edge.role)],
      ...(textOrNull(edge.context) ? [['文脈', edge.context]] : []),
      ['有効期間', validityText(edge.validFrom, edge.validTo)],
      ['出典', renderProvenance(doc, edge.provenance)],
    ]));
    const subject = edge.direction === 'outgoing'
      ? `${entity.name} → ${relationLabel(edge.relation)} → ${edge.counterpart.name}`
      : `${edge.counterpart.name} → ${relationLabel(edge.relation)} → ${entity.name}`;
    if (edgesWritable) {
      item.append(workspaceActions(doc, [
        workspaceButton(doc, { text: 'この関係を直す', variant: 'quiet', onClick: () => openCorrection(edge.id, () => correction.openEdge(edge, { mode: 'edit', subject })) }),
      ]));
    }
    item.append(recordDetails(doc, [
      ['関係ID', edge.id],
      ['関係の種類ID', edge.relation],
      ['起点ID', edge.fromId],
      ['終点ID', edge.toId],
      ['出典ID', edge.provenance.sourceId],
      ['digest', edge.digest],
    ], { title: 'この関係のID（技術情報）' }));
    if (edgesWritable && state.panelAt === edge.id) {
      const panel = correction.render(doc);
      if (panel) item.append(panel);
    }
    return item;
  }

  function renderRelations(payload, direction) {
    const { entity } = payload;
    const kind = typeLabel(entity.type);
    const outgoing = direction === 'outgoing';
    const content = [makeElement(doc, 'p', {
      className: 'bb-graph-block-lead',
      text: outgoing
        ? `この${kind}が起点になっている関係です。相手の名前を押すと、その記録を開きます。`
        : `ほかの記録からこの${kind}へ向かう関係です。相手の名前を押すと、その記録を開きます。`,
    })];
    const edges = payload[direction];
    if (edges.length === 0) {
      const availability = relationAvailability(payload, direction);
      if (availability.state === 'unknown') {
        content.push(workspaceNotice(doc, {
          label: '未確認',
          tone: 'warning',
          role: 'status',
          text: availability.reason,
        }));
        content.push(workspaceActions(doc, [workspaceButton(doc, {
          text: '再試行',
          variant: 'quiet',
          onClick: () => controller.loadEntity(entity.id, { keep: true }),
        })]));
      } else {
        content.push(makeElement(doc, 'p', { className: 'bb-graph-empty', text: outgoing ? 'この記録から出る関係はありません。' : 'この記録へ入る関係はありません。' }));
      }
    } else {
      const list = makeElement(doc, 'ul', { className: 'bb-graph-compact-list' });
      for (const edge of edges) list.append(relationItem(edge, entity, payload.asOf));
      content.push(list);
    }
    return workspaceRailBlock(doc, { title: outgoing ? '出る関係' : '入る関係', content });
  }

  function validityValue(entity, asOf) {
    const wrap = makeElement(doc, 'span', { className: 'bb-graph-inline-value' });
    wrap.append(makeElement(doc, 'span', { text: validityText(entity.validFrom, entity.validTo) }), activityBadge(doc, entity, asOf));
    return wrap;
  }

  /** What the rail says: which record is open below its row, and a way there. */
  function renderRail() {
    // A host without a rail draws nothing after the workspace: the record is already open in it.
    if (layout.inline) return [];
    const detail = state.detail;
    if (!detail) {
      return [workspaceDetailEmpty(doc, {
        mark: 'G',
        title: '記録を選択',
        text: '検索結果の行を押すと、その行のすぐ下に、別名・要約と、出る関係・入る関係を出典つきで開きます。',
      })];
    }
    const entity = openEntityHead();
    return [workspaceRailBlock(doc, {
      title: '開いている記録',
      className: 'bb-gr-rail-open',
      content: [
        workspaceRailHead(doc, { kicker: entity.type ? typeLabel(entity.type) : '記録', title: entity.name, sub: entity.id }),
        makeElement(doc, 'p', { className: 'bb-graph-block-lead', text: '詳細は、検索結果のこの記録の行のすぐ下に開いています。' }),
        workspaceActions(doc, [
          workspaceButton(doc, { text: '詳細へ移る', variant: 'quiet', onClick: () => controller.revealDetail() }),
          workspaceButton(doc, { text: '閉じる', variant: 'quiet', onClick: () => controller.closeEntity() }),
        ]),
      ],
    })];
  }

  function openEntityHead() {
    const detail = state.detail;
    return (detail.state === 'ok' ? detail.payload.entity : null) ?? detail.pending ?? { id: detail.id, name: detail.id, type: null };
  }

  /** The open record, right below the row the owner pressed: its name heads it so it is clear what it details. */
  function renderDetail() {
    const detail = state.detail;
    const panel = makeElement(doc, 'section', { className: 'bb-gr-detail', attrs: { id: DETAIL_ID, 'aria-label': '選んだ記録の詳細' } });
    const children = [];
    const loaded = detail.state === 'ok' ? detail.payload : null;
    const entity = openEntityHead();
    const head = makeElement(doc, 'div', { className: 'bb-gr-detail-head' });
    const heading = workspaceRailHead(doc, {
      kicker: `選んだ記録の詳細・${entity.type ? typeLabel(entity.type) : '記録'}`,
      title: entity.name,
      sub: entity.id,
    });
    heading.setAttribute('tabindex', '-1');
    heading.setAttribute('data-detail-heading', '');
    head.append(heading, button(doc, '閉じる', () => controller.closeEntity(), { className: 'bb-ws-button is-quiet bb-gr-detail-close', attrs: { 'aria-label': `「${entity.name}」の詳細を閉じる` } }));
    children.push(head);
    // Followed from a relation: say where it started and how to go back.
    const previous = state.trail[state.trail.length - 1];
    if (previous) {
      const origin = state.trail[0];
      const trail = makeElement(doc, 'p', { className: 'bb-gr-detail-trail' });
      trail.append(
        makeElement(doc, 'span', { text: `「${origin.name}」の関係からたどっています。` }),
        button(doc, `← 前の記録（${previous.name}）に戻る`, () => controller.back(), { className: 'bb-graph-link bb-graph-back' }),
      );
      children.push(trail);
    }
    if (!loaded) {
      children.push(graphStateNotice(doc, detail, { onRetry: () => controller.loadEntity(detail.id), loadingText: 'この記録を読み込んでいます。' }));
      panel.append(...children.filter(Boolean));
      return panel;
    }
    children.push(renderGraphIssues(doc, loaded.issues));
    // The record a host's read-only note may point at.
    const noteSubject = { id: entity.id, type: entity.type, metadata: loaded.entity?.metadata ?? {} };
    const summaryRows = [
      ['別名', entity.aliases.length > 0 ? entity.aliases.join('、') : { text: 'なし', className: 'is-unrecorded' }],
      ['要約', textOrNull(entity.summary) ?? { text: '要約は未登録', className: 'is-unrecorded' }],
      ['有効期間', validityValue(entity, loaded.asOf)],
      ...(entity.type === 'project' ? [['目的', textOrNull(entity.goal)], ['状態', textOrNull(entity.status)]] : []),
      ...(state.applied.asOfDay ? [['見ている時点', `${state.applied.asOfDay} の時点で有効なものを見ています`]] : []),
    ];
    children.push(workspaceRailBlock(doc, {
      title: '概要',
      content: [
        workspaceDefinition(doc, summaryRows),
        recordDetails(doc, [['記録ID', entity.id], ['種類ID', entity.type], ['digest', entity.digest], ['読み取った時点', loaded.asOf]], { title: 'この記録のID（技術情報）' }),
      ],
    }));
    if (writable) {
      const canFix = scope.entity(entity.type) && scope.fields(graphEntityCorrectionFields(entity.type)).length > 0;
      const relatable = newRelationOptions(entity.type).length > 0;
      const related = loaded.outgoing.length + loaded.incoming.length > 0;
      const correctionEntries = [
        canFix ? '「この記録を直す」' : null,
        relatable && scope.createEdges ? '「関係を加える」' : null,
        related && scope.edges ? '関係ごとの「この関係を直す」' : null,
      ].filter(Boolean);
      if (correctionEntries.length > 0) {
        const lastEntry = correctionEntries.at(-1);
        const entries = correctionEntries.length === 1
          ? lastEntry
          : `${correctionEntries.slice(0, -1).join('、')}、または${lastEntry}`;
        children.push(workspaceRailBlock(doc, {
          title: '訂正の流れ',
          content: makeElement(doc, 'p', {
            text: `誤りを見つけたときの訂正入口です。${entries}から変更案を入力します。承認待ちの提出ではなく、保存するとその場でGraphに反映され、理由と変更前後が履歴に残ります。保存後に読み直して一致を確かめ、確認できた内容は、次のMCPの search・get_context・resolve_entity で使われます。`,
          }),
        }));
      }
      const actions = [
        canFix ? workspaceButton(doc, { text: 'この記録を直す', onClick: () => openCorrection('entity', () => correction.openEntity(entity, { title: 'この記録を直す' })) }) : null,
        relatable && scope.createEdges
          ? workspaceButton(doc, { text: '関係を加える', onClick: () => openCorrection('entity', () => correction.openCreate(entity, { title: '関係を加える' })) })
          : null,
      ].filter(Boolean);
      if (actions.length > 0) children.push(workspaceActions(doc, actions));
      // A correction opened on a relation shows inside that relation; any other shows here.
      const inRelation = [...loaded.outgoing, ...loaded.incoming].some((edge) => edge.id === state.panelAt);
      if (!inRelation) children.push(correction.render(doc));
      // The host's reason for a control it withholds, where that control would be.
      if (!canFix || (relatable && !scope.createEdges) || (related && !scope.edges)) children.push(hostReadOnlyNote(doc, readOnlyNote, noteSubject));
    } else {
      children.push(hostReadOnlyNote(doc, readOnlyNote, noteSubject));
    }
    children.push(renderRelations(loaded, 'outgoing'), renderRelations(loaded, 'incoming'));
    children.push(renderCorrectionHistory(doc, loaded.history));
    panel.append(...children.filter(Boolean));
    return panel;
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

  /** Keeps the open record only while the row it hangs from is among the new results. */
  async function followResults() {
    const detail = state.detail;
    if (!detail) return;
    const key = state.anchor ?? detail.id;
    const listed = state.search.state === 'ok' && state.search.payload.results.some((entity) => entity.id === key);
    if (!listed) {
      closeCorrection();
      state.detail = null;
      state.anchor = null;
      state.trail = [];
      return;
    }
    await controller.loadEntity(detail.id, { keep: true });
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

  /** Brings the open record's heading into view and onto focus, once after the owner opened it. */
  function showDetail({ focus = false } = {}) {
    if (typeof root.querySelector !== 'function') return;
    const heading = root.querySelector('[data-detail-heading]');
    if (!heading) return;
    heading.scrollIntoView?.({ block: 'nearest' });
    if (focus) heading.focus?.({ preventScroll: true });
  }

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
      if (focusRow) {
        focusLedgerRow(root, focusRow);
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
     * new ones are read; the open record stays while its row is among them.
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
      // The owner's own share answers the same search on its own; neither waits on the other's failure.
      const owning = own ? controller.searchOwn() : null;
      const result = await readSearch(applied);
      if (state.applied !== applied) {
        await owning;
        return state.search;
      }
      state.searching = false;
      state.search = result;
      await followResults();
      controller.render();
      await owning;
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
    /** Closes the open record. */
    closeEntity() {
      closeCorrection();
      const anchor = state.anchor;
      state.detail = null;
      state.anchor = null;
      state.trail = [];
      if (anchor) focusRow = anchor;
      controller.render();
      return null;
    },
    /** Moves to the open record below its row (the rail's 詳細へ移る). */
    revealDetail() {
      showDetail({ focus: true });
    },
    /** Runs the applied search on the owner's own share (with `ownShare`); a failure stays in that section. */
    async searchOwn() {
      if (!own) return null;
      const applied = state.applied;
      state.own.search = { state: 'loading' };
      controller.render();
      const result = await own.client.read('/search', searchParams(applied));
      if (state.applied !== applied) return state.own.search;
      // An empty answer is an answer here: the host confirms the whole snapshot was searched.
      state.own.search = result.state === 'ok' && !(Array.isArray(result.payload.results) && result.payload.results.every(isEntityView)) ? INVALID : result;
      const openId = state.own.detail?.id;
      if (openId && !(state.own.search.state === 'ok' && state.own.search.payload.results.some((entity) => entity.id === openId))) state.own.detail = null;
      controller.render();
      return state.own.search;
    },
    /** Opens (or with null closes) a record of the owner's own share below its results. */
    async openOwnEntity(id) {
      if (!own) return null;
      const target = textOrNull(id);
      if (!target) {
        state.own.detail = null;
        controller.render();
        return null;
      }
      const listed = state.own.search.state === 'ok' ? state.own.search.payload.results.find((entity) => entity.id === target) : null;
      const pending = listed ?? (state.own.detail?.state === 'ok' ? [...state.own.detail.payload.outgoing, ...state.own.detail.payload.incoming]
        .map((edge) => edge.counterpart).find((counterpart) => counterpart.id === target) : null) ?? null;
      state.own.detail = { id: target, state: 'loading', pending: pending ? { id: target, name: pending.name, type: pending.type } : null };
      controller.render();
      const result = await own.client.read(`/entities/${encodeURIComponent(target)}`, { as_of: asOfParam() });
      if (state.own.detail?.id !== target) return state.own.detail;
      const base = { id: target, pending: state.own.detail.pending };
      state.own.detail = result.state === 'error' && result.status === 404
        ? { ...base, state: 'not_found', reason: 'この記録は束の中に見つかりません。' }
        : { ...base, ...normalizeEntityDetail(result) };
      controller.render();
      return state.own.detail;
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
     * Opens a record in the rail.  `from` (the record being left) makes 戻る
     * return to it; a row of the results starts a new trail.
     */
    async openEntity(id, { from, pending } = {}) {
      closeCorrection();
      // A relation followed from the open record keeps opening below the same row.
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
