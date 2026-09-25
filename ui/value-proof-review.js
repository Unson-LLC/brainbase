/*
 * Local owner review surface for judgment value proofs.
 *
 * The host supplies a same-origin request function and a review token. This
 * module owns presentation only: it never treats an unavailable journal as an
 * empty list, never edits the judgment journal, and keeps internal IDs inside
 * the audit details.
 */

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

/** Keep the card on a visible judgment and open the row that lists it. */
function revealSelection(state) {
  if (!itemVisible(state, findItem(state, state.selectedKey))) state.selectedKey = firstVisibleKey(state);
  const row = rowOfItem(state, state.selectedKey);
  if (row) state.expandedRows.add(row.key);
}

function notice(doc, className, message, role = 'status') {
  return makeElement(doc, 'p', { className: `vpr-notice ${className}`, text: message, attrs: { role } });
}

function renderHeader(doc) {
  const header = makeElement(doc, 'header', { className: 'vpr-header' });
  header.append(
    makeElement(doc, 'div', { className: 'vpr-kicker', text: 'BRAINBASE / REVIEW' }),
    makeElement(doc, 'h1', { text: '判断の見返し' }),
    makeElement(doc, 'p', { className: 'vpr-lead', text: 'Brainbaseに、どの種類の判断をどこまで任せていて、そのうち何をあなたが直したか。' }),
  );
  return header;
}

function renderCoverage(doc, home, state, callbacks) {
  const coverage = makeElement(doc, 'section', { className: 'vpr-coverage', attrs: { 'aria-label': '記録の範囲' } });
  const facts = makeElement(doc, 'dl', { className: 'vpr-coverage-facts' });
  const fact = (label, value) => facts.append(makeElement(doc, 'dt', { text: label }), makeElement(doc, 'dd', { text: value }));
  fact('対象', home.root ?? '不明');
  fact('保存済み', home.coverage.saved === null ? '不明' : `${home.coverage.saved}件`);
  fact('最終記録', home.coverage.latestRecordedAt ? formatDate(home.coverage.latestRecordedAt) : '記録なし');
  coverage.append(facts);
  const needsHuman = home.sections.needs_human.length;
  const needsHumanButton = makeElement(doc, 'button', {
    className: `vpr-needs-human${state.needsHumanOnly ? ' is-active' : ''}`,
    text: state.needsHumanOnly ? `あなたの判断が必要 ${needsHuman}件（絞り込み中・解除）` : `あなたの判断が必要 ${needsHuman}件`,
    attrs: { type: 'button', 'aria-pressed': state.needsHumanOnly ? 'true' : 'false', disabled: needsHuman === 0 && !state.needsHumanOnly },
  });
  needsHumanButton.addEventListener('click', () => callbacks.onToggleNeedsHuman?.(!state.needsHumanOnly));
  coverage.append(needsHumanButton);
  if (home.coverage.possiblyStalled) {
    coverage.append(notice(doc, 'is-warning', 'しばらく新しい記録がありません。記録が止まっている可能性があります。0件を「何も無かった」とは扱いません。'));
  }
  if (home.coverage.rejected) {
    const details = makeElement(doc, 'details', { className: 'vpr-rejected' });
    details.append(makeElement(doc, 'summary', { text: `読めない記録 ${home.coverage.rejected}件` }));
    const list = makeElement(doc, 'ul');
    for (const entry of home.rejected) {
      list.append(makeElement(doc, 'li', { text: `${text(entry.file) ?? '不明なファイル'}: ${text(entry.reason) ?? '理由不明'}` }));
    }
    details.append(list);
    coverage.append(details);
  }
  const filter = makeElement(doc, 'label', { className: 'vpr-filter' });
  const checkbox = makeElement(doc, 'input', { attrs: { type: 'checkbox' } });
  checkbox.checked = state.unratedOnly;
  checkbox.addEventListener('change', () => callbacks.onToggleUnrated?.(Boolean(checkbox.checked)));
  filter.append(checkbox, makeElement(doc, 'span', { text: '未評価のみ表示' }));
  coverage.append(filter);
  return coverage;
}

function itemTitle(proof) {
  return text(proof.interruption.question_display_text)
    ?? text(proof.human_decision?.question)
    ?? '質問の記録なし';
}

function renderItemButton(doc, state, item, callbacks, extraMeta = []) {
  const key = itemKey(item.proof);
  const selected = key === state.selectedKey;
  const button = makeElement(doc, 'button', {
    className: `vpr-item${selected ? ' is-selected' : ''}`,
    attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false' },
  });
  button.append(
    makeElement(doc, 'span', { className: 'vpr-item-title', text: itemTitle(item.proof) }),
    makeElement(doc, 'span', { className: 'vpr-item-summary', text: text(item.proof.decision.summary) ?? text(item.proof.human_decision?.why_human) ?? '判断の記録なし' }),
    makeElement(doc, 'span', {
      className: 'vpr-item-meta',
      text: [
        ...extraMeta,
        SECTION_LABELS[item.section],
        formatDate(item.proof.recorded_at),
        OUTCOME_LABELS[item.proof.outcome.status] ?? '成果不明',
        FEEDBACK_LABELS[item.proof.feedback.status] ?? '評価不明',
      ].filter(Boolean).join(' · '),
    }),
  );
  button.addEventListener('click', () => callbacks.onSelect?.(key));
  const entry = makeElement(doc, 'li');
  entry.append(button);
  return entry;
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

function rowCountsText(row) {
  const { counts } = row;
  const byFeedback = ['accepted', 'corrected', 'next_time_ask', 'reverted']
    .filter((status) => counts.byFeedback[status] > 0)
    .map((status) => `${FEEDBACK_LABELS[status]} ${counts.byFeedback[status]}`);
  return [
    `聞かずに続行 ${counts.continued}件・あなたに戻した ${counts.returned}件`,
    `評価済み ${counts.rated}件${byFeedback.length > 0 ? `（${byFeedback.join('・')}）` : ''}`,
    `引き継ぎあり ${counts.inherited}件`,
    `最新 ${row.latestRecordedAt ? formatDate(row.latestRecordedAt) : '日時不明'}`,
  ].join(' / ');
}

function highlightMeta(entry, item) {
  const latest = item.feedbackHistory.at(-1);
  const layer = FEEDBACK_LAYER_LABELS[latest?.target_layer];
  return [
    entry.row ? rowName(entry.row) : null,
    latest ? `${FEEDBACK_LABELS[latest.status] ?? latest.status}${layer ? `（${layer}）` : ''}${text(latest.summary) ? `: ${text(latest.summary)}` : ''}` : null,
  ];
}

function renderHighlight(doc, state, entries, { className, title, hint }, callbacks) {
  const visible = entries
    .map((entry) => ({ entry, item: state.home.itemsByKey.get(entry.key) }))
    .filter(({ item }) => itemVisible(state, item));
  if (visible.length === 0) return null;
  const block = makeElement(doc, 'section', { className: `vpr-highlight ${className}`, attrs: { 'aria-label': title } });
  const heading = makeElement(doc, 'h2');
  heading.append(makeElement(doc, 'span', { text: title }), makeElement(doc, 'span', { className: 'vpr-count', text: `${visible.length}件` }));
  block.append(heading, makeElement(doc, 'p', { className: 'vpr-hint', text: hint }));
  const list = makeElement(doc, 'ul', { className: 'vpr-list' });
  for (const { entry, item } of visible) list.append(renderItemButton(doc, state, item, callbacks, highlightMeta(entry, item)));
  block.append(list);
  return block;
}

function renderRow(doc, state, row, callbacks) {
  const open = state.needsHumanOnly || state.expandedRows.has(row.key);
  const block = makeElement(doc, 'li', { className: `vpr-row is-${row.state}${open ? ' is-open' : ''}` });
  const head = makeElement(doc, 'button', {
    className: 'vpr-row-head',
    attrs: { type: 'button', 'aria-expanded': open ? 'true' : 'false' },
  });
  const title = makeElement(doc, 'span', { className: 'vpr-row-title' });
  title.append(
    makeElement(doc, 'span', { className: `vpr-state is-${row.state}`, text: DELEGATION_STATE_LABELS[row.state] }),
    makeElement(doc, 'span', { className: 'vpr-row-name', text: rowName(row) }),
  );
  head.append(title, makeElement(doc, 'span', { className: 'vpr-row-basis', text: stateBasisText(row.stateBasis) }));
  if (row.counts.correctedOrReverted > 0) {
    head.append(makeElement(doc, 'span', { className: 'vpr-row-alert', text: `訂正・取り消し ${row.counts.correctedOrReverted}件` }));
  }
  head.append(makeElement(doc, 'span', { className: 'vpr-row-counts', text: rowCountsText(row) }));
  head.addEventListener('click', () => callbacks.onToggleRow?.(row.key));
  block.append(head);
  if (open) {
    const items = rowItems(state, row);
    if (items.length === 0) {
      block.append(makeElement(doc, 'p', { className: 'vpr-empty', text: state.unratedOnly ? '未評価の判断はありません。' : 'この行に表示できる判断はありません。' }));
    } else {
      const list = makeElement(doc, 'ul', { className: 'vpr-list' });
      for (const item of items) list.append(renderItemButton(doc, state, item, callbacks));
      block.append(list);
    }
  }
  return block;
}

function renderDelegationMap(doc, state, callbacks) {
  const map = state.home.delegationMap;
  const block = makeElement(doc, 'section', { className: 'vpr-map', attrs: { 'aria-label': '委任の地図' } });
  block.append(
    makeElement(doc, 'h2', { text: '委任の地図' }),
    makeElement(doc, 'p', { className: 'vpr-hint', text: '判断の種類ごとに、任せている・確かめ中・戻しているを、最新の判断と最新の評価から示します。' }),
  );
  if (map.judged > 0 && map.kindRecorded === 0) {
    block.append(notice(doc, 'is-muted', '判断の種類はまだ記録されていません。理由コードで分けています。'));
  }
  const rows = visibleRows(state);
  if (rows.length === 0) {
    block.append(makeElement(doc, 'p', { className: 'vpr-empty', text: state.needsHumanOnly ? 'あなたの判断が必要な記録はありません。' : '判断の記録はありません。' }));
    return block;
  }
  const kinds = rows.filter((row) => row.source === 'judgment_kind');
  const unrecorded = rows.filter((row) => row.source !== 'judgment_kind');
  if (kinds.length > 0) {
    const list = makeElement(doc, 'ul', { className: 'vpr-rows' });
    for (const row of kinds) list.append(renderRow(doc, state, row, callbacks));
    block.append(list);
  }
  if (unrecorded.length > 0) {
    block.append(
      makeElement(doc, 'h3', { className: 'vpr-subheading', text: '判断の種類が記録されていない判断' }),
      makeElement(doc, 'p', { className: 'vpr-hint', text: '理由コードは、聞いた・聞かなかった理由であって、判断の種類ではありません。' }),
    );
    const list = makeElement(doc, 'ul', { className: 'vpr-rows is-unrecorded' });
    for (const row of unrecorded) list.append(renderRow(doc, state, row, callbacks));
    block.append(list);
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

function row(doc, list, label, value, className) {
  list.append(makeElement(doc, 'dt', { text: label }), makeElement(doc, 'dd', { className, text: value }));
}

function renderFeedbackForm(doc, item, state, callbacks) {
  const form = makeElement(doc, 'form', { className: 'vpr-feedback', attrs: { 'aria-label': 'この判断を評価する' } });
  const fieldset = makeElement(doc, 'fieldset');
  fieldset.append(makeElement(doc, 'legend', { text: 'この判断を評価する' }));
  const draft = state.draft;
  const summary = makeElement(doc, 'textarea', { attrs: { rows: '3', maxlength: '500', 'aria-label': '評価の理由' } });
  summary.value = draft.summary;
  const summaryHint = makeElement(doc, 'p', { className: 'vpr-hint' });
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
  layerGroup.append(makeElement(doc, 'p', { className: 'vpr-hint', text: '何を直すか（必須）' }));
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
    className: 'vpr-submit',
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

function renderCard(doc, item, state, callbacks) {
  const card = makeElement(doc, 'article', { className: 'vpr-card', attrs: { 'aria-label': '判断カード' } });
  if (!item) {
    card.append(makeElement(doc, 'p', { className: 'vpr-empty', text: '一覧から判断を選ぶと、ここに詳細が出ます。' }));
    return card;
  }
  const { proof } = item;
  const heading = makeElement(doc, 'h2', { text: itemTitle(proof), attrs: { tabindex: '-1' } });
  card.append(
    makeElement(doc, 'div', { className: `vpr-badge is-${item.section}`, text: SECTION_LABELS[item.section] }),
    heading,
  );
  if (kindLabel(proof)) card.append(makeElement(doc, 'p', { className: 'vpr-hint', text: `判断の種類: ${kindLabel(proof)}` }));
  const facts = makeElement(doc, 'dl', { className: 'vpr-facts' });
  const reason = text(proof.interruption.human_reason) ?? text(proof.interruption.reason_code) ?? '理由の記録なし';
  row(doc, facts, '扱い', `${RESOLUTION_LABELS[proof.interruption.resolution] ?? '不明'}（${reason}）`);
  row(doc, facts, '判断', text(proof.decision.summary) ?? '判断の記録なし');
  row(doc, facts, '仕事への影響', text(proof.decision.work_impact) ?? '影響の記録なし');
  const basis = Array.isArray(proof.decision.basis) ? proof.decision.basis : [];
  row(doc, facts, '根拠', basis.length > 0 ? basis.map(basisText).join(' / ') : '根拠の記録なし');
  const reuse = proof.decision.prior_learning_reused;
  row(doc, facts, '過去の学習の再利用', reuse === true ? 'あり' : reuse === false ? 'なし' : '未確認');
  row(doc, facts, '引き継ぎ', inheritanceText(proof.decision.inheritance));
  row(doc, facts, '実行', `${EXECUTION_LABELS[proof.execution.status] ?? '不明'}${text(proof.execution.summary) ? `: ${text(proof.execution.summary)}` : ''}`);
  const evidence = Array.isArray(proof.outcome.evidence_refs) ? proof.outcome.evidence_refs : [];
  const evidenceText = evidence.length > 0
    ? `（証拠: ${evidence.map((entry) => `${text(entry.label) ?? entry.kind} ${entry.status === 'verified' ? '確認済み' : '未確認'}`).join(' / ')}）`
    : '';
  row(doc, facts, '成果の確認', `${OUTCOME_LABELS[proof.outcome.status] ?? '不明'}${text(proof.outcome.summary) ? `: ${text(proof.outcome.summary)}` : ''}${evidenceText}`, `is-outcome-${proof.outcome.status}`);
  const latestLayer = FEEDBACK_LAYER_LABELS[item.feedbackHistory.at(-1)?.target_layer];
  row(doc, facts, '評価', `${FEEDBACK_LABELS[proof.feedback.status] ?? '不明'}${latestLayer ? `（${latestLayer}）` : ''}${text(proof.feedback.summary) ? `: ${text(proof.feedback.summary)}` : ''}`);
  card.append(facts);

  if (proof.human_decision) {
    const decision = makeElement(doc, 'section', { className: 'vpr-human-decision', attrs: { 'aria-label': 'あなたに戻した理由と選択肢' } });
    decision.append(
      makeElement(doc, 'h3', { text: 'あなたに戻した理由' }),
      makeElement(doc, 'p', { text: text(proof.human_decision.why_human) ?? '理由の記録なし' }),
    );
    const options = Array.isArray(proof.human_decision.options) ? proof.human_decision.options : [];
    if (options.length > 0) {
      const list = makeElement(doc, 'ul');
      for (const option of options) list.append(makeElement(doc, 'li', { text: `${text(option.label) ?? option.id}: ${text(option.impact) ?? '影響の記録なし'}` }));
      decision.append(makeElement(doc, 'h3', { text: '選択肢と影響' }), list);
    }
    card.append(decision);
  }

  card.append(renderFeedbackForm(doc, item, state, callbacks));

  if (item.feedbackHistory.length > 1) {
    const history = makeElement(doc, 'details', { className: 'vpr-history' });
    history.append(makeElement(doc, 'summary', { text: `評価の履歴 ${item.feedbackHistory.length}件` }));
    const list = makeElement(doc, 'ol');
    for (const entry of item.feedbackHistory) {
      const layer = FEEDBACK_LAYER_LABELS[entry.target_layer];
      list.append(makeElement(doc, 'li', { text: `${formatDate(entry.recorded_at)} ${FEEDBACK_LABELS[entry.status] ?? entry.status}${layer ? `（${layer}）` : ''}${text(entry.summary) ? `: ${text(entry.summary)}` : ''}` }));
    }
    history.append(list);
    card.append(history);
  }

  const consult = makeElement(doc, 'button', { className: 'vpr-secondary', text: 'Codexで相談する（依頼文をコピー）', attrs: { type: 'button' } });
  consult.addEventListener('click', () => callbacks.onConsult?.(consultText(proof)));
  card.append(consult);
  if (state.consultMessage) card.append(notice(doc, 'is-muted', state.consultMessage));

  const audit = makeElement(doc, 'details', { className: 'vpr-audit' });
  audit.append(makeElement(doc, 'summary', { text: '監査詳細' }));
  const auditFacts = makeElement(doc, 'dl', { className: 'vpr-facts is-audit' });
  row(doc, auditFacts, 'intent_id', proof.intent_id);
  row(doc, auditFacts, 'decision_attempt_id', proof.decision_attempt_id);
  row(doc, auditFacts, '記録日時', proof.recorded_at);
  row(doc, auditFacts, '状態', String(proof.state));
  if (text(proof.interruption.question_digest)) row(doc, auditFacts, 'question_digest', proof.interruption.question_digest);
  if (basis.length > 0) row(doc, auditFacts, '根拠の対象ID', basis.map((entry) => entry.entity_id).join(', '));
  if (evidence.length > 0) row(doc, auditFacts, '証拠参照', evidence.map((entry) => `${entry.kind}:${entry.ref}`).join(', '));
  const artifacts = Array.isArray(proof.execution.artifact_refs) ? proof.execution.artifact_refs : [];
  if (artifacts.length > 0) row(doc, auditFacts, '成果物参照', artifacts.map((entry) => `${entry.kind}:${entry.ref}`).join(', '));
  audit.append(auditFacts);
  card.append(audit);

  if (state.focusCard && typeof heading.focus === 'function') queueMicrotask(() => heading.focus());
  return card;
}

/** Render the whole surface into a host-owned root. */
export function renderValueProofReview(root, state, callbacks = {}, options = {}) {
  const doc = getDocument(options.document);
  root.replaceChildren();
  const surface = makeElement(doc, 'div', { className: 'vpr', attrs: { 'data-contract-version': VALUE_PROOF_REVIEW_UI_CONTRACT_VERSION } });
  surface.append(renderHeader(doc));

  if (state.phase === 'loading' && !state.home) {
    surface.append(notice(doc, 'is-muted', '判断の記録を読み込んでいます。'));
    root.append(surface);
    return surface;
  }
  if (state.phase === 'error') {
    surface.append(notice(doc, 'is-danger', `判断の記録を取得できません（${state.error ?? 'request_failed'}）。0件ではありません。`, 'alert'));
    const retry = makeElement(doc, 'button', { className: 'vpr-secondary', text: '再試行', attrs: { type: 'button' } });
    retry.addEventListener('click', () => void callbacks.onReload?.());
    surface.append(retry);
    root.append(surface);
    return surface;
  }
  const home = state.home;
  if (!home || home.status === 'invalid') {
    surface.append(notice(doc, 'is-danger', `判断の記録を表示できません（${home?.reason ?? '応答なし'}）。0件ではありません。`, 'alert'));
    root.append(surface);
    return surface;
  }
  if (home.status === 'unavailable') {
    const box = makeElement(doc, 'section', { className: 'vpr-unavailable', attrs: { role: 'alert' } });
    box.append(
      makeElement(doc, 'h2', { text: '判断journalに接続できません' }),
      makeElement(doc, 'p', { text: `場所: ${home.root ?? '不明'}（${home.reason}）` }),
      makeElement(doc, 'p', { text: '記録の場所は、起動時の --journal か環境変数 BRAINBASE_JUDGMENT_JOURNAL_DIR で指定できます。0件としては扱いません。' }),
    );
    surface.append(box);
    root.append(surface);
    return surface;
  }

  surface.append(renderCoverage(doc, home, state, callbacks));
  const layout = makeElement(doc, 'div', { className: 'vpr-layout' });
  const lists = makeElement(doc, 'div', { className: 'vpr-lists' });
  if (home.delegationMap.rated === 0 && home.delegationMap.judged > 0) {
    lists.append(notice(doc, 'is-muted', 'まだ評価がありません。任せている・戻しているは評価から決まります。'));
  }
  for (const highlight of [
    renderHighlight(doc, state, home.delegationMap.correctedAfterContinue, {
      className: 'is-corrected', title: '聞かずに進めたが直した判断', hint: 'あなたに聞かずに進めたあと、あなたが訂正・取り消しした判断',
    }, callbacks),
    renderHighlight(doc, state, home.delegationMap.continuedAfterAsk, {
      className: 'is-after-ask', title: '評価の後も聞かずに進めた判断', hint: '「次回は聞く」と評価した種類で、その後も聞かずに進めた判断。評価がまだ次の判断に効いていません',
    }, callbacks),
  ]) if (highlight) lists.append(highlight);
  lists.append(renderDelegationMap(doc, state, callbacks));
  if (home.sections.other.length > 0) {
    lists.append(makeElement(doc, 'p', { className: 'vpr-hint', text: `その他 ${home.sections.other.length}件（判断の代行が無い記録）` }));
  }
  layout.append(lists, renderCard(doc, findItem(state, state.selectedKey), state, callbacks));
  surface.append(layout);
  root.append(surface);
  return surface;
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
  document: explicitDocument,
  fetcher,
  basePath = '/api/value-proofs',
  token,
  clipboard,
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
    unratedOnly: false,
    needsHumanOnly: false,
    expandedRows: new Set(),
    draft: { status: '', summary: '', targetLayer: '' },
    save: { state: 'idle', message: '' },
    focusCard: false,
    consultMessage: '',
  };

  const callbacks = {
    onReload: () => controller.load(),
    onToggleUnrated(value) {
      state.unratedOnly = value;
      revealSelection(state);
      controller.render();
    },
    onToggleNeedsHuman(value) {
      state.needsHumanOnly = value;
      revealSelection(state);
      controller.render();
    },
    onToggleRow(key) {
      if (state.expandedRows.has(key)) state.expandedRows.delete(key);
      else state.expandedRows.add(key);
      controller.render();
    },
    onSelect(key) {
      if (key !== state.selectedKey) {
        state.draft = { status: '', summary: '', targetLayer: '' };
        state.save = { state: 'idle', message: '' };
        state.consultMessage = '';
      }
      state.selectedKey = key;
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
        const saved = findItem(state, itemKey(item.proof));
        if (saved?.proof.feedback.status !== option.value) throw new Error('保存後の読み戻しで評価を確認できません');
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
      renderValueProofReview(root, state, callbacks, { document: doc });
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
