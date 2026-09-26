/*
 * Read-only World Model view (現状と見通し).
 *
 * Shows recorded observations apart from the variables and models that are
 * the owner's way of seeing them (which may be hypotheses), plus model
 * adoptions.  The host injects the fetcher and base path; this module keeps
 * no global state and never writes.  Each section loads on its own: a failed
 * or unverifiable section is reported in place and never shown as zero items.
 */

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

function notice(doc, className, message, role = 'status') {
  return makeElement(doc, 'p', { className: `bb-wm-notice ${className}`, text: message, attrs: { role } });
}

function badge(doc, label, tone = '') {
  return makeElement(doc, 'span', { className: `bb-wm-badge${tone ? ` is-${tone}` : ''}`, text: label });
}

function facts(doc, rows) {
  const list = makeElement(doc, 'dl', { className: 'bb-wm-facts' });
  for (const [label, value] of rows) {
    if (value === null || value === undefined || value === '') continue;
    list.append(makeElement(doc, 'dt', { text: label }), makeElement(doc, 'dd', { text: value }));
  }
  return list;
}

function item(doc, title, badges, rows, className = '') {
  const article = makeElement(doc, 'article', { className: `bb-wm-item${className ? ` ${className}` : ''}` });
  const head = makeElement(doc, 'div', { className: 'bb-wm-item-head' });
  head.append(makeElement(doc, 'strong', { className: 'bb-wm-item-title', text: title }));
  if (badges.length > 0) {
    const group = makeElement(doc, 'span', { className: 'bb-wm-badges' });
    group.append(...badges);
    head.append(group);
  }
  article.append(head, facts(doc, rows));
  return article;
}

function epistemicBadge(doc, state) {
  const label = EPISTEMIC_STATE_LABELS[state];
  if (!label) return badge(doc, '認識の状態 未記録', 'muted');
  const tone = state === 'verified' || state === 'supported' ? 'success' : state === 'refuted' ? 'danger' : 'warning';
  return badge(doc, `認識: ${label}`, tone);
}

function unreadableMessage(unreadable) {
  const reasons = unreadable.codes.map((code) => UNREADABLE_LABELS[code] ?? code).join('、');
  return `読めない記録が${unreadable.count}件あります${reasons ? `（${reasons}）` : ''}。読めた記録だけを表示しています。`;
}

function refLabel(ref, names) {
  const name = names.get(ref.id);
  return name ? `${name}（${ref.id}@${ref.revision}）` : `${ref.id}@${ref.revision}`;
}

/** Renders a section's status; returns true when the caller should render its items. */
function renderSectionState(doc, container, section, sectionState, callbacks, emptyText) {
  const { state } = sectionState;
  if (state === 'loading' || state === 'idle') {
    container.append(notice(doc, 'is-muted', '読み込んでいます。'));
    return false;
  }
  if (state === 'approval_unverifiable') {
    container.append(notice(doc, 'is-warning', '承認を確かめられないため表示できません。承認済みの採用を確かめる仕組みがこのホストにありません。ほかの欄はそのまま使えます。', 'alert'));
    return false;
  }
  if (state === 'error' || state === 'invalid') {
    container.append(notice(doc, 'is-danger', `読み取れませんでした（${sectionState.reason ?? '理由不明'}）。0件ではありません。`, 'alert'));
    const retry = makeElement(doc, 'button', { className: 'bb-wm-retry', text: '再試行', attrs: { type: 'button' } });
    retry.addEventListener('click', () => void callbacks.onRetry?.(section));
    container.append(retry);
    return false;
  }
  if (state === 'unknown') {
    const message = sectionState.unreadable?.count
      ? unreadableMessage(sectionState.unreadable)
      : '記録の有無を確かめられません。0件ではありません。';
    container.append(notice(doc, 'is-warning', message, 'alert'));
    return false;
  }
  if (state === 'empty') {
    container.append(notice(doc, 'is-muted', emptyText));
    return false;
  }
  if (state === 'partial') container.append(notice(doc, 'is-warning', unreadableMessage(sectionState.unreadable), 'alert'));
  return true;
}

function renderVariables(doc, container, state, callbacks) {
  container.append(makeElement(doc, 'h4', { className: 'bb-wm-subheading', text: '変数（何を測るか）' }));
  if (!renderSectionState(doc, container, 'variables', state.variables, callbacks, '変数はまだ登録がありません。')) return;
  const list = makeElement(doc, 'div', { className: 'bb-wm-list' });
  for (const record of state.variables.items) {
    const definition = record.definition;
    list.append(item(doc, text(definition.meaning) ?? definition.id, [
      epistemicBadge(doc, definition.epistemicState),
      badge(doc, ADOPTION_LABELS[definition.adoptionState] ?? String(definition.adoptionState ?? '採用 未記録'), 'muted'),
    ], [
      ['対象', text(definition.subject)],
      ['単位', text(definition.unit)],
      ['測り方', text(definition.measurementMethod)],
      ['版', `${definition.id}@${definition.revision}`],
    ]));
  }
  container.append(list);
}

function renderModels(doc, container, state, callbacks, names) {
  container.append(makeElement(doc, 'h4', { className: 'bb-wm-subheading', text: 'モデル（どう関係すると考えているか）' }));
  if (!renderSectionState(doc, container, 'models', state.models, callbacks, 'モデルはまだ登録がありません。')) return;
  const list = makeElement(doc, 'div', { className: 'bb-wm-list' });
  for (const record of state.models.items) {
    const definition = record.definition;
    const refs = (value) => (Array.isArray(value) && value.length > 0 ? value.filter(isRevisionRef).map((ref) => refLabel(ref, names)).join('、') : null);
    list.append(item(doc, text(definition.meaning) ?? definition.id, [
      epistemicBadge(doc, definition.epistemicState),
      badge(doc, `検証: ${VALIDATION_LABELS[definition.validationState] ?? '未記録'}`, 'muted'),
    ], [
      ['関係', text(definition.relationship)],
      ['不確かさ', text(definition.uncertainty)],
      ['入力', refs(definition.inputVariableRefs)],
      ['出力', refs(definition.outputVariableRefs)],
      ['版', `${definition.id}@${definition.revision}`],
    ]));
  }
  container.append(list);
}

function renderObservations(doc, container, state, callbacks, names, units) {
  if (!renderSectionState(doc, container, 'observations', state.observations, callbacks, '観測はまだ記録がありません。')) return;
  const correctedBy = new Map();
  for (const observation of state.observations.items) {
    if (typeof observation.supersedes === 'string') correctedBy.set(observation.supersedes, observation.id);
  }
  const list = makeElement(doc, 'div', { className: 'bb-wm-list' });
  for (const observation of state.observations.items) {
    const newer = correctedBy.get(observation.id);
    const source = observation.sourceRef;
    const badges = [];
    if (newer) badges.push(badge(doc, '訂正済み', 'warning'));
    if (typeof observation.supersedes === 'string') badges.push(badge(doc, '訂正', 'accent'));
    list.append(item(doc, `${observation.subjectId}：${formatValue(observation.value, units.get(observation.variableRef.id))}`, badges, [
      ['変数', refLabel(observation.variableRef, names)],
      ['発生', formatDateTime(observation.occurredAt)],
      ['期間', `${formatDateTime(observation.period.from)} 〜 ${formatDateTime(observation.period.until)}`],
      ['記録', formatDateTime(observation.recordedAt)],
      ['出典', `${SOURCE_KIND_LABELS[source.sourceKind] ?? String(source.sourceKind)}（${String(source.sourceId)}）`],
      ['訂正の関係', [
        typeof observation.supersedes === 'string' ? `観測「${observation.supersedes}」を訂正` : null,
        newer ? `観測「${newer}」で訂正済み` : null,
      ].filter(Boolean).join('／') || null],
      ['観測ID', observation.id],
    ], newer ? 'is-superseded' : ''));
  }
  container.append(list);
}

function renderAdoptions(doc, container, state, callbacks, modelNames) {
  if (!renderSectionState(doc, container, 'adoptions', state.adoptions, callbacks, 'モデルの採用はまだありません。')) return;
  const list = makeElement(doc, 'div', { className: 'bb-wm-list' });
  for (const adoption of state.adoptions.items) {
    const candidate = adoption.candidate;
    list.append(item(doc, refLabel(adoption.modelRef, modelNames), [
      badge(doc, ADOPTION_LABELS[adoption.adoptionState] ?? String(adoption.adoptionState), adoption.adoptionState === 'approved' ? 'success' : 'warning'),
    ], [
      ['根拠（候補の仮説）', text(candidate.hypothesis)],
      ['候補の認識', EPISTEMIC_STATE_LABELS[candidate.epistemicState] ?? null],
      ['証拠', Array.isArray(candidate.evidenceIds) ? `${candidate.evidenceIds.length}件` : null],
      ['用途', USE_LABELS[adoption.authorizedUse] ?? text(adoption.authorizedUse)],
      ['承認', isRevisionRef(adoption.approvalRef) ? `${adoption.approvalRef.id}@${adoption.approvalRef.revision}` : 'なし'],
      ['日時', formatDateTime(adoption.adoptedAt)],
    ]));
  }
  container.append(list);
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

/** Render the whole view into a host-owned root. */
export function renderWorldModelView(root, state, callbacks = {}, options = {}) {
  const doc = getDocument(options.document);
  root.replaceChildren();
  const surface = makeElement(doc, 'section', { className: 'bb-wm', attrs: { 'data-contract-version': WORLD_MODEL_VIEW_CONTRACT_VERSION, 'aria-label': '現状と見通し' } });
  const header = makeElement(doc, 'header', { className: 'bb-wm-header' });
  header.append(
    makeElement(doc, 'h2', { text: '現状と見通し' }),
    makeElement(doc, 'p', { className: 'bb-wm-lead', text: '見方（変数とモデル。仮説を含みます）と、記録された観測を分けて表示します。この欄は表示だけです。' }),
  );
  surface.append(header);

  const variables = namesOf(state.variables);
  const models = namesOf(state.models);

  const view = block(doc, '変数とモデル', '見方：変数とモデル', '何を測り、どう関係すると考えているか。認識の状態は、確かめた度合いです。観測ではありません。');
  renderVariables(doc, view, state, callbacks);
  renderModels(doc, view, state, callbacks, variables.names);
  surface.append(view);

  const observed = block(doc, '観測', '観測：記録された値', '実際に記録された値です。推定や予測は含みません。訂正は新しい観測として残り、元の観測との関係を示します。');
  renderObservations(doc, observed, state, callbacks, variables.names, variables.units);
  surface.append(observed);

  const adopted = block(doc, 'モデルの採用', 'モデルの採用', 'どのモデルを、どの根拠で判断などに使うことにしたか。');
  renderAdoptions(doc, adopted, state, callbacks, models.names);
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

export function createWorldModelView({
  root,
  document: explicitDocument,
  fetcher,
  basePath = '/api/world-model',
  autoLoad = true,
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = getDocument(explicitDocument);
  const request = typeof fetcher === 'function'
    ? fetcher
    : typeof globalThis.fetch === 'function' ? (path, init) => globalThis.fetch(path, init) : null;
  const base = String(basePath).replace(/\/+$/u, '');
  const state = Object.fromEntries(WORLD_MODEL_SECTIONS.map((section) => [section, { state: 'loading', items: null }]));

  const callbacks = { onRetry: (section) => controller.loadSection(section) };

  const controller = {
    get state() { return state; },
    render() {
      renderWorldModelView(root, state, callbacks, { document: doc });
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
  };
  controller.render();
  if (autoLoad) void controller.load();
  return controller;
}

export default createWorldModelView;
