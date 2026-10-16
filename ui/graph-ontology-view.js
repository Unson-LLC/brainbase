/*
 * 「情報の種類とつながり方」: the rules of the Graph (its ontology) — which
 * kinds of record it can hold and how records may be connected.  These are
 * definitions, not records; the records are in 「情報と関係」.
 *
 * Seeing and proposing changes to the definitions is infrequent management
 * work, so a host places this part under its settings (ledger D14, v5).  The
 * part reads `GET {base}/ontology` (see `graph-view-shared.js`) and draws
 * read-only ledgers:
 *
 * - every relation has a plain Japanese name; relations with the same name
 *   are one row with each of their start and end kinds (`groupRelationKinds`);
 *   relation ids appear only in the details;
 * - a count column is drawn only when the host counted something; a count the
 *   host could not finish is 未確認 or a lower bound, never zero (P9).
 *
 * The host injects the fetcher, base path and page context; this module keeps
 * no global state.
 */

import {
  createGraphClient,
  facts,
  getDocument,
  graphPageContext,
  graphStateNotice,
  groupRelationKinds,
  isRecord,
  makeElement,
  ownLabel,
  readOnlyGraphClient,
  recordDetails,
  relationLabel,
  textOrNull,
  typeLabel,
  GRAPH_CORRECTION_FIELDS,
  GRAPH_ENTITY_TYPE_MEANINGS,
  GRAPH_RELATION_LABELS,
} from './graph-view-shared.js';
import {
  workspaceLedger,
  workspacePageHeader,
  workspaceSectionTitle,
} from './workspace-kit.js';

export const GRAPH_ONTOLOGY_VIEW_CONTRACT_VERSION = 'brainbase.graph-ontology-view.v1';
export const GRAPH_ONTOLOGY_TITLE = '情報の種類とつながり方';

const INVALID = Object.freeze({ state: 'invalid', reason: '応答の形式が不正です' });

// A host that could not finish counting sends null (with countStatus
// 'unknown', or 'at_least' plus atLeast) rather than a number it cannot vouch for.
function isCount(value) {
  return value === null || value === undefined || Number.isInteger(value);
}

/** The `/ontology` answer is `ok` when its kinds and relations are well formed. */
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

/** Whether the host counted anything in these rows; without a count the column is not drawn. */
function anyCounted(items) {
  return items.some((item) => Number.isInteger(item.count) || (item.countStatus === 'at_least' && Number.isInteger(item.atLeast)));
}

function countText(item) {
  if (Number.isInteger(item.count)) {
    return Number.isInteger(item.activeCount) ? `${item.count}件（うち有効 ${item.activeCount}件）` : `${item.count}件`;
  }
  if (item.countStatus === 'at_least' && Number.isInteger(item.atLeast)) return `${item.atLeast}件以上`;
  return { text: '未確認', className: 'is-unresolved' };
}

/** The plain names of the kinds a relation starts or ends at (`org・project`, or a list). */
function kindNames(single, list) {
  const ids = Array.isArray(list) && list.length > 0 ? list : String(single ?? '').split(/[・,]/u);
  return ids.map((id) => id.trim()).filter(Boolean).map(typeLabel).join('・');
}

/** One kind of a merged relation row, as a sentence: 組織 → アプリ・プロジェクト（を所有）. */
function kindSentence(item) {
  const phrase = ownLabel(GRAPH_RELATION_LABELS, item.id)?.outgoing;
  return `${kindNames(item.from, item.fromTypes)} → ${kindNames(item.to, item.toTypes)}${phrase ? `（${phrase}）` : ''}`;
}

function fieldNames(fields) {
  return (Array.isArray(fields) ? fields : []).map((field) => GRAPH_CORRECTION_FIELDS[field]?.label ?? field).join('・');
}

/** A type's meaning: the plain Japanese one for a local kind, otherwise what the host's answer says. */
function typeMeaning(item) {
  return ownLabel(GRAPH_ENTITY_TYPE_MEANINGS, item.id) ?? textOrNull(item.meaning) ?? '';
}

/**
 * Draws the definitions of an `ok` ontology state.
 *
 * @param {Document} doc
 * @param {{ payload: object }} ontologyState
 * @param {{ canCorrect?: boolean }} [options] With `canCorrect`, lists what the host lets 情報と関係 correct.
 * @returns {Element[]}
 */
export function renderOntologyDefinitions(doc, { payload }, { canCorrect = false } = {}) {
  const ontology = payload.ontology;
  const version = textOrNull(ontology.version);
  const currentVersion = textOrNull(ontology.currentVersion);
  const freshness = ontology.upToDate === false && currentVersion
    ? `最新ではありません。最新は ${currentVersion}`
    : ontology.upToDate === true && version ? '最新' : '最新性は未確認';
  const children = [makeElement(doc, 'p', { className: 'bb-go-caption', text: `定義の版 ${version ?? '未確認'}（${freshness}）` })];

  const types = payload.entityTypes;
  const typesCounted = anyCounted(types);
  children.push(workspaceSectionTitle(doc, { title: '情報の種類', lead: 'Graphに登録できる記録の種類です。' }));
  children.push(workspaceLedger(doc, {
    className: `bb-go-type-ledger${typesCounted ? ' is-counted' : ''}`,
    ariaLabel: '情報の種類',
    columns: typesCounted ? ['種類', '意味', '件数'] : ['種類', '意味'],
    rows: types.map((item) => ({
      key: item.id,
      cells: [typeLabel(item.id), typeMeaning(item), ...(typesCounted ? [countText(item)] : [])],
    })),
  }));
  if (!typesCounted && types.length > 0) {
    children.push(makeElement(doc, 'p', { className: 'bb-go-note', attrs: { role: 'status' }, text: 'このGraphでは、種類ごとの件数を数えていません。' }));
  }

  const rows = groupRelationKinds(payload.relations);
  const relationsCounted = anyCounted(payload.relations);
  children.push(workspaceSectionTitle(doc, { title: 'つながり方', lead: '記録どうしを、どの種類からどの種類へ、どんな意味でつなげるかの決まりです。同じ意味のつながりは1行にまとめています。' }));
  if (!relationsCounted && rows.length > 0) {
    children.push(makeElement(doc, 'p', { className: 'bb-go-note', attrs: { role: 'status' }, text: 'このGraphでは、つながりの件数を数えていません。' }));
  }
  children.push(workspaceLedger(doc, {
    className: `bb-go-relation-ledger${relationsCounted ? ' is-counted' : ''}`,
    ariaLabel: 'つながり方',
    columns: relationsCounted ? ['つながり', 'つながる種類', '意味', '件数'] : ['つながり', 'つながる種類', '意味'],
    rows: rows.map((row) => {
      const kinds = makeElement(doc, 'ul', { className: 'bb-go-kinds' });
      // Kinds that read the same (has_project and has_engagement, both project → project) are one line.
      for (const sentence of new Set(row.kinds.map(kindSentence))) kinds.append(makeElement(doc, 'li', { text: sentence }));
      const counted = row.kinds.filter((item) => Number.isInteger(item.count));
      const count = counted.length === row.kinds.length
        ? countText({
          count: counted.reduce((sum, item) => sum + item.count, 0),
          activeCount: counted.every((item) => Number.isInteger(item.activeCount)) ? counted.reduce((sum, item) => sum + item.activeCount, 0) : null,
        })
        : row.kinds.length === 1 ? countText(row.kinds[0]) : { text: '一部未確認', className: 'is-unresolved' };
      return {
        key: row.label,
        cells: [row.label, kinds, row.meanings.join('／'), ...(relationsCounted ? [count] : [])],
      };
    }),
  }));
  const ids = makeElement(doc, 'details', { className: 'bb-graph-audit' });
  ids.append(makeElement(doc, 'summary', { text: 'つながりのID' }), facts(doc, rows.map((row) => [row.label, row.kinds.map((item) => item.id).join('・')]), 'bb-graph-facts is-mono'));
  children.push(ids);

  const corrections = canCorrect && isRecord(payload.corrections) ? payload.corrections : null;
  if (corrections) {
    children.push(workspaceSectionTitle(doc, { title: '「情報と関係」で直せること' }));
    const list = makeElement(doc, 'ul', { className: 'bb-graph-plain-list' });
    list.append(
      makeElement(doc, 'li', { text: `記録: ${fieldNames(corrections.entityFields)}（プロジェクトは${fieldNames(corrections.projectFields)}も）` }),
      makeElement(doc, 'li', { text: `関係: ${fieldNames(corrections.edgeFields)}` }),
      makeElement(doc, 'li', { text: `新しく加えられる関係: ${(Array.isArray(corrections.newEdgeRelations) ? corrections.newEdgeRelations : []).map((id) => relationLabel(id)).join('・')}` }),
      makeElement(doc, 'li', { text: '記録と関係は削除しません。終わったものは終了日で表します。関係の種類や相手を変えるときは、今の関係を終えてから新しく加えます。' }),
    );
    children.push(list);
  }
  children.push(recordDetails(doc, [
    ['定義ID', textOrNull(ontology.id) ?? '未確認'],
    ['定義の版', version ?? '未確認'],
    ['release digest', textOrNull(ontology.releaseDigest) ?? '未確認'],
  ]));
  return children;
}

/**
 * Mounts 「情報の種類とつながり方」.
 *
 * @param {object} options
 * @param {Element} options.root Where the screen is drawn.
 * @param {{ crumbs?: string[], source?: string }} [options.page] Breadcrumb and source label of the page head.
 * @param {Document} [options.document]
 * @param {Function} [options.fetcher] `fetch`-compatible function for the Graph routes.
 * @param {string} [options.basePath='/api/graph'] Where the Graph routes are served.
 * @param {boolean} [options.canCorrect=false] Lists what 情報と関係 can correct (the host's answer says what).
 * @param {boolean} [options.autoLoad=true]
 * @returns The controller: `state`, `render()`, `load()`.
 */
export function createGraphOntologyView({
  root,
  page,
  document: explicitDocument,
  fetcher,
  basePath = '/api/graph',
  canCorrect = false,
  autoLoad = true,
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = getDocument(explicitDocument);
  const client = readOnlyGraphClient(createGraphClient({ fetcher, basePath }));
  const context = graphPageContext(page);
  const state = { ontology: { state: 'loading' } };

  const controller = {
    get state() { return state; },
    render() {
      const surface = makeElement(doc, 'section', {
        className: 'bb-graph bb-go',
        attrs: { 'data-contract-version': GRAPH_ONTOLOGY_VIEW_CONTRACT_VERSION, 'aria-label': GRAPH_ONTOLOGY_TITLE },
      });
      surface.append(workspacePageHeader(doc, {
        crumbs: context.crumbs,
        title: GRAPH_ONTOLOGY_TITLE,
        lead: 'Graphに登録できる記録の種類と、記録どうしのつながり方の決まり（オントロジー）です。記録そのものは「情報と関係」で見ます。',
        source: context.source,
      }));
      const notice = graphStateNotice(doc, state.ontology, { onRetry: () => controller.load(), loadingText: '情報の種類を読み込んでいます。' });
      if (notice) surface.append(notice);
      else surface.append(...renderOntologyDefinitions(doc, state.ontology, { canCorrect }).filter(Boolean));
      root.replaceChildren(surface);
      return controller;
    },
    async load() {
      state.ontology = { state: 'loading' };
      controller.render();
      state.ontology = normalizeOntology(await client.read('/ontology'));
      controller.render();
      return state.ontology;
    },
  };
  controller.render();
  if (autoLoad) void controller.load();
  return controller;
}

export default createGraphOntologyView;
