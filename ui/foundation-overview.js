/*
 * Foundation overview: the first read-only view of a selected project.
 *
 * The host supplies an authenticated, scope-bound `port.readCatalog()`; this
 * module never fetches a database, writes a record, or treats a failed read as
 * an empty catalog.  The screen deliberately keeps recorded facts, missing
 * definitions, and hypotheses visually separate.
 */

import {
  workspaceButton,
  workspaceDefinition,
  workspaceLedger,
  workspaceMetrics,
  workspaceNotice,
  workspacePageHeader,
  workspaceSectionTitle,
} from './workspace-kit.js';

export const FOUNDATION_OVERVIEW_CONTRACT_VERSION = 'foundation-overview.v1';
export const FOUNDATION_OVERVIEW_PAGE_SIZE = 50;

const ADOPTION_LABELS = Object.freeze({
  draft: '草案',
  proposed: '提案中',
  approved: '承認済み',
  retired: '終了',
});
const EPISTEMIC_LABELS = Object.freeze({
  unverified: '未検証',
  hypothesis: '仮説',
  supported: '支持',
  verified: '検証済み',
  refuted: '反証',
});
const VALIDATION_LABELS = Object.freeze({
  unverified: '未検証',
  in_progress: '検証中',
  supported: '支持',
  verified: '検証済み',
  refuted: '反証',
});
const USE_LABELS = Object.freeze({
  draft: '草案',
  judgment: '判断',
  evaluation: '評価',
  execution: '実行',
});
const PHILOSOPHY_STATUS_LABELS = Object.freeze({
  active: '有効',
  draft: '草案',
  proposed: '提案中',
  inactive: '停止',
  retired: '終了',
  archived: '終了',
});
const OPERATOR_LABELS = Object.freeze({ at_least: '以上', at_most: '以下', equals: '一致' });

export class FoundationOverviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FoundationOverviewError';
    this.code = code;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getDocument(explicit) {
  const value = explicit ?? (typeof document === 'undefined' ? null : document);
  if (!value || typeof value.createElement !== 'function') throw new TypeError('document_unavailable');
  return value;
}

function makeElement(doc, tag, { className, text, attrs = {}, value, hidden, disabled } = {}) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  for (const [name, attrValue] of Object.entries(attrs)) {
    if (attrValue === undefined || attrValue === null || attrValue === false) continue;
    element.setAttribute(name, attrValue === true ? '' : String(attrValue));
  }
  if (value !== undefined && 'value' in element) element.value = String(value);
  if (hidden !== undefined) element.hidden = Boolean(hidden);
  if (disabled !== undefined) element.disabled = Boolean(disabled);
  return element;
}

function append(parent, ...children) {
  parent.append(...children.filter((child) => child !== null && child !== undefined));
  return parent;
}

function firstValue(source, ...keys) {
  if (!isObject(source)) return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function error(code, message) {
  return new FoundationOverviewError(code, message);
}

function validateFoundationRecords(value, type, label) {
  if (!Array.isArray(value)) throw error('invalid_schema', `${label}の形式を確認できません。`);
  for (const [index, item] of value.entries()) {
    if (!isObject(item) || !isObject(item.definition)
      || item.definition.type !== type
      || !nonEmpty(item.definition.id)
      || !nonEmpty(item.definition.revision)
      || !nonEmpty(item.digest)) {
      throw error('invalid_schema', `${label}の${index + 1}件目の形式が不正です。`);
    }
  }
  return value;
}

function validatePhilosophyRecords(value) {
  if (!Array.isArray(value)) throw error('invalid_schema', '哲学の形式を確認できません。');
  for (const [index, item] of value.entries()) {
    if (!isObject(item)
      || item.kind !== 'philosophy'
      || !nonEmpty(item.id)
      || !nonEmpty(item.revision)
      || !nonEmpty(item.digest)
      || !isObject(item.payload)) {
      throw error('invalid_schema', `哲学の${index + 1}件目の形式が不正です。`);
    }
  }
  return value;
}

/** Validate the host contract without converting an unreadable response into an empty catalog. */
export function normalizeFoundationCatalog(value, expectedScopeId) {
  if (!isObject(value) || value.contractVersion !== FOUNDATION_OVERVIEW_CONTRACT_VERSION) {
    throw error('invalid_schema', '目的と現状の応答形式を確認できません。');
  }
  const scopeId = nonEmpty(value.scopeId);
  if (!scopeId) throw error('invalid_schema', '対象範囲が応答にありません。');
  if (scopeId !== expectedScopeId) {
    throw error('scope_mismatch', '選択した対象範囲と応答の対象範囲が一致しません。');
  }
  validateFoundationRecords(value.objectives, 'objective', '目的');
  validateFoundationRecords(value.variables, 'variable', '変数');
  validateFoundationRecords(value.models, 'model', '世界モデル');
  validatePhilosophyRecords(value.philosophies);
  return {
    contractVersion: value.contractVersion,
    scopeId,
    objectives: value.objectives,
    variables: value.variables,
    models: value.models,
    philosophies: value.philosophies,
  };
}

function formatDate(value) {
  if (typeof value !== 'string' || !value.trim()) return '未確認';
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  return new Date(time).toISOString().slice(0, 10);
}

function formatPeriod(value) {
  if (!isObject(value) || typeof value.from !== 'string' || typeof value.until !== 'string') return null;
  return `${formatDate(value.from)} 〜 ${formatDate(value.until)}`;
}

function formatAny(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => formatAny(item)).filter(Boolean).join('、') || null;
  if (isObject(value)) {
    const preferred = firstValue(value, 'text', 'description', 'statement', 'label', 'name', 'value');
    if (preferred !== undefined && preferred !== value) return formatAny(preferred);
    try { return JSON.stringify(value); } catch { return null; }
  }
  return null;
}

function formatStructuredValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) return value.map((item) => formatStructuredValue(item)).filter(Boolean).join('、') || null;
  if (isObject(value)) {
    const preferred = firstValue(value, 'text', 'description', 'statement', 'label', 'name', 'value');
    if (preferred !== undefined && preferred !== value) return formatStructuredValue(preferred);
    return Object.entries(value)
      .map(([key, item]) => {
        const formatted = formatStructuredValue(item);
        return formatted ? `${key}: ${formatted}` : null;
      })
      .filter(Boolean)
      .join('、') || null;
  }
  return formatAny(value);
}

const SCOPE_LABELS = Object.freeze({
  project: 'プロジェクト',
  organization: '組織',
  company: '組織',
});

function formatScope(value) {
  if (!isObject(value)) return formatStructuredValue(value);
  const type = formatAny(value.type);
  const id = formatAny(value.id);
  if (type && id) return `${SCOPE_LABELS[type] ?? type}: ${id}`;
  return formatStructuredValue(value);
}

function recordDefinition(record) { return isObject(record?.definition) ? record.definition : {}; }

function foundationKey(ref) {
  if (!isObject(ref) || !nonEmpty(ref.id) || !nonEmpty(ref.type) || !nonEmpty(ref.revision)) return null;
  return `${ref.type}:${ref.id}@${ref.revision}`;
}

function referenceLabel(ref) {
  const id = nonEmpty(ref?.id) ?? '不明な変数';
  const revision = nonEmpty(ref?.revision) ?? '?';
  return `${id}@${revision}`;
}

function statusText(definition) {
  const status = ADOPTION_LABELS[definition.adoptionState] ?? '状態未確認';
  const epistemic = EPISTEMIC_LABELS[definition.epistemicState];
  const validation = VALIDATION_LABELS[definition.validationState];
  const uses = Array.isArray(definition.authorizedUses)
    ? definition.authorizedUses.map((use) => USE_LABELS[use] ?? String(use)).join('、')
    : '未確認';
  return [
    `登録状態: ${status}`,
    epistemic ? `認識: ${epistemic}` : null,
    validation ? `検証: ${validation}` : null,
    `許可用途: ${uses || '未確認'}`,
  ].filter(Boolean).join(' ／ ');
}

function statusElement(doc, definition, className = '') {
  return makeElement(doc, 'p', { className: `bb-fov-status${className ? ` ${className}` : ''}`, text: statusText(definition) });
}

function detailsFor(record) {
  return isObject(record?.details) ? record.details : {};
}

function currentStateFor(record) {
  const definition = recordDefinition(record);
  const details = detailsFor(record);
  const current = firstValue(details, 'current_state', 'currentState')
    ?? firstValue(definition, 'current_state', 'currentState');
  const asOf = firstValue(details, 'as_of', 'asOf', 'recorded_at', 'recordedAt')
    ?? firstValue(record, 'as_of', 'asOf', 'recorded_at', 'recordedAt');
  const savedAt = firstValue(details, 'saved_at', 'savedAt', 'persisted_at', 'persistedAt')
    ?? firstValue(record, 'saved_at', 'savedAt', 'persisted_at', 'persistedAt');
  if (isObject(current)) {
    const text = formatAny(firstValue(current, 'text', 'description', 'statement', 'value', 'summary'));
    const status = formatAny(firstValue(current, 'status'));
    const evidenceScope = formatAny(firstValue(current, 'evidence_scope', 'evidenceScope'));
    const missingValue = firstValue(current, 'missing');
    const missing = Array.isArray(missingValue)
      ? missingValue.map((item) => formatAny(item)).filter(Boolean)
      : (formatAny(missingValue) ? [formatAny(missingValue)] : []);
    return {
      text,
      status,
      evidenceScope,
      missing,
      asOf: firstValue(current, 'as_of', 'asOf', 'recorded_at', 'recordedAt') ?? asOf,
      savedAt: firstValue(current, 'saved_at', 'savedAt') ?? savedAt,
      recorded: Boolean(text || status || evidenceScope || missing.length || asOf),
    };
  }
  const text = formatAny(current);
  return { text, status: null, evidenceScope: null, missing: [], asOf, savedAt, recorded: Boolean(text) };
}

function criteriaList(doc, definition, variableMap) {
  const list = makeElement(doc, 'ul', { className: 'bb-fov-list' });
  if (!Array.isArray(definition.criteria) || definition.criteria.length === 0) {
    list.append(makeElement(doc, 'li', { className: 'is-unrecorded', text: '評価基準は未記録です。' }));
    return list;
  }
  for (const criterion of definition.criteria) {
    const ref = criterion?.variableRef;
    const exact = variableMap.get(foundationKey(ref));
    const exactDefinition = exact ? recordDefinition(exact) : null;
    const name = exactDefinition
      ? (formatAny(exactDefinition.meaning) ?? referenceLabel(ref))
      : referenceLabel(ref);
    const variableDetails = exactDefinition
      ? [
        ['定義', exactDefinition.definition],
        ['評価規準', exactDefinition.rubric],
        ['値域', exactDefinition.valueSpace],
      ].map(([label, value]) => {
        const text = formatStructuredValue(value);
        return text ? `${label}: ${text}` : null;
      }).filter(Boolean)
      : [];
    const operator = OPERATOR_LABELS[criterion?.operator] ?? '条件';
    const target = formatAny(criterion?.target);
    const status = exact ? '参照確認済み' : '参照未確認（基準変数の版が一致しません）';
    list.append(makeElement(doc, 'li', {
      className: exact ? '' : 'is-unrecorded',
      text: `${name}${variableDetails.length > 0 ? `（${variableDetails.join(' ／ ')}）` : ''}（${referenceLabel(ref)}） ${operator}${target === null ? '' : ` ${target}`} — ${status}`,
    }));
  }
  return list;
}

function criteriaElement(doc, definition, details, variableMap) {
  const wrap = makeElement(doc, 'div', { className: 'bb-fov-criteria' });
  const recordedValue = firstValue(details, 'criteria_text', 'criteriaText');
  const recordedTexts = Array.isArray(recordedValue)
    ? recordedValue.map((item) => formatAny(item)).filter(Boolean)
    : [formatAny(recordedValue)].filter(Boolean);
  if (recordedTexts.length === 1) {
    wrap.append(makeElement(doc, 'p', { className: 'bb-fov-criteria-text', text: recordedTexts[0] }));
  } else if (recordedTexts.length > 1) {
    const recordedList = makeElement(doc, 'ul', { className: 'bb-fov-list bb-fov-criteria-text-list' });
    for (const text of recordedTexts) recordedList.append(makeElement(doc, 'li', { text }));
    wrap.append(recordedList);
  }
  if (Array.isArray(definition.criteria) && definition.criteria.length > 0) {
    wrap.append(criteriaList(doc, definition, variableMap));
  } else if (recordedTexts.length === 0) {
    wrap.append(criteriaList(doc, definition, variableMap));
  }
  return wrap;
}

function missingObjectiveFields(record) {
  const definition = recordDefinition(record);
  const current = currentStateFor(record);
  const gaps = [];
  if (!nonEmpty(definition.desiredState)) gaps.push('目指す状態');
  if (!Array.isArray(definition.criteria) || definition.criteria.length === 0) gaps.push('評価基準');
  if (!formatPeriod(definition.evaluationPeriod)) gaps.push('評価期間');
  if (!nonEmpty(definition.accountableId)) gaps.push('責任者');
  if (!current.recorded) gaps.push('記録上の現状');
  return gaps;
}

function recordedStateElement(doc, record) {
  const current = currentStateFor(record);
  const body = makeElement(doc, 'div', { className: 'bb-fov-current-state' });
  body.append(makeElement(doc, 'strong', {
    text: current.text ?? (current.status ? `状態: ${current.status}` : current.recorded ? '保存時点の記録' : '未記録'),
  }));
  const details = [];
  if (current.status && current.text) details.push(['状態', current.status]);
  if (current.evidenceScope) details.push(['証拠範囲', current.evidenceScope]);
  if (current.asOf !== undefined && current.asOf !== null) details.push(['記録時点', formatDate(current.asOf)]);
  if (current.missing.length > 0) {
    const missing = makeElement(doc, 'ul', { className: 'bb-fov-list bb-fov-current-missing' });
    for (const item of current.missing) missing.append(makeElement(doc, 'li', { text: item }));
    details.push(['保存時点で未確認', missing]);
  }
  if (details.length > 0) body.append(workspaceDefinition(doc, details));
  body.append(makeElement(doc, 'p', {
    className: current.recorded ? 'bb-fov-recorded-notice' : 'bb-fov-recorded-notice is-unrecorded',
    text: current.recorded
      ? `保存時点の記録です。記録時点: ${formatDate(current.asOf)}。${current.savedAt ? `保存日時: ${formatDate(current.savedAt)}。` : ''}`
      : '記録上の現状は未記録です。',
  }));
  return body;
}

function objectiveCard(doc, record, variableMap) {
  const definition = recordDefinition(record);
  const details = detailsFor(record);
  const title = formatAny(firstValue(details, 'title')) ?? formatAny(definition.meaning) ?? definition.id;
  const gaps = missingObjectiveFields(record);
  const current = currentStateFor(record);
  const evaluationPeriod = formatAny(firstValue(details, 'evaluation_period_note', 'evaluationPeriodNote'))
    ?? formatPeriod(definition.evaluationPeriod);
  const evaluator = formatAny(firstValue(details, 'evaluator_note', 'evaluatorNote'));
  const accountable = formatAny(definition.accountableId);
  const beneficiary = formatAny(firstValue(details, 'beneficiary_description', 'beneficiaryDescription'))
    ?? (Array.isArray(definition.beneficiaryIds) ? definition.beneficiaryIds.join('、') : null);
  const card = makeElement(doc, 'article', { className: 'bb-fov-objective-card' });
  card.append(makeElement(doc, 'h3', { text: title }), statusElement(doc, definition));
  card.append(workspaceDefinition(doc, [
    ['目指す状態', formatAny(definition.desiredState)],
    ['評価基準', criteriaElement(doc, definition, details, variableMap)],
    ['評価期間', evaluationPeriod],
    ['評価者', evaluator],
    ['責任者', accountable],
    ['対象・受益者', beneficiary],
    ['記録上の現状', recordedStateElement(doc, record)],
  ]));
  const gap = makeElement(doc, 'div', { className: 'bb-fov-gap' });
  if (gaps.length > 0) {
    gap.append(makeElement(doc, 'strong', { text: 'まだ確かめられていない点' }));
    const list = makeElement(doc, 'ul', { className: 'bb-fov-list' });
    for (const item of gaps) list.append(makeElement(doc, 'li', { text: `${item}: 未確定` }));
    gap.append(list);
  } else if (current.missing.length > 0) {
    gap.append(makeElement(doc, 'p', { text: '保存時点で未確認の項目があります。' }));
  } else {
    gap.append(makeElement(doc, 'p', { text: '不足項目は記録上ありません。達成・採用・検証済みを意味しません。' }));
  }
  card.append(gap);
  return card;
}

function renderObjectives(doc, catalog, viewState, callbacks) {
  const section = makeElement(doc, 'section', { className: 'bb-fov-section', attrs: { 'aria-label': '目的' } });
  section.append(workspaceSectionTitle(doc, {
    title: '目的',
    lead: '目指す状態、評価の定義、記録上の現状を分けて確認します。',
  }));
  if (catalog.objectives.length === 0) {
    section.append(workspaceNotice(doc, { label: '目的', text: 'この対象範囲には登録された目的がありません。' }));
    return section;
  }
  const variableMap = new Map(catalog.variables.map((record) => [foundationKey(recordDefinition(record)), record]));
  const rows = catalog.objectives.map((record) => {
    const definition = recordDefinition(record);
    const details = detailsFor(record);
    const key = `${definition.id}@${definition.revision}`;
    return {
      key,
      selected: key === viewState.objectiveKey,
      onSelect: () => {
        viewState.objectiveKey = key;
        callbacks.render?.();
      },
      cells: [
        { primary: formatAny(firstValue(details, 'title')) ?? formatAny(definition.meaning) ?? definition.id, secondary: `${definition.id}@${definition.revision}` },
        formatAny(definition.desiredState) ?? '目指す状態: 未記録',
        formatAny(definition.adoptionState) ? (ADOPTION_LABELS[definition.adoptionState] ?? definition.adoptionState) : '状態未確認',
      ],
    };
  });
  section.append(workspaceLedger(doc, {
    className: 'bb-fov-objective-ledger',
    ariaLabel: '登録された目的',
    columns: ['目的', '目指す状態', '登録状態'],
    rows,
  }));
  const selected = catalog.objectives.find((record) => {
    const definition = recordDefinition(record);
    return `${definition.id}@${definition.revision}` === viewState.objectiveKey;
  }) ?? catalog.objectives[0];
  if (selected) {
    const selectedDefinition = recordDefinition(selected);
    viewState.objectiveKey = `${selectedDefinition.id}@${selectedDefinition.revision}`;
    if (catalog.objectives.length > 1) {
      section.append(workspaceNotice(doc, {
        label: '詳細表示',
        text: `目的${catalog.objectives.length}件のうち1件を選択して詳細を表示しています。`,
      }));
    }
    section.append(objectiveCard(doc, selected, variableMap));
  }
  return section;
}

function philosophyApplicability(payload) {
  const text = formatAny(firstValue(payload, 'applicability_text', 'applicabilityText'));
  if (text) return text;
  const legacy = firstValue(payload, 'judgmentApplicability', 'judgment_applicability');
  if (!isObject(legacy)) return formatAny(legacy);
  const description = formatAny(firstValue(legacy, 'text', 'description', 'statement', 'applicability_text', 'applicabilityText'));
  if (description) return description;
  const scope = formatScope(legacy.scope);
  const validFrom = legacy.validFrom ?? legacy.valid_from;
  const validUntil = legacy.validUntil ?? legacy.valid_until;
  const period = validFrom
    ? `${formatDate(validFrom)}から${validUntil ? ` ${formatDate(validUntil)}まで` : ''}`
    : null;
  return [scope, period ? `適用期間: ${period}` : null].filter(Boolean).join(' ／ ') || formatStructuredValue(legacy);
}

function philosophyCard(doc, record) {
  const payload = record.payload;
  const card = makeElement(doc, 'article', { className: 'bb-fov-philosophy-card' });
  const title = formatAny(payload.title) ?? record.id;
  card.append(makeElement(doc, 'h3', { text: title }));
  const rawStatus = formatAny(payload.status);
  const status = rawStatus ? (PHILOSOPHY_STATUS_LABELS[rawStatus] ?? `未確認（${rawStatus}）`) : '状態未確認';
  card.append(makeElement(doc, 'p', { className: 'bb-fov-status', text: `状態: ${status} ／ 版: ${record.revision}` }));
  if (formatAny(payload.statement)) card.append(makeElement(doc, 'p', { className: 'bb-fov-philosophy-statement', text: formatAny(payload.statement) }));
  if (formatAny(payload.summary)) card.append(makeElement(doc, 'p', { text: formatAny(payload.summary) }));
  const applicability = record.applicability?.scope
    ?? record.currentScope
    ?? firstValue(payload.judgmentApplicability, 'scope');
  card.append(workspaceDefinition(doc, [
    ['判断への適用', philosophyApplicability(payload) ?? '未記録'],
    ['適用範囲', formatScope(applicability) ?? '未記録'],
  ]));
  return card;
}

function renderPhilosophies(doc, catalog) {
  const section = makeElement(doc, 'section', { className: 'bb-fov-section', attrs: { 'aria-label': '哲学' } });
  section.append(workspaceSectionTitle(doc, {
    title: '哲学',
    lead: '判断の前提となる考え方です。登録された本文と、判断への適用範囲を分けて表示します。',
  }));
  if (catalog.philosophies.length === 0) {
    section.append(workspaceNotice(doc, { label: '哲学', text: 'この対象範囲には登録された哲学がありません。' }));
    return section;
  }
  const grid = makeElement(doc, 'div', { className: 'bb-fov-philosophy-grid' });
  for (const record of catalog.philosophies) grid.append(philosophyCard(doc, record));
  section.append(grid);
  return section;
}

function searchTextForModel(record) {
  const definition = recordDefinition(record);
  return [
    definition.id,
    definition.revision,
    definition.meaning,
    definition.relationship,
    definition.uncertainty,
    definition.epistemicState,
    definition.validationState,
    ...(Array.isArray(definition.authorizedUses) ? definition.authorizedUses : []),
    ...(Array.isArray(definition.inputVariableRefs) ? definition.inputVariableRefs.flatMap((ref) => [ref.id, ref.revision]) : []),
    ...(Array.isArray(definition.outputVariableRefs) ? definition.outputVariableRefs.flatMap((ref) => [ref.id, ref.revision]) : []),
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

function renderReferenceList(doc, refs, variableMap, label) {
  const list = makeElement(doc, 'ul', { className: 'bb-fov-ref-list' });
  if (!Array.isArray(refs) || refs.length === 0) {
    list.append(makeElement(doc, 'li', { className: 'is-unrecorded', text: `${label}: 未接続の定義です。` }));
    return list;
  }
  for (const ref of refs) {
    const exact = variableMap.get(foundationKey(ref));
    const name = exact ? formatAny(recordDefinition(exact).meaning) ?? referenceLabel(ref) : referenceLabel(ref);
    list.append(makeElement(doc, 'li', {
      className: exact ? '' : 'is-unrecorded',
      text: exact ? `${name}（${referenceLabel(ref)}）` : `${referenceLabel(ref)} — 未接続（変数の版が一致しません）`,
    }));
  }
  return list;
}

function modelCard(doc, record, variableMap) {
  const definition = recordDefinition(record);
  const card = makeElement(doc, 'article', { className: 'bb-fov-model-card' });
  card.append(makeElement(doc, 'h3', { text: formatAny(definition.meaning) ?? definition.id }));
  card.append(makeElement(doc, 'code', { className: 'bb-fov-record-id', text: `${definition.id}@${definition.revision}` }));
  card.append(statusElement(doc, definition));
  card.append(workspaceDefinition(doc, [
    ['関係', formatAny(definition.relationship)],
    ['適用範囲', formatAny(definition.applicability ?? definition.scope)],
    ['不確かさ', formatAny(definition.uncertainty)],
    ['入力変数', renderReferenceList(doc, definition.inputVariableRefs, variableMap, '入力変数')],
    ['出力変数', renderReferenceList(doc, definition.outputVariableRefs, variableMap, '出力変数')],
  ]));
  return card;
}

function renderModels(doc, catalog, viewState, callbacks) {
  const section = makeElement(doc, 'section', { className: 'bb-fov-section', attrs: { 'aria-label': '世界モデル' } });
  section.append(workspaceSectionTitle(doc, {
    title: '世界モデル',
    lead: '変数の関係として登録された見方です。仮説・未検証・許可用途を、それぞれの状態として表示します。',
  }));
  const searchWrap = makeElement(doc, 'div', { className: 'bb-fov-model-search' });
  const label = makeElement(doc, 'label', { text: 'モデルを検索', attrs: { for: 'bb-fov-model-search' } });
  const input = makeElement(doc, 'input', {
    className: 'bb-fov-search-input',
    value: viewState.query,
    attrs: { id: 'bb-fov-model-search', name: 'model-search', type: 'search', autocomplete: 'off', placeholder: '名前、関係、状態、変数を検索' },
  });
  input.addEventListener('input', () => {
    viewState.query = String(input.value ?? '');
    viewState.page = 0;
    renderResults();
  });
  searchWrap.append(label, input);
  section.append(searchWrap);

  const results = makeElement(doc, 'div', { className: 'bb-fov-model-results' });
  section.append(results);
  const renderResults = () => {
    results.replaceChildren();
    const query = viewState.query.trim().toLocaleLowerCase();
    const filtered = query ? catalog.models.filter((record) => searchTextForModel(record).includes(query)) : catalog.models;
    if (filtered.length === 0) {
      results.append(workspaceNotice(doc, { label: '検索結果', text: query ? '条件に一致する世界モデルはありません。' : 'この対象範囲には登録された世界モデルがありません。' }));
      return;
    }
    const pages = Math.max(1, Math.ceil(filtered.length / FOUNDATION_OVERVIEW_PAGE_SIZE));
    viewState.page = Math.min(Math.max(viewState.page, 0), pages - 1);
    const start = viewState.page * FOUNDATION_OVERVIEW_PAGE_SIZE;
    const pageItems = filtered.slice(start, start + FOUNDATION_OVERVIEW_PAGE_SIZE);
    results.append(workspaceNotice(doc, {
      label: '表示範囲',
      text: `${start + 1}〜${start + pageItems.length}件を表示しています。登録は採用・検証済みを意味しません。`,
    }));
    const variableMap = new Map(catalog.variables.map((record) => [foundationKey(recordDefinition(record)), record]));
    const cards = makeElement(doc, 'div', { className: 'bb-fov-model-grid' });
    for (const record of pageItems) cards.append(modelCard(doc, record, variableMap));
    results.append(cards);
    if (pages > 1) {
      const pager = makeElement(doc, 'nav', { className: 'bb-fov-pager', attrs: { 'aria-label': '世界モデルのページ' } });
      const previous = workspaceButton(doc, {
        text: '前の50件',
        variant: 'quiet',
        disabled: viewState.page === 0,
        onClick: () => { viewState.page -= 1; renderResults(); },
      });
      const next = workspaceButton(doc, {
        text: '次の50件',
        variant: 'quiet',
        disabled: viewState.page >= pages - 1,
        onClick: () => { viewState.page += 1; renderResults(); },
      });
      pager.append(previous, makeElement(doc, 'span', { text: `${viewState.page + 1} / ${pages}` }), next);
      results.append(pager);
    }
  };
  renderResults();
  return section;
}

function renderLoading(doc, state, callbacks) {
  const notice = workspaceNotice(doc, { label: '読み込み', text: '目的・哲学・世界モデルを読み込んでいます。' });
  notice.append(workspaceButton(doc, { text: '再試行', variant: 'quiet', onClick: callbacks.load }));
  return notice;
}

function renderFailure(doc, state, callbacks) {
  const label = state.status === 'scope_mismatch' ? '対象範囲' : state.status === 'invalid' ? '応答形式' : '取得失敗';
  const message = state.error?.message ?? '目的・哲学・世界モデルを確認できません。';
  const notice = workspaceNotice(doc, { label, tone: 'danger', text: message, role: 'alert' });
  notice.append(makeElement(doc, 'p', { text: '確認できない状態を登録なし・0件として表示していません。' }));
  notice.append(workspaceButton(doc, { text: '再試行', variant: 'quiet', onClick: callbacks.load }));
  return notice;
}

export function renderFoundationOverview(root, state, {
  document: explicitDocument,
  scopeId,
  viewState = { query: '', page: 0 },
  callbacks = {},
  showHeader = true,
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = getDocument(explicitDocument);
  root.replaceChildren();
  const surface = makeElement(doc, 'section', {
    className: 'bb-fov',
    attrs: { 'data-contract-version': FOUNDATION_OVERVIEW_CONTRACT_VERSION, 'aria-label': '目的と現状' },
  });
  if (showHeader) {
    surface.append(workspacePageHeader(doc, {
      crumbs: ['Brainbase', '目的と現状'],
      title: '目的と現状',
      lead: '選択したプロジェクトの目的、哲学、世界モデルを、登録状態と未確認の点を分けて読みます。',
      source: `正本: ${scopeId}`,
    }));
  }
  surface.append(workspaceNotice(doc, {
    label: '対象範囲',
    text: scopeId,
  }));
  if (state.status === 'loading') {
    surface.append(renderLoading(doc, state, callbacks));
    root.append(surface);
    return surface;
  }
  if (state.status !== 'ready') {
    surface.append(renderFailure(doc, state, callbacks));
    root.append(surface);
    return surface;
  }
  const catalog = state.catalog;
  surface.append(workspaceNotice(doc, {
    label: '読み方',
    text: '登録は達成・採用・検証済みを意味しません。記録上の現状は保存時点の記述です。',
  }));
  surface.append(workspaceMetrics(doc, [
    { label: '目的', value: catalog.objectives.length, note: '登録された定義' },
    { label: '哲学', value: catalog.philosophies.length, note: '登録された版' },
    { label: '世界モデル', value: catalog.models.length, note: '検索対象' },
  ], { ariaLabel: 'Foundationの登録数' }));
  surface.append(renderObjectives(doc, catalog, viewState, callbacks));
  surface.append(renderPhilosophies(doc, catalog));
  surface.append(renderModels(doc, catalog, viewState, callbacks));
  root.append(surface);
  return surface;
}

/** Mount the read-only overview and ignore responses from a destroyed generation. */
export function createFoundationOverview({ root, port, scopeId, document: explicitDocument, autoLoad = true, showHeader = true } = {}) {
  if (!root) throw new TypeError('root is required');
  if (!port || typeof port.readCatalog !== 'function') throw new TypeError('port.readCatalog is required');
  const doc = getDocument(explicitDocument);
  const selectedScope = nonEmpty(scopeId);
  if (!selectedScope) throw new TypeError('scopeId is required');
  const viewState = { query: '', page: 0 };
  const state = { status: 'loading', catalog: null, error: null };
  let generation = 0;
  let destroyed = false;
  const controller = {
    get state() { return state; },
    render() {
      if (destroyed) return controller;
      renderFoundationOverview(root, state, {
        document: doc,
        scopeId: selectedScope,
        viewState,
        callbacks: { load: () => controller.load(), render: () => controller.render() },
        showHeader,
      });
      return controller;
    },
    async load() {
      if (destroyed) return state;
      const requestGeneration = ++generation;
      state.status = 'loading';
      state.catalog = null;
      state.error = null;
      controller.render();
      try {
        const response = await port.readCatalog();
        if (destroyed || requestGeneration !== generation) return state;
        state.catalog = normalizeFoundationCatalog(response, selectedScope);
        state.status = 'ready';
      } catch (cause) {
        if (destroyed || requestGeneration !== generation) return state;
        const code = cause?.code === 'scope_mismatch' ? 'scope_mismatch'
          : cause?.code === 'invalid_schema' ? 'invalid'
            : cause?.code === 'authorization_denied' || cause?.code === 'forbidden' ? 'denied' : 'error';
        state.status = code;
        state.error = {
          code,
          message: cause instanceof Error && cause.message ? cause.message : '目的・哲学・世界モデルを確認できません。',
        };
      }
      controller.render();
      return state;
    },
    destroy() {
      destroyed = true;
      generation += 1;
      root.replaceChildren();
    },
  };
  controller.render();
  if (autoLoad) void controller.load();
  return controller;
}

export default createFoundationOverview;
