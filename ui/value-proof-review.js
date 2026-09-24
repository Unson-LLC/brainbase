/*
 * Local owner review surface for judgment value proofs.
 *
 * The host supplies a same-origin request function and a review token. This
 * module owns presentation only: it never treats an unavailable journal as an
 * empty list, never edits the judgment journal, and keeps internal IDs inside
 * the audit details.
 */

export const VALUE_PROOF_REVIEW_UI_CONTRACT_VERSION = 'value-proof-review-ui.v1';

const SECTION_ORDER = Object.freeze(['needs_human', 'blocked', 'continued']);
const SECTION_LABELS = Object.freeze({
  needs_human: 'あなたの判断が必要',
  blocked: '止まっている',
  continued: '聞かずに進めた',
  other: 'その他',
});
const SECTION_HINTS = Object.freeze({
  needs_human: 'Brainbaseが決めずに、あなたへ戻した判断',
  blocked: '進めたが、途中で止まった判断',
  continued: 'あなたに聞かずに進めた判断',
});
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
const EXECUTION_LABELS = Object.freeze({ not_started: '未着手', executing: '実行中', completed: '完了', blocked: '停止' });
const FEEDBACK_LABELS = Object.freeze({
  none: '未評価',
  pending: '評価待ち',
  accepted: '採用',
  corrected: '訂正',
  next_time_ask: '次回は聞く',
  reverted: '取り消し',
});
export const VALUE_PROOF_FEEDBACK_OPTIONS = Object.freeze([
  Object.freeze({ value: 'accepted', label: '採用', hint: '聞かずに進めてよかった', summary: 'none', placeholder: '' }),
  Object.freeze({ value: 'corrected', label: '訂正', hint: '判断の中身が違った', summary: 'required', placeholder: '何が違ったか（必須）' }),
  Object.freeze({ value: 'next_time_ask', label: '次回は聞く', hint: 'この種の判断は、次は聞いてほしい', summary: 'optional', placeholder: 'どの条件なら聞くべきか（任意）' }),
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
    rejected: Array.isArray(payload.rejected) ? payload.rejected.filter(isRecord) : [],
  };
}

function isUnrated(proof) {
  return proof.feedback.status === 'none' || proof.feedback.status === 'pending';
}

function visibleItems(state, section) {
  const items = state.home?.sections?.[section] ?? [];
  return state.unratedOnly ? items.filter((item) => isUnrated(item.proof)) : items;
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
  for (const section of SECTION_ORDER) {
    const item = visibleItems(state, section)[0];
    if (item) return itemKey(item.proof);
  }
  return null;
}

function notice(doc, className, message, role = 'status') {
  return makeElement(doc, 'p', { className: `vpr-notice ${className}`, text: message, attrs: { role } });
}

function renderHeader(doc) {
  const header = makeElement(doc, 'header', { className: 'vpr-header' });
  header.append(
    makeElement(doc, 'div', { className: 'vpr-kicker', text: 'BRAINBASE / REVIEW' }),
    makeElement(doc, 'h1', { text: '判断の見返し' }),
    makeElement(doc, 'p', { className: 'vpr-lead', text: 'Brainbaseが最近、何をあなたに聞かずに進め、何をあなたに戻し、何が止まっているか。' }),
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

function renderSection(doc, state, section, callbacks) {
  const items = visibleItems(state, section);
  const all = state.home.sections[section];
  const block = makeElement(doc, 'section', { className: `vpr-section is-${section}`, attrs: { 'aria-label': SECTION_LABELS[section] } });
  const heading = makeElement(doc, 'h2');
  heading.append(
    makeElement(doc, 'span', { text: SECTION_LABELS[section] }),
    makeElement(doc, 'span', { className: 'vpr-count', text: `${all.length}件` }),
  );
  block.append(heading, makeElement(doc, 'p', { className: 'vpr-hint', text: SECTION_HINTS[section] }));
  if (items.length === 0) {
    block.append(makeElement(doc, 'p', { className: 'vpr-empty', text: all.length === 0 ? 'この区分の記録はありません。' : '未評価の記録はありません。' }));
    return block;
  }
  const list = makeElement(doc, 'ul', { className: 'vpr-list' });
  for (const item of items) {
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
        text: `${formatDate(item.proof.recorded_at)} · ${OUTCOME_LABELS[item.proof.outcome.status] ?? '成果不明'} · ${FEEDBACK_LABELS[item.proof.feedback.status] ?? '評価不明'}`,
      }),
    );
    button.addEventListener('click', () => callbacks.onSelect?.(key));
    const row = makeElement(doc, 'li');
    row.append(button);
    list.append(row);
  }
  block.append(list);
  return block;
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
    });
    label.append(radio, makeElement(doc, 'span', { text: option.label }));
    options.append(label);
  }
  syncSummary(draft.status);
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
  fieldset.append(options, summaryHint, summary);
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
  const facts = makeElement(doc, 'dl', { className: 'vpr-facts' });
  const reason = text(proof.interruption.human_reason) ?? text(proof.interruption.reason_code) ?? '理由の記録なし';
  row(doc, facts, '扱い', `${RESOLUTION_LABELS[proof.interruption.resolution] ?? '不明'}（${reason}）`);
  row(doc, facts, '判断', text(proof.decision.summary) ?? '判断の記録なし');
  row(doc, facts, '仕事への影響', text(proof.decision.work_impact) ?? '影響の記録なし');
  const basis = Array.isArray(proof.decision.basis) ? proof.decision.basis : [];
  row(doc, facts, '根拠', basis.length > 0 ? basis.map((entry) => text(entry.application) ?? '適用内容なし').join(' / ') : '根拠の記録なし');
  const reuse = proof.decision.prior_learning_reused;
  row(doc, facts, '過去の学習の再利用', reuse === true ? 'あり' : reuse === false ? 'なし' : '未確認');
  row(doc, facts, '実行', `${EXECUTION_LABELS[proof.execution.status] ?? '不明'}${text(proof.execution.summary) ? `: ${text(proof.execution.summary)}` : ''}`);
  const evidence = Array.isArray(proof.outcome.evidence_refs) ? proof.outcome.evidence_refs : [];
  const evidenceText = evidence.length > 0
    ? `（証拠: ${evidence.map((entry) => `${text(entry.label) ?? entry.kind} ${entry.status === 'verified' ? '確認済み' : '未確認'}`).join(' / ')}）`
    : '';
  row(doc, facts, '成果の確認', `${OUTCOME_LABELS[proof.outcome.status] ?? '不明'}${text(proof.outcome.summary) ? `: ${text(proof.outcome.summary)}` : ''}${evidenceText}`, `is-outcome-${proof.outcome.status}`);
  row(doc, facts, '評価', `${FEEDBACK_LABELS[proof.feedback.status] ?? '不明'}${text(proof.feedback.summary) ? `: ${text(proof.feedback.summary)}` : ''}`);
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
      list.append(makeElement(doc, 'li', { text: `${formatDate(entry.recorded_at)} ${FEEDBACK_LABELS[entry.status] ?? entry.status}${text(entry.summary) ? `: ${text(entry.summary)}` : ''}` }));
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
  for (const section of SECTION_ORDER) lists.append(renderSection(doc, state, section, callbacks));
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
    draft: { status: '', summary: '' },
    save: { state: 'idle', message: '' },
    focusCard: false,
    consultMessage: '',
  };

  const callbacks = {
    onReload: () => controller.load(),
    onToggleUnrated(value) {
      state.unratedOnly = value;
      if (!findItem(state, state.selectedKey) || (value && !isUnrated(findItem(state, state.selectedKey).proof))) {
        state.selectedKey = firstVisibleKey(state);
      }
      controller.render();
    },
    onSelect(key) {
      if (key !== state.selectedKey) {
        state.draft = { status: '', summary: '' };
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
          }),
        });
        if (!response.ok) throw new Error(await readErrorMessage(response));
        await controller.load();
        const saved = findItem(state, itemKey(item.proof));
        if (saved?.proof.feedback.status !== option.value) throw new Error('保存後の読み戻しで評価を確認できません');
        state.draft = { status: '', summary: '' };
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
        if (!findItem(state, state.selectedKey)) state.selectedKey = firstVisibleKey(state);
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
