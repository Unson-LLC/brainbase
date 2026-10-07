/*
 * Brainbase Objective editor.
 *
 * The OSS package owns this screen and its browser-side state only.  A host
 * supplies the ObjectiveEditorPort below; the module never fetches a BFF,
 * opens a database, or decides organization membership/RACI.  An organization
 * application can compose the same screen by adapting its authenticated
 * FoundationRevisionStore boundary to the port.
 *
 * Two layouts: without `rail` the screen keeps its tabs (list, editor, Story
 * links) as the organization edition composes it.  With a `rail` element the
 * screen follows the organization edition's pattern (workspace-kit): page
 * head, metrics and a ledger of objectives in the workspace, and the selected
 * objective (or its edit form) in the rail.
 */

import {
  workspaceActions,
  workspaceButton,
  workspaceDefinition,
  workspaceDetailEmpty,
  workspaceHostActions,
  workspaceHostNotice,
  workspaceLedger,
  workspaceMetrics,
  workspaceNotice,
  workspacePageHeader,
  workspaceRailBlock,
  workspaceRailHead,
} from './workspace-kit.js';

export const OBJECTIVE_EDITOR_CONTRACT_VERSION = 'brainbase.objective-editor.v1';

export const OBJECTIVE_EDITOR_STORY_IDS = Object.freeze([
  'story-company-os-objective-editor-v1',
]);

export const OBJECTIVE_EDITOR_RELATION_TYPES = Object.freeze([
  ['contributes_to', '目的への貢献'],
  ['execution_depends_on', '実行の依存'],
  ['time_condition', '時間の条件'],
]);

const UNKNOWN = 'unknown';

const STATUS_LABELS = Object.freeze({
  idle: '未取得',
  loading: '読み込み中',
  saving: '保存中',
  ready: '取得済み',
  empty: '登録なし',
  draft: '下書き',
  proposed: '提案中',
  approved: '承認済み',
  retired: '終了',
  judgment_available: '判断に利用可能',
  judgment_unknown: '判断利用可否 未確認',
  permission_denied: '権限不足',
  api_unavailable: 'API未提供',
  missing: '欠損',
  conflict: '版の競合',
  saved_unverified: '保存済み・未確認',
  verified: '正本と一致',
  error_retryable: '取得失敗',
  unknown: '確認できません',
});

const RELATION_LABELS = Object.freeze(Object.fromEntries(OBJECTIVE_EDITOR_RELATION_TYPES));

function getDocument() {
  if (typeof document === 'undefined' || !document?.createElement) throw new Error('document_unavailable');
  return document;
}

function makeElement(tag, options = {}) {
  const element = getDocument().createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined && options.text !== null) element.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  if (options.value !== undefined && 'value' in element) element.value = String(options.value);
  if (options.checked !== undefined && 'checked' in element) element.checked = Boolean(options.checked);
  if (options.disabled !== undefined) element.disabled = Boolean(options.disabled);
  if (options.hidden !== undefined) element.hidden = Boolean(options.hidden);
  return element;
}

function append(parent, ...children) {
  parent.append(...children.filter((child) => child !== null && child !== undefined));
  return parent;
}

function clear(parent) {
  parent.replaceChildren();
  return parent;
}

function optionalText(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

function nonEmptyText(value) {
  const result = optionalText(value).trim();
  return result || null;
}

function text(value, fallback = '未確認') {
  const result = nonEmptyText(value);
  return result ?? fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : null;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function firstValue(source, ...keys) {
  const object = objectValue(source);
  if (!object) return undefined;
  for (const key of keys) {
    if (Object.hasOwn(object, key) && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

function payloadValue(payload, ...keys) {
  const object = objectValue(payload);
  if (!object) return undefined;
  for (const key of keys) {
    if (Object.hasOwn(object, key) && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

function normalizeState(value, fallback = UNKNOWN) {
  const state = optionalText(value).trim().toLowerCase();
  if (!state) return fallback;
  if (['forbidden', 'authorization_denied', 'permission_insufficient', 'not_allowed'].includes(state)) return 'permission_denied';
  if (['unavailable', 'upstream_unavailable', 'api_not_implemented', 'not_implemented'].includes(state)) return 'api_unavailable';
  if (['version_conflict', 'revision_conflict', 'cas_conflict'].includes(state)) return 'conflict';
  if (['persisted', 'saved'].includes(state)) return 'saved_unverified';
  if (['readback_verified', 'committed_verified'].includes(state)) return 'verified';
  return state;
}

const EXPLICIT_COLLECTION_FAILURES = new Set(['permission_denied', 'api_unavailable', 'missing', 'conflict']);

function explicitCollectionFailure(state, key) {
  if (!EXPLICIT_COLLECTION_FAILURES.has(state)) return null;
  return { state, [key]: null, absence_confirmed: false };
}

function normalizeRevision(value) {
  const revision = nonEmptyText(value);
  return revision && /^[1-9]\d*$/.test(revision) ? revision : revision;
}

function normalizeReference(value, defaultType = null) {
  const object = objectValue(value);
  if (!object) return null;
  const id = nonEmptyText(firstValue(object, 'id', 'resourceId', 'resource_id'));
  const type = nonEmptyText(firstValue(object, 'type', 'resourceType', 'resource_type')) ?? defaultType;
  const revision = normalizeRevision(firstValue(object, 'revision', 'version'));
  if (!id || !type || !revision) return null;
  return {
    id,
    type,
    revision,
    digest: nonEmptyText(firstValue(object, 'digest', 'hash')),
    meaning: nonEmptyText(firstValue(object, 'meaning', 'label', 'name')),
    raw: object,
  };
}

function normalizeVariableRef(value) {
  const reference = normalizeReference(value, 'variable');
  if (!reference || reference.type !== 'variable') return null;
  return { id: reference.id, type: 'variable', revision: reference.revision };
}

function normalizeCriterion(value) {
  const object = objectValue(value);
  if (!object) return null;
  const variableRef = normalizeVariableRef(firstValue(object, 'variableRef', 'variable_ref', 'variable'));
  const operator = nonEmptyText(firstValue(object, 'operator', 'comparison'));
  if (!variableRef || !operator) return null;
  const criterion = { variableRef, operator };
  if (Object.hasOwn(object, 'target')) criterion.target = object.target;
  return criterion;
}

function normalizePeriod(value) {
  const object = objectValue(value);
  if (!object) return null;
  return {
    from: nonEmptyText(firstValue(object, 'from', 'validFrom', 'valid_from', 'start')),
    until: nonEmptyText(firstValue(object, 'until', 'validUntil', 'valid_until', 'end')),
  };
}

function dateTimeLocalValue(value) {
  const input = nonEmptyText(value);
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function canonicalDateTimeValue(value) {
  const input = nonEmptyText(value);
  if (!input) return '';
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? input : date.toISOString();
}

// Empty date inputs are an unspecified draft period. A partial or invalid
// period must still reach canonical validation instead of being discarded.
function definitionForSave(definition) {
  const draft = JSON.parse(JSON.stringify(definition));
  const period = objectValue(draft.evaluationPeriod);
  const blankDate = (value) => value === null || value === undefined || (typeof value === 'string' && !value.trim());
  if (period && Object.keys(period).every((key) => ['from', 'until'].includes(key))
    && blankDate(period.from) && blankDate(period.until)) delete draft.evaluationPeriod;
  return draft;
}

function normalizeReadiness(value) {
  const object = objectValue(value);
  if (!object || typeof object.ready !== 'boolean') return { state: 'unknown', ready: null, issues: null };
  const issues = asArray(object.issues);
  return {
    state: 'ready',
    ready: object.ready,
    issues: issues ? issues.map((issue) => ({
      code: text(firstValue(issue, 'code'), 'UNKNOWN'),
      path: text(firstValue(issue, 'path'), 'definition'),
      message: text(firstValue(issue, 'message'), '利用条件を確認できません。'),
    })) : [],
  };
}

function recordPayload(payload) {
  const object = objectValue(payload);
  if (!object) return null;
  const nestedRecord = objectValue(payloadValue(object, 'objective', 'record', 'data'));
  if (nestedRecord) return nestedRecord;
  // A canonical FoundationCatalogRecord carries metadata (digest/readiness)
  // beside `definition`; keep the record wrapper so that metadata is not
  // mistaken for an absent readback.
  if (objectValue(object.definition)) return object;
  return objectValue(payloadValue(object, 'definition')) ?? object;
}

/**
 * Converts a canonical FoundationCatalogRecord (or a host projection of it)
 * without filling missing fields with guessed values.
 */
export function normalizeObjectiveRecord(payload) {
  const source = recordPayload(payload);
  if (!source) return null;
  const definition = objectValue(source.definition) ?? source;
  const type = nonEmptyText(firstValue(definition, 'type')) ?? nonEmptyText(firstValue(source, 'type'));
  const id = nonEmptyText(firstValue(definition, 'id')) ?? nonEmptyText(firstValue(source, 'id'));
  const revision = normalizeRevision(firstValue(definition, 'revision', 'version')) ?? normalizeRevision(firstValue(source, 'revision', 'version'));
  if (!id || !revision) return null;
  const criteriaValue = firstValue(definition, 'criteria');
  const criteria = asArray(criteriaValue);
  // A malformed criterion must invalidate the whole Objective readback.  It
  // is unsafe to drop a broken Variable reference and present the remaining
  // criteria as a usable (or empty) set for saving or judgment.
  if (criteriaValue !== undefined && criteria === null) return null;
  const normalizedCriteria = criteria ? criteria.map(normalizeCriterion) : null;
  if (normalizedCriteria?.some((criterion) => !criterion)) return null;
  const readiness = normalizeReadiness(firstValue(source, 'readiness', 'judgmentReadiness', 'judgment_readiness'));
  const constraintRefsValue = firstValue(source, 'constraintRefs', 'constraint_refs', 'constraints');
  const constraintRefs = asArray(constraintRefsValue);
  const normalized = {
    id,
    type: type ?? 'objective',
    revision,
    digest: nonEmptyText(firstValue(source, 'digest', 'hash')),
    meaning: nonEmptyText(firstValue(definition, 'meaning')),
    beneficiaryIds: asArray(firstValue(definition, 'beneficiaryIds', 'beneficiary_ids')),
    desiredState: nonEmptyText(firstValue(definition, 'desiredState', 'desired_state')),
    criteria: normalizedCriteria,
    evaluationPeriod: normalizePeriod(firstValue(definition, 'evaluationPeriod', 'evaluation_period')),
    accountableId: nonEmptyText(firstValue(definition, 'accountableId', 'accountable_id')),
    epistemicState: nonEmptyText(firstValue(definition, 'epistemicState', 'epistemic_state')),
    adoptionState: nonEmptyText(firstValue(definition, 'adoptionState', 'adoption_state')),
    authorizedUses: asArray(firstValue(definition, 'authorizedUses', 'authorized_uses')),
    acl: objectValue(firstValue(definition, 'acl')),
    storage: nonEmptyText(firstValue(definition, 'storage')),
    provenance: asArray(firstValue(definition, 'provenance')),
    scope: objectValue(firstValue(definition, 'scope')),
    readiness,
    constraintRefs: constraintRefs ? constraintRefs.map((ref) => normalizeReference(ref, 'constraint')).filter(Boolean) : null,
    raw: source,
    definition,
  };
  return normalized;
}

function collectionRecords(payload, keys) {
  if (Array.isArray(payload)) return payload;
  const object = objectValue(payload);
  if (!object) return null;
  for (const key of keys) {
    if (Array.isArray(object[key])) return object[key];
  }
  return null;
}

/**
 * Keeps an absent records array distinct from a confirmed empty result.
 */
export function normalizeObjectiveCollection(payload) {
  const recordsValue = collectionRecords(payload, ['records', 'objectives', 'items', 'data']);
  const explicitState = normalizeState(payloadValue(payload, 'state', 'status'), 'unknown');
  const explicitFailure = explicitCollectionFailure(explicitState, 'records');
  if (explicitFailure) return explicitFailure;
  if (recordsValue === null) {
    return { state: explicitState === 'empty' ? 'unknown' : explicitState, records: null, absence_confirmed: false };
  }
  const records = recordsValue.map(normalizeObjectiveRecord);
  if (records.some((record) => !record || record.type !== 'objective')) {
    return { state: 'unknown', records: null, absence_confirmed: false };
  }
  const absenceConfirmed = payloadValue(payload, 'absence_confirmed', 'absenceConfirmed') === true;
  if (records.length === 0 && !absenceConfirmed) {
    return { state: 'unknown', records: null, absence_confirmed: false };
  }
  const state = explicitState === 'permission_denied' || explicitState === 'api_unavailable' || explicitState === 'conflict'
    ? explicitState
    : records.length ? 'ready' : 'empty';
  return {
    state,
    records,
    absence_confirmed: absenceConfirmed,
  };
}

export function normalizeReferenceCollection(payload, keys = ['refs', 'references', 'constraints', 'records', 'items', 'data']) {
  const recordsValue = collectionRecords(payload, keys);
  const explicitState = normalizeState(payloadValue(payload, 'state', 'status'), 'unknown');
  const explicitFailure = explicitCollectionFailure(explicitState, 'refs');
  if (explicitFailure) return explicitFailure;
  if (recordsValue === null) return { state: explicitState, refs: null, absence_confirmed: false };
  const refs = recordsValue.map((value) => normalizeReference(value));
  if (refs.some((ref) => !ref)) {
    return { state: 'unknown', refs: null, absence_confirmed: false };
  }
  const absenceConfirmed = payloadValue(payload, 'absence_confirmed', 'absenceConfirmed') === true;
  if (refs.length === 0 && !absenceConfirmed) {
    return { state: 'unknown', refs: null, absence_confirmed: false };
  }
  return {
    state: explicitState === 'permission_denied' || explicitState === 'api_unavailable' || explicitState === 'conflict'
      ? explicitState : refs.length ? 'ready' : 'empty',
    refs,
    absence_confirmed: absenceConfirmed,
  };
}

export function normalizeStoryObjectiveLinks(payload) {
  const recordsValue = collectionRecords(payload, ['links', 'relations', 'records', 'items', 'data']);
  const explicitState = normalizeState(payloadValue(payload, 'state', 'status'), 'unknown');
  const explicitFailure = explicitCollectionFailure(explicitState, 'links');
  if (explicitFailure) return explicitFailure;
  if (recordsValue === null) return { state: explicitState, links: null, absence_confirmed: false };
  const links = recordsValue.map((value) => {
    const object = objectValue(value);
    if (!object) return null;
    const relation = nonEmptyText(firstValue(object, 'relation', 'linkKind', 'link_kind', 'kind'));
    const objective = normalizeReference(firstValue(object, 'objective', 'target', 'objectiveRef', 'objective_ref'));
    const story = normalizeReference(firstValue(object, 'story', 'source', 'storyRef', 'story_ref'), 'story');
    // The relation target is the canonical Objective. A model, Story, or
    // other resource must never be rendered as an Objective by defaulting its
    // type from the relation position.
    if (!relation || !objective || objective.type !== 'objective') return null;
    return {
      relation,
      relationLabel: RELATION_LABELS[relation] ?? relation,
      objective,
      story,
      timeCondition: firstValue(object, 'timeCondition', 'time_condition') ?? null,
      raw: object,
    };
  }).filter(Boolean);
  if (links.length !== recordsValue.length) {
    return { state: 'unknown', links: null, absence_confirmed: false };
  }
  const absenceConfirmed = payloadValue(payload, 'absence_confirmed', 'absenceConfirmed') === true;
  if (links.length === 0 && !absenceConfirmed) {
    return { state: 'unknown', links: null, absence_confirmed: false };
  }
  return {
    state: explicitState === 'permission_denied' || explicitState === 'api_unavailable' || explicitState === 'conflict'
      ? explicitState : links.length ? 'ready' : 'empty',
    links,
    absence_confirmed: absenceConfirmed,
  };
}

export function objectiveJudgmentState(objective) {
  const normalized = normalizeObjectiveRecord(objective) ?? objective;
  const readiness = normalized?.readiness;
  if (readiness?.state === 'ready' && readiness.ready === true && normalized?.adoptionState !== 'retired') return 'judgment_available';
  if (readiness?.state === 'ready' && readiness.ready === false) return 'draft';
  if (['draft', 'proposed'].includes(normalized?.adoptionState)) return 'draft';
  return 'judgment_unknown';
}

export function objectiveJudgmentLabel(objective) {
  return STATUS_LABELS[objectiveJudgmentState(objective)] ?? STATUS_LABELS.unknown;
}

export function statusLabel(value) {
  const state = normalizeState(value);
  return STATUS_LABELS[state] ?? text(value);
}

export function normalizeObjectiveError(error) {
  const code = optionalText(error?.code ?? error?.status ?? error?.name).trim().toLowerCase();
  const status = Number(error?.statusCode ?? error?.status);
  let state = normalizeState(code);
  if (state === UNKNOWN || !state) {
    if (status === 401 || status === 403) state = 'permission_denied';
    else if (status === 404) state = 'missing';
    else if (status === 409) state = 'conflict';
    else if (status >= 500) state = 'api_unavailable';
    else state = 'error_retryable';
  }
  if (!['permission_denied', 'api_unavailable', 'missing', 'conflict', 'saved_unverified', 'error_retryable'].includes(state)) state = 'error_retryable';
  return {
    state,
    code: code || state,
    currentRevision: nonEmptyText(error?.currentRevision ?? error?.current_revision),
    message: nonEmptyText(error?.message) ?? STATUS_LABELS[state],
    error,
  };
}

function statusNotice(state, callbacks = {}) {
  const normalized = typeof state === 'string' ? { state } : state ?? {};
  const status = normalizeState(normalized.state);
  const className = ['permission_denied', 'api_unavailable', 'conflict', 'missing'].includes(status)
    ? `objective-editor-notice objective-editor-notice-${status}`
    : 'objective-editor-notice';
  const notice = makeElement('div', { className, attrs: { role: status === 'error_retryable' ? 'alert' : 'status' } });
  append(notice,
    makeElement('strong', { text: STATUS_LABELS[status] ?? STATUS_LABELS.unknown }),
    makeElement('p', { text: normalized.message ?? STATUS_LABELS[status] ?? '状態を確認できません。' }),
  );
  if (status === 'conflict' && normalized.currentRevision) {
    notice.append(makeElement('small', { text: `現在の版: ${normalized.currentRevision}。入力を保持したまま再読込してください。` }));
  }
  if (callbacks.onRetry) notice.append(makeButton('再読込', callbacks.onRetry, 'objective-editor-button-secondary'));
  return notice;
}

function makeButton(label, onClick, className = 'objective-editor-button') {
  const button = makeElement('button', { className, text: label, attrs: { type: 'button' } });
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

function statusBadge(state, label = null) {
  const normalized = normalizeState(state);
  return makeElement('span', {
    className: `objective-editor-badge objective-editor-badge-${normalized.replace(/[^a-z0-9_-]/g, '-')}`,
    text: label ?? (STATUS_LABELS[normalized] ?? text(state)),
  });
}

function field(labelText, name, value, options = {}) {
  const label = makeElement('label', { className: 'objective-editor-field' });
  label.append(makeElement('span', { className: 'objective-editor-label', text: labelText }));
  // A field with choices is a select; an input cannot hold option elements.
  const input = makeElement(options.tag ?? (options.options ? 'select' : 'input'), {
    className: 'objective-editor-input',
    value: value ?? '',
    attrs: { name, ...(options.attrs ?? {}) },
    disabled: options.disabled,
  });
  if (options.tag === 'textarea') input.textContent = value ?? '';
  if (options.options) {
    clear(input);
    for (const option of options.options) {
      input.append(makeElement('option', { text: option.label, value: option.value, attrs: { value: option.value } }));
    }
    input.value = value ?? '';
  }
  label.append(input);
  if (options.help) label.append(makeElement('small', { className: 'objective-editor-help', text: options.help }));
  return { label, input };
}

function findAll(node, predicate, result = []) {
  if (!node) return result;
  if (predicate(node)) result.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, result);
  return result;
}

function nodeAttribute(node, name) {
  if (!node) return undefined;
  if (typeof node.getAttribute === 'function') return node.getAttribute(name) ?? undefined;
  const attributes = node.attributes;
  if (!attributes) return undefined;
  if (typeof attributes.getNamedItem === 'function') return attributes.getNamedItem(name)?.value;
  return attributes[name];
}

function findField(root, name) {
  return findAll(root, (node) => nodeAttribute(node, 'name') === name)[0] ?? null;
}

function parseTarget(value) {
  const input = optionalText(value).trim();
  if (!input) return undefined;
  if (input === 'true') return true;
  if (input === 'false') return false;
  if (/^-?(?:\d+|\d*\.\d+)$/.test(input)) return Number(input);
  return input;
}

function copyDefinition(normalized) {
  if (!normalized) return null;
  const source = objectValue(normalized.definition) ?? objectValue(normalized.raw) ?? {};
  return JSON.parse(JSON.stringify(source));
}

function editorDraftFromObjective(objective, options = {}) {
  const definition = copyDefinition(objective) ?? {};
  return {
    ...definition,
    id: objective?.id ?? definition.id ?? '',
    type: 'objective',
    revision: objective?.revision ?? definition.revision ?? '1',
    meaning: objective?.meaning ?? definition.meaning ?? '',
    beneficiaryIds: [...(objective?.beneficiaryIds ?? definition.beneficiaryIds ?? [])],
    desiredState: objective?.desiredState ?? definition.desiredState ?? '',
    criteria: JSON.parse(JSON.stringify(objective?.criteria ?? definition.criteria ?? [])),
    evaluationPeriod: {
      from: objective?.evaluationPeriod?.from ?? definition.evaluationPeriod?.from ?? '',
      until: objective?.evaluationPeriod?.until ?? definition.evaluationPeriod?.until ?? '',
    },
    accountableId: objective?.accountableId ?? definition.accountableId ?? '',
    adoptionState: objective?.adoptionState ?? definition.adoptionState ?? 'draft',
    authorizedUses: [...(objective?.authorizedUses ?? definition.authorizedUses ?? ['draft'])],
    ...options,
  };
}

function shortDate(value) {
  const input = nonEmptyText(value);
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Readiness in the list: known readiness is named as such, not as the adoption state. */
function readinessBadge(objective) {
  const readiness = objective.readiness;
  if (readiness?.state === 'ready' && readiness.ready === false) {
    const count = readiness.issues?.length ?? 0;
    return statusBadge('draft', count > 0 ? `判断に使えない（不足${count}件）` : '判断に使えない');
  }
  return statusBadge(objectiveJudgmentState(objective), objectiveJudgmentLabel(objective));
}

/** One line per Objective: desired state, evaluation period, accountable person and criteria count. */
function objectiveSummary(objective) {
  const from = shortDate(objective.evaluationPeriod?.from);
  const until = shortDate(objective.evaluationPeriod?.until);
  return [
    `評価期間 ${from || until ? `${from ?? '未設定'}〜${until ?? '未設定'}` : '未設定'}`,
    `責任者 ${objective.accountableId ?? '未設定'}`,
    `評価基準 ${objective.criteria ? `${objective.criteria.length}件` : '未確認'}`,
  ].join(' ・ ');
}

function renderObjectiveList(root, state, callbacks) {
  const section = makeElement('section', { className: 'objective-editor-panel', attrs: { 'aria-label': '目的一覧' } });
  append(section,
    makeElement('div', { className: 'objective-editor-panel-heading', text: '目的一覧' }),
    makeElement('p', { className: 'objective-editor-muted', text: '目的本文、評価基準、利用可能な版を正本から確認します。' }),
  );
  if (state.objectives.state === 'loading') {
    for (let index = 0; index < 3; index += 1) section.append(makeElement('div', { className: 'objective-editor-skeleton', text: '目的を読み込んでいます。' }));
    return section;
  }
  if (['permission_denied', 'api_unavailable', 'error_retryable', 'unknown'].includes(state.objectives.state)) {
    section.append(statusNotice(state.objectives, { onRetry: callbacks.onReload }));
    return section;
  }
  if (state.objectives.state === 'empty') {
    section.append(makeElement('div', { className: 'objective-editor-empty', text: '目的はまだ登録されていません。' }));
    if (callbacks.onCreate) section.append(makeButton('目的を作成', callbacks.onCreate, 'objective-editor-button-primary'));
    return section;
  }
  const list = makeElement('div', { className: 'objective-editor-list' });
  for (const objective of state.objectives.records ?? []) {
    const row = makeButton('', () => callbacks.onSelect?.(objective), 'objective-editor-list-row');
    const copy = makeElement('span', { className: 'objective-editor-list-copy' });
    append(copy,
      makeElement('strong', { text: text(objective.meaning, objective.id) }),
      objective.desiredState ? makeElement('span', { className: 'objective-editor-muted', text: `実現したい状態: ${objective.desiredState}` }) : null,
      makeElement('small', { text: objectiveSummary(objective) }),
      makeElement('small', { text: `${objective.id}@${objective.revision}` }),
    );
    const badges = makeElement('span', { className: 'objective-editor-list-badges' });
    badges.append(statusBadge(objective.adoptionState ?? 'unknown'), readinessBadge(objective));
    row.append(copy, badges);
    list.append(row);
  }
  section.append(list);
  return section;
}

function renderReadiness(root, readiness) {
  const section = makeElement('section', { className: 'objective-editor-readiness', attrs: { 'aria-label': '判断利用可能性' } });
  const normalized = normalizeReadiness(readiness);
  section.append(makeElement('div', { className: 'objective-editor-subheading', text: '判断への利用' }));
  if (normalized.state !== 'ready') {
    section.append(statusBadge('judgment_unknown'), makeElement('p', { className: 'objective-editor-muted', text: '判断に使える状態かどうかを、保存先から確認できていません。' }));
    return section;
  }
  section.append(normalized.ready ? statusBadge('judgment_available') : statusBadge('draft', '判断に使えない'));
  if (!normalized.ready && normalized.issues?.length) {
    const list = makeElement('ul', { className: 'objective-editor-issue-list' });
    for (const issue of normalized.issues) list.append(makeElement('li', { text: `${issue.path}: ${issue.message}` }));
    section.append(list);
  } else {
    section.append(makeElement('p', { className: 'objective-editor-muted', text: '必要な定義・基準・参照が揃っています。観測値の存在は別途確認します。' }));
  }
  return section;
}

function renderConstraintRefs(root, state, callbacks) {
  const section = makeElement('section', { className: 'objective-editor-reference-section', attrs: { 'aria-label': '制約参照' } });
  section.append(makeElement('div', { className: 'objective-editor-subheading', text: '適用する制約参照' }));
  if (state.constraints.state === 'loading') {
    section.append(makeElement('p', { className: 'objective-editor-muted', text: '制約参照を読み込んでいます。' }));
    return section;
  }
  if (['permission_denied', 'api_unavailable', 'error_retryable', 'unknown'].includes(state.constraints.state)) {
    section.append(statusNotice(state.constraints, { onRetry: callbacks.onReloadConstraints }));
    return section;
  }
  const refs = state.editor.constraintRefs ?? state.constraints.refs ?? [];
  const list = makeElement('ul', { className: 'objective-editor-reference-list' });
  if (!refs.length) list.append(makeElement('li', { className: 'objective-editor-muted', text: 'この目的に紐づく制約参照はありません。' }));
  for (const ref of refs) {
    const item = makeElement('li', { className: 'objective-editor-reference-item' });
    item.append(makeElement('span', { text: `${ref.id}@${ref.revision}` }));
    if (ref.meaning) item.append(makeElement('small', { text: ref.meaning }));
    if (callbacks.canEdit && callbacks.constraintsEditable !== false && callbacks.onRemoveConstraintRef) item.append(makeButton('外す', () => callbacks.onRemoveConstraintRef(ref), 'objective-editor-button-danger'));
    list.append(item);
  }
  section.append(list);
  if (callbacks.constraintsEditable === false) {
    section.append(makeElement('p', { className: 'objective-editor-muted', text: '制約の参照はここでは表示だけです。' }));
  } else if (callbacks.canEdit && callbacks.onAddConstraintRef) {
    const addForm = makeElement('form', { className: 'objective-editor-inline-form' });
    const idField = field('制約ID', 'constraint_id', '', { attrs: { placeholder: 'constraint-id' } });
    const revisionField = field('版', 'constraint_revision', '', { attrs: { placeholder: '1' } });
    const submit = makeElement('button', { className: 'objective-editor-button-secondary', text: '参照を追加', attrs: { type: 'submit' } });
    addForm.append(idField.label, revisionField.label, submit);
    addForm.addEventListener('submit', (event) => {
      event.preventDefault();
      callbacks.onAddConstraintRef({ id: idField.input.value, type: 'constraint', revision: revisionField.input.value });
    });
    section.append(addForm);
  }
  return section;
}

function renderCriteria(root, draft, callbacks) {
  const fieldset = makeElement('fieldset', { className: 'objective-editor-criteria' });
  fieldset.append(makeElement('legend', { text: '評価基準' }));
  const criteria = Array.isArray(draft.criteria) ? draft.criteria : [];
  if (!criteria.length) fieldset.append(makeElement('p', { className: 'objective-editor-muted', text: '評価基準はまだありません。判断に使うには、測る変数の参照が必要です。' }));
  criteria.forEach((criterion, index) => {
    const row = makeElement('div', { className: 'objective-editor-criterion-row' });
    const variableRef = criterion?.variableRef ?? {};
    const variableId = field('変数ID', `criteria.${index}.variable_id`, variableRef.id ?? '', { attrs: { required: true } });
    const variableRevision = field('変数の版', `criteria.${index}.variable_revision`, variableRef.revision ?? '', { attrs: { required: true } });
    const operator = field('比較', `criteria.${index}.operator`, criterion?.operator ?? 'equals', { options: [
      { value: 'at_least', label: '以上' },
      { value: 'at_most', label: '以下' },
      { value: 'equals', label: '一致' },
    ] });
    const target = field('基準値', `criteria.${index}.target`, criterion?.target ?? '', { attrs: { placeholder: '未指定は条件のみ' } });
    const remove = callbacks.canEdit ? makeButton('削除', () => callbacks.onRemoveCriterion?.(index), 'objective-editor-button-danger') : null;
    row.append(variableId.label, variableRevision.label, operator.label, target.label, remove);
    fieldset.append(row);
  });
  if (callbacks.canEdit) fieldset.append(makeButton('基準を追加', callbacks.onAddCriterion, 'objective-editor-button-secondary'));
  return fieldset;
}

function collectDefinition(form, baseDraft, { keepEmptyCriteria = false } = {}) {
  const draft = JSON.parse(JSON.stringify(baseDraft ?? {}));
  const value = (name) => findField(form, name)?.value ?? '';
  draft.id = optionalText(value('id')).trim();
  draft.meaning = value('meaning');
  draft.desiredState = value('desired_state');
  draft.beneficiaryIds = optionalText(value('beneficiary_ids')).split(',').map((item) => item.trim()).filter(Boolean);
  draft.accountableId = optionalText(value('accountable_id')).trim() || undefined;
  draft.adoptionState = value('adoption_state') || draft.adoptionState || 'draft';
  draft.evaluationPeriod = {
    from: canonicalDateTimeValue(value('evaluation_from')),
    until: canonicalDateTimeValue(value('evaluation_until')),
  };
  draft.criteria = [];
  const variableIds = findAll(form, (node) => /^criteria\.\d+\.variable_id$/.test(nodeAttribute(node, 'name') ?? ''));
  for (const variableIdInput of variableIds) {
    const match = nodeAttribute(variableIdInput, 'name').match(/^criteria\.(\d+)\.variable_id$/);
    const index = Number(match[1]);
    const variableRevision = value(`criteria.${index}.variable_revision`).trim();
    const operator = value(`criteria.${index}.operator`) || 'equals';
    const target = parseTarget(value(`criteria.${index}.target`));
    if (!keepEmptyCriteria && !variableIdInput.value.trim() && !variableRevision) continue;
    const criterion = {
      variableRef: { id: variableIdInput.value.trim(), type: 'variable', revision: variableRevision },
      operator,
    };
    if (target !== undefined) criterion.target = target;
    draft.criteria.push(criterion);
  }
  return definitionForSave(draft);
}

function renderObjectiveForm(root, state, callbacks) {
  const section = makeElement('section', { className: 'objective-editor-panel', attrs: { 'aria-label': '目的を編集' } });
  const draft = state.editor.draft;
  if (!draft) {
    section.append(makeElement('div', { className: 'objective-editor-empty', text: '編集する目的を選択してください。' }));
    return section;
  }
  const title = state.editor.mode === 'create' ? '目的を作成' : '目的を編集';
  append(section,
    makeElement('div', { className: 'objective-editor-panel-heading', text: title }),
    makeElement('p', { className: 'objective-editor-muted', text: '保存すると新しい版になり、保存した版を読み戻して表示します。' }),
  );
  if (state.save.state !== 'idle' && state.save.state !== 'saving') section.append(statusNotice(state.save, {
    onRetry: ['conflict', 'saved_unverified'].includes(state.save.state) ? null : callbacks.onRetrySave,
  }));
  section.append(buildObjectiveForm(state, callbacks));
  return section;
}

/**
 * The edit form.  The tabs layout ends it with 保存 and 一覧へ戻る; the
 * workspace layout (in the rail) ends it with 保存 and キャンセル.
 */
function buildObjectiveForm(state, callbacks, { workspace = false } = {}) {
  const draft = state.editor.draft;
  const form = makeElement('form', { className: 'objective-editor-form' });
  const identity = makeElement('div', { className: 'objective-editor-identity' });
  const idField = field('目的ID', 'id', draft.id, { disabled: state.editor.mode !== 'create', attrs: { required: true } });
  const revision = makeElement('div', { className: 'objective-editor-readonly-value' });
  append(revision, makeElement('span', { className: 'objective-editor-label', text: '使用する版' }), makeElement('strong', { text: `${draft.revision ?? '1'}` }));
  identity.append(idField.label, revision);
  form.append(identity);
  form.append(field('目的の意味', 'meaning', draft.meaning, { tag: 'textarea', attrs: { required: true, rows: '3' } }).label);
  form.append(field('実現したい状態', 'desired_state', draft.desiredState, { tag: 'textarea', attrs: { required: true, rows: '3' } }).label);
  form.append(field('対象者ID（カンマ区切り）', 'beneficiary_ids', (draft.beneficiaryIds ?? []).join(', '), { help: '対象者を推測して補完しません。' }).label);
  const period = makeElement('div', { className: 'objective-editor-inline-fields' });
  period.append(field('評価期間の開始', 'evaluation_from', dateTimeLocalValue(draft.evaluationPeriod?.from ?? ''), { attrs: { type: 'datetime-local' } }).label);
  period.append(field('評価期間の終了', 'evaluation_until', dateTimeLocalValue(draft.evaluationPeriod?.until ?? ''), { attrs: { type: 'datetime-local' } }).label);
  form.append(period);
  const governance = makeElement('div', { className: 'objective-editor-inline-fields' });
  governance.append(field('責任者ID', 'accountable_id', draft.accountableId ?? '', { help: '認可主体やRACIをここで決めません。' }).label);
  governance.append(field('採用状態', 'adoption_state', draft.adoptionState ?? 'draft', { options: [
    { value: 'draft', label: '下書き' },
    { value: 'proposed', label: '提案中' },
    { value: 'approved', label: '承認済み' },
    { value: 'retired', label: '終了' },
  ] }).label);
  form.append(governance);
  const captureDraft = () => callbacks.onDraftChange?.(collectDefinition(form, draft, { keepEmptyCriteria: true }));
  form.append(renderCriteria(form, draft, {
    ...callbacks,
    onAddCriterion: () => { captureDraft(); callbacks.onAddCriterion?.(); },
    onRemoveCriterion: (index) => { captureDraft(); callbacks.onRemoveCriterion?.(index); },
  }));
  form.append(renderReadiness(form, state.readiness));
  form.append(renderConstraintRefs(form, state, callbacks));
  const actions = makeElement('div', { className: 'objective-editor-actions' });
  actions.append(makeElement('span', { className: 'objective-editor-muted', text: callbacks.canEdit ? '保存後に同じID・新版を再取得して確認します。' : '読み取り専用です。書込み権限はホストから提供してください。' }));
  const saving = callbacks.saving || state.save.state === 'saving';
  const unverified = state.save.state === 'saved_unverified';
  if (saving) actions.append(makeElement('span', { className: 'objective-editor-muted', text: '保存中の処理は、画面を閉じても続きます。' }));
  if (unverified) actions.append(makeElement('span', { className: 'objective-editor-muted', text: '一覧を再読込し、保存した目的を選び直して確かめてください。' }));
  if (callbacks.canEdit) actions.append(makeElement('button', { className: workspace ? 'bb-ws-button is-primary' : 'objective-editor-button-primary', text: saving ? '保存中…' : '保存', attrs: { type: 'submit' }, disabled: saving || unverified }));
  const dismiss = workspace
    ? makeButton('キャンセル', callbacks.onCancelEdit, 'bb-ws-button')
    : makeButton('一覧へ戻る', callbacks.onBack, 'objective-editor-button-secondary');
  actions.append(dismiss);
  form.append(actions);
  if (saving) {
    for (const control of findAll(form, (node) => ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(node.tagName))) {
      if (control !== dismiss) control.disabled = true;
    }
  }
  form.addEventListener('input', captureDraft);
  form.addEventListener('change', captureDraft);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (saving || unverified) return;
    callbacks.onSubmit?.(collectDefinition(form, draft));
  });
  return form;
}

function renderStoryLinks(root, state, callbacks) {
  const section = makeElement('section', { className: 'objective-editor-panel', attrs: { 'aria-label': 'ストーリーから参照される目的' } });
  append(section,
    makeElement('div', { className: 'objective-editor-panel-heading', text: 'ストーリーから参照される目的' }),
    makeElement('p', { className: 'objective-editor-muted', text: 'ストーリーの本文は複製せず、ストーリーが参照する目的とその版を表示します。' }),
  );
  const form = makeElement('form', { className: 'objective-editor-inline-form' });
  const storyField = field('ストーリーID', 'story_id', state.story.storyId ?? '', { attrs: { required: true, placeholder: 'story-...' } });
  form.append(storyField.label, makeElement('button', { className: 'objective-editor-button-secondary', text: '参照を取得', attrs: { type: 'submit' } }));
  form.addEventListener('submit', (event) => { event.preventDefault(); callbacks.onLoadStoryLinks?.(storyField.input.value.trim()); });
  section.append(form);
  if (state.story.state === 'loading') section.append(makeElement('p', { className: 'objective-editor-muted', text: 'ストーリーとの関係を読み込んでいます。' }));
  else if (['permission_denied', 'api_unavailable', 'error_retryable', 'unknown'].includes(state.story.state)) section.append(statusNotice(state.story, { onRetry: callbacks.onRetryStory }));
  else if (state.story.state === 'empty') section.append(makeElement('p', { className: 'objective-editor-empty', text: 'このストーリーから参照される目的はありません。' }));
  else if (state.story.links) {
    const list = makeElement('ul', { className: 'objective-editor-link-list' });
    for (const link of state.story.links) {
      const item = makeElement('li', { className: 'objective-editor-link-item' });
      append(item,
        statusBadge(link.relation, link.relationLabel),
        makeElement('strong', { text: `${link.objective.id}@${link.objective.revision}` }),
        makeElement('span', { text: text(link.objective.meaning, '目的の意味 未確認') }),
      );
      if (link.timeCondition) item.append(makeElement('small', { text: `時間条件: ${JSON.stringify(link.timeCondition)}` }));
      list.append(item);
    }
    section.append(list);
  }
  return section;
}

/**
 * Render the common UI from a controller state.  Hosts may use this pure
 * renderer when their own application owns navigation and lifecycle.
 */
export function renderObjectiveEditor(root, state, callbacks = {}) {
  clear(root);
  const wrapper = makeElement('div', { className: 'objective-editor-root', attrs: { 'data-contract-version': OBJECTIVE_EDITOR_CONTRACT_VERSION, 'data-view': state.view ?? 'list' } });
  const header = makeElement('header', { className: 'objective-editor-header' });
  const copy = makeElement('div', { className: 'objective-editor-header-copy' });
  append(copy,
    makeElement('div', { className: 'objective-editor-eyebrow', text: 'BRAINBASE / OBJECTIVES' }),
    makeElement('h1', { text: '目的と評価基準' }),
    makeElement('p', { text: '目指す状態と評価基準を、版つきで編集・確認します。現状の理解（観測や仮説）とは分けて扱います。' }),
  );
  const headerStatus = state.save.state !== 'idle' ? state.save.state : state.objectives.state;
  header.append(copy, statusBadge(headerStatus));
  wrapper.append(header);
  const toolbar = makeElement('div', { className: 'objective-editor-toolbar' });
  const tabs = [
    ['list', '目的一覧'],
    ['editor', '目的を編集'],
    ...(callbacks.storyLinks === false ? [] : [['story', 'Story参照']]),
  ];
  for (const [id, label] of tabs) toolbar.append(makeButton(label, () => callbacks.onView?.(id), `objective-editor-tab${state.view === id ? ' is-active' : ''}`));
  toolbar.append(makeButton('再読込', callbacks.onReload, 'objective-editor-button-secondary'));
  if (callbacks.canEdit) toolbar.append(makeButton('新しい目的', callbacks.onCreate, 'objective-editor-button-primary'));
  wrapper.append(toolbar);
  const connectionState = state.connection;
  if (connectionState && connectionState !== 'ready') wrapper.append(statusNotice({ state: connectionState, message: state.connectionMessage }, { onRetry: callbacks.onReload }));
  const content = makeElement('main', { className: 'objective-editor-content' });
  const renderer = state.view === 'editor' ? renderObjectiveForm
    : state.view === 'story' && callbacks.storyLinks !== false ? renderStoryLinks
      : renderObjectiveList;
  content.append(renderer(content, state, callbacks));
  wrapper.append(content);
  root.append(wrapper);
  return wrapper;
}

/* ---- Workspace layout (the organization edition's pattern; used when the host gives a rail) ---- */

const OPERATOR_LABELS = Object.freeze({ at_least: '以上', at_most: '以下', equals: '一致' });
const FAILED_STATES = Object.freeze(['permission_denied', 'api_unavailable', 'missing', 'conflict', 'error_retryable', 'unknown']);

/** `2026/7/1`, or `7/1` when the year is `sameYearAs`'s; text that is not a date stays as it is. */
function ledgerDate(value, sameYearAs = null) {
  const input = nonEmptyText(value);
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  const day = `${date.getMonth() + 1}/${date.getDate()}`;
  return sameYearAs !== null && sameYearAs === date.getFullYear() ? day : `${date.getFullYear()}/${day}`;
}

function periodText(period, { compact = false } = {}) {
  const from = shortDate(period?.from);
  const until = shortDate(period?.until);
  if (!from && !until) return null;
  if (!compact) return `${from ?? '未設定'}〜${until ?? '未設定'}`;
  // In the ledger the dates are short and the end drops its year when it is the start's year.
  const start = new Date(nonEmptyText(period?.from) ?? '');
  const startYear = Number.isNaN(start.getTime()) ? null : start.getFullYear();
  return `${ledgerDate(period?.from) ?? '未設定'}〜${ledgerDate(period?.until, startYear) ?? '未設定'}`;
}

/** A state as a kit notice: failures are alerts, and never read as zero items. */
function workspaceStatusNotice(doc, value, { label, onRetry, retryLabel = '再試行' } = {}) {
  const normalized = typeof value === 'string' ? { state: value } : value ?? {};
  const status = normalizeState(normalized.state);
  const tone = status === 'verified' ? 'info'
    : ['unknown', 'saved_unverified'].includes(status) ? 'warning'
      : 'danger';
  const body = makeElement('div', { className: 'bb-objective-notice-body' });
  body.append(makeElement('p', { text: `${STATUS_LABELS[status] ?? STATUS_LABELS.unknown}：${normalized.message ?? STATUS_LABELS[status] ?? '状態を確認できません。'}` }));
  if (status === 'conflict' && normalized.currentRevision) {
    body.append(makeElement('p', { text: `現在の版: ${normalized.currentRevision}。入力は残しています。現在の版を確かめてから直してください。` }));
  }
  if (onRetry) body.append(workspaceButton(doc, { text: retryLabel, variant: 'quiet', onClick: onRetry }));
  return workspaceNotice(doc, { label, text: body, tone });
}

function objectiveReadinessCell(objective) {
  const readiness = objective.readiness;
  if (readiness?.state === 'ready' && readiness.ready === false) {
    const count = readiness.issues?.length ?? 0;
    return { text: count > 0 ? `使えない・不足${count}件` : '使えない', className: 'bb-objective-judgment is-draft' };
  }
  const state = objectiveJudgmentState(objective);
  if (state === 'judgment_available') return { text: '使える', className: 'bb-objective-judgment is-available' };
  if (state === 'draft') return { text: '使えない・下書き', className: 'bb-objective-judgment is-draft' };
  return { text: '未確認', className: 'bb-objective-judgment is-unresolved' };
}

function renderObjectiveMetrics(doc, state) {
  const records = ['ready', 'empty'].includes(state.objectives.state) && Array.isArray(state.objectives.records) ? state.objectives.records : null;
  const judged = records ? records.map((objective) => objectiveJudgmentState(objective)) : [];
  const unknown = judged.filter((value) => value === 'judgment_unknown').length;
  return workspaceMetrics(doc, [
    { label: '目的', value: records ? records.length : null, note: '読めた目的' },
    {
      label: '判断に使える',
      value: records ? judged.filter((value) => value === 'judgment_available').length : null,
      note: unknown > 0 ? `使えるか未確認 ${unknown}件` : '評価基準と参照が揃った目的',
    },
    {
      label: '下書き',
      value: records ? records.filter((objective) => ['draft', 'proposed'].includes(objective.adoptionState)).length : null,
      note: '下書き・提案中',
    },
  ], { ariaLabel: '目的の集計' });
}

const OBJECTIVE_COLUMNS = Object.freeze(['目的', '望ましい状態', '状態', '判断に使えるか', '評価期間']);

function renderObjectiveLedger(doc, state, callbacks) {
  const objectives = state.objectives;
  if (objectives.state === 'idle' && state.connection !== 'ready') {
    return workspaceStatusNotice(doc, { state: state.connection, message: state.connectionMessage }, { label: '目的', onRetry: callbacks.onReload, retryLabel: '再読込' });
  }
  if (FAILED_STATES.includes(objectives.state)) {
    return workspaceStatusNotice(doc, objectives, { label: '目的', onRetry: callbacks.onReload, retryLabel: '再読込' });
  }
  const loading = objectives.state === 'loading' || objectives.state === 'idle';
  const records = loading ? [] : objectives.records ?? [];
  return workspaceLedger(doc, {
    className: 'bb-objective-ledger',
    ariaLabel: '目的の一覧',
    columns: OBJECTIVE_COLUMNS,
    empty: loading ? '目的を読み込んでいます。' : '目的はまだ登録されていません。',
    rows: records.map((objective) => {
      const period = periodText(objective.evaluationPeriod, { compact: true });
      return {
        key: objective.id,
        selected: objective.id === state.selectedId,
        onSelect: () => callbacks.onSelect?.(objective),
        cells: [
          { primary: text(objective.meaning, objective.id), secondary: `${objective.id}@${objective.revision}` },
          objective.desiredState ?? { text: '未設定', className: 'is-unresolved' },
          objective.adoptionState ? (STATUS_LABELS[objective.adoptionState] ?? objective.adoptionState) : { text: '未記録', className: 'is-unresolved' },
          objectiveReadinessCell(objective),
          period ?? { text: '未設定', className: 'is-unresolved' },
        ],
      };
    }),
  });
}

/**
 * Render the workspace (page head, metrics, ledger) and the rail.  `host` is
 * what the host adds to the page head: `{ title, lead, sourceNotice, pageActions }`
 * (see `createObjectiveEditorController`).
 */
export function renderObjectiveWorkspace(root, rail, state, callbacks = {}, page = {}, host = {}) {
  const doc = getDocument();
  clear(root);
  const wrapper = makeElement('div', {
    className: 'bb-objective-workspace',
    attrs: { 'data-contract-version': OBJECTIVE_EDITOR_CONTRACT_VERSION, 'data-layout': 'workspace' },
  });
  const actions = [{ text: '再読込', onClick: callbacks.onReload }];
  if (callbacks.canEdit) actions.push({ text: '新しい目的', variant: 'primary', onClick: callbacks.onCreate });
  actions.push(...workspaceHostActions(host?.pageActions));
  wrapper.append(workspacePageHeader(doc, {
    crumbs: Array.isArray(page?.crumbs) ? page.crumbs : [],
    title: nonEmptyText(host?.title) ?? '目的と現状',
    lead: nonEmptyText(host?.lead) ?? '目指す状態と評価基準を、版つきで確かめて直します。下の「現状と見通し」は、目的とは分けた、いまの理解（観測と仮説）です。',
    source: nonEmptyText(page?.source),
    actions,
  }));
  const notice = workspaceHostNotice(doc, host?.sourceNotice);
  if (notice) wrapper.append(notice);
  wrapper.append(renderObjectiveMetrics(doc, state), renderObjectiveLedger(doc, state, callbacks));
  if (callbacks.storyLinks !== false) {
    const story = makeElement('div', { className: 'bb-objective-story' });
    story.append(renderStoryLinks(story, state, callbacks));
    wrapper.append(story);
  }
  root.append(wrapper);
  if (rail) renderObjectiveRail(doc, rail, state, callbacks);
  return wrapper;
}

function criteriaContent(doc, criteria) {
  if (criteria === null || criteria === undefined) return makeElement('p', { className: 'is-unrecorded', text: '評価基準を確認できません。' });
  if (!criteria.length) return makeElement('p', { text: '評価基準はまだありません。判断に使うには、測る変数の参照が必要です。' });
  const list = makeElement('ul', { className: 'bb-objective-list' });
  for (const criterion of criteria) {
    const item = makeElement('li');
    const operator = OPERATOR_LABELS[criterion.operator] ?? criterion.operator;
    const target = criterion.target === undefined ? null : optionalText(criterion.target);
    item.append(
      makeElement('code', { text: `${criterion.variableRef.id}@${criterion.variableRef.revision}` }),
      makeElement('span', { text: target === null ? `基準値なし（${operator}）` : criterion.operator === 'equals' ? `${target} と一致` : `${target} ${operator}` }),
    );
    list.append(item);
  }
  return list;
}

function constraintContent(doc, state, callbacks) {
  if (state.constraints.state === 'loading') return makeElement('p', { text: '制約の参照を読み込んでいます。' });
  if (['permission_denied', 'api_unavailable', 'error_retryable', 'unknown'].includes(state.constraints.state)) {
    return workspaceStatusNotice(doc, state.constraints, { label: '制約', onRetry: callbacks.onReloadConstraints, retryLabel: '再読込' });
  }
  const refs = state.editor.constraintRefs ?? state.constraints.refs ?? [];
  const content = [];
  if (!refs.length) content.push(makeElement('p', { text: 'この目的に紐づく制約の参照はありません。' }));
  else {
    const list = makeElement('ul', { className: 'bb-objective-list' });
    for (const ref of refs) {
      const item = makeElement('li');
      item.append(makeElement('code', { text: `${ref.id}@${ref.revision}` }));
      if (ref.meaning) item.append(makeElement('span', { text: ref.meaning }));
      list.append(item);
    }
    content.push(list);
  }
  content.push(makeElement('p', {
    className: 'bb-objective-note',
    text: callbacks.constraintsEditable === false || !callbacks.canEdit
      ? '制約の参照はここでは表示だけです。'
      : '参照の追加と外しは「目的を直す」から行えます。',
  }));
  return content;
}

function readinessContent(doc, readiness) {
  const normalized = normalizeReadiness(readiness);
  if (normalized.state !== 'ready') {
    return [statusBadge('judgment_unknown'), makeElement('p', { text: '判断に使える状態かどうかを、保存先から確認できていません。' })];
  }
  if (normalized.ready) {
    return [statusBadge('judgment_available'), makeElement('p', { text: '必要な定義・基準・参照が揃っています。観測値の存在は別途確認します。' })];
  }
  const content = [statusBadge('draft', '判断に使えない')];
  if (normalized.issues?.length) {
    const list = makeElement('ul', { className: 'bb-objective-issues' });
    for (const issue of normalized.issues) list.append(makeElement('li', { text: `${issue.path}: ${issue.message}` }));
    content.push(list);
  }
  return content;
}

function renderObjectiveDetail(doc, state, callbacks) {
  const objective = state.selected;
  const parts = [workspaceRailHead(doc, { kicker: '目的', title: text(objective.meaning, objective.id), sub: `${objective.id}@${objective.revision}` })];
  if (state.save.state === 'verified' && state.save.reference?.id === objective.id) {
    parts.push(workspaceNotice(doc, {
      label: '保存',
      text: `${STATUS_LABELS.verified}：保存した版（${state.save.reference.id}@${state.save.reference.revision}）を読み戻して確かめました。`,
    }));
  }
  parts.push(workspaceRailBlock(doc, {
    title: '概要',
    content: workspaceDefinition(doc, [
      ['望ましい状態', objective.desiredState],
      ['対象者', objective.beneficiaryIds?.length ? objective.beneficiaryIds.join('、') : null],
      ['責任者', objective.accountableId],
      ['採用状態', objective.adoptionState ? (STATUS_LABELS[objective.adoptionState] ?? objective.adoptionState) : null],
      ['評価期間', periodText(objective.evaluationPeriod)],
    ]),
  }));
  parts.push(workspaceRailBlock(doc, { title: `評価基準${objective.criteria ? ` ${objective.criteria.length}件` : ''}`, className: 'bb-objective-criteria-block', content: criteriaContent(doc, objective.criteria) }));
  parts.push(workspaceRailBlock(doc, { title: '制約の参照', className: 'bb-objective-constraints-block', content: constraintContent(doc, state, callbacks) }));
  parts.push(workspaceRailBlock(doc, { title: '判断に使えるか', className: 'bb-objective-readiness-block', content: readinessContent(doc, state.readiness) }));
  if (callbacks.canEdit) {
    parts.push(makeElement('p', { className: 'objective-editor-muted', text: '直すと同じ目的の新しい版を作ります。保存結果を読み戻して確認し、確認できない場合はその状態を表示します。' }));
    parts.push(workspaceActions(doc, [{ text: '目的を直す', variant: 'primary', onClick: callbacks.onEdit }]));
  }
  return parts;
}

function renderObjectiveFormRail(doc, state, callbacks) {
  const creating = state.editor.mode === 'create';
  const draft = state.editor.draft;
  const parts = [workspaceRailHead(doc, {
    kicker: '目的',
    title: creating ? '新しい目的' : '目的を直す',
    sub: creating ? '保存すると版1になります。' : `${draft.id}@${state.editor.expectedRevision ?? draft.revision} を元に新しい版を作ります。`,
  })];
  if (state.save.state !== 'idle' && state.save.state !== 'saving') {
    // A conflict keeps the input; saving again with the same revision would fail again, so no retry there.
    parts.push(workspaceStatusNotice(doc, state.save, {
      label: '保存',
      onRetry: ['conflict', 'saved_unverified'].includes(state.save.state) ? null : callbacks.onRetrySave,
      retryLabel: 'もう一度保存',
    }));
  }
  parts.push(buildObjectiveForm(state, callbacks, { workspace: true }));
  return parts;
}

function renderObjectiveRail(doc, rail, state, callbacks) {
  const panel = makeElement('div', { className: 'bb-objective-rail', attrs: { 'aria-label': '選択中の目的' } });
  const pending = state.selectedId ? (state.objectives.records ?? []).find((objective) => objective.id === state.selectedId) : null;
  if (state.railMode === 'form' && state.editor.draft) {
    panel.setAttribute('data-rail-mode', 'form');
    panel.append(...renderObjectiveFormRail(doc, state, callbacks));
  } else if (state.editor.state === 'loading') {
    panel.setAttribute('data-rail-mode', 'loading');
    panel.append(
      workspaceRailHead(doc, { kicker: '目的', title: pending ? text(pending.meaning, pending.id) : '目的', sub: pending ? `${pending.id}@${pending.revision}` : null }),
      workspaceNotice(doc, { label: '目的', text: '目的を読み込んでいます。' }),
    );
  } else if (FAILED_STATES.includes(state.editor.state)) {
    panel.setAttribute('data-rail-mode', 'error');
    panel.append(
      workspaceRailHead(doc, { kicker: '目的', title: pending ? text(pending.meaning, pending.id) : '目的', sub: pending ? `${pending.id}@${pending.revision}` : null }),
      workspaceStatusNotice(doc, state.editor, { label: '目的', onRetry: pending ? () => callbacks.onSelect?.(pending) : null, retryLabel: '再読込' }),
    );
  } else if (state.selected) {
    panel.setAttribute('data-rail-mode', 'detail');
    panel.append(...renderObjectiveDetail(doc, state, callbacks));
  } else {
    panel.setAttribute('data-rail-mode', 'empty');
    panel.append(workspaceDetailEmpty(doc, {
      mark: '目',
      title: '目的を選択',
      text: '一覧から選ぶと、評価基準・制約の参照・判断に使えるかを表示します。',
    }));
  }
  rail.replaceChildren(panel);
  return panel;
}

function extractMutationRef(payload) {
  const object = objectValue(payload);
  if (!object) return null;
  return normalizeReference(payloadValue(object, 'ref', 'reference', 'objective', 'record', 'data') ?? object, 'objective');
}

function definitionsEqual(left, right) {
  if (!left || !right) return false;
  return left.id === right.id && left.type === right.type && left.revision === right.revision
    && (!left.digest || !right.digest || left.digest === right.digest);
}

function referencesEqual(left, right) {
  const lhs = (left ?? []).map((ref) => `${ref.type}:${ref.id}@${ref.revision}`).sort();
  const rhs = (right ?? []).map((ref) => `${ref.type}:${ref.id}@${ref.revision}`).sort();
  return JSON.stringify(lhs) === JSON.stringify(rhs);
}

function portMethod(port, name) {
  return port && typeof port[name] === 'function' ? port[name].bind(port) : null;
}

/**
 * Creates a host-injected Objective editor controller.
 *
 * ObjectiveEditorPort methods use the same argument order as
 * CompanyOsObjectives where possible.  The host owns FoundationStore,
 * authentication and Story/Constraint adapters; the UI only supplies the
 * trusted context it was given and never accepts owner/scope from form data.
 *
 * Host options used only in the workspace layout (when `rail` is given); the
 * tabs layout without `rail` ignores them:
 * - `title` / `lead`: replace the page head's 目的と現状 and its lead.
 * - `sourceNotice: { label, text }`: a notice right after the page head
 *   (`text` is a string or an element).  Default: none.
 * - `pageActions: [{ text, variant, onClick, disabled }]`: host-owned buttons in
 *   the page head after 再読込 / 新しい目的.
 * All four are read from `options` on every render, so a host may change them
 * and call `render()`.
 */
export function createObjectiveEditorController(options = {}) {
  const root = options.root ?? null;
  // With a rail the screen uses the workspace layout; without one it keeps its tabs.
  const rail = options.rail ?? null;
  const page = options.page ?? {};
  const port = options.port ?? null;
  const context = options.context ?? {};
  const canEdit = options.canEdit === true;
  // Hosts without a constraint-link writer show constraints read-only.
  const constraintsEditable = options.constraintsEditable !== false;
  // Hosts without a Story provider hide the Story tab instead of showing an unavailable API.
  const storyLinks = options.storyLinks !== false;
  const createDefaults = options.createDefaults ?? {};
  const state = {
    view: options.initialView ?? 'list',
    connection: port ? 'ready' : 'api_unavailable',
    connectionMessage: port ? null : '目的を読み書きする経路が、この画面に渡されていません。',
    objectives: { state: 'idle', records: null, absence_confirmed: false },
    selected: null,
    readiness: { state: 'unknown', ready: null, issues: null },
    constraints: { state: 'idle', refs: null, absence_confirmed: false },
    story: { state: 'idle', storyId: '', links: null, absence_confirmed: false },
    editor: { state: 'idle', mode: 'edit', draft: null, expectedRevision: null, constraintRefs: null, originalConstraintRefs: null, constraintRefsChanged: false },
    save: { state: 'idle' },
    /** The objective the owner picked (workspace layout: the selected ledger row). */
    selectedId: null,
    /** What the rail shows in the workspace layout: the selected objective, or the edit form. */
    railMode: 'detail',
  };
  // The objective shown before 新しい目的, to return to when the owner cancels.
  let beforeCreate = null;
  // Requests may finish after Cancel or a newer selection. Only the current
  // screen may consume their results; the save lock survives those changes.
  let selectionVersion = 0;
  let editorVersion = 0;
  let listRequest = 0;
  let readinessRequest = 0;
  let constraintRequest = 0;
  let renderVersion = 0;
  let activeSave = null;

  function render() {
    if (!root) return null;
    const currentRender = ++renderVersion;
    const currentEditor = editorVersion;
    const callbacks = {
      canEdit,
      saving: activeSave !== null,
      constraintsEditable,
      storyLinks,
      onView: (view) => { state.view = view; render(); },
      onReload: loadObjectives,
      onCreate: beginCreate,
      onSelect: selectObjective,
      onBack: () => { cancelEdit(); state.view = 'list'; render(); },
      onSubmit: (definition) => currentEditor === editorVersion && currentRender === renderVersion ? saveObjective(definition) : null,
      onDraftChange: (definition) => {
        if (currentEditor === editorVersion && currentRender === renderVersion && !activeSave) state.editor.draft = definition;
      },
      onRetrySave: () => saveObjective(state.editor.draft),
      onAddCriterion: () => { state.editor.draft.criteria = [...(state.editor.draft.criteria ?? []), { variableRef: { id: '', type: 'variable', revision: '' }, operator: 'equals' }]; render(); },
      onRemoveCriterion: (index) => { state.editor.draft.criteria = (state.editor.draft.criteria ?? []).filter((_, itemIndex) => itemIndex !== index); render(); },
      onAddConstraintRef: addConstraintRef,
      onRemoveConstraintRef: removeConstraintRef,
      onReloadConstraints: () => loadConstraintRefs(state.selected),
      onLoadStoryLinks: loadStoryLinks,
      onRetryStory: () => loadStoryLinks(state.story.storyId),
      onEdit: beginEdit,
      onCancelEdit: cancelEdit,
    };
    // Detached forms and buttons must not act on a newer editor session.
    for (const [name, callback] of Object.entries(callbacks)) {
      if (typeof callback === 'function') callbacks[name] = (...args) => currentRender === renderVersion ? callback(...args) : undefined;
    }
    return rail ? renderObjectiveWorkspace(root, rail, state, callbacks, page, options) : renderObjectiveEditor(root, state, callbacks);
  }

  function setPortState(error, target, fallbackMessage = null) {
    const normalized = normalizeObjectiveError(error);
    target.state = normalized.state;
    target.message = normalized.message ?? fallbackMessage;
    target.code = normalized.code;
    target.currentRevision = normalized.currentRevision;
    return normalized;
  }

  async function loadObjectives() {
    const request = ++listRequest;
    const version = editorVersion;
    state.objectives = { state: 'loading', records: null, absence_confirmed: false };
    state.connection = port ? 'ready' : 'api_unavailable';
    render();
    const method = portMethod(port, 'listObjectives');
    if (!method) {
      state.objectives = { state: 'api_unavailable', records: null, absence_confirmed: false, message: '目的の一覧を読む経路がありません。' };
      state.connection = 'api_unavailable';
      render();
      return state.objectives;
    }
    try {
      const payload = await method(context);
      if (request !== listRequest) return state.objectives;
      state.objectives = normalizeObjectiveCollection(payload);
      state.connection = state.objectives.state === 'ready' || state.objectives.state === 'empty' ? 'ready' : state.objectives.state;
    } catch (error) {
      if (request !== listRequest) return state.objectives;
      state.objectives = { state: normalizeObjectiveError(error).state, records: null, absence_confirmed: false, ...normalizeObjectiveError(error) };
      state.connection = state.objectives.state;
    }
    render();
    // As on the organization screens, the workspace opens with the first row selected.
    const first = state.objectives.records?.[0];
    if (rail && first && !state.selectedId && state.railMode !== 'form' && version === editorVersion) await selectObjective(first);
    return state.objectives;
  }

  async function loadConstraintRefs(objective) {
    const version = selectionVersion;
    const request = ++constraintRequest;
    const current = () => version === selectionVersion && request === constraintRequest;
    state.constraints = { state: 'loading', refs: null, absence_confirmed: false };
    render();
    if (!objective) {
      state.constraints = { state: 'unknown', refs: null, absence_confirmed: false, message: '目的が選ばれていません。' };
      render();
      return state.constraints;
    }
    const method = portMethod(port, 'listObjectiveConstraintRefs') ?? portMethod(port, 'listConstraintReferences');
    if (!method) {
      state.constraints = { state: 'api_unavailable', refs: null, absence_confirmed: false, message: '目的と制約の参照を読む経路がありません。' };
      state.editor.constraintRefs = null;
      render();
      return state.constraints;
    }
    try {
      const payload = await method({ id: objective.id, type: 'objective', revision: objective.revision }, context);
      if (!current()) return state.constraints;
      state.constraints = normalizeReferenceCollection(payload, ['refs', 'references', 'constraints', 'records', 'items', 'data']);
      if (state.constraints.refs && !state.editor.constraintRefsChanged) {
        state.editor.constraintRefs = state.constraints.refs;
        state.editor.originalConstraintRefs = JSON.parse(JSON.stringify(state.constraints.refs));
        state.editor.constraintRefsChanged = false;
      }
    } catch (error) {
      if (!current()) return state.constraints;
      state.constraints = { state: normalizeObjectiveError(error).state, refs: null, absence_confirmed: false, ...normalizeObjectiveError(error) };
    }
    render();
    return state.constraints;
  }

  async function loadReadiness(objective) {
    if (!objective) return state.readiness;
    const version = selectionVersion;
    const request = ++readinessRequest;
    const current = () => version === selectionVersion && request === readinessRequest
      && state.selected?.id === objective.id && state.selected?.revision === objective.revision;
    const method = portMethod(port, 'checkObjectiveReadiness');
    if (!method) {
      state.readiness = { state: 'unknown', ready: null, issues: null, message: '判断に使える状態を確かめる経路がありません。' };
      render();
      return state.readiness;
    }
    try {
      const payload = await method(objective.id, context, objective.revision);
      if (!current()) return state.readiness;
      state.readiness = normalizeReadiness(payload);
    } catch (error) {
      if (!current()) return state.readiness;
      state.readiness = { state: normalizeObjectiveError(error).state, ready: null, issues: null, ...normalizeObjectiveError(error) };
    }
    if (state.selected) state.selected.readiness = state.readiness;
    render();
    return state.readiness;
  }

  async function selectObjective(objectiveOrReference) {
    const reference = normalizeReference(objectiveOrReference, 'objective') ?? objectiveOrReference;
    const id = reference?.id;
    const revision = reference?.revision;
    if (!id) return null;
    const version = ++selectionVersion;
    editorVersion += 1;
    state.selected = null;
    state.selectedId = id;
    state.save = { state: 'idle' };
    if (rail) {
      state.railMode = 'detail';
      beforeCreate = null;
    }
    state.view = 'editor';
    state.editor = { state: 'loading', mode: 'edit', draft: null, expectedRevision: revision ?? null, constraintRefs: null, originalConstraintRefs: null, constraintRefsChanged: false };
    state.readiness = { state: 'unknown', ready: null, issues: null };
    state.constraints = { state: 'loading', refs: null, absence_confirmed: false };
    render();
    const method = portMethod(port, 'readObjective');
    if (!method) {
      state.editor = { ...state.editor, state: 'api_unavailable', message: '目的を読む経路がありません。' };
      state.connection = 'api_unavailable';
      render();
      return null;
    }
    try {
      const payload = await method(id, context, revision);
      if (version !== selectionVersion) return null;
      const objective = normalizeObjectiveRecord(payload);
      if (!objective) {
        state.editor = { ...state.editor, state: 'missing', message: '指定した目的を保存先から確認できません。' };
        state.connection = 'missing';
        render();
        return null;
      }
      state.selected = objective;
      state.editor = {
        state: 'ready', mode: 'edit', draft: editorDraftFromObjective(objective), expectedRevision: objective.revision,
        constraintRefs: null, originalConstraintRefs: null, constraintRefsChanged: false,
      };
      state.connection = 'ready';
      render();
      await Promise.allSettled([loadReadiness(objective), loadConstraintRefs(objective)]);
      return objective;
    } catch (error) {
      if (version !== selectionVersion) return null;
      const normalized = normalizeObjectiveError(error);
      state.editor = { ...state.editor, state: normalized.state, message: normalized.message, error: normalized.error };
      state.connection = normalized.state;
      render();
      return null;
    }
  }

  function beginCreate() {
    // A repeated click on New must not throw away an in-progress draft.
    if (state.editor.mode === 'create' && state.railMode === 'form') return;
    selectionVersion += 1;
    editorVersion += 1;
    if (rail && state.railMode !== 'form') beforeCreate = state.selected;
    state.railMode = 'form';
    state.view = 'editor';
    state.selected = null;
    state.readiness = { state: 'unknown', ready: null, issues: null };
    state.constraints = { state: 'empty', refs: [], absence_confirmed: true };
    state.editor = {
      state: 'ready', mode: 'create', draft: editorDraftFromObjective({
        id: '', revision: '1', meaning: '', beneficiaryIds: [], desiredState: '', criteria: [],
        evaluationPeriod: { from: '', until: '' }, adoptionState: 'draft', authorizedUses: ['draft'],
        definition: { type: 'objective', revision: '1', ...createDefaults },
      }), expectedRevision: null, constraintRefs: [], originalConstraintRefs: [], constraintRefsChanged: false,
    };
    state.save = { state: 'idle' };
    render();
  }

  /** Workspace layout: open the edit form for the selected objective in the rail. */
  function beginEdit() {
    if (!state.selected) return;
    if (state.railMode === 'form' && state.editor.mode === 'edit') return;
    editorVersion += 1;
    state.editor = {
      ...state.editor,
      state: 'ready', mode: 'edit', draft: editorDraftFromObjective(state.selected), expectedRevision: state.selected.revision,
      constraintRefs: state.constraints.refs ?? state.editor.constraintRefs ?? null,
      originalConstraintRefs: state.constraints.refs ? JSON.parse(JSON.stringify(state.constraints.refs)) : state.editor.originalConstraintRefs,
      constraintRefsChanged: false,
    };
    state.save = { state: 'idle' };
    state.railMode = 'form';
    render();
  }

  /** Discard unsaved input and leave the form; an already sent write cannot be undone. */
  function cancelEdit() {
    editorVersion += 1;
    const creating = state.editor.mode === 'create';
    state.railMode = 'detail';
    state.save = { state: 'idle' };
    if (creating) {
      selectionVersion += 1;
      const previous = beforeCreate;
      beforeCreate = null;
      state.editor = { state: 'idle', mode: 'edit', draft: null, expectedRevision: null, constraintRefs: null, originalConstraintRefs: null, constraintRefsChanged: false };
      state.selectedId = null;
      if (previous) {
        void selectObjective(previous);
        return;
      }
      render();
      return;
    }
    if (state.selected) {
      state.editor = {
        state: 'ready', mode: 'edit', draft: editorDraftFromObjective(state.selected), expectedRevision: state.selected.revision,
        constraintRefs: state.constraints.refs ?? null, originalConstraintRefs: state.constraints.refs ?? null, constraintRefsChanged: false,
      };
    }
    render();
  }

  function addConstraintRef(reference) {
    if (!canEdit || !constraintsEditable || activeSave) return;
    const normalized = normalizeReference(reference, 'constraint');
    if (!normalized || normalized.type !== 'constraint') return;
    const refs = state.editor.constraintRefs ?? [];
    if (refs.some((item) => item.id === normalized.id && item.revision === normalized.revision)) return;
    state.editor.constraintRefs = [...refs, normalized];
    state.editor.constraintRefsChanged = true;
    render();
  }

  function removeConstraintRef(reference) {
    if (!canEdit || !constraintsEditable || activeSave) return;
    state.editor.constraintRefs = (state.editor.constraintRefs ?? []).filter((item) => !(item.id === reference.id && item.revision === reference.revision));
    state.editor.constraintRefsChanged = true;
    render();
  }

  async function saveObjective(definition) {
    if (!definition) return null;
    if (!canEdit) return { state: 'permission_denied', message: 'この画面では目的を保存できません。' };
    if (activeSave) return { state: 'saving', action: activeSave.mode };
    // Once a mutation succeeded, repeating it is unsafe until the owner has
    // reloaded and selected the canonical revision again.
    if (state.save.state === 'saved_unverified') return state.save;
    definition = definitionForSave(definition);
    const mode = state.editor.mode;
    const expectedRevision = state.editor.expectedRevision;
    const constraintRefsChanged = state.editor.constraintRefsChanged;
    const constraintRefs = JSON.parse(JSON.stringify(state.editor.constraintRefs ?? []));
    const updateMethod = mode === 'create' ? null : portMethod(port, 'updateObjective');
    const createMethod = mode === 'create' ? portMethod(port, 'createObjective') : null;
    if ((mode === 'create' && !createMethod) || (mode !== 'create' && !updateMethod)) {
      state.save = { state: 'api_unavailable', message: '目的を保存する経路がありません。' };
      render();
      return state.save;
    }
    if (constraintRefsChanged && !portMethod(port, 'replaceObjectiveConstraintRefs')) {
      state.save = { state: 'api_unavailable', message: '制約の参照を保存する経路が無いため、目的の本文も保存していません。' };
      render();
      return state.save;
    }
    const version = editorVersion;
    const current = () => version === editorVersion;
    const publish = (result) => {
      if (current()) { state.save = result; render(); }
      return result;
    };
    const saving = { mode };
    activeSave = saving;
    state.editor.draft = definition;
    state.save = { state: 'saving', action: mode };
    render();
    let mutation;
    let mutationCompleted = false;
    try {
      mutation = mode === 'create'
        ? await createMethod(definition, context)
        : await updateMethod(definition.id, expectedRevision, definition, context);
      mutationCompleted = true;
      if (!current()) return { state: 'saved_unverified', action: mode, mutation };
      const savedRef = extractMutationRef(mutation);
      if (!savedRef || savedRef.id !== definition.id || savedRef.type !== 'objective' || !savedRef.revision) {
        return publish({ state: 'saved_unverified', message: '保存の応答に、同じ目的の新しい版が含まれていません。', mutation });
      }
      if (mode !== 'create' && (!expectedRevision || savedRef.revision === expectedRevision)) {
        return publish({
          state: 'saved_unverified',
          message: '更新応答にexpectedRevisionとは異なる新版が含まれていません。',
          mutation,
          expectedRevision,
          reference: savedRef,
        });
      }
      const readMethod = portMethod(port, 'readObjective');
      const readback = readMethod ? normalizeObjectiveRecord(await readMethod(savedRef.id, context, savedRef.revision)) : null;
      if (!current()) return { state: 'saved_unverified', action: mode, mutation, readback };
      const returnedDefinition = readback ? { id: readback.id, type: readback.type, revision: readback.revision, digest: readback.digest } : null;
      const referenceMatches = definitionsEqual(savedRef, returnedDefinition);
      if (!referenceMatches || !readback || (mode !== 'create' && (!expectedRevision || readback.revision === expectedRevision))) {
        return publish({ state: 'saved_unverified', message: '保存した新しい版を読み戻して確かめられません。一覧を再読込して確かめてください。', mutation, readback });
      }
      if (constraintRefsChanged) {
        const replaceRefs = portMethod(port, 'replaceObjectiveConstraintRefs');
        await replaceRefs(savedRef, constraintRefs, context);
        if (!current()) return { state: 'saved_unverified', action: mode, mutation, readback };
        const readConstraintRefs = portMethod(port, 'listObjectiveConstraintRefs') ?? portMethod(port, 'listConstraintReferences');
        const constraintPayload = readConstraintRefs
          ? await readConstraintRefs(savedRef, context)
          : null;
        if (!current()) return { state: 'saved_unverified', action: mode, mutation, readback };
        const verifiedRefs = normalizeReferenceCollection(constraintPayload).refs;
        if (!verifiedRefs || !referencesEqual(verifiedRefs, constraintRefs)) {
          return publish({ state: 'saved_unverified', message: '目的は保存されましたが、制約の参照を読み戻した内容が一致しません。', mutation, readback, constraintRefs: verifiedRefs });
        }
      }
      // Reads of the previous revision must not replace the saved revision's
      // readiness or constraints when they finish out of order.
      selectionVersion += 1;
      state.selected = readback;
      state.selectedId = readback.id;
      state.railMode = 'detail';
      beforeCreate = null;
      state.editor = {
        state: 'ready', mode: 'edit', draft: editorDraftFromObjective(readback), expectedRevision: readback.revision,
        constraintRefs, originalConstraintRefs: constraintRefs, constraintRefsChanged: false,
      };
      const result = { state: 'verified', action: mode, reference: savedRef, readback };
      state.save = result;
      state.connection = 'ready';
      // Readiness belongs to a revision; re-read it for the one just saved.
      state.readiness = { state: 'unknown', ready: null, issues: null };
      render();
      await loadReadiness(readback);
      if (current()) await loadObjectives();
      return result;
    } catch (error) {
      const normalized = normalizeObjectiveError(error);
      return publish(mutationCompleted
        ? { state: 'saved_unverified', message: '目的は保存されましたが、保存結果を確かめられません。一覧を再読込して確かめてください。', mutation, error: normalized.error, draft: definition }
        : { state: normalized.state, message: normalized.message, currentRevision: normalized.currentRevision, error: normalized.error, draft: definition });
    } finally {
      if (activeSave === saving) activeSave = null;
      render();
    }
  }

  async function loadStoryLinks(storyId) {
    state.view = 'story';
    state.story = { state: 'loading', storyId: storyId ?? '', links: null, absence_confirmed: false };
    render();
    const method = portMethod(port, 'listStoryObjectiveLinks');
    if (!method) {
      state.story = { state: 'api_unavailable', storyId, links: null, absence_confirmed: false, message: 'ストーリーと目的の関係を読む経路がありません。' };
      render();
      return state.story;
    }
    try {
      state.story = { ...normalizeStoryObjectiveLinks(await method(storyId, context)), storyId };
    } catch (error) {
      state.story = { state: normalizeObjectiveError(error).state, storyId, links: null, absence_confirmed: false, ...normalizeObjectiveError(error) };
    }
    render();
    return state.story;
  }

  const controller = {
    state,
    render,
    loadObjectives,
    selectObjective,
    beginCreate,
    saveObjective,
    loadConstraintRefs,
    loadReadiness,
    loadStoryLinks,
    addConstraintRef,
    removeConstraintRef,
    beginEdit,
    cancelEdit,
    contractVersion: OBJECTIVE_EDITOR_CONTRACT_VERSION,
  };
  render();
  if (options.autoLoad !== false) void loadObjectives();
  return controller;
}

export const createObjectiveEditorModule = createObjectiveEditorController;
export default createObjectiveEditorController;
