/*
 * 「情報と関係」: what the local Graph holds, how records are connected, and
 * where to correct a mistake so the next MCP use sees the fix.
 *
 * Reads `GET {base}/search`, `GET {base}/entities/:id` and `GET {base}/ontology`
 * and corrects through `POST {base}/corrections` (see `graph-view-shared.js`).
 * The kinds of information and relations are shown read-only; there is no
 * change proposal here.  Only the local Graph is shown: an organization Graph
 * is not read by this part.  The host injects the fetcher, base path and
 * launch token; this module keeps no global state.
 */

import {
  activityBadge,
  badge,
  button,
  createGraphClient,
  createGraphCorrection,
  dayToRfc3339,
  facts,
  getDocument,
  isEdgeView,
  isEntityView,
  isRecord,
  makeElement,
  newRelationOptions,
  notice,
  recordDetails,
  relationLabel,
  renderCorrectionHistory,
  renderGraphIssues,
  renderGraphReadState,
  renderProvenance,
  textOrNull,
  typeLabel,
  validityText,
  GRAPH_CORRECTION_FIELDS,
  GRAPH_ENTITY_TYPE_LABELS,
  GRAPH_ENTITY_TYPE_MEANINGS,
  GRAPH_RELATION_LABELS,
} from './graph-view-shared.js';

export const GRAPH_REGISTRY_VIEW_CONTRACT_VERSION = 'brainbase.graph-registry-view.v1';
export const GRAPH_SEARCH_LIMIT = 50;

const INVALID = Object.freeze({ state: 'invalid', reason: '応答の形式が不正です' });
const TYPE_FILTERS = Object.freeze([['', 'すべての種類'], ...Object.entries(GRAPH_ENTITY_TYPE_LABELS)]);

function shellArg(value) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value) ? value : JSON.stringify(value);
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

export function normalizeOntology(result) {
  if (result?.state !== 'ok') return result ?? INVALID;
  const payload = result.payload;
  const entityTypesOk = Array.isArray(payload.entityTypes) && payload.entityTypes.every((item) => isRecord(item)
    && typeof item.id === 'string' && Number.isInteger(item.count));
  const relationsOk = Array.isArray(payload.relations) && payload.relations.every((item) => isRecord(item)
    && typeof item.id === 'string' && typeof item.from === 'string' && typeof item.to === 'string'
    && Number.isInteger(item.count) && Number.isInteger(item.activeCount));
  if (!entityTypesOk || !relationsOk || !isRecord(payload.ontology)) return INVALID;
  return { state: 'ok', payload };
}

function block(doc, label, heading, lead) {
  const section = makeElement(doc, 'section', { className: 'bb-graph-block', attrs: { 'aria-label': label } });
  const head = makeElement(doc, 'div', { className: 'bb-graph-block-head' });
  head.append(makeElement(doc, 'h3', { className: 'bb-graph-heading', text: heading }));
  if (lead) head.append(makeElement(doc, 'p', { className: 'bb-graph-lead', text: lead }));
  section.append(head);
  return { section, head };
}

function tableOf(doc, className, headings, rows) {
  const table = makeElement(doc, 'table', { className: `bb-graph-table ${className}` });
  const thead = makeElement(doc, 'thead');
  const headRow = makeElement(doc, 'tr');
  for (const heading of headings) headRow.append(makeElement(doc, 'th', { text: heading, attrs: { scope: 'col' } }));
  thead.append(headRow);
  const tbody = makeElement(doc, 'tbody');
  for (const cells of rows) {
    const row = makeElement(doc, 'tr');
    cells.forEach((value, index) => row.append(makeElement(doc, 'td', { text: value, attrs: { 'data-label': headings[index] } })));
    tbody.append(row);
  }
  table.append(thead, tbody);
  return table;
}

function fieldNames(fields) {
  return (Array.isArray(fields) ? fields : []).map((field) => GRAPH_CORRECTION_FIELDS[field]?.label ?? field).join('・');
}

export function createGraphRegistryView({
  root,
  document: explicitDocument,
  fetcher,
  basePath = '/api/graph',
  token,
  tokenHeader,
  autoLoad = true,
  now = () => new Date(),
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = getDocument(explicitDocument);
  const client = createGraphClient({ fetcher, basePath, token, ...(tokenHeader ? { tokenHeader } : {}) });
  const state = {
    query: { q: '', type: '', asOfDay: '' },
    queryMessage: null,
    search: { state: 'loading' },
    searchStale: false,
    detail: null,
    trail: [],
    ontology: { state: 'loading' },
  };

  const correction = createGraphCorrection({
    client,
    now,
    rerender: () => controller.render(),
    onSaved: async () => {
      state.searchStale = true;
      if (state.detail) await controller.loadEntity(state.detail.id, { keep: true });
      void controller.loadOntology({ keep: true });
    },
    onConflict: async () => {
      if (state.detail) await controller.loadEntity(state.detail.id, { keep: true });
    },
  });

  function asOfParam() {
    return state.query.asOfDay ? dayToRfc3339(state.query.asOfDay) : null;
  }

  function renderSearchForm(surface) {
    const { section } = block(doc, '検索', '検索', '名前か別名で探し、種類と有効時点で絞り込みます。空のまま探すと、種類と名前の順に並べて出します。');
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
    for (const [value, label] of TYPE_FILTERS) {
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
    const fields = makeElement(doc, 'div', { className: 'bb-graph-fields bb-gr-search-fields' });
    fields.append(field('bb-gr-q', '名前・別名', q), field('bb-gr-type', '種類', type), field('bb-gr-as-of', '有効時点（空なら今）', asOf));
    const actions = makeElement(doc, 'div', { className: 'bb-graph-actions' });
    actions.append(makeElement(doc, 'button', { className: 'bb-graph-button is-primary', text: '探す', attrs: { type: 'submit' } }));
    form.append(fields, actions);
    section.append(form);
    if (state.queryMessage) section.append(notice(doc, 'danger', state.queryMessage, 'alert'));
    surface.append(section);
  }

  function renderResults(surface) {
    const { section } = block(doc, '検索結果', '検索結果');
    surface.append(section);
    if (!renderGraphReadState(doc, section, state.search, { onRetry: () => controller.search() })) return;
    const { payload } = state.search;
    if (payload.graphEmpty === true) {
      const box = makeElement(doc, 'div', { className: 'bb-graph-state is-muted', attrs: { role: 'status' } });
      const dir = textOrNull(payload.source?.dataDir);
      box.append(
        makeElement(doc, 'strong', { text: 'まだ登録がありません' }),
        makeElement(doc, 'p', { text: 'このGraphには、人物・組織・プロジェクト・判断がまだ登録されていません。次のコマンドで始められます。CodexやClaude Codeからは、MCPのオンボーディング（brainbase_onboarding_start）で資料から候補を作り、確かめてから登録できます。' }),
      );
      const commands = makeElement(doc, 'ol', { className: 'bb-graph-commands' });
      const item = makeElement(doc, 'li');
      item.append(makeElement(doc, 'code', { text: `brainbase onboard:start${dir ? ` --dir ${shellArg(dir)}` : ''}` }));
      commands.append(item);
      box.append(commands);
      section.append(box);
      return;
    }
    if (payload.results.length === 0) {
      section.append(notice(doc, 'muted', '条件に合う記録はありません。名前や別名、種類、有効時点を変えて探してください。'));
      return;
    }
    section.append(makeElement(doc, 'p', { className: 'bb-graph-lead', text: `${payload.total}件${payload.query?.asOf ? `（${String(payload.query.asOf).slice(0, 10)} の時点で有効なもの）` : ''}` }));
    const list = makeElement(doc, 'ul', { className: 'bb-graph-list' });
    for (const entity of payload.results) {
      const item = makeElement(doc, 'li', { className: `bb-graph-item${entity.active ? '' : ' is-ended'}` });
      const head = makeElement(doc, 'div', { className: 'bb-graph-item-head' });
      head.append(button(doc, entity.name, () => controller.openEntity(entity.id), { className: 'bb-graph-link' }));
      const badges = makeElement(doc, 'span', { className: 'bb-graph-badges' });
      badges.append(badge(doc, typeLabel(entity.type), 'accent'), activityBadge(doc, entity, payload.query?.asOf ?? null));
      head.append(badges);
      item.append(head, facts(doc, [
        ['別名', entity.aliases.length > 0 ? entity.aliases.join('、') : null],
        ['要約', textOrNull(entity.summary)],
        ['有効期間', validityText(entity.validFrom, entity.validTo)],
      ]));
      list.append(item);
    }
    section.append(list);
    if (payload.truncated) {
      section.append(notice(doc, 'muted', `ほかに${payload.total - payload.results.length}件あります。条件を絞って探してください。`));
    }
  }

  function relationItem(edge, entity, asOf) {
    const labels = GRAPH_RELATION_LABELS[edge.relation];
    const item = makeElement(doc, 'li', { className: `bb-graph-item${edge.active ? '' : ' is-ended'}` });
    const head = makeElement(doc, 'div', { className: 'bb-graph-item-head' });
    const phrase = makeElement(doc, 'span', { className: 'bb-graph-relation' });
    phrase.append(
      badge(doc, relationLabel(edge.relation), 'accent'),
      button(doc, edge.counterpart.name, () => controller.openEntity(edge.counterpart.id, { from: entity }), { className: 'bb-graph-link' }),
      makeElement(doc, 'span', { text: labels ? (edge.direction === 'outgoing' ? labels.outgoing : labels.incoming) : '' }),
    );
    head.append(phrase, activityBadge(doc, edge, asOf));
    item.append(head, facts(doc, [
      ['関係の意味', labels?.meaning ?? edge.relation],
      ['相手の種類', typeLabel(edge.counterpart.type)],
      ['役割', textOrNull(edge.role) ?? '未記入'],
      ['文脈', textOrNull(edge.context)],
      ['有効期間', validityText(edge.validFrom, edge.validTo)],
      ['出典', renderProvenance(doc, edge.provenance)],
    ]));
    const subject = edge.direction === 'outgoing'
      ? `${entity.name} → ${relationLabel(edge.relation)} → ${edge.counterpart.name}`
      : `${edge.counterpart.name} → ${relationLabel(edge.relation)} → ${entity.name}`;
    const actions = makeElement(doc, 'div', { className: 'bb-graph-row-actions' });
    actions.append(button(doc, 'この関係を直す', () => correction.openEdge(edge, { mode: 'edit', subject })));
    item.append(actions, recordDetails(doc, [
      ['関係ID', edge.id],
      ['関係の種類ID', edge.relation],
      ['起点ID', edge.fromId],
      ['終点ID', edge.toId],
      ['出典ID', edge.provenance.sourceId],
      ['digest', edge.digest],
    ]));
    return item;
  }

  function renderRelations(surface, payload, direction) {
    const { entity } = payload;
    const kind = typeLabel(entity.type);
    const outgoing = direction === 'outgoing';
    const { section } = block(
      doc,
      outgoing ? '出る関係' : '入る関係',
      outgoing ? `出る関係（この${kind}から）` : `入る関係（この${kind}へ）`,
      outgoing ? 'この記録が起点になっている関係です。相手の名前を押すと、その記録を開きます。' : 'ほかの記録からこの記録へ向かう関係です。相手の名前を押すと、その記録を開きます。',
    );
    const edges = payload[direction];
    if (edges.length === 0) {
      section.append(notice(doc, 'muted', outgoing ? 'この記録から出る関係はありません。' : 'この記録へ入る関係はありません。'));
    } else {
      const list = makeElement(doc, 'ul', { className: 'bb-graph-list' });
      for (const edge of edges) list.append(relationItem(edge, entity, payload.asOf));
      section.append(list);
    }
    surface.append(section);
  }

  function renderDetail(surface) {
    const detail = state.detail;
    const previous = state.trail[state.trail.length - 1];
    surface.append(button(doc, previous ? `← 前の記録（${previous.name}）に戻る` : '← 検索結果に戻る', () => controller.back(), { className: 'bb-graph-back' }));
    if (detail.state !== 'ok') {
      const { section } = block(doc, '記録の詳細', '記録の詳細');
      renderGraphReadState(doc, section, detail, { onRetry: () => controller.loadEntity(detail.id) });
      surface.append(section);
      return;
    }
    const { payload } = detail;
    const { entity } = payload;
    const issues = renderGraphIssues(doc, payload.issues);
    if (issues) surface.append(issues);

    const summary = makeElement(doc, 'section', { className: 'bb-graph-block', attrs: { 'aria-label': '記録の詳細' } });
    const head = makeElement(doc, 'div', { className: 'bb-graph-block-head' });
    const title = makeElement(doc, 'div', { className: 'bb-graph-title-row' });
    title.append(makeElement(doc, 'h3', { className: 'bb-graph-title', text: entity.name }));
    const badges = makeElement(doc, 'span', { className: 'bb-graph-badges' });
    badges.append(badge(doc, typeLabel(entity.type), 'accent'), activityBadge(doc, entity, payload.asOf));
    title.append(badges);
    const actions = makeElement(doc, 'div', { className: 'bb-graph-row-actions' });
    actions.append(button(doc, 'この記録を直す', () => correction.openEntity(entity, { title: 'この記録を直す' })));
    if (newRelationOptions(entity.type).length > 0) {
      actions.append(button(doc, '関係を加える', () => correction.openCreate(entity, { title: '関係を加える' })));
    }
    head.append(title, actions);
    summary.append(head, facts(doc, [
      ['種類', typeLabel(entity.type)],
      ['別名', entity.aliases.length > 0 ? entity.aliases.join('、') : 'なし'],
      ['要約', textOrNull(entity.summary) ?? '未記入'],
      ['有効期間', validityText(entity.validFrom, entity.validTo)],
      ...(entity.type === 'project' ? [['目的', textOrNull(entity.goal) ?? '未記入'], ['状態', textOrNull(entity.status) ?? '未記入']] : []),
      ['見ている時点', state.query.asOfDay ? `${state.query.asOfDay}（有効時点で絞っています）` : null],
    ]));
    summary.append(recordDetails(doc, [['記録ID', entity.id], ['種類ID', entity.type], ['digest', entity.digest], ['読み取った時点', payload.asOf]]));
    surface.append(summary);

    const panel = correction.render(doc);
    if (panel) surface.append(panel);

    renderRelations(surface, payload, 'outgoing');
    renderRelations(surface, payload, 'incoming');
    const history = renderCorrectionHistory(doc, payload.history);
    if (history) surface.append(history);
  }

  function renderOntology(surface) {
    const { section } = block(doc, '情報の種類とつながり方', '情報の種類とつながり方', 'Graphに登録できる情報の種類と、種類どうしのつながり方です。この欄は表示だけです。');
    surface.append(section);
    if (!renderGraphReadState(doc, section, state.ontology, { onRetry: () => controller.loadOntology() })) return;
    const { payload } = state.ontology;
    const ontology = payload.ontology;
    section.append(facts(doc, [
      ['定義の版', ontology.upToDate === false
        ? `${String(ontology.version)}（最新ではありません。最新は ${String(ontology.currentVersion)}）`
        : `${String(ontology.version)}（最新）`],
    ]));
    section.append(makeElement(doc, 'h4', { className: 'bb-graph-subheading', text: '情報の種類' }));
    section.append(tableOf(doc, 'bb-gr-types', ['種類', '意味', '登録数'], payload.entityTypes.map((item) => [
      typeLabel(item.id),
      GRAPH_ENTITY_TYPE_MEANINGS[item.id] ?? '',
      `${item.count}件`,
    ])));
    section.append(makeElement(doc, 'h4', { className: 'bb-graph-subheading', text: 'つながり方' }));
    section.append(tableOf(doc, 'bb-gr-relations', ['つながり', '起点 → 終点', '意味', '登録数'], payload.relations.map((item) => [
      relationLabel(item.id),
      `${typeLabel(item.from)} → ${typeLabel(item.to)}`,
      GRAPH_RELATION_LABELS[item.id]?.meaning ?? '',
      `${item.count}件（うち有効 ${item.activeCount}件）`,
    ])));
    const corrections = isRecord(payload.corrections) ? payload.corrections : null;
    if (corrections) {
      section.append(makeElement(doc, 'h4', { className: 'bb-graph-subheading', text: 'この画面で直せること' }));
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
  }

  const controller = {
    get state() { return state; },
    get correction() { return correction; },
    render() {
      root.replaceChildren();
      const surface = makeElement(doc, 'section', {
        className: 'bb-graph bb-gr',
        attrs: { 'data-contract-version': GRAPH_REGISTRY_VIEW_CONTRACT_VERSION, 'aria-label': '情報と関係' },
      });
      const header = makeElement(doc, 'header', { className: 'bb-graph-header' });
      header.append(
        makeElement(doc, 'h2', { text: '情報と関係' }),
        makeElement(doc, 'p', { className: 'bb-graph-lead', text: 'Graphに何がどう登録されているかを確かめます。ここで直した内容は、同じGraphを読むMCPの search・get_context・resolve_entity で次から使われます。' }),
      );
      surface.append(header);
      renderSearchForm(surface);
      if (state.detail) renderDetail(surface);
      else renderResults(surface);
      renderOntology(surface);
      root.append(surface);
      return controller;
    },
    /** Runs the search in the form.  Opening a result keeps these results for 戻る. */
    async search() {
      const asOf = asOfParam();
      if (state.query.asOfDay && !asOf) {
        state.queryMessage = '有効時点の日付の形式が正しくありません。';
        controller.render();
        return state.search;
      }
      state.queryMessage = null;
      state.detail = null;
      state.trail = [];
      state.searchStale = false;
      if (correction.form) correction.close();
      state.search = { state: 'loading' };
      controller.render();
      state.search = normalizeSearch(await client.read('/search', {
        q: state.query.q.trim(),
        type: state.query.type,
        as_of: asOf,
        limit: GRAPH_SEARCH_LIMIT,
      }));
      controller.render();
      return state.search;
    },
    /** `keep` shows the current detail until the new one has been read. */
    async loadEntity(id, { keep = false } = {}) {
      const previous = state.detail;
      if (!(keep && previous?.id === id && previous.state === 'ok')) {
        state.detail = { id, state: 'loading' };
        controller.render();
      }
      const result = await client.read(`/entities/${encodeURIComponent(id)}`, { as_of: asOfParam() });
      if (state.detail?.id !== id) return state.detail;
      state.detail = result.state === 'error' && result.status === 404
        ? { id, state: 'not_found', reason: 'この記録は見つかりません。検索結果に戻って探し直してください。' }
        : { id, ...normalizeEntityDetail(result) };
      controller.render();
      return state.detail;
    },
    /** Opens a record; `from` (the record being left) makes 戻る return to it. */
    async openEntity(id, { from } = {}) {
      if (correction.form) correction.close();
      if (from) state.trail.push({ id: from.id, name: from.name });
      return controller.loadEntity(id);
    },
    async back() {
      if (correction.form) correction.close();
      const previous = state.trail.pop();
      if (previous) return controller.loadEntity(previous.id);
      state.detail = null;
      if (state.searchStale) return controller.search();
      controller.render();
      return state.search;
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
