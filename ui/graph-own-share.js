/*
 * 「引き継いだ自分の分」: the owner's own Graph snapshot that a host keeps for
 * them (an OSS Personal OS sent with `brainbase graph:upgrade`), shown next to
 * the host's own Graph and never mixed into it.
 *
 * A host that has such a snapshot passes `ownShare: { basePath }` to
 * 「プロジェクトと関係者」 and 「情報と関係」, and mounts
 * `createOwnObjectivesView` for the objectives.  The section is read-only,
 * has its own label, and reads its own routes with a second client:
 *
 * - `GET {basePath}/projects`, `/projects/:id`, `/search`, `/entities/:id` and
 *   `/objectives` answer the local Graph route shapes (`openOwnerPrivateGraph`
 *   in `graph-web`), with `source.authority: 'owner_private'` and
 *   `handover: { graphId, projectCode, digest, createdAt }` for the snapshot.
 * - `{ status: 'not_handed_over' }` when the owner has sent nothing: the
 *   section says so and shows the commands that send it.
 * - A failed read is shown in this section only.  The host's own Graph keeps
 *   working, and a failure there does not hide this section.
 *
 * Without `ownShare` nothing here is drawn or read (the local host).
 */

import {
  activityBadge,
  badge,
  button,
  createGraphClient,
  formatDateTime,
  formatDay,
  graphCommandList,
  graphStateNotice,
  isRecord,
  makeElement,
  ownLabel,
  readOnlyGraphClient,
  recordDetails,
  relationLabel,
  textOrNull,
  typeLabel,
  validityText,
  GRAPH_RELATION_LABELS,
} from './graph-view-shared.js';
import {
  workspaceDefinition,
  workspaceLedger,
  workspaceNotice,
  workspaceRailBlock,
  workspaceRailHead,
  workspaceSectionTitle,
} from './workspace-kit.js';

export const GRAPH_OWN_SHARE_CONTRACT_VERSION = 'brainbase.graph-own-share.v1';
export const GRAPH_OWN_SHARE_LABEL = '引き継いだ自分の分（組織には未反映）';
export const GRAPH_OWN_OBJECTIVES_LABEL = '引き継いだ自分の目的';
/** Sends the local Graph (`graph:upgrade`) and lists what was sent (`graph:bundles`). */
export const GRAPH_OWN_SHARE_COMMANDS = Object.freeze(['brainbase graph:upgrade', 'brainbase graph:bundles']);
export const GRAPH_OWN_OBJECTIVE_LEDGER_COLUMNS = Object.freeze(['目的', '状態', '評価期間', '責任を持つ人', '基準']);

const OWN_LEAD = '手元のOSSから送った最新の束です。組織の記録ではなく、あなたにだけ表示しています。読み取りのみで、ここでは直せません。';
const OBJECTIVES_LEAD = '手元のOSSから送った最新の束にある目的の定義です。組織の目的ではなく、あなたにだけ表示しています。読み取りのみで、組織の目的には反映しません。';
const PARTICIPATION = Object.freeze({ participates_in: '参加', accountable_for: '責任' });
const ADOPTION_LABELS = Object.freeze({ draft: '下書き', proposed: '提案中', approved: '承認済み', retired: '終了' });
const VISIBILITY_LABELS = Object.freeze({ private: '本人だけ', project: 'プロジェクト', organization: '組織', public: '公開' });
const INVALID = Object.freeze({ state: 'invalid', reason: '応答の形式が不正です' });

/**
 * The host's owner-private source, or null without one: a read-only client
 * for `basePath` (with the part's fetcher unless the option has its own) and
 * the section label.
 */
export function graphOwnShareSource(option, { fetcher } = {}) {
  if (!isRecord(option) || !textOrNull(option.basePath)) return null;
  return Object.freeze({
    client: readOnlyGraphClient(createGraphClient({ fetcher: option.fetcher ?? fetcher, basePath: option.basePath })),
    label: textOrNull(option.label) ?? GRAPH_OWN_SHARE_LABEL,
  });
}

/** What the owner sent: the snapshot ID, where it is kept and when it was sent. */
export function ownShareHandoverText(handover) {
  if (!isRecord(handover) || !textOrNull(handover.graphId)) return null;
  const where = textOrNull(handover.projectCode);
  return `束 ${handover.graphId}（${where ? `置き場所 ${where}、` : ''}${formatDateTime(handover.createdAt)} に送信）`;
}

/**
 * A read state of the own section as a notice, or null when the payload should
 * be drawn.  Not handed over yet shows the commands that send it; a failure is
 * never shown as zero items.
 */
export function ownShareStateNotice(doc, readState, { onRetry, loadingText } = {}) {
  if (readState?.state === 'not_handed_over') {
    const body = makeElement(doc, 'div', { className: 'bb-graph-notice-body' });
    body.append(
      makeElement(doc, 'p', { text: 'まだ引き継いでいません。手元のOSSのGraphを次のコマンドで送ると、ここにあなたにだけ表示されます。送る前に、接続先の設定（BRAINBASE_ORGANIZATION_URL・_TOKEN・_PROJECT・_GRAPH_ID）が要ります。2つ目のコマンドで、送った束を確かめられます。' }),
      graphCommandList(doc, GRAPH_OWN_SHARE_COMMANDS),
    );
    return workspaceNotice(doc, { label: 'まだ引き継いでいません', text: body, tone: 'info', role: 'status' });
  }
  return graphStateNotice(doc, readState, { onRetry, loadingText });
}

/** The section that holds everything of the owner's own share; never part of the host's ledgers. */
export function ownShareSection(doc, { label, lead = OWN_LEAD, handover, children = [], className = '' } = {}) {
  const section = makeElement(doc, 'section', {
    className: `bb-graph-own${className ? ` ${className}` : ''}`,
    attrs: { 'aria-label': label, 'data-contract-version': GRAPH_OWN_SHARE_CONTRACT_VERSION, 'data-authority': 'owner_private' },
  });
  section.append(workspaceSectionTitle(doc, { title: label, lead }));
  const facts = makeElement(doc, 'p', { className: 'bb-graph-own-facts' });
  facts.append(badge(doc, '読み取りのみ', 'muted'));
  const sent = ownShareHandoverText(handover);
  if (sent) facts.append(makeElement(doc, 'span', { text: sent }));
  section.append(facts);
  for (const child of children) if (child) section.append(child);
  return section;
}

function closeButton(doc, onClose) {
  return typeof onClose === 'function' ? button(doc, '閉じる', () => onClose(), { className: 'bb-graph-link bb-graph-own-close' }) : null;
}

function relationItem(doc, edge, asOf, { onOpen, participation = false } = {}) {
  const item = makeElement(doc, 'li', { className: `bb-graph-compact${edge.active ? '' : ' is-ended'}` });
  const head = makeElement(doc, 'div', { className: 'bb-graph-compact-head' });
  const name = typeof onOpen === 'function'
    ? button(doc, edge.counterpart.name, () => onOpen(edge.counterpart.id), { className: 'bb-graph-link' })
    : makeElement(doc, 'strong', { className: 'bb-graph-compact-title', text: edge.counterpart.name });
  const labels = ownLabel(GRAPH_RELATION_LABELS, edge.relation);
  const how = participation ? ownLabel(PARTICIPATION, edge.relation) : null;
  head.append(
    badge(doc, how ?? relationLabel(edge.relation), edge.relation === 'accountable_for' ? 'accent' : ''),
    name,
    makeElement(doc, 'span', { text: how ? '' : labels ? (edge.direction === 'outgoing' ? labels.outgoing : labels.incoming) : '' }),
    activityBadge(doc, edge, asOf),
  );
  item.append(head, workspaceDefinition(doc, [
    ['役割', textOrNull(edge.role)],
    ...(textOrNull(edge.context) ? [['文脈', edge.context]] : []),
    ['有効期間', validityText(edge.validFrom, edge.validTo)],
  ]));
  item.append(recordDetails(doc, [['関係ID', edge.id], ['相手のID', edge.counterpart.id], ['出典ID', edge.provenance?.sourceId ?? null]]));
  return item;
}

function relationList(doc, edges, asOf, options) {
  const list = makeElement(doc, 'ul', { className: 'bb-graph-compact-list' });
  for (const edge of edges) list.append(relationItem(doc, edge, asOf, options));
  return list;
}

/** A selected project of the own share, below its ledger (not in the host's rail). */
export function ownProjectDetail(doc, detail, { onClose, onRetry } = {}) {
  const wrap = makeElement(doc, 'div', { className: 'bb-graph-own-detail', attrs: { 'aria-label': '選んだプロジェクト（引き継いだ自分の分）' } });
  const project = detail?.state === 'ok' ? detail.payload.project : { name: detail?.id ?? '', id: detail?.id ?? '' };
  wrap.append(workspaceRailHead(doc, { kicker: 'プロジェクト（引き継いだ自分の分）', title: project.name, sub: project.id }), closeButton(doc, onClose));
  if (detail?.state !== 'ok') {
    wrap.append(graphStateNotice(doc, detail ?? { state: 'loading' }, { onRetry, loadingText: 'このプロジェクトを読み込んでいます。' }));
    return wrap;
  }
  const { payload } = detail;
  const principles = Array.isArray(project.decisionPrinciples) ? project.decisionPrinciples.filter((item) => textOrNull(item)) : [];
  wrap.append(workspaceRailBlock(doc, {
    title: '概要',
    content: workspaceDefinition(doc, [
      ['状態', textOrNull(project.status)],
      ['目的', textOrNull(project.goal)],
      ['判断の原則', principles.length > 0 ? principles.join('、') : null],
      ['有効期間', validityText(project.validFrom, project.validTo)],
    ]),
  }));
  wrap.append(workspaceRailBlock(doc, {
    title: '関係者',
    content: payload.participants.length === 0
      ? makeElement(doc, 'p', { className: 'bb-graph-empty', text: 'この束には、このプロジェクトの関係者の記録がありません。' })
      : relationList(doc, payload.participants, payload.asOf, { participation: true }),
  }));
  const relations = Array.isArray(payload.relations) ? payload.relations : [];
  if (relations.length > 0) wrap.append(workspaceRailBlock(doc, { title: 'そのほかの関係', content: relationList(doc, relations, payload.asOf) }));
  return wrap;
}

function decisionRecordBlock(doc, entity, record) {
  if (entity.type !== 'decision' || record === undefined) return null;
  if (record === null) {
    return workspaceRailBlock(doc, { title: '判断根拠', content: makeElement(doc, 'p', { className: 'bb-graph-empty', text: 'この束には、この判断の根拠の記録がありません。' }) });
  }
  return workspaceRailBlock(doc, {
    title: '判断根拠',
    content: workspaceDefinition(doc, [
      ['判断', textOrNull(record.decision)],
      ['理由', textOrNull(record.rationale)],
      ['論点', textOrNull(record.topic)],
      ['有効になった日', formatDay(record.effectiveAt)],
      ...(Array.isArray(record.supersedes) && record.supersedes.length > 0 ? [['置き換えた判断', record.supersedes.join('、')]] : []),
    ]),
  });
}

/** A selected record of the own share, below its results (not in the host's rail). */
export function ownEntityDetail(doc, detail, { onClose, onRetry, onOpen } = {}) {
  const wrap = makeElement(doc, 'div', { className: 'bb-graph-own-detail', attrs: { 'aria-label': '選んだ記録（引き継いだ自分の分）' } });
  const loaded = detail?.state === 'ok' ? detail.payload : null;
  const entity = loaded?.entity ?? detail?.pending ?? { id: detail?.id ?? '', name: detail?.id ?? '', type: null };
  wrap.append(workspaceRailHead(doc, { kicker: `${entity.type ? typeLabel(entity.type) : '記録'}（引き継いだ自分の分）`, title: entity.name, sub: entity.id }), closeButton(doc, onClose));
  if (!loaded) {
    wrap.append(graphStateNotice(doc, detail ?? { state: 'loading' }, { onRetry, loadingText: 'この記録を読み込んでいます。' }));
    return wrap;
  }
  wrap.append(workspaceRailBlock(doc, {
    title: '概要',
    content: workspaceDefinition(doc, [
      ['別名', entity.aliases.length > 0 ? entity.aliases.join('、') : null],
      ['要約', textOrNull(entity.summary)],
      ['有効期間', validityText(entity.validFrom, entity.validTo)],
      ...(entity.type === 'project' ? [['目的', textOrNull(entity.goal)], ['状態', textOrNull(entity.status)]] : []),
    ]),
  }));
  wrap.append(decisionRecordBlock(doc, entity, loaded.decisionRecord));
  for (const [key, title, empty] of [['outgoing', '出る関係', 'この記録から出る関係はありません。'], ['incoming', '入る関係', 'この記録へ入る関係はありません。']]) {
    const edges = Array.isArray(loaded[key]) ? loaded[key] : [];
    wrap.append(workspaceRailBlock(doc, {
      title,
      content: edges.length === 0 ? makeElement(doc, 'p', { className: 'bb-graph-empty', text: empty }) : relationList(doc, edges, loaded.asOf, { onOpen }),
    }));
  }
  return wrap;
}

// ---------------------------------------------------------------------------
// 引き継いだ自分の目的

function isObjectiveView(value) {
  return isRecord(value) && typeof value.id === 'string' && typeof value.meaning === 'string'
    && Array.isArray(value.criteria) && Array.isArray(value.beneficiaries);
}

export function normalizeOwnObjectives(result) {
  if (result?.state !== 'ok') return result ?? INVALID;
  const payload = result.payload;
  if (!Array.isArray(payload.objectives) || !payload.objectives.every(isObjectiveView)) return INVALID;
  if (payload.objectives.length === 0 && payload.absenceConfirmed !== true) return { state: 'unknown' };
  return { state: 'ok', payload };
}

function personText(person) {
  return person ? textOrNull(person.name) ?? person.id : null;
}

function criterionText(criterion) {
  const variable = textOrNull(criterion.variable?.meaning) ?? criterion.variable?.id ?? '変数';
  if (criterion.target === null || criterion.target === undefined) return `${variable}（目標値なし）`;
  const value = `${String(criterion.target)}${textOrNull(criterion.variable?.unit) ? ` ${criterion.variable.unit}` : ''}`;
  if (criterion.operator === 'at_least') return `${variable}: ${value}以上`;
  if (criterion.operator === 'at_most') return `${variable}: ${value}以下`;
  return `${variable}: ${value}`;
}

function periodText(period) {
  return `${formatDay(period?.from) ?? '開始日不明'} 〜 ${formatDay(period?.until) ?? '終了日不明'}`;
}

/**
 * Mounts 「引き継いだ自分の目的」: the objectives of the owner's latest
 * snapshot, read-only, from `GET {basePath}/objectives`.
 *
 * @param {object} options
 * @param {Element} options.root Where the section is drawn.
 * @param {Document} [options.document]
 * @param {Function} [options.fetcher] `fetch`-compatible function.
 * @param {string} [options.basePath='/api/graph/own'] The host's owner-private routes.
 * @param {string} [options.label] The section label (default 引き継いだ自分の目的).
 * @param {boolean} [options.autoLoad=true]
 * @returns The controller: `state`, `render()`, `load()`, `select(id)`.
 */
export function createOwnObjectivesView({
  root,
  document: explicitDocument,
  fetcher,
  basePath = '/api/graph/own',
  label = GRAPH_OWN_OBJECTIVES_LABEL,
  autoLoad = true,
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = explicitDocument ?? globalThis.document;
  const source = graphOwnShareSource({ basePath, label }, { fetcher });
  const state = { list: { state: 'loading' }, selectedId: null };

  function detail(objective) {
    const wrap = makeElement(doc, 'div', { className: 'bb-graph-own-detail', attrs: { 'aria-label': '選んだ目的（引き継いだ自分の分）' } });
    wrap.append(
      workspaceRailHead(doc, { kicker: '目的（引き継いだ自分の分）', title: objective.meaning, sub: objective.id }),
      closeButton(doc, () => controller.select(null)),
    );
    const criteria = makeElement(doc, 'ul', { className: 'bb-graph-plain-list' });
    for (const criterion of objective.criteria) criteria.append(makeElement(doc, 'li', { text: criterionText(criterion) }));
    wrap.append(workspaceRailBlock(doc, {
      title: '概要',
      content: [
        workspaceDefinition(doc, [
          ['目指す状態', textOrNull(objective.desiredState)],
          ['評価基準', objective.criteria.length > 0 ? criteria : null],
          ['評価期間', periodText(objective.evaluationPeriod)],
          ['責任を持つ人', personText(objective.accountable)],
          ['受益者', objective.beneficiaries.length > 0 ? objective.beneficiaries.map(personText).join('、') : null],
          ['状態', ownLabel(ADOPTION_LABELS, objective.adoptionState) ?? textOrNull(objective.adoptionState)],
          ['公開範囲（手元での設定）', ownLabel(VISIBILITY_LABELS, objective.visibility) ?? textOrNull(objective.visibility)],
        ]),
        recordDetails(doc, [['目的ID', objective.id], ['版', objective.revision]]),
      ],
    }));
    return wrap;
  }

  function body() {
    const notice = ownShareStateNotice(doc, state.list, { onRetry: () => controller.load(), loadingText: '引き継いだ自分の目的を読み込んでいます。' });
    if (notice) return [notice];
    const { payload } = state.list;
    if (payload.objectives.length === 0) {
      return [makeElement(doc, 'p', { className: 'bb-graph-empty', text: payload.foundation === 'none' ? 'この束には、目的の定義がありません。' : 'この束には、目的がありません。' })];
    }
    const children = [workspaceLedger(doc, {
      className: 'bb-graph-own-ledger bb-graph-own-objective-ledger',
      ariaLabel: `${label}の一覧`,
      columns: GRAPH_OWN_OBJECTIVE_LEDGER_COLUMNS,
      rows: payload.objectives.map((objective) => ({
        key: objective.id,
        selected: objective.id === state.selectedId,
        onSelect: (id) => controller.select(id),
        cells: [
          { primary: objective.meaning, secondary: objective.id },
          ownLabel(ADOPTION_LABELS, objective.adoptionState) ?? String(objective.adoptionState ?? ''),
          periodText(objective.evaluationPeriod),
          personText(objective.accountable) ?? { text: '未登録', className: 'is-unresolved' },
          objective.criteria.length > 0 ? `${objective.criteria.length}件` : { text: 'なし', className: 'is-unresolved' },
        ],
      })),
    })];
    const selected = payload.objectives.find((objective) => objective.id === state.selectedId);
    if (selected) children.push(detail(selected));
    return children;
  }

  const controller = {
    get state() { return state; },
    render() {
      const handover = state.list.state === 'ok' ? state.list.payload.handover : null;
      root.replaceChildren(ownShareSection(doc, { label: source.label, lead: OBJECTIVES_LEAD, handover, children: body(), className: 'bb-graph-own-objectives' }));
      return controller;
    },
    async load() {
      state.list = { state: 'loading' };
      controller.render();
      state.list = normalizeOwnObjectives(await source.client.read('/objectives'));
      if (state.list.state !== 'ok' || !state.list.payload.objectives.some((objective) => objective.id === state.selectedId)) state.selectedId = null;
      controller.render();
      return state.list;
    },
    select(id) {
      state.selectedId = textOrNull(id);
      return controller.render();
    },
  };
  controller.render();
  if (autoLoad) void controller.load();
  return controller;
}
