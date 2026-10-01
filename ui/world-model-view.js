/*
 * World Model view (現状と見通し).
 *
 * Shows recorded observations apart from the variables and models that are
 * the owner's way of seeing them (which may be hypotheses), plus model
 * adoptions.  The host injects the fetcher and base path; this module keeps
 * no global state.  The empty state also offers the host's first-user
 * variable-and-observation registration route. Each section loads on its own: a failed
 * or unverifiable section is reported in place and never shown as zero items.
 *
 * Drawn with the organization edition's screen pattern (workspace-kit): a
 * section title under the page head, then one ledger per block. Rows are not
 * selectable, so the view never writes to the host's rail; the only write is
 * the explicit first-registration form shown for a confirmed empty state.
 *
 * A section the host cannot serve answers `{ status: 'unavailable', reason }`
 * (HTTP 200).  It is shown as unavailable, never as zero items; a host with no
 * World Model source at all can pass `unavailableNotice` to show one notice
 * with its own copy instead of four.
 */

import { workspaceButton, workspaceLedger, workspaceNotice, workspaceSectionTitle } from './workspace-kit.js';

export const WORLD_MODEL_VIEW_CONTRACT_VERSION = 'brainbase.world-model-view.v1';

export const WORLD_MODEL_SECTIONS = Object.freeze(['variables', 'models', 'observations', 'adoptions']);

const SECTION_KEYS = Object.freeze({ variables: 'records', models: 'records', observations: 'observations', adoptions: 'adoptions' });

export const EPISTEMIC_STATE_LABELS = Object.freeze({
  unverified: '未検証',
  hypothesis: '仮説',
  supported: '支持',
  verified: '検証済み',
  refuted: '反証',
});
const ADOPTION_LABELS = Object.freeze({ draft: '下書き', proposed: '提案中', approved: '承認済み', retired: '終了' });
const VALIDATION_LABELS = Object.freeze({ unverified: '未検証', in_progress: '検証中', supported: '支持', verified: '検証済み', refuted: '反証' });
const SOURCE_KIND_LABELS = Object.freeze({ candidate: '候補', document: '文書', observation: '観測', decision: '判断', import: '取り込み' });
const USE_LABELS = Object.freeze({ draft: '下書き', judgment: '判断', evaluation: '評価', execution: '実行' });
const UNREADABLE_LABELS = Object.freeze({
  authorization_denied: '読む権限がない',
  scope_violation: '扱える範囲の外',
  invalid_input: '変数の定義と合わない',
  not_found: '参照先が見つからない',
});

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

function formatDateTime(value) {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) return '日時不明';
  const date = new Date(time);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatValue(value, unit) {
  const rendered = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : JSON.stringify(value);
  return unit ? `${rendered} ${unit}` : rendered;
}

function isRevisionRef(value) {
  return isRecord(value) && typeof value.id === 'string' && typeof value.revision === 'string';
}

function isDefinitionRecord(value, type) {
  return isRecord(value) && isRecord(value.definition) && value.definition.type === type
    && typeof value.definition.id === 'string' && typeof value.definition.revision === 'string';
}

function isObservation(value) {
  return isRecord(value) && typeof value.id === 'string' && isRevisionRef(value.variableRef)
    && typeof value.subjectId === 'string' && typeof value.occurredAt === 'string' && typeof value.recordedAt === 'string'
    && isRecord(value.period) && isRecord(value.sourceRef) && 'value' in value;
}

function isAdoption(value) {
  return isRecord(value) && typeof value.adoptionId === 'string' && isRevisionRef(value.modelRef)
    && typeof value.adoptionState === 'string' && isRecord(value.candidate);
}

const ITEM_CHECKS = Object.freeze({
  variables: (item) => isDefinitionRecord(item, 'variable'),
  models: (item) => isDefinitionRecord(item, 'model'),
  observations: isObservation,
  adoptions: isAdoption,
});

/**
 * Normalize one section response.  A missing array or a malformed item is
 * `invalid`; an empty array is `empty` only when the host confirmed absence.
 */
export function normalizeWorldModelSection(section, payload) {
  const key = SECTION_KEYS[section];
  if (key && isRecord(payload) && (payload.status === 'unavailable' || payload.state === 'unavailable')) {
    return { state: 'unavailable', items: null, reason: text(payload.reason) };
  }
  if (!key || !isRecord(payload) || !Array.isArray(payload[key])) {
    return { state: 'invalid', items: null, reason: '応答の形式が不正です' };
  }
  const items = payload[key];
  if (!items.every(ITEM_CHECKS[section])) return { state: 'invalid', items: null, reason: '応答の記録の形式が不正です' };
  const unreadableCount = Number.isInteger(payload.unreadable?.count) && payload.unreadable.count > 0 ? payload.unreadable.count : 0;
  const unreadableCodes = Array.isArray(payload.unreadable?.codes) ? payload.unreadable.codes.filter((code) => typeof code === 'string') : [];
  const unreadable = { count: unreadableCount, codes: unreadableCodes };
  if (items.length === 0) {
    return payload.absence_confirmed === true && unreadableCount === 0
      ? { state: 'empty', items: [], unreadable }
      : { state: 'unknown', items: null, unreadable };
  }
  return { state: unreadableCount > 0 ? 'partial' : 'ready', items, unreadable };
}

function unreadableMessage(unreadable) {
  const reasons = unreadable.codes.map((code) => UNREADABLE_LABELS[code] ?? code).join('、');
  return `読めない記録が${unreadable.count}件あります${reasons ? `（${reasons}）` : ''}。読めた記録だけを表示しています。`;
}

function refLabel(ref, names) {
  const name = names.get(ref.id);
  return name ? `${name}（${ref.id}@${ref.revision}）` : `${ref.id}@${ref.revision}`;
}

/** A ledger cell with a main line and quieter detail lines (the World Model rows wrap instead of cutting text). */
function stack(doc, main, details = [], className = '') {
  const cell = makeElement(doc, 'span', { className: `bb-wm-cell${className ? ` ${className}` : ''}` });
  cell.append(makeElement(doc, 'span', { className: 'bb-wm-main', text: main }));
  for (const detail of details) {
    if (!detail) continue;
    const [value, tone] = Array.isArray(detail) ? detail : [detail, ''];
    cell.append(makeElement(doc, 'small', { className: tone ? `is-${tone}` : undefined, text: value }));
  }
  return cell;
}

/** One element for a notice body, so the kit's label column stays on the left. */
function noticeBody(doc, message, action) {
  const body = makeElement(doc, 'div', { className: 'bb-wm-notice-body' });
  body.append(makeElement(doc, 'p', { text: message }));
  if (action) body.append(action);
  return body;
}

/**
 * A section's state as a notice, or nothing when its rows can be shown.
 * Returns `{ notice, rows }`: rows is false when the section has none to show.
 */
function sectionStatus(doc, label, section, sectionState, callbacks, emptyText) {
  const { state } = sectionState;
  if (state === 'loading' || state === 'idle') {
    return { notice: workspaceNotice(doc, { label, text: '読み込んでいます。' }), rows: false };
  }
  if (state === 'approval_unverifiable') {
    return {
      notice: workspaceNotice(doc, { label, tone: 'warning', text: '承認を確かめられないため表示できません。承認済みの採用を確かめる仕組みがこのホストにありません。ほかの欄はそのまま使えます。' }),
      rows: false,
    };
  }
  if (state === 'error' || state === 'invalid') {
    const retry = workspaceButton(doc, { text: '再試行', variant: 'quiet', onClick: () => void callbacks.onRetry?.(section) });
    return {
      notice: workspaceNotice(doc, { label, tone: 'danger', text: noticeBody(doc, `読み取れませんでした（${sectionState.reason ?? '理由不明'}）。0件ではありません。`, retry) }),
      rows: false,
    };
  }
  if (state === 'unavailable') {
    return {
      notice: workspaceNotice(doc, { label, tone: 'warning', text: `このホストでは読めません（${sectionState.reason ?? '理由不明'}）。0件ではありません。` }),
      rows: false,
    };
  }
  if (state === 'unknown') {
    const message = sectionState.unreadable?.count
      ? unreadableMessage(sectionState.unreadable)
      : '記録の有無を確かめられません。0件ではありません。';
    return { notice: workspaceNotice(doc, { label, tone: 'warning', text: message }), rows: false };
  }
  if (state === 'empty') return { notice: workspaceNotice(doc, { label, text: emptyText }), rows: false };
  if (state === 'partial') return { notice: workspaceNotice(doc, { label, tone: 'warning', text: unreadableMessage(sectionState.unreadable) }), rows: true };
  return { notice: null, rows: true };
}

function epistemicText(state) {
  return EPISTEMIC_STATE_LABELS[state] ?? null;
}

function viewRows(doc, state, statuses, variableNames) {
  const rows = [];
  if (statuses.variables.rows) {
    for (const record of state.variables.items) {
      const definition = record.definition;
      const epistemic = epistemicText(definition.epistemicState);
      rows.push({
        key: `variable:${definition.id}`,
        cells: [
          stack(doc, text(definition.meaning) ?? definition.id, [
            text(definition.subject) ? `対象: ${text(definition.subject)}` : null,
            text(definition.unit) ? `単位: ${text(definition.unit)}` : null,
            text(definition.measurementMethod) ? `測り方: ${text(definition.measurementMethod)}` : null,
          ]),
          stack(doc, '変数', [ADOPTION_LABELS[definition.adoptionState] ?? (definition.adoptionState ? String(definition.adoptionState) : '採用 未記録')]),
          stack(doc, epistemic ?? '未記録', [], epistemic ? `is-${definition.epistemicState}` : 'is-unresolved'),
          { text: `${definition.id}@${definition.revision}`, className: 'bb-wm-code' },
        ],
      });
    }
  }
  if (statuses.models.rows) {
    for (const record of state.models.items) {
      const definition = record.definition;
      const refs = (value) => (Array.isArray(value) && value.length > 0 ? value.filter(isRevisionRef).map((ref) => refLabel(ref, variableNames)).join('、') : null);
      const epistemic = epistemicText(definition.epistemicState);
      rows.push({
        key: `model:${definition.id}`,
        cells: [
          stack(doc, text(definition.meaning) ?? definition.id, [
            text(definition.relationship) ? `関係: ${text(definition.relationship)}` : null,
            text(definition.uncertainty) ? `不確かさ: ${text(definition.uncertainty)}` : null,
            refs(definition.inputVariableRefs) ? `入力: ${refs(definition.inputVariableRefs)}` : null,
            refs(definition.outputVariableRefs) ? `出力: ${refs(definition.outputVariableRefs)}` : null,
          ]),
          stack(doc, 'モデル', [`検証: ${VALIDATION_LABELS[definition.validationState] ?? '未記録'}`]),
          stack(doc, epistemic ?? '未記録', [], epistemic ? `is-${definition.epistemicState}` : 'is-unresolved'),
          { text: `${definition.id}@${definition.revision}`, className: 'bb-wm-code' },
        ],
      });
    }
  }
  return rows;
}

function observationRows(doc, state, names, units) {
  const correctedBy = new Map();
  for (const observation of state.observations.items) {
    if (typeof observation.supersedes === 'string') correctedBy.set(observation.supersedes, observation.id);
  }
  return state.observations.items.map((observation) => {
    const newer = correctedBy.get(observation.id);
    const source = observation.sourceRef;
    const chain = [];
    if (typeof observation.supersedes === 'string') chain.push([`観測「${observation.supersedes}」を訂正`, 'accent']);
    if (newer) chain.push([`観測「${newer}」で訂正済み`, 'warning']);
    return {
      key: observation.id,
      className: newer ? 'is-superseded' : '',
      cells: [
        stack(doc, observation.subjectId, [refLabel(observation.variableRef, names)]),
        stack(doc, formatValue(observation.value, units.get(observation.variableRef.id)), chain, 'is-value'),
        stack(doc, `${formatDateTime(observation.period.from)} 〜 ${formatDateTime(observation.period.until)}`, [`発生 ${formatDateTime(observation.occurredAt)}`]),
        stack(doc, formatDateTime(observation.recordedAt)),
        stack(doc, `${SOURCE_KIND_LABELS[source.sourceKind] ?? String(source.sourceKind)}（${String(source.sourceId)}）`, [`観測ID ${observation.id}`]),
      ],
    };
  });
}

function adoptionRows(doc, state, modelNames) {
  return state.adoptions.items.map((adoption) => {
    const candidate = adoption.candidate;
    return {
      key: adoption.adoptionId,
      cells: [
        stack(doc, refLabel(adoption.modelRef, modelNames)),
        stack(doc, ADOPTION_LABELS[adoption.adoptionState] ?? String(adoption.adoptionState), [], adoption.adoptionState === 'approved' ? 'is-approved' : 'is-pending'),
        stack(doc, text(candidate.hypothesis) ?? '仮説の記録なし', [
          EPISTEMIC_STATE_LABELS[candidate.epistemicState] ? `候補の認識: ${EPISTEMIC_STATE_LABELS[candidate.epistemicState]}` : null,
          Array.isArray(candidate.evidenceIds) ? `証拠 ${candidate.evidenceIds.length}件` : null,
        ]),
        stack(doc, USE_LABELS[adoption.authorizedUse] ?? text(adoption.authorizedUse) ?? '未記録'),
        stack(doc, isRevisionRef(adoption.approvalRef) ? `${adoption.approvalRef.id}@${adoption.approvalRef.revision}` : 'なし'),
        stack(doc, formatDateTime(adoption.adoptedAt)),
      ],
    };
  });
}

function namesOf(section) {
  const names = new Map();
  const units = new Map();
  for (const record of section.items ?? []) {
    const definition = record.definition;
    if (text(definition.meaning)) names.set(definition.id, text(definition.meaning));
    if (text(definition.unit)) units.set(definition.id, text(definition.unit));
  }
  return { names, units };
}

function block(doc, label, heading, lead) {
  const section = makeElement(doc, 'section', { className: 'bb-wm-block', attrs: { 'aria-label': label } });
  section.append(makeElement(doc, 'h3', { className: 'bb-wm-heading', text: heading }), makeElement(doc, 'p', { className: 'bb-wm-lead', text: lead }));
  return section;
}

/**
 * The host's single notice when no section can be served: its title and
 * guidance, then the reasons the sections gave.  Null when the host passed no
 * copy or when any section is readable, loading or failed in another way.
 */
function unavailableSummary(doc, state, unavailableNotice) {
  if (!isRecord(unavailableNotice) || !text(unavailableNotice.title)) return null;
  if (!WORLD_MODEL_SECTIONS.every((section) => state[section]?.state === 'unavailable')) return null;
  const labels = isRecord(unavailableNotice.reasonLabels) ? unavailableNotice.reasonLabels : {};
  const reasonText = (reason) => (Object.hasOwn(labels, reason) && text(labels[reason])) || reason;
  const reasons = [...new Set(WORLD_MODEL_SECTIONS.map((section) => state[section].reason).filter(Boolean).map(reasonText))];
  const body = makeElement(doc, 'div', { className: 'bb-wm-notice-body' });
  if (text(unavailableNotice.guidance)) body.append(makeElement(doc, 'p', { text: text(unavailableNotice.guidance) }));
  body.append(makeElement(doc, 'p', { text: `理由: ${reasons.length > 0 ? reasons.join('、') : '理由不明'}。0件ではありません。` }));
  return workspaceNotice(doc, { label: text(unavailableNotice.title), text: body, tone: 'info' });
}

/**
 * The current Personal Web is a read-mostly World Model surface. Show the
 * first-registration entry only after variables and observations have both
 * been confirmed empty;
 * an unknown, partial or unavailable section must not be presented as an
 * empty World Model.
 */
function registrationField(doc, { id, label, type = 'text', value = '', required = true, attrs = {}, options = [] } = {}) {
  const field = makeElement(doc, 'div', { className: 'bb-wm-registration-field' });
  const labelElement = makeElement(doc, 'label', { text: label, attrs: { for: id } });
  const input = makeElement(doc, type === 'select' ? 'select' : 'input', {
    className: 'bb-wm-registration-input',
    attrs: { id, name: id, type: type === 'select' ? undefined : type, required, ...attrs },
  });
  if (type === 'select') {
    for (const option of options) {
      input.append(makeElement(doc, 'option', { text: option.label, attrs: { value: option.value } }));
    }
    input.value = value;
  } else {
    input.value = value;
  }
  field.append(labelElement, input);
  return { field, input, id };
}

function registrationValue(raw, valueKind) {
  const value = String(raw ?? '').trim();
  if (!value) return { error: '最初の観測値を入力してください。' };
  if (valueKind === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? { value: number } : { error: '数値の観測値を入力してください。' };
  }
  if (valueKind === 'boolean') {
    if (value === 'true' || value === 'はい') return { value: true };
    if (value === 'false' || value === 'いいえ') return { value: false };
    return { error: '真偽値は「true」または「false」で入力してください。' };
  }
  return { value };
}

function emptyRegistrationEntry(doc, state, callbacks, registration = {}) {
  if (state.variables?.state !== 'empty' || state.observations?.state !== 'empty') return null;
  const formFields = {};
  const form = makeElement(doc, 'form', {
    className: 'bb-wm-registration-form',
    attrs: { 'aria-label': '最初の変数と観測値を登録' },
  });
  const fields = [
    registrationField(doc, { id: 'bb-wm-registration-meaning', label: '何を記録するか', attrs: { autocomplete: 'off' } }),
    registrationField(doc, { id: 'bb-wm-registration-subject', label: '対象', attrs: { autocomplete: 'off' } }),
    registrationField(doc, {
      id: 'bb-wm-registration-value-kind', label: '値の種類', type: 'select', value: 'number',
      options: [
        { value: 'number', label: '数値' },
        { value: 'boolean', label: 'はい／いいえ' },
        { value: 'string', label: '文字' },
        { value: 'state', label: '状態' },
      ],
    }),
    registrationField(doc, { id: 'bb-wm-registration-unit', label: '単位（数値の場合）', required: false, attrs: { autocomplete: 'off' } }),
    registrationField(doc, {
      id: 'bb-wm-registration-aggregation', label: '集計方法', type: 'select', value: 'last',
      options: [
        { value: 'last', label: '最新の値' },
        { value: 'sum', label: '合計' },
        { value: 'average', label: '平均' },
        { value: 'count', label: '件数' },
        { value: 'none', label: '集計しない' },
      ],
    }),
    registrationField(doc, { id: 'bb-wm-registration-granularity', label: '記録の単位', value: '日', attrs: { autocomplete: 'off' } }),
    registrationField(doc, { id: 'bb-wm-registration-method', label: '測り方', attrs: { autocomplete: 'off' } }),
    registrationField(doc, { id: 'bb-wm-registration-value', label: '最初の観測値', attrs: { autocomplete: 'off' } }),
  ];
  for (const { field, input, id } of fields) {
    formFields[id] = input;
    form.append(field);
  }
  const status = makeElement(doc, 'p', {
    className: 'bb-wm-registration-status',
    text: registration.message ?? '登録すると、この画面の記録として読み直します。',
    attrs: { 'aria-live': 'polite' },
  });
  const submit = workspaceButton(doc, {
    text: registration.state === 'saving' ? '登録しています…' : '変数と観測値を登録',
    variant: 'primary',
    disabled: registration.state === 'saving',
    attrs: { type: 'submit' },
  });
  form.addEventListener('submit', (event) => {
    event?.preventDefault?.();
    const parsed = registrationValue(formFields['bb-wm-registration-value'].value, formFields['bb-wm-registration-value-kind'].value);
    const payload = {
      meaning: String(formFields['bb-wm-registration-meaning'].value ?? '').trim(),
      subject: String(formFields['bb-wm-registration-subject'].value ?? '').trim(),
      valueKind: String(formFields['bb-wm-registration-value-kind'].value ?? '').trim(),
      unit: String(formFields['bb-wm-registration-unit'].value ?? '').trim(),
      aggregation: String(formFields['bb-wm-registration-aggregation'].value ?? '').trim(),
      granularity: String(formFields['bb-wm-registration-granularity'].value ?? '').trim(),
      measurementMethod: String(formFields['bb-wm-registration-method'].value ?? '').trim(),
      value: parsed.value,
    };
    if (!payload.meaning || !payload.subject || !payload.granularity || !payload.measurementMethod) {
      status.textContent = '何を記録するか、対象、記録の単位、測り方を入力してください。';
      return;
    }
    if (payload.valueKind === 'number' && !payload.unit) {
      status.textContent = '数値を記録する場合は単位を入力してください。';
      return;
    }
    if (parsed.error) {
      status.textContent = parsed.error;
      return;
    }
    return callbacks.onRegister?.(payload);
  });
  form.append(status, submit);
  const guidance = workspaceNotice(doc, {
    label: '最初の登録',
    text: [
      makeElement(doc, 'p', { text: 'ここから変数と最初の観測値を登録できます。登録者と記録日時は、この手元のWebホストが決めます。' }),
      form,
      makeElement(doc, 'p', { className: 'bb-wm-registration-boundary', text: 'モデルの作成・採用や、既存観測の訂正はこの初回登録の対象外です。確認と権限が必要な別の手順で扱います。' }),
    ],
  });
  guidance.className += ' bb-wm-registration-guidance';
  return guidance;
}

/**
 * Render the whole view into a host-owned root: a section title, optional first-registration form,
 * and ledgers.
 * `options.unavailableNotice` is the host's `{ title, guidance }` shown once
 * when every section is unavailable.
 */
export function renderWorldModelView(root, state, callbacks = {}, options = {}) {
  const doc = getDocument(options.document);
  root.replaceChildren();
  const surface = makeElement(doc, 'section', { className: 'bb-wm', attrs: { 'data-contract-version': WORLD_MODEL_VIEW_CONTRACT_VERSION, 'aria-label': '現状と見通し' } });
  surface.append(workspaceSectionTitle(doc, {
    title: '現状と見通し',
    lead: '見方（変数とモデル。仮説を含みます）と、記録された観測を分けて表示します。最初の変数と観測値はここから登録できます。',
  }));
  const unavailable = unavailableSummary(doc, state, options.unavailableNotice);
  if (unavailable) {
    surface.append(unavailable);
    root.append(surface);
    return surface;
  }

  if (options.registration?.state === 'error' && text(options.registration.message)) {
    surface.append(workspaceNotice(doc, {
      label: '登録結果',
      tone: 'danger',
      text: options.registration.message,
    }));
  }

  const variables = namesOf(state.variables);
  const models = namesOf(state.models);

  const view = block(doc, '変数とモデル', '見方：変数とモデル', '何を測り、どう関係すると考えているか。認識の状態は、確かめた度合いです。観測ではありません。');
  const registrationGuidance = emptyRegistrationEntry(doc, state, callbacks, options.registration);
  if (registrationGuidance) view.append(registrationGuidance);
  const statuses = {
    variables: sectionStatus(doc, '変数', 'variables', state.variables, callbacks, '変数はまだ登録がありません。'),
    models: sectionStatus(doc, 'モデル', 'models', state.models, callbacks, 'モデルはまだ登録がありません。'),
  };
  for (const status of Object.values(statuses)) if (status.notice) view.append(status.notice);
  const rows = viewRows(doc, state, statuses, variables.names);
  if (rows.length > 0) {
    view.append(workspaceLedger(doc, { className: 'bb-wm-view-ledger', ariaLabel: '変数とモデル', columns: ['名前', '種類', '認識の状態', '版'], rows }));
  }
  surface.append(view);

  const observed = block(doc, '観測', '観測：記録された値', '実際に記録された値です。推定や予測は含みません。訂正は新しい観測として残り、元の観測との関係を示します。');
  const observedStatus = sectionStatus(doc, '観測', 'observations', state.observations, callbacks, '観測はまだ記録がありません。');
  if (observedStatus.notice) observed.append(observedStatus.notice);
  if (observedStatus.rows) {
    observed.append(workspaceLedger(doc, {
      className: 'bb-wm-observation-ledger',
      ariaLabel: '観測',
      columns: ['対象', '値', '期間', '記録', '出典'],
      rows: observationRows(doc, state, variables.names, variables.units),
    }));
  }
  surface.append(observed);

  const adopted = block(doc, 'モデルの採用', 'モデルの採用', 'どのモデルを、どの根拠で判断などに使うことにしたか。');
  const adoptedStatus = sectionStatus(doc, '採用', 'adoptions', state.adoptions, callbacks, 'モデルの採用はまだありません。');
  if (adoptedStatus.notice) adopted.append(adoptedStatus.notice);
  if (adoptedStatus.rows) {
    adopted.append(workspaceLedger(doc, {
      className: 'bb-wm-adoption-ledger',
      ariaLabel: 'モデルの採用',
      columns: ['モデル', '状態', '根拠', '用途', '承認', '日時'],
      rows: adoptionRows(doc, state, models.names),
    }));
  }
  surface.append(adopted);

  root.append(surface);
  return surface;
}

async function readError(response) {
  try {
    const body = await response.json();
    return { code: text(body?.error?.code), message: text(body?.error?.message) };
  } catch {
    return { code: null, message: null };
  }
}

/**
 * Mounts the World Model view.
 *
 * @param {object} options
 * @param {Element} options.root Where the view is drawn.
 * @param {Element} [options.rail] Accepted for the host's screen contract; the view never writes to it.
 * @param {Document} [options.document] The document to build elements with (default: the global one).
 * @param {Function} [options.fetcher] `fetch`-compatible function for the sections.
 * @param {string} [options.token] Local Web write token sent with registration requests.
 * @param {string} [options.basePath='/api/world-model'] Where `{variables,models,observations,adoptions}` are served.
 * @param {boolean} [options.autoLoad=true] Reads every section on mount.
 * @param {{ title: string, guidance?: string, reasonLabels?: Record<string, string> }} [options.unavailableNotice]
 *   When every section is unavailable (for example the host has no World Model source), one notice
 *   with this title (the notice's short label) and guidance, plus the reasons, replaces the blocks.
 *   `reasonLabels` says a reason code in the host's words.  Without it each block reports its own
 *   state, as by default.
 * @returns The controller: `state`, `render()`, `load()`, `loadSection(section)`.
 */
export function createWorldModelView({
  root,
  /** Accepted for the host's screen contract; the view keeps the rail to the screen's editor. */
  rail: _rail,
  document: explicitDocument,
  fetcher,
  token,
  basePath = '/api/world-model',
  autoLoad = true,
  unavailableNotice,
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = getDocument(explicitDocument);
  const request = typeof fetcher === 'function'
    ? fetcher
    : typeof globalThis.fetch === 'function' ? (path, init) => globalThis.fetch(path, init) : null;
  const base = String(basePath).replace(/\/+$/u, '');
  const state = Object.fromEntries(WORLD_MODEL_SECTIONS.map((section) => [section, { state: 'loading', items: null }]));

  const registration = { state: 'idle', message: null };
  const callbacks = {
    onRetry: (section) => controller.loadSection(section),
    onRegister: (payload) => controller.register(payload),
  };

  const controller = {
    get state() { return state; },
    render() {
      renderWorldModelView(root, state, callbacks, { document: doc, unavailableNotice, registration });
      return controller;
    },
    async loadSection(section) {
      state[section] = { state: 'loading', items: null };
      controller.render();
      if (!request) {
        state[section] = { state: 'error', items: null, reason: '取得先が設定されていません' };
        controller.render();
        return state[section];
      }
      try {
        const response = await request(`${base}/${section}`);
        if (!response.ok) {
          const error = await readError(response);
          state[section] = error.code === 'approval_reference_unresolved'
            ? { state: 'approval_unverifiable', items: null }
            : { state: 'error', items: null, reason: error.message ?? error.code ?? `HTTP ${response.status}` };
        } else {
          state[section] = normalizeWorldModelSection(section, await response.json());
        }
      } catch (error) {
        state[section] = { state: 'error', items: null, reason: error instanceof Error ? error.message : 'request_failed' };
      }
      controller.render();
      return state[section];
    },
    async load() {
      await Promise.all(WORLD_MODEL_SECTIONS.map((section) => controller.loadSection(section)));
      return state;
    },
    async register(payload) {
      if (!request) {
        registration.state = 'error';
        registration.message = '登録先が設定されていません。';
        controller.render();
        return;
      }
      registration.state = 'saving';
      registration.message = '登録しています…';
      controller.render();
      const write = async (path, body) => {
        const response = await request(`${base}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'X-Brainbase-Review-Token': token } : {}),
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const error = await readError(response);
          throw new Error(error.message ?? error.code ?? `HTTP ${response.status}`);
        }
        return response.json();
      };
      let variableReference = null;
      try {
        const created = await write('/variables', {
          meaning: payload.meaning,
          subject: payload.subject,
          valueKind: payload.valueKind,
          ...(payload.unit ? { unit: payload.unit } : {}),
          aggregation: payload.aggregation,
          granularity: payload.granularity,
          measurementMethod: payload.measurementMethod,
        });
        const reference = created?.reference;
        if (!reference || typeof reference.id !== 'string' || typeof reference.revision !== 'string') {
          throw new Error('変数の登録結果を読み取れませんでした');
        }
        variableReference = reference;
        await write('/observations', { variableRef: reference, value: payload.value });
        registration.state = 'idle';
        registration.message = null;
        await controller.load();
      } catch (error) {
        registration.state = 'error';
        const detail = error instanceof Error ? error.message : '登録できませんでした';
        registration.message = variableReference
          ? `変数は登録されましたが、最初の観測値を保存できませんでした。${detail}`
          : detail;
        await controller.load();
        controller.render();
      }
      return registration;
    },
  };
  controller.render();
  if (autoLoad) void controller.load();
  return controller;
}

export default createWorldModelView;
