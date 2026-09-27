/*
 * 「情報と関係」: what the local Graph holds, how records are connected, and
 * where to correct a mistake so the next MCP use sees the fix.
 *
 * Built on the organization edition's screen pattern (workspace kit): the
 * workspace has the page head, the source notice, the search, the results
 * ledger and the kinds of information as two ledgers; the right rail has the
 * selected record — its outline, the relations going out and coming in, and
 * the corrections.
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
 * @param {() => Date} [options.now] The owner's clock.
 * @param {boolean} [options.canCorrect=true] When false, no correction control is drawn anywhere
 *   (この記録を直す, 関係を加える, この関係を直す, and この画面で直せること under the kinds of
 *   information), and the client refuses every correction before sending it.
 * @param {{ entityTypes?: string[], fields?: string[], edges?: boolean, createEdges?: boolean }} [options.correctionScope]
 *   With corrections allowed, only these (see `graphCorrectionScope`): `entityTypes` lists the kinds that
 *   offer この記録を直す, `fields` limits its form, `edges: false` withholds この関係を直す and
 *   `createEdges: false` withholds 関係を加える.  A withheld control is not drawn and the client refuses
 *   such a correction before sending it.  Without it every correction is allowed.
 * @param {string} [options.readOnlyNote] With `canCorrect: false`, or where `correctionScope` withholds a
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
    // `detail` is the record in the rail: { id, state, payload?, pending? }.
    detail: null,
    trail: [],
    ontology: { state: 'loading' },
    // Where the open correction shows: a relation id (inside that relation) or anything else (below the record actions).
    panelAt: null,
    // The owner's own share: the same search on its own routes, and its own open record.
    own: own ? { search: { state: 'loading' }, detail: null } : null,
  };
  let focusRow = null;

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

  function renderSearchForm() {
    const section = makeElement(doc, 'section', { className: 'bb-gr-search-section', attrs: { 'aria-label': '検索' } });
    const form = makeElement(doc, 'form', { className: 'bb-graph-form bb-gr-search', attrs: { role: 'search', novalidate: true } });
    form.addEventListener('submit', (event) => {
      event?.preventDefault?.();
      return controller.search();
    });
    const field = (id, label, control) => {
      const wrap = makeElement(doc, 'div', { className: 'bb-graph-field' });
      wrap.append(makeElement(doc, 'label', { text: label, attrs: { for: id } }), control);
      return wrap;
    };
    const bind = (control, key) => {
      const update = (event) => { state.query[key] = event?.target?.value ?? control.value; };
      control.addEventListener('input', update);
      control.addEventListener('change', update);
    };
    const q = makeElement(doc, 'input', { attrs: { id: 'bb-gr-q', name: 'q', type: 'search', maxlength: 200, placeholder: '例: 田中' } });
    q.value = state.query.q;
    bind(q, 'q');
    const type = makeElement(doc, 'select', { attrs: { id: 'bb-gr-type', name: 'type' } });
    for (const [value, label] of graphTypeFilters(state.ontology)) {
      const option = makeElement(doc, 'option', { text: label, attrs: { value } });
      if (value === state.query.type) {
        option.setAttribute('selected', 'selected');
        option.selected = true;
      }
      type.append(option);
    }
    type.value = state.query.type;
    bind(type, 'type');
    const asOf = makeElement(doc, 'input', { attrs: { id: 'bb-gr-as-of', name: 'as_of', type: 'date' } });
    asOf.value = state.query.asOfDay;
    bind(asOf, 'asOfDay');
    form.append(
      field('bb-gr-q', '名前・別名', q),
      field('bb-gr-type', '種類', type),
      field('bb-gr-as-of', '有効時点（空なら今）', asOf),
      makeElement(doc, 'button', { className: 'bb-ws-button is-primary bb-gr-search-submit', text: '探す', attrs: { type: 'submit' } }),
    );
    section.append(form);
    if (state.queryMessage) section.append(workspaceNotice(doc, { label: '入力', text: state.queryMessage, tone: 'danger' }));
    return section;
  }

  function renderResults() {
    const section = makeElement(doc, 'section', { className: 'bb-gr-results', attrs: { 'aria-label': '検索結果' } });
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
      // Next to the owner's own share, these results are named as the organization's.
      text: `${own ? '組織のGraphの' : ''}${Number.isInteger(payload.total) ? `検索結果 ${payload.total}件` : `検索結果 ${payload.results.length}件を表示（全体の件数は未確認）`}${asOfDay ? `（${asOfDay} の時点で有効なもの）` : ''}`,
    }));
    section.append(workspaceLedger(doc, {
      className: 'bb-graph-entity-ledger',
      ariaLabel: '検索結果の一覧',
      columns: GRAPH_ENTITY_LEDGER_COLUMNS,
      empty: '条件に合う記録はありません。名前や別名、種類、有効時点を変えて探してください。',
      rows: payload.results.map((entity) => ({
        key: entity.id,
        selected: entity.id === state.detail?.id,
        className: entity.active ? '' : 'is-ended',
        onSelect: (id) => {
          focusRow = id;
          void controller.openEntity(id);
        },
        cells: [
          { primary: entity.name, secondary: entity.id },
          typeLabel(entity.type),
          textCell(entity.summary, '要約なし'),
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
    section.append(makeElement(doc, 'p', {
      className: 'bb-gr-caption',
      text: `定義の版 ${ontology.upToDate === false
        ? `${String(ontology.version)}（最新ではありません。最新は ${String(ontology.currentVersion)}）`
        : `${String(ontology.version)}（最新）`}`,
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
    section.append(recordDetails(doc, [['定義ID', ontology.id], ['定義の版', ontology.version], ['release digest', ontology.releaseDigest]]));
    return section;
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
      workspaceHostNotice(doc, sourceNotice) ?? workspaceNotice(doc, {
        label: '出典',
        text: `このMacのGraph${dir ? `（${dir}）` : ''}だけを表示します。ここで直した内容は、同じGraphを読むMCPの search・get_context・resolve_entity で次から使われます。`,
      }),
      state.detail?.state === 'ok' ? renderGraphIssues(doc, state.detail.payload.issues) : null,
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
            textCell(entity.summary, '要約なし'),
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
    ]));
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
      content.push(makeElement(doc, 'p', { className: 'bb-graph-empty', text: outgoing ? 'この記録から出る関係はありません。' : 'この記録へ入る関係はありません。' }));
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

  function renderRail() {
    const detail = state.detail;
    if (!detail) {
      return [workspaceDetailEmpty(doc, {
        mark: 'G',
        title: '記録を選択',
        text: '検索結果から選ぶと、別名・要約と、出る関係・入る関係を出典つきで表示します。',
      })];
    }
    const children = [];
    const previous = state.trail[state.trail.length - 1];
    if (previous) {
      children.push(button(doc, `← 前の記録（${previous.name}）に戻る`, () => controller.back(), { className: 'bb-graph-link bb-graph-back' }));
    }
    const loaded = detail.state === 'ok' ? detail.payload : null;
    const entity = loaded?.entity ?? detail.pending ?? { id: detail.id, name: detail.id, type: null };
    children.push(workspaceRailHead(doc, { kicker: entity.type ? typeLabel(entity.type) : '記録', title: entity.name, sub: entity.id }));
    if (!loaded) {
      children.push(graphStateNotice(doc, detail, { onRetry: () => controller.loadEntity(detail.id), loadingText: 'この記録を読み込んでいます。' }));
      return children;
    }
    const summaryRows = [
      ['別名', entity.aliases.length > 0 ? entity.aliases.join('、') : { text: 'なし', className: 'is-unrecorded' }],
      ['要約', textOrNull(entity.summary)],
      ['有効期間', validityValue(entity, loaded.asOf)],
      ...(entity.type === 'project' ? [['目的', textOrNull(entity.goal)], ['状態', textOrNull(entity.status)]] : []),
      ...(state.applied.asOfDay ? [['見ている時点', `${state.applied.asOfDay}（有効時点で絞っています）`]] : []),
    ];
    children.push(workspaceRailBlock(doc, {
      title: '概要',
      content: [
        workspaceDefinition(doc, summaryRows),
        recordDetails(doc, [['記録ID', entity.id], ['種類ID', entity.type], ['digest', entity.digest], ['読み取った時点', loaded.asOf]]),
      ],
    }));
    if (writable) {
      const canFix = scope.entity(entity.type) && scope.fields(graphEntityCorrectionFields(entity.type)).length > 0;
      const relatable = newRelationOptions(entity.type).length > 0;
      const related = loaded.outgoing.length + loaded.incoming.length > 0;
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
      if (!canFix || (relatable && !scope.createEdges) || (related && !scope.edges)) children.push(hostReadOnlyNote(doc, readOnlyNote));
    } else {
      children.push(hostReadOnlyNote(doc, readOnlyNote));
    }
    children.push(renderRelations(loaded, 'outgoing'), renderRelations(loaded, 'incoming'));
    children.push(renderCorrectionHistory(doc, loaded.history));
    return children;
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

  /** Keeps the record in the rail only when it is among the new results. */
  async function followResults() {
    const detail = state.detail;
    if (!detail) return;
    const listed = state.search.state === 'ok' && state.search.payload.results.some((entity) => entity.id === detail.id);
    if (!listed) {
      closeCorrection();
      state.detail = null;
      state.trail = [];
      return;
    }
    await controller.loadEntity(detail.id, { keep: true });
  }

  const controller = {
    get state() { return state; },
    get correction() { return correction; },
    render() {
      layout.render(renderWorkspace(), renderRail());
      if (focusRow) {
        focusLedgerRow(root, focusRow);
        focusRow = null;
      }
      return controller;
    },
    /** Runs the search in the form.  The record in the rail stays while it is among the results. */
    async search() {
      if (state.query.asOfDay && !dayToRfc3339(state.query.asOfDay)) {
        state.queryMessage = '有効時点の日付の形式が正しくありません。';
        controller.render();
        return state.search;
      }
      state.queryMessage = null;
      state.applied = { ...state.query };
      state.search = { state: 'loading' };
      controller.render();
      const applied = state.applied;
      // The owner's own share answers the same search on its own; neither waits on the other's failure.
      const owning = own ? controller.searchOwn() : null;
      const result = await readSearch(applied);
      if (state.applied !== applied) {
        await owning;
        return state.search;
      }
      state.search = result;
      await followResults();
      controller.render();
      await owning;
      return state.search;
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
        // What is already known about the record (name, kind) heads the rail while it loads.
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
      if (from) state.trail.push({ id: from.id, name: from.name, type: from.type });
      else state.trail = [];
      const listed = state.search.state === 'ok' ? state.search.payload.results.find((entity) => entity.id === id) : null;
      return controller.loadEntity(id, { keep: true, pending: pending ?? listed ?? null });
    },
    async back() {
      closeCorrection();
      const previous = state.trail.pop();
      if (!previous) return state.detail;
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
  if (autoLoad) void controller.load();
  return controller;
}

export default createGraphRegistryView;
