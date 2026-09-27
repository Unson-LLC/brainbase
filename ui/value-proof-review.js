/*
 * Local owner review surface for judgment value proofs.
 *
 * The host supplies a same-origin request function and a review token. A host
 * that cannot read a local journal may replace the unavailable notice. This
 * module owns presentation only: it never treats an unavailable journal as an
 * empty list, never edits the judgment journal, and keeps internal IDs inside
 * the audit details.
 *
 * The screen follows the organization edition's pattern (workspace-kit): page
 * head, the 記録の範囲 notice, filters, metrics, and the 委任の地図 as a ledger
 * of rows the owner selects.  A host that gives a `rail` element gets the
 * selected row or judgment there; without one (the organization edition, the
 * standalone review host) the same detail follows the workspace content.
 */

import {
  workspaceActions,
  workspaceButton,
  workspaceDefinition,
  workspaceDetailEmpty,
  workspaceLedger,
  workspaceMetrics,
  workspaceNotice,
  workspacePageHeader,
  workspaceRailBlock,
  workspaceRailHead,
  workspaceSectionTitle,
} from './workspace-kit.js';

export const VALUE_PROOF_REVIEW_UI_CONTRACT_VERSION = 'value-proof-review-ui.v2';

const SECTION_ORDER = Object.freeze(['needs_human', 'blocked', 'continued']);
const SECTION_LABELS = Object.freeze({
  needs_human: 'あなたの判断が必要',
  blocked: '止まっている',
  continued: '聞かずに進めた',
  other: 'その他',
});
const DELEGATION_STATE_LABELS = Object.freeze({
  delegated: '任せている',
  verifying: '確かめ中',
  returned: '戻している',
});
const DELEGATION_STATES = Object.freeze(Object.keys(DELEGATION_STATE_LABELS));
const DELEGATION_SOURCES = Object.freeze(['judgment_kind', 'reason_code', 'unrecorded']);
const RESOLUTION_LABELS = Object.freeze({
  continued_without_human: '聞かずに続行',
  human_required: 'あなたに戻した',
  not_applicable: '判断の代行なし',
});
const OUTCOME_LABELS = Object.freeze({
  outcome_verified: '成果確認済み',
  unconfirmed: '成果未確認',
  not_applicable: '成果確認の対象外',
});
const BASIS_LAYER_LABELS = Object.freeze({
  philosophy: '大切にすること',
  objective: '目的',
  world_model: '現状と見通し',
  method: '判断方法',
  constraint: '守る条件',
  other: 'その他',
});
const EXECUTION_LABELS = Object.freeze({ not_started: '未着手', executing: '実行中', completed: '完了', blocked: '停止' });
const FEEDBACK_LABELS = Object.freeze({
  none: '未評価',
  pending: '評価待ち',
  accepted: '採用',
  corrected: '訂正',
  next_time_ask: '次回は聞く',
  reverted: '取り消し',
});
const FEEDBACK_LAYER_LABELS = Object.freeze({
  delegation: '任せる範囲',
  method: '判断方法',
  objective: '目的',
  world_model: '現状と見通し',
  philosophy: '大切にすること',
  other: 'その他',
});
/** Layers the owner can pick for a correction. `delegation` comes from 「次回は聞く」. */
export const VALUE_PROOF_CORRECTION_LAYERS = Object.freeze(['method', 'objective', 'world_model', 'philosophy', 'other']);
export const VALUE_PROOF_FEEDBACK_OPTIONS = Object.freeze([
  Object.freeze({ value: 'accepted', label: '採用', hint: '聞かずに進めてよかった', summary: 'none', placeholder: '' }),
  Object.freeze({ value: 'corrected', label: '訂正', hint: '判断の中身が違った', summary: 'required', placeholder: '何が違ったか（必須）' }),
  Object.freeze({ value: 'next_time_ask', label: '次回は聞く', hint: 'この種の判断は、次は聞いてほしい。任せる範囲の訂正として記録します', summary: 'optional', placeholder: 'どの条件なら聞くべきか（任意）' }),
  Object.freeze({ value: 'reverted', label: '取り消し', hint: 'この判断を元に戻した（記録のみ。外部の操作は戻さない）', summary: 'required', placeholder: '何を戻したか（必須）' }),
]);

function getDocument(explicit) {
  const value = explicit ?? (typeof document === 'undefined' ? null : document);
  if (!value || typeof value.createElement !== 'function') throw new Error('document_unavailable');
  return value;
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

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatDate(value) {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) return '日時不明';
  const date = new Date(time);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function itemKey(proof) {
  return `${proof.intent_id}\u0000${proof.decision_attempt_id}`;
}

function isProof(value) {
  return isRecord(value)
    && value.schema_version === 'brainbase-judgment-value-proof-v1'
    && typeof value.intent_id === 'string'
    && typeof value.decision_attempt_id === 'string'
    && isRecord(value.interruption)
    && isRecord(value.decision)
    && isRecord(value.execution)
    && isRecord(value.outcome)
    && isRecord(value.feedback);
}

/** Normalize the host response. Anything unexpected becomes `invalid`, never an empty success. */
export function normalizeValueProofReviewHome(payload) {
  if (!isRecord(payload)) return { status: 'invalid', reason: '応答の形式が不正です' };
  if (payload.status === 'unavailable') {
    return { status: 'unavailable', root: text(payload.root), reason: text(payload.reason) ?? 'unknown' };
  }
  if (payload.status !== 'available' || !isRecord(payload.coverage) || !isRecord(payload.sections)) {
    return { status: 'invalid', reason: '応答の形式が不正です' };
  }
  const sections = {};
  for (const section of [...SECTION_ORDER, 'other']) {
    const items = payload.sections[section];
    if (!Array.isArray(items) || !items.every((item) => isRecord(item) && isProof(item.proof))) {
      return { status: 'invalid', reason: `区分「${SECTION_LABELS[section]}」の形式が不正です` };
    }
    sections[section] = items.map((item) => ({
      section,
      proof: item.proof,
      feedbackHistory: Array.isArray(item.feedback_history) ? item.feedback_history.filter(isRecord) : [],
    }));
  }
  const itemsByKey = new Map(SECTION_ORDER.flatMap((section) => sections[section].map((item) => [itemKey(item.proof), item])));
  const delegationMap = normalizeDelegationMap(payload.delegation_map, itemsByKey);
  if (!delegationMap) return { status: 'invalid', reason: '委任の地図の形式が不正です' };
  return {
    status: 'available',
    root: text(payload.root),
    coverage: {
      saved: Number.isInteger(payload.coverage.saved) ? payload.coverage.saved : null,
      rejected: Number.isInteger(payload.coverage.rejected) ? payload.coverage.rejected : null,
      latestRecordedAt: text(payload.coverage.latest_recorded_at),
      possiblyStalled: payload.coverage.possibly_stalled === true,
    },
    sections,
    itemsByKey,
    delegationMap,
    rejected: Array.isArray(payload.rejected) ? payload.rejected.filter(isRecord) : [],
  };
}

function refKey(ref) {
  return isRecord(ref) && typeof ref.intent_id === 'string' && typeof ref.decision_attempt_id === 'string'
    ? `${ref.intent_id}\u0000${ref.decision_attempt_id}`
    : null;
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeStateBasis(basis) {
  if (!isRecord(basis)) return { reason: 'no_feedback' };
  if (basis.reason === 'latest_judgment_returned') return { reason: basis.reason, at: text(basis.at) };
  if (basis.reason === 'latest_feedback') {
    return { reason: basis.reason, status: text(basis.status), targetLayer: text(basis.target_layer), at: text(basis.at) };
  }
  return { reason: 'no_feedback' };
}

/** The server decides rows and states; this only checks the shape and resolves item references. */
function normalizeDelegationMap(map, itemsByKey) {
  if (!isRecord(map) || !Array.isArray(map.rows)) return null;
  const refs = (list) => (Array.isArray(list) ? list.map(refKey).filter((key) => key && itemsByKey.has(key)) : []);
  const rows = [];
  for (const row of map.rows) {
    if (!isRecord(row) || !text(row.key) || !DELEGATION_SOURCES.includes(row.source)
      || !DELEGATION_STATES.includes(row.state) || !Array.isArray(row.items)) return null;
    const counts = isRecord(row.counts) ? row.counts : {};
    const byFeedback = isRecord(counts.by_feedback) ? counts.by_feedback : {};
    rows.push({
      key: row.key,
      source: row.source,
      label: text(row.label),
      state: row.state,
      stateBasis: normalizeStateBasis(row.state_basis),
      counts: {
        continued: count(counts.continued),
        returned: count(counts.returned),
        rated: count(counts.rated),
        byFeedback: {
          accepted: count(byFeedback.accepted),
          corrected: count(byFeedback.corrected),
          next_time_ask: count(byFeedback.next_time_ask),
          reverted: count(byFeedback.reverted),
        },
        correctedOrReverted: count(counts.corrected_or_reverted),
        inherited: count(counts.inherited),
      },
      latestRecordedAt: text(row.latest_recorded_at),
      itemKeys: refs(row.items),
    });
  }
  const rowLabel = new Map(rows.map((row) => [row.key, row]));
  const highlight = (list) => (Array.isArray(list) ? list : [])
    .map((ref) => ({ key: refKey(ref), row: rowLabel.get(ref?.row_key) ?? null }))
    .filter((entry) => entry.key && itemsByKey.has(entry.key));
  return {
    judged: count(map.judged),
    kindRecorded: count(map.kind_recorded),
    rated: count(map.rated),
    rows,
    correctedAfterContinue: highlight(map.corrected_after_continue),
    continuedAfterAsk: highlight(map.continued_after_ask),
  };
}

function isUnrated(proof) {
  return proof.feedback.status === 'none' || proof.feedback.status === 'pending';
}

function itemVisible(state, item) {
  if (!item) return false;
  if (state.unratedOnly && !isUnrated(item.proof)) return false;
  if (state.needsHumanOnly && item.section !== 'needs_human') return false;
  return true;
}

function rowItems(state, row) {
  return row.itemKeys.map((key) => state.home.itemsByKey.get(key)).filter((item) => itemVisible(state, item));
}

function visibleRows(state) {
  const rows = state.home?.delegationMap?.rows ?? [];
  return state.needsHumanOnly ? rows.filter((row) => rowItems(state, row).length > 0) : rows;
}

function rowOfItem(state, key) {
  return state.home?.delegationMap?.rows.find((row) => row.itemKeys.includes(key)) ?? null;
}

function findItem(state, key) {
  if (state.home?.status !== 'available' || !key) return null;
  for (const section of [...SECTION_ORDER, 'other']) {
    const found = state.home.sections[section].find((item) => itemKey(item.proof) === key);
    if (found) return found;
  }
  return null;
}


function firstVisibleKey(state) {
  for (const row of visibleRows(state)) {
    const item = rowItems(state, row)[0];
    if (item) return itemKey(item.proof);
  }
  return null;
}

/**
 * Keep the selection on something the filters still show: a hidden judgment
 * moves to the first visible one (in the selected row when it has one), and
 * the selected row follows it; a hidden row falls back to the first visible row.
 */
function revealSelection(state) {
  if (state.home?.status !== 'available') return;
  if (!itemVisible(state, findItem(state, state.selectedKey))) {
    const selectedRow = visibleRows(state).find((row) => row.key === state.selectedRowKey);
    const inRow = selectedRow ? rowItems(state, selectedRow)[0] : null;
    state.selectedKey = inRow ? itemKey(inRow.proof) : firstVisibleKey(state);
    const row = rowOfItem(state, state.selectedKey);
    if (row) state.selectedRowKey = row.key;
  }
  const rows = visibleRows(state);
  if (!rows.some((row) => row.key === state.selectedRowKey)) {
    state.selectedRowKey = rowOfItem(state, state.selectedKey)?.key ?? rows[0]?.key ?? null;
  }
  if (state.railView === 'judgment' && !findItem(state, state.selectedKey)) state.railView = 'row';
}

function notice(doc, className, message, role = 'status') {
  return makeElement(doc, 'p', { className: `vpr-notice ${className}`, text: message, attrs: { role } });
}

const PAGE_LEAD = 'Brainbaseに、どの種類の判断をどこまで任せていて、そのうち何をあなたが直したか。';

function shortDate(value) {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) return '日時不明';
  const date = new Date(time);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function renderPageHead(doc, page) {
  return workspacePageHeader(doc, {
    crumbs: Array.isArray(page?.crumbs) ? page.crumbs : [],
    title: '判断の見返し',
    lead: PAGE_LEAD,
    source: text(page?.source),
  });
}

/** One element for a notice body, so the kit's label column stays on the left. */
function noticeBody(doc, ...parts) {
  const body = makeElement(doc, 'div', { className: 'bb-vpr-notice-body' });
  for (const part of parts) {
    if (part === null || part === undefined || part === false) continue;
    body.append(typeof part === 'string' ? makeElement(doc, 'p', { text: part }) : part);
  }
  return body;
}

function renderCoverageNotice(doc, home) {
  const saved = home.coverage.saved === null ? '保存済み 未確認' : `保存済み ${home.coverage.saved}件`;
  const latest = home.coverage.latestRecordedAt ? `最終記録 ${formatDate(home.coverage.latestRecordedAt)}` : '最終記録 なし';
  let rejected = null;
  if (home.coverage.rejected) {
    rejected = makeElement(doc, 'details', { className: 'bb-vpr-rejected' });
    rejected.append(makeElement(doc, 'summary', { text: `読めない記録 ${home.coverage.rejected}件` }));
    const list = makeElement(doc, 'ul');
    for (const entry of home.rejected) {
      list.append(makeElement(doc, 'li', { text: `${text(entry.file) ?? '不明なファイル'}: ${text(entry.reason) ?? '理由不明'}` }));
    }
    rejected.append(list);
  }
  return workspaceNotice(doc, {
    label: '記録の範囲',
    text: noticeBody(doc, `判断journal（${home.root ?? '場所不明'}）を読んでいます。${saved}・${latest}。`, rejected),
  });
}

function toggleButton(doc, { label, pressed, disabled = false, onClick }) {
  const button = workspaceButton(doc, {
    text: label,
    onClick,
    disabled,
    attrs: { 'aria-pressed': pressed ? 'true' : 'false' },
  });
  button.className = `${button.className} bb-vpr-toggle${pressed ? ' is-pressed' : ''}`;
  return button;
}

function renderFilters(doc, home, state, callbacks) {
  const needsHuman = home.sections.needs_human.length;
  const actions = workspaceActions(doc, [
    toggleButton(doc, {
      label: state.needsHumanOnly ? `あなたの判断が必要 ${needsHuman}件（絞り込み中・解除）` : `あなたの判断が必要 ${needsHuman}件`,
      pressed: state.needsHumanOnly,
      disabled: needsHuman === 0 && !state.needsHumanOnly,
      onClick: () => callbacks.onToggleNeedsHuman?.(!state.needsHumanOnly),
    }),
    toggleButton(doc, {
      label: state.unratedOnly ? '未評価のみ（絞り込み中・解除）' : '未評価のみ',
      pressed: state.unratedOnly,
      onClick: () => callbacks.onToggleUnrated?.(!state.unratedOnly),
    }),
  ]);
  actions.className = `${actions.className} bb-vpr-filters`;
  actions.setAttribute('aria-label', '絞り込み');
  return actions;
}

function renderMetrics(doc, home) {
  const map = home.delegationMap;
  return workspaceMetrics(doc, [
    { label: '保存済み', value: home.coverage.saved, note: '判断journalの記録' },
    { label: 'あなたの判断が必要', value: home.sections.needs_human.length, note: 'あなたに戻した判断' },
    { label: '聞かずに進めた', value: home.sections.continued.length, note: '聞かずに続行した判断' },
    { label: '評価済み', value: map.rated, note: `判断 ${map.judged}件のうち` },
  ], { ariaLabel: '判断の集計' });
}

function itemTitle(proof) {
  return text(proof.interruption.question_display_text)
    ?? text(proof.human_decision?.question)
    ?? '質問の記録なし';
}

function rowName(row) {
  if (row.source === 'judgment_kind') return row.label ?? '種類名なし';
  if (row.source === 'reason_code') return `種類の記録なし・理由: ${row.label ?? '不明'}`;
  return '種類の記録なし';
}

function stateBasisText(basis) {
  if (basis.reason === 'latest_judgment_returned') return `最新の判断をあなたに戻した（${formatDate(basis.at)}）`;
  if (basis.reason === 'latest_feedback') {
    const layer = basis.status === 'corrected' ? FEEDBACK_LAYER_LABELS[basis.targetLayer] : null;
    return `最新の評価が${FEEDBACK_LABELS[basis.status] ?? '不明'}${layer ? `（${layer}）` : ''}（${formatDate(basis.at)}）`;
  }
  return 'まだ評価がありません';
}

function ratedText(row) {
  const { counts } = row;
  if (counts.rated === 0) return '未評価';
  const byFeedback = ['accepted', 'corrected', 'next_time_ask', 'reverted']
    .filter((status) => counts.byFeedback[status] > 0)
    .map((status) => `${FEEDBACK_LABELS[status]} ${counts.byFeedback[status]}`);
  return `${counts.rated}件${byFeedback.length > 0 ? `（${byFeedback.join('・')}）` : ''}`;
}

function feedbackText(status, layerKey, summary) {
  const layer = FEEDBACK_LAYER_LABELS[layerKey];
  return `${FEEDBACK_LABELS[status] ?? status ?? '評価不明'}${layer ? `（${layer}）` : ''}${text(summary) ? `: ${text(summary)}` : ''}`;
}

/** The latest feedback of a judgment: the history entry when there is one, else the proof's own. */
function latestFeedbackText(item) {
  const latest = item.feedbackHistory.at(-1);
  if (latest) return feedbackText(latest.status, latest.target_layer, latest.summary);
  return feedbackText(item.proof.feedback.status, null, item.proof.feedback.summary);
}

function judgmentLedgerRow(state, item, row, callbacks) {
  const key = itemKey(item.proof);
  return {
    key,
    selected: key === state.selectedKey && state.railView === 'judgment',
    onSelect: (selected) => callbacks.onSelect?.(selected),
    cells: [
      { text: itemTitle(item.proof), className: 'bb-vpr-primary' },
      row ? rowName(row) : { text: '種類の記録なし', className: 'is-unresolved' },
      latestFeedbackText(item),
      shortDate(item.proof.recorded_at),
    ],
  };
}

function renderHighlight(doc, state, entries, { className, title, hint }, callbacks) {
  const visible = entries
    .map((entry) => ({ entry, item: state.home.itemsByKey.get(entry.key) }))
    .filter(({ item }) => itemVisible(state, item));
  if (visible.length === 0) return null;
  const block = makeElement(doc, 'section', { className: `bb-vpr-highlight ${className}`, attrs: { 'aria-label': title } });
  const heading = makeElement(doc, 'h2');
  heading.append(makeElement(doc, 'span', { text: title }), makeElement(doc, 'span', { className: 'bb-vpr-count', text: `${visible.length}件` }));
  block.append(heading, makeElement(doc, 'p', { className: 'bb-vpr-hint', text: hint }));
  block.append(workspaceLedger(doc, {
    className: 'bb-vpr-judgment-ledger',
    ariaLabel: title,
    columns: ['判断', '判断の種類', '評価', '記録'],
    rows: visible.map(({ entry, item }) => judgmentLedgerRow(state, item, entry.row, callbacks)),
  }));
  return block;
}

/** The name in the map ledger: rows without a kind sit under their own heading, so the reason code is enough. */
function ledgerRowName(row) {
  if (row.source === 'reason_code') return `理由: ${row.label ?? '不明'}`;
  if (row.source === 'unrecorded') return '理由の記録もなし';
  return rowName(row);
}

function mapLedgerRow(state, row, callbacks) {
  const corrected = row.counts.correctedOrReverted;
  return {
    key: row.key,
    selected: row.key === state.selectedRowKey,
    onSelect: (key) => callbacks.onSelectRow?.(key),
    className: `is-${row.state}`,
    cells: [
      { primary: ledgerRowName(row) },
      { text: DELEGATION_STATE_LABELS[row.state], className: `bb-vpr-state is-${row.state}` },
      `続行 ${row.counts.continued}・戻した ${row.counts.returned}`,
      ratedText(row),
      { text: `${corrected}件`, className: corrected > 0 ? 'bb-vpr-alert' : 'is-unresolved' },
      row.latestRecordedAt ? shortDate(row.latestRecordedAt) : { text: '日時不明', className: 'is-unresolved' },
    ],
  };
}

const MAP_COLUMNS = Object.freeze(['判断の種類', '状態', '判断', '評価', '訂正・取り消し', '最新']);

function renderDelegationMap(doc, state, callbacks) {
  const map = state.home.delegationMap;
  const block = makeElement(doc, 'section', { className: 'bb-vpr-map', attrs: { 'aria-label': '委任の地図' } });
  block.append(workspaceSectionTitle(doc, {
    title: '委任の地図',
    lead: '判断の種類ごとに、任せている・確かめ中・戻しているを、最新の判断と最新の評価から示します。行を選ぶと、その種類の判断が出ます。',
  }));
  if (map.judged > 0 && map.kindRecorded === 0) {
    block.append(workspaceNotice(doc, { label: '判断の種類', text: '判断の種類はまだ記録されていません。理由コードで分けています。' }));
  }
  const rows = visibleRows(state);
  if (rows.length === 0) {
    block.append(workspaceLedger(doc, {
      className: 'bb-vpr-map-ledger',
      ariaLabel: '委任の地図',
      columns: MAP_COLUMNS,
      rows: [],
      empty: state.needsHumanOnly ? 'あなたの判断が必要な記録はありません。' : '判断の記録はありません。',
    }));
    return block;
  }
  const kinds = rows.filter((row) => row.source === 'judgment_kind');
  const unrecorded = rows.filter((row) => row.source !== 'judgment_kind');
  if (kinds.length > 0) {
    block.append(workspaceLedger(doc, {
      className: 'bb-vpr-map-ledger',
      ariaLabel: '判断の種類ごとの委任',
      columns: MAP_COLUMNS,
      rows: kinds.map((row) => mapLedgerRow(state, row, callbacks)),
    }));
  }
  if (unrecorded.length > 0) {
    block.append(
      makeElement(doc, 'h3', { className: 'bb-vpr-subheading', text: '判断の種類が記録されていない判断' }),
      makeElement(doc, 'p', { className: 'bb-vpr-hint', text: '理由コードは、聞いた・聞かなかった理由であって、判断の種類ではありません。' }),
      workspaceLedger(doc, {
        className: 'bb-vpr-map-ledger is-unrecorded',
        ariaLabel: '判断の種類が記録されていない判断',
        columns: MAP_COLUMNS,
        rows: unrecorded.map((row) => mapLedgerRow(state, row, callbacks)),
      }),
    );
  }
  return block;
}

function basisText(entry) {
  const application = text(entry.application) ?? '適用内容なし';
  const layer = BASIS_LAYER_LABELS[entry.layer];
  return layer ? `[${layer}] ${application}` : application;
}

function inheritanceText(inheritance) {
  const sources = Array.isArray(inheritance?.sources) ? inheritance.sources : [];
  if (sources.length === 0) return '引き継ぎの記録なし';
  const parts = [sources.map((source) => text(source.label) ?? text(source.ref) ?? '不明').join(' / ')];
  const same = Array.isArray(inheritance.same_conditions) ? inheritance.same_conditions.filter(text) : [];
  const rechecked = Array.isArray(inheritance.rechecked_conditions) ? inheritance.rechecked_conditions.filter(text) : [];
  if (same.length > 0) parts.push(`今回も同じ: ${same.join('、')}`);
  if (rechecked.length > 0) parts.push(`今回だけ確認: ${rechecked.join('、')}`);
  return parts.join('。');
}

function kindLabel(proof) {
  return text(proof.decision?.judgment_kind?.label);
}

function renderItemButton(doc, state, item, callbacks) {
  const key = itemKey(item.proof);
  const selected = key === state.selectedKey;
  const button = makeElement(doc, 'button', {
    className: `bb-vpr-item${selected ? ' is-selected' : ''}`,
    attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false' },
  });
  button.append(
    makeElement(doc, 'span', { className: 'bb-vpr-item-title', text: itemTitle(item.proof) }),
    makeElement(doc, 'span', { className: 'bb-vpr-item-summary', text: text(item.proof.decision.summary) ?? text(item.proof.human_decision?.why_human) ?? '判断の記録なし' }),
    makeElement(doc, 'span', {
      className: 'bb-vpr-item-meta',
      text: [
        SECTION_LABELS[item.section],
        formatDate(item.proof.recorded_at),
        OUTCOME_LABELS[item.proof.outcome.status] ?? '成果不明',
        FEEDBACK_LABELS[item.proof.feedback.status] ?? '評価不明',
      ].join(' · '),
    }),
  );
  button.addEventListener('click', () => callbacks.onSelect?.(key));
  const entry = makeElement(doc, 'li');
  entry.append(button);
  return entry;
}

/** The selected map row: its state and reason, its counts and its judgments. */
function renderRowDetail(doc, state, row, callbacks) {
  const detail = [workspaceRailHead(doc, {
    kicker: '判断の種類',
    title: rowName(row),
    sub: `${DELEGATION_STATE_LABELS[row.state]}：${stateBasisText(row.stateBasis)}`,
  })];
  detail.push(workspaceRailBlock(doc, {
    title: '記録と評価',
    content: workspaceDefinition(doc, [
      ['聞かずに続行', `${row.counts.continued}件`],
      ['あなたに戻した', `${row.counts.returned}件`],
      ['評価', ratedText(row)],
      ['訂正・取り消し', `${row.counts.correctedOrReverted}件`],
      ['引き継ぎあり', `${row.counts.inherited}件`],
      ['最新', row.latestRecordedAt ? formatDate(row.latestRecordedAt) : '日時不明'],
    ]),
  }));
  const items = rowItems(state, row);
  const list = items.length === 0
    ? makeElement(doc, 'p', { className: 'bb-vpr-empty', text: state.unratedOnly ? '未評価の判断はありません。' : 'この行に表示できる判断はありません。' })
    : makeElement(doc, 'ul', { className: 'bb-vpr-list' });
  for (const item of items) list.append(renderItemButton(doc, state, item, callbacks));
  detail.push(workspaceRailBlock(doc, { title: `判断 ${items.length}件`, className: 'bb-vpr-row-judgments', content: list }));
  return detail;
}

function renderFeedbackForm(doc, item, state, callbacks) {
  const form = makeElement(doc, 'form', { className: 'vpr-feedback', attrs: { 'aria-label': 'この判断を評価する' } });
  const fieldset = makeElement(doc, 'fieldset');
  fieldset.append(makeElement(doc, 'legend', { text: 'この判断を評価する' }));
  const draft = state.draft;
  const summary = makeElement(doc, 'textarea', { attrs: { rows: '3', maxlength: '500', 'aria-label': '評価の理由' } });
  summary.value = draft.summary;
  const summaryHint = makeElement(doc, 'p', { className: 'bb-vpr-hint' });
  const syncSummary = (value) => {
    const option = VALUE_PROOF_FEEDBACK_OPTIONS.find((entry) => entry.value === value);
    summary.setAttribute('placeholder', option?.placeholder || '理由（任意）');
    summaryHint.textContent = option ? option.hint : '評価を選んでください。';
    if (option?.summary === 'required') summary.setAttribute('required', '');
    else if (typeof summary.removeAttribute === 'function') summary.removeAttribute('required');
  };
  const options = makeElement(doc, 'div', { className: 'vpr-options' });
  for (const option of VALUE_PROOF_FEEDBACK_OPTIONS) {
    const label = makeElement(doc, 'label', { className: 'vpr-option' });
    const radio = makeElement(doc, 'input', { attrs: { type: 'radio', name: 'vpr-feedback-status', value: option.value } });
    radio.checked = draft.status === option.value;
    radio.addEventListener('change', () => {
      callbacks.onDraft?.({ status: option.value });
      syncSummary(option.value);
      syncLayers(option.value);
    });
    label.append(radio, makeElement(doc, 'span', { text: option.label }));
    options.append(label);
  }
  const layerGroup = makeElement(doc, 'div', { className: 'vpr-layers', attrs: { role: 'radiogroup', 'aria-label': '何を直すか' } });
  layerGroup.append(makeElement(doc, 'p', { className: 'bb-vpr-hint', text: '何を直すか（必須）' }));
  for (const layer of VALUE_PROOF_CORRECTION_LAYERS) {
    const label = makeElement(doc, 'label', { className: 'vpr-option' });
    const radio = makeElement(doc, 'input', { attrs: { type: 'radio', name: 'vpr-feedback-layer', value: layer } });
    radio.checked = draft.targetLayer === layer;
    radio.addEventListener('change', () => callbacks.onDraft?.({ targetLayer: layer }));
    label.append(radio, makeElement(doc, 'span', { text: FEEDBACK_LAYER_LABELS[layer] }));
    layerGroup.append(label);
  }
  const syncLayers = (value) => {
    if (value === 'corrected') {
      if (typeof layerGroup.removeAttribute === 'function') layerGroup.removeAttribute('hidden');
    } else {
      layerGroup.setAttribute('hidden', '');
    }
  };
  syncSummary(draft.status);
  syncLayers(draft.status);
  summary.addEventListener('input', () => callbacks.onDraft?.({ summary: summary.value }));
  const submit = makeElement(doc, 'button', {
    className: 'bb-ws-button is-primary vpr-submit',
    text: state.save.state === 'saving' ? '保存中…' : '評価を保存',
    attrs: { type: 'submit', disabled: state.save.state === 'saving' },
  });
  form.addEventListener('submit', (event) => {
    event?.preventDefault?.();
    void callbacks.onSubmit?.(item);
  });
  fieldset.append(options, summaryHint, layerGroup, summary);
  form.append(fieldset, submit);
  if (state.save.state === 'saved') form.append(notice(doc, 'is-success', state.save.message));
  if (state.save.state === 'error') form.append(notice(doc, 'is-danger', state.save.message, 'alert'));
  return form;
}

function consultText(proof) {
  return [
    'Brainbaseのこの判断について相談したい。',
    `本来の質問: ${itemTitle(proof)}`,
    `判断: ${text(proof.decision.summary) ?? '記録なし'}`,
    `decision_attempt_id: ${proof.decision_attempt_id}`,
  ].join('\n');
}

function facts(doc, pairs) {
  const list = workspaceDefinition(doc, pairs);
  list.className = `${list.className} bb-vpr-facts`;
  return list;
}

/** The selected judgment as rail blocks, in the contract order. */
function renderJudgmentDetail(doc, state, item, callbacks) {
  const { proof } = item;
  const detail = [];
  const row = rowOfItem(state, itemKey(proof));
  if (row) {
    const back = workspaceButton(doc, { text: `← ${rowName(row)}`, variant: 'quiet', onClick: () => callbacks.onShowRow?.() });
    back.className = `${back.className} bb-vpr-back`;
    detail.push(back);
  }
  const head = workspaceRailHead(doc, {
    kicker: SECTION_LABELS[item.section],
    title: itemTitle(proof),
    sub: kindLabel(proof) ? `判断の種類: ${kindLabel(proof)}` : row ? rowName(row) : null,
  });
  const heading = Array.from(head.children ?? []).find((child) => child.tagName === 'H2');
  heading?.setAttribute('tabindex', '-1');
  detail.push(head);

  const reason = text(proof.interruption.human_reason) ?? text(proof.interruption.reason_code) ?? '理由の記録なし';
  detail.push(workspaceRailBlock(doc, {
    title: '判断',
    content: facts(doc, [
      ['扱い', `${RESOLUTION_LABELS[proof.interruption.resolution] ?? '不明'}（${reason}）`],
      ['判断', text(proof.decision.summary) ?? '判断の記録なし'],
      ['仕事への影響', text(proof.decision.work_impact) ?? '影響の記録なし'],
    ]),
  }));
  const basis = Array.isArray(proof.decision.basis) ? proof.decision.basis : [];
  const reuse = proof.decision.prior_learning_reused;
  detail.push(workspaceRailBlock(doc, {
    title: '根拠と引き継ぎ',
    content: facts(doc, [
      ['根拠', basis.length > 0 ? basis.map(basisText).join(' / ') : '根拠の記録なし'],
      ['過去の学習の再利用', reuse === true ? 'あり' : reuse === false ? 'なし' : '未確認'],
      ['引き継ぎ', inheritanceText(proof.decision.inheritance)],
    ]),
  }));
  const evidence = Array.isArray(proof.outcome.evidence_refs) ? proof.outcome.evidence_refs : [];
  const evidenceText = evidence.length > 0
    ? `（証拠: ${evidence.map((entry) => `${text(entry.label) ?? entry.kind} ${entry.status === 'verified' ? '確認済み' : '未確認'}`).join(' / ')}）`
    : '';
  const latestLayer = item.feedbackHistory.at(-1)?.target_layer;
  detail.push(workspaceRailBlock(doc, {
    title: '実行と成果',
    content: facts(doc, [
      ['実行', `${EXECUTION_LABELS[proof.execution.status] ?? '不明'}${text(proof.execution.summary) ? `: ${text(proof.execution.summary)}` : ''}`],
      ['成果の確認', {
        text: `${OUTCOME_LABELS[proof.outcome.status] ?? '不明'}${text(proof.outcome.summary) ? `: ${text(proof.outcome.summary)}` : ''}${evidenceText}`,
        className: `bb-vpr-outcome is-${proof.outcome.status}`,
      }],
      ['評価', feedbackText(proof.feedback.status, latestLayer, proof.feedback.summary)],
    ]),
  }));

  if (proof.human_decision) {
    const content = [makeElement(doc, 'p', { text: text(proof.human_decision.why_human) ?? '理由の記録なし' })];
    const options = Array.isArray(proof.human_decision.options) ? proof.human_decision.options : [];
    if (options.length > 0) {
      const list = makeElement(doc, 'ul', { className: 'bb-vpr-options-list' });
      for (const option of options) list.append(makeElement(doc, 'li', { text: `${text(option.label) ?? option.id}: ${text(option.impact) ?? '影響の記録なし'}` }));
      content.push(makeElement(doc, 'h4', { text: '選択肢と影響' }), list);
    }
    detail.push(workspaceRailBlock(doc, { title: 'あなたに戻した理由', className: 'bb-vpr-human-decision', content }));
  }

  const feedback = [renderFeedbackForm(doc, item, state, callbacks)];
  if (item.feedbackHistory.length > 1) {
    const history = makeElement(doc, 'details', { className: 'bb-vpr-history' });
    history.append(makeElement(doc, 'summary', { text: `評価の履歴 ${item.feedbackHistory.length}件` }));
    const list = makeElement(doc, 'ol');
    for (const entry of item.feedbackHistory) {
      list.append(makeElement(doc, 'li', { text: `${formatDate(entry.recorded_at)} ${feedbackText(entry.status, entry.target_layer, entry.summary)}` }));
    }
    history.append(list);
    feedback.push(history);
  }
  detail.push(workspaceRailBlock(doc, { title: '評価', className: 'bb-vpr-feedback-block', content: feedback }));

  const consult = [workspaceButton(doc, { text: 'Codexで相談する（依頼文をコピー）', onClick: () => callbacks.onConsult?.(consultText(proof)) })];
  if (state.consultMessage) consult.push(notice(doc, 'is-muted', state.consultMessage));
  detail.push(workspaceRailBlock(doc, { title: 'Codexで相談', content: consult }));

  const audit = makeElement(doc, 'details', { className: 'bb-vpr-audit' });
  audit.append(makeElement(doc, 'summary', { text: '監査詳細' }));
  const auditPairs = [
    ['intent_id', proof.intent_id],
    ['decision_attempt_id', proof.decision_attempt_id],
    ['記録日時', proof.recorded_at],
    ['状態', String(proof.state)],
  ];
  if (text(proof.interruption.question_digest)) auditPairs.push(['question_digest', proof.interruption.question_digest]);
  if (basis.length > 0) auditPairs.push(['根拠の対象ID', basis.map((entry) => entry.entity_id).join(', ')]);
  if (evidence.length > 0) auditPairs.push(['証拠参照', evidence.map((entry) => `${entry.kind}:${entry.ref}`).join(', ')]);
  const artifacts = Array.isArray(proof.execution.artifact_refs) ? proof.execution.artifact_refs : [];
  if (artifacts.length > 0) auditPairs.push(['成果物参照', artifacts.map((entry) => `${entry.kind}:${entry.ref}`).join(', ')]);
  audit.append(workspaceDefinition(doc, auditPairs));
  detail.push(workspaceRailBlock(doc, { className: 'bb-vpr-audit-block', content: audit }));

  if (state.focusCard && heading && typeof heading.focus === 'function') queueMicrotask(() => heading.focus());
  return detail;
}

/** The detail for the rail (or inline): the selected judgment, else the selected row. Null when nothing can be shown. */
function renderDetail(doc, state, callbacks) {
  if (state.home?.status !== 'available') return null;
  const item = state.railView === 'judgment' ? findItem(state, state.selectedKey) : null;
  const row = item ? null : visibleRows(state).find((entry) => entry.key === state.selectedRowKey) ?? null;
  if (!item && !row) return null;
  const detail = makeElement(doc, 'div', {
    className: `vpr bb-vpr-detail${item ? ' is-judgment' : ' is-row'}`,
    attrs: { 'data-detail': item ? 'judgment' : 'row' },
  });
  detail.append(...(item ? renderJudgmentDetail(doc, state, item, callbacks) : renderRowDetail(doc, state, row, callbacks)));
  return detail;
}

/** Render the whole surface into a host-owned root, and the detail into `options.rail` when given. */
export function renderValueProofReview(root, state, callbacks = {}, options = {}) {
  const doc = getDocument(options.document);
  const rail = options.rail ?? null;
  root.replaceChildren();
  const surface = makeElement(doc, 'div', {
    className: 'vpr',
    attrs: { 'data-contract-version': VALUE_PROOF_REVIEW_UI_CONTRACT_VERSION, 'data-layout': rail ? 'rail' : 'inline' },
  });
  surface.append(renderPageHead(doc, options.page));
  const finish = (detail, empty) => {
    if (rail) {
      if (detail) rail.replaceChildren(detail);
      else rail.replaceChildren(workspaceDetailEmpty(doc, empty));
    } else if (detail) {
      const inline = makeElement(doc, 'section', { className: 'bb-vpr-inline-detail', attrs: { 'aria-label': '選択中の項目' } });
      inline.append(detail);
      surface.append(inline);
    }
    root.append(surface);
    return surface;
  };
  const unreadable = { mark: '!', title: '判断を表示できません', text: '記録の範囲の注記を確かめてください。' };

  if (state.phase === 'loading' && !state.home) {
    surface.append(workspaceNotice(doc, { label: '記録の範囲', text: '判断の記録を読み込んでいます。' }));
    return finish(null, { mark: '…', title: '読み込んでいます', text: '判断の記録を読み込んでいます。' });
  }
  if (state.phase === 'error') {
    const retry = workspaceButton(doc, { text: '再試行', onClick: () => void callbacks.onReload?.() });
    surface.append(workspaceNotice(doc, {
      label: '記録の範囲',
      tone: 'danger',
      text: noticeBody(doc, `判断の記録を取得できません（${state.error ?? 'request_failed'}）。0件ではありません。`, retry),
    }));
    return finish(null, unreadable);
  }
  const home = state.home;
  if (!home || home.status === 'invalid') {
    surface.append(workspaceNotice(doc, { label: '記録の範囲', tone: 'danger', text: `判断の記録を表示できません（${home?.reason ?? '応答なし'}）。0件ではありません。` }));
    return finish(null, unreadable);
  }
  if (home.status === 'unavailable') {
    const hostNotice = options.unavailableNotice;
    const title = makeElement(doc, 'p', { className: 'bb-vpr-notice-title', text: text(hostNotice?.title) ?? '判断journalに接続できません' });
    surface.append(workspaceNotice(doc, {
      label: '記録の範囲',
      tone: 'danger',
      text: noticeBody(doc,
        title,
        home.root ? `場所: ${home.root}（${home.reason}）` : `理由: ${home.reason}`,
        `${text(hostNotice?.guidance) ?? '記録の場所は、起動時の --journal か環境変数 BRAINBASE_JUDGMENT_JOURNAL_DIR で指定できます。'}0件としては扱いません。`),
    }));
    return finish(null, unreadable);
  }

  surface.append(renderCoverageNotice(doc, home));
  if (home.coverage.possiblyStalled) {
    surface.append(workspaceNotice(doc, {
      label: '記録の停止',
      tone: 'warning',
      text: 'しばらく新しい記録がありません。記録が止まっている可能性があります。0件を「何も無かった」とは扱いません。',
    }));
  }
  surface.append(renderFilters(doc, home, state, callbacks), renderMetrics(doc, home));
  if (home.delegationMap.rated === 0 && home.delegationMap.judged > 0) {
    surface.append(workspaceNotice(doc, { label: '評価', text: 'まだ評価がありません。任せている・戻しているは評価から決まります。' }));
  }
  for (const highlight of [
    renderHighlight(doc, state, home.delegationMap.correctedAfterContinue, {
      className: 'is-corrected', title: '聞かずに進めたが直した判断', hint: 'あなたに聞かずに進めたあと、あなたが訂正・取り消しした判断',
    }, callbacks),
    renderHighlight(doc, state, home.delegationMap.continuedAfterAsk, {
      className: 'is-after-ask', title: '評価の後も聞かずに進めた判断', hint: '「次回は聞く」と評価した種類で、その後も聞かずに進めた判断。評価がまだ次の判断に効いていません',
    }, callbacks),
  ]) if (highlight) surface.append(highlight);
  surface.append(renderDelegationMap(doc, state, callbacks));
  if (home.sections.other.length > 0) {
    surface.append(makeElement(doc, 'p', { className: 'bb-vpr-hint', text: `その他 ${home.sections.other.length}件（判断の代行が無い記録）` }));
  }
  return finish(renderDetail(doc, state, callbacks), {
    mark: '判',
    title: '判断の種類を選択',
    text: '委任の地図から行を選ぶと、その種類の判断が出ます。判断を選ぶと、根拠と評価の欄が出ます。',
  });
}

function joinPath(basePath, suffix) {
  return `${String(basePath || '/api/value-proofs').replace(/\/+$/u, '')}${suffix}`;
}

async function readErrorMessage(response) {
  try {
    const body = await response.json();
    return text(body?.error?.message) ?? text(body?.error?.code) ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export function createValueProofReviewUI({
  root,
  /** The host's right-rail element for the selected row or judgment. Without it, the detail follows the workspace content. */
  rail,
  /** Page context from the host: `{ crumbs, source }` for the page head. */
  page,
  document: explicitDocument,
  fetcher,
  basePath = '/api/value-proofs',
  token,
  clipboard,
  /** Optional `{ title, guidance }` for hosts where the local journal hint does not apply. */
  unavailableNotice,
  autoLoad = true,
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = getDocument(explicitDocument);
  const request = typeof fetcher === 'function'
    ? fetcher
    : typeof globalThis.fetch === 'function' ? (path, init) => globalThis.fetch(path, init) : null;
  const writeClipboard = clipboard
    ?? (typeof navigator !== 'undefined' && navigator.clipboard ? (value) => navigator.clipboard.writeText(value) : null);

  const state = {
    phase: 'loading',
    home: null,
    error: null,
    selectedKey: null,
    selectedRowKey: null,
    /** What the detail shows: the selected map row, or the selected judgment. */
    railView: 'row',
    unratedOnly: false,
    needsHumanOnly: false,
    draft: { status: '', summary: '', targetLayer: '' },
    save: { state: 'idle', message: '' },
    focusCard: false,
    consultMessage: '',
  };

  const resetJudgmentInput = () => {
    state.draft = { status: '', summary: '', targetLayer: '' };
    state.save = { state: 'idle', message: '' };
    state.consultMessage = '';
  };

  const applyFilter = () => {
    const previous = state.selectedKey;
    revealSelection(state);
    if (state.selectedKey !== previous) resetJudgmentInput();
    controller.render();
  };

  const callbacks = {
    onReload: () => controller.load(),
    onToggleUnrated(value) {
      state.unratedOnly = value;
      applyFilter();
    },
    onToggleNeedsHuman(value) {
      state.needsHumanOnly = value;
      applyFilter();
    },
    onSelectRow(key) {
      state.selectedRowKey = key;
      state.railView = 'row';
      controller.render();
    },
    onShowRow() {
      state.railView = 'row';
      controller.render();
    },
    onSelect(key) {
      if (key !== state.selectedKey) resetJudgmentInput();
      state.selectedKey = key;
      state.selectedRowKey = rowOfItem(state, key)?.key ?? state.selectedRowKey;
      state.railView = 'judgment';
      state.focusCard = true;
      controller.render();
      state.focusCard = false;
    },
    onDraft(patch) {
      state.draft = { ...state.draft, ...patch };
    },
    async onSubmit(item) {
      const option = VALUE_PROOF_FEEDBACK_OPTIONS.find((entry) => entry.value === state.draft.status);
      if (!option) {
        state.save = { state: 'error', message: '評価を選んでください。' };
        controller.render();
        return;
      }
      if (option.value === 'corrected' && !VALUE_PROOF_CORRECTION_LAYERS.includes(state.draft.targetLayer)) {
        state.save = { state: 'error', message: '「訂正」では、何を直すかを選んでください。' };
        controller.render();
        return;
      }
      if (option.summary === 'required' && !text(state.draft.summary)) {
        state.save = { state: 'error', message: `「${option.label}」には理由の1文が必要です。` };
        controller.render();
        return;
      }
      if (!request) {
        state.save = { state: 'error', message: '保存先のAPIが未設定です。' };
        controller.render();
        return;
      }
      state.save = { state: 'saving', message: '' };
      controller.render();
      try {
        const response = await request(joinPath(basePath, '/feedback'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Brainbase-Review-Token': token ?? '' },
          body: JSON.stringify({
            intent_id: item.proof.intent_id,
            decision_attempt_id: item.proof.decision_attempt_id,
            status: option.value,
            summary: text(state.draft.summary),
            target_layer: option.value === 'corrected' ? state.draft.targetLayer : null,
          }),
        });
        if (!response.ok) throw new Error(await readErrorMessage(response));
        await controller.load();
        const key = itemKey(item.proof);
        const saved = findItem(state, key);
        if (saved?.proof.feedback.status !== option.value) throw new Error('保存後の読み戻しで評価を確認できません');
        // Keep the read-back on the judgment just rated, even when a filter now hides it from the lists.
        state.selectedKey = key;
        state.selectedRowKey = rowOfItem(state, key)?.key ?? state.selectedRowKey;
        state.railView = 'judgment';
        state.draft = { status: '', summary: '', targetLayer: '' };
        state.save = { state: 'saved', message: `「${option.label}」を保存しました（読み戻し済み）。` };
      } catch (error) {
        state.save = { state: 'error', message: `保存できませんでした: ${error instanceof Error ? error.message : 'request_failed'}。入力は残しています。` };
      }
      controller.render();
    },
    async onConsult(value) {
      if (!writeClipboard) {
        state.consultMessage = `コピーできない環境です。次の文をCodexへ貼ってください。\n${value}`;
      } else {
        try {
          await writeClipboard(value);
          state.consultMessage = '依頼文をコピーしました。Codexに貼ると、この判断の相談から始められます。';
        } catch {
          state.consultMessage = `コピーできませんでした。次の文をCodexへ貼ってください。\n${value}`;
        }
      }
      controller.render();
    },
  };

  const controller = {
    get state() { return state; },
    render() {
      renderValueProofReview(root, state, callbacks, { document: doc, unavailableNotice, rail, page });
      return controller;
    },
    async load() {
      if (!request) {
        state.phase = 'error';
        state.error = 'api_unavailable';
        controller.render();
        return state.home;
      }
      state.phase = 'loading';
      try {
        const response = await request(joinPath(basePath, '/home'));
        if (!response.ok) throw new Error(await readErrorMessage(response));
        state.home = normalizeValueProofReviewHome(await response.json());
        state.phase = 'ready';
        state.error = null;
        revealSelection(state);
      } catch (error) {
        state.phase = 'error';
        state.error = error instanceof Error ? error.message : 'request_failed';
      }
      controller.render();
      return state.home;
    },
    callbacks,
  };
  controller.render();
  if (autoLoad) void controller.load();
  return controller;
}

export default renderValueProofReview;
