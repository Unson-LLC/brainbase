/*
 * Brainbase Objective editor.
 *
 * The OSS package owns this screen and its browser-side state only.  A host
 * supplies the ObjectiveEditorPort below; the module never fetches a BFF,
 * opens a database, or decides organization membership/RACI.  An organization
 * application can compose the same screen by adapting its authenticated
 * FoundationRevisionStore boundary to the port.
 */

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
    section.append(statusBadge('judgment_unknown'), makeElement('p', { className: 'objective-editor-muted', text: 'readinessを正本APIから確認できていません。' }));
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
  if (!criteria.length) fieldset.append(makeElement('p', { className: 'objective-editor-muted', text: '評価基準はまだありません。判断利用にはVariable参照が必要です。' }));
  criteria.forEach((criterion, index) => {
    const row = makeElement('div', { className: 'objective-editor-criterion-row' });
    const variableRef = criterion?.variableRef ?? {};
    const variableId = field('Variable ID', `criteria.${index}.variable_id`, variableRef.id ?? '', { attrs: { required: true } });
    const variableRevision = field('Variable版', `criteria.${index}.variable_revision`, variableRef.revision ?? '', { attrs: { required: true } });
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

function collectDefinition(form, baseDraft) {
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
    if (!variableIdInput.value.trim() && !variableRevision) continue;
    const criterion = {
      variableRef: { id: variableIdInput.value.trim(), type: 'variable', revision: variableRevision },
      operator,
    };
    if (target !== undefined) criterion.target = target;
    draft.criteria.push(criterion);
  }
  return draft;
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
    makeElement('p', { className: 'objective-editor-muted', text: '入力はFoundationRevisionStoreへ渡す定義の編集です。組織の権限判定はホストのportが担当します。' }),
  );
  if (state.save.state !== 'idle' && state.save.state !== 'saving') section.append(statusNotice(state.save, { onRetry: callbacks.onRetrySave }));
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
  form.append(renderCriteria(root, draft, callbacks));
  form.append(renderReadiness(root, state.readiness));
  form.append(renderConstraintRefs(root, state, callbacks));
  const actions = makeElement('div', { className: 'objective-editor-actions' });
  actions.append(makeElement('span', { className: 'objective-editor-muted', text: callbacks.canEdit ? '保存後に同じID・新版を再取得して確認します。' : '読み取り専用です。書込み権限はホストから提供してください。' }));
  if (callbacks.canEdit) actions.append(makeElement('button', { className: 'objective-editor-button-primary', text: state.save.state === 'saving' ? '保存中…' : '保存', attrs: { type: 'submit' }, disabled: state.save.state === 'saving' }));
  actions.append(makeButton('一覧へ戻る', callbacks.onBack, 'objective-editor-button-secondary'));
  form.append(actions);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    callbacks.onSubmit?.(collectDefinition(form, draft));
  });
  section.append(form);
  return section;
}

function renderStoryLinks(root, state, callbacks) {
  const section = makeElement('section', { className: 'objective-editor-panel', attrs: { 'aria-label': 'StoryからObjectiveを参照' } });
  append(section,
    makeElement('div', { className: 'objective-editor-panel-heading', text: 'StoryからObjectiveを参照' }),
    makeElement('p', { className: 'objective-editor-muted', text: 'Story本文を複製せず、既存のtyped relationとObjectiveの版を表示します。' }),
  );
  const form = makeElement('form', { className: 'objective-editor-inline-form' });
  const storyField = field('Story ID', 'story_id', state.story.storyId ?? '', { attrs: { required: true, placeholder: 'story-...' } });
  form.append(storyField.label, makeElement('button', { className: 'objective-editor-button-secondary', text: '参照を取得', attrs: { type: 'submit' } }));
  form.addEventListener('submit', (event) => { event.preventDefault(); callbacks.onLoadStoryLinks?.(storyField.input.value.trim()); });
  section.append(form);
  if (state.story.state === 'loading') section.append(makeElement('p', { className: 'objective-editor-muted', text: 'Storyの関係を読み込んでいます。' }));
  else if (['permission_denied', 'api_unavailable', 'error_retryable', 'unknown'].includes(state.story.state)) section.append(statusNotice(state.story, { onRetry: callbacks.onRetryStory }));
  else if (state.story.state === 'empty') section.append(makeElement('p', { className: 'objective-editor-empty', text: 'このStoryから参照されるObjectiveはありません。' }));
  else if (state.story.links) {
    const list = makeElement('ul', { className: 'objective-editor-link-list' });
    for (const link of state.story.links) {
      const item = makeElement('li', { className: 'objective-editor-link-item' });
      append(item,
        statusBadge(link.relation, link.relationLabel),
        makeElement('strong', { text: `${link.objective.id}@${link.objective.revision}` }),
        makeElement('span', { text: text(link.objective.meaning, 'Objectiveの意味 未確認') }),
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
    makeElement('div', { className: 'objective-editor-eyebrow', text: 'BRAINBASE / COMPANY OS' }),
    makeElement('h1', { text: '目的と評価基準' }),
    makeElement('p', { text: '世界の認識やStoryとは分けたObjectiveの正本を、版付きで編集・確認します。' }),
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
 */
export function createObjectiveEditorController(options = {}) {
  const root = options.root ?? null;
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
    connectionMessage: port ? null : 'ObjectiveEditorPortが提供されていません。組織サービスやDBへ直接接続しません。',
    objectives: { state: 'idle', records: null, absence_confirmed: false },
    selected: null,
    readiness: { state: 'unknown', ready: null, issues: null },
    constraints: { state: 'idle', refs: null, absence_confirmed: false },
    story: { state: 'idle', storyId: '', links: null, absence_confirmed: false },
    editor: { state: 'idle', mode: 'edit', draft: null, expectedRevision: null, constraintRefs: null, originalConstraintRefs: null, constraintRefsChanged: false },
    save: { state: 'idle' },
  };

  function render() {
    if (!root) return null;
    return renderObjectiveEditor(root, state, {
      canEdit,
      constraintsEditable,
      storyLinks,
      onView: (view) => { state.view = view; render(); },
      onReload: loadObjectives,
      onCreate: beginCreate,
      onSelect: selectObjective,
      onBack: () => { state.view = 'list'; render(); },
      onSubmit: saveObjective,
      onRetrySave: () => state.editor.mode === 'create' ? saveObjective(state.editor.draft) : saveObjective(state.editor.draft),
      onAddCriterion: () => { state.editor.draft.criteria = [...(state.editor.draft.criteria ?? []), { variableRef: { id: '', type: 'variable', revision: '' }, operator: 'equals' }]; render(); },
      onRemoveCriterion: (index) => { state.editor.draft.criteria = (state.editor.draft.criteria ?? []).filter((_, itemIndex) => itemIndex !== index); render(); },
      onAddConstraintRef: addConstraintRef,
      onRemoveConstraintRef: removeConstraintRef,
      onReloadConstraints: () => loadConstraintRefs(state.selected),
      onLoadStoryLinks: loadStoryLinks,
      onRetryStory: () => loadStoryLinks(state.story.storyId),
    });
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
    state.objectives = { state: 'loading', records: null, absence_confirmed: false };
    state.connection = port ? 'ready' : 'api_unavailable';
    render();
    const method = portMethod(port, 'listObjectives');
    if (!method) {
      state.objectives = { state: 'api_unavailable', records: null, absence_confirmed: false, message: '目的一覧APIが未提供です。' };
      state.connection = 'api_unavailable';
      render();
      return state.objectives;
    }
    try {
      state.objectives = normalizeObjectiveCollection(await method(context));
      state.connection = state.objectives.state === 'ready' || state.objectives.state === 'empty' ? 'ready' : state.objectives.state;
    } catch (error) {
      state.objectives = { state: normalizeObjectiveError(error).state, records: null, absence_confirmed: false, ...normalizeObjectiveError(error) };
      state.connection = state.objectives.state;
    }
    render();
    return state.objectives;
  }

  async function loadConstraintRefs(objective) {
    state.constraints = { state: 'loading', refs: null, absence_confirmed: false };
    render();
    if (!objective) {
      state.constraints = { state: 'unknown', refs: null, absence_confirmed: false, message: 'Objectiveが未選択です。' };
      render();
      return state.constraints;
    }
    const method = portMethod(port, 'listObjectiveConstraintRefs') ?? portMethod(port, 'listConstraintReferences');
    if (!method) {
      state.constraints = { state: 'api_unavailable', refs: null, absence_confirmed: false, message: 'ObjectiveとConstraintの参照APIが未提供です。' };
      state.editor.constraintRefs = null;
      render();
      return state.constraints;
    }
    try {
      const payload = await method({ id: objective.id, type: 'objective', revision: objective.revision }, context);
      state.constraints = normalizeReferenceCollection(payload, ['refs', 'references', 'constraints', 'records', 'items', 'data']);
      if (state.constraints.refs) {
        state.editor.constraintRefs = state.constraints.refs;
        state.editor.originalConstraintRefs = JSON.parse(JSON.stringify(state.constraints.refs));
        state.editor.constraintRefsChanged = false;
      }
    } catch (error) {
      state.constraints = { state: normalizeObjectiveError(error).state, refs: null, absence_confirmed: false, ...normalizeObjectiveError(error) };
    }
    render();
    return state.constraints;
  }

  async function loadReadiness(objective) {
    if (!objective) return state.readiness;
    const method = portMethod(port, 'checkObjectiveReadiness');
    if (!method) {
      state.readiness = { state: 'unknown', ready: null, issues: null, message: 'readiness APIが未提供です。' };
      render();
      return state.readiness;
    }
    try {
      state.readiness = normalizeReadiness(await method(objective.id, context, objective.revision));
    } catch (error) {
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
    state.view = 'editor';
    state.editor = { state: 'loading', mode: 'edit', draft: null, expectedRevision: revision ?? null, constraintRefs: null, originalConstraintRefs: null, constraintRefsChanged: false };
    state.readiness = { state: 'unknown', ready: null, issues: null };
    state.constraints = { state: 'loading', refs: null, absence_confirmed: false };
    render();
    const method = portMethod(port, 'readObjective');
    if (!method) {
      state.editor = { ...state.editor, state: 'api_unavailable', message: 'Objective読取APIが未提供です。' };
      state.connection = 'api_unavailable';
      render();
      return null;
    }
    try {
      const payload = await method(id, context, revision);
      const objective = normalizeObjectiveRecord(payload);
      if (!objective) {
        state.editor = { ...state.editor, state: 'missing', message: '指定したObjectiveを正本から確認できません。' };
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
      const normalized = normalizeObjectiveError(error);
      state.editor = { ...state.editor, state: normalized.state, message: normalized.message, error: normalized.error };
      state.connection = normalized.state;
      render();
      return null;
    }
  }

  function beginCreate() {
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

  function addConstraintRef(reference) {
    if (!constraintsEditable) return;
    const normalized = normalizeReference(reference, 'constraint');
    if (!normalized || normalized.type !== 'constraint') return;
    const refs = state.editor.constraintRefs ?? [];
    if (refs.some((item) => item.id === normalized.id && item.revision === normalized.revision)) return;
    state.editor.constraintRefs = [...refs, normalized];
    state.editor.constraintRefsChanged = true;
    render();
  }

  function removeConstraintRef(reference) {
    if (!constraintsEditable) return;
    state.editor.constraintRefs = (state.editor.constraintRefs ?? []).filter((item) => !(item.id === reference.id && item.revision === reference.revision));
    state.editor.constraintRefsChanged = true;
    render();
  }

  async function saveObjective(definition) {
    if (!definition) return null;
    const mode = state.editor.mode;
    const updateMethod = mode === 'create' ? null : portMethod(port, 'updateObjective');
    const createMethod = mode === 'create' ? portMethod(port, 'createObjective') : null;
    if ((mode === 'create' && !createMethod) || (mode !== 'create' && !updateMethod)) {
      state.save = { state: 'api_unavailable', message: 'Objectiveの保存APIが未提供です。' };
      render();
      return state.save;
    }
    if (state.editor.constraintRefsChanged && !portMethod(port, 'replaceObjectiveConstraintRefs')) {
      state.save = { state: 'api_unavailable', message: 'Constraint参照の保存APIが未提供のため、目的本文も保存していません。' };
      render();
      return state.save;
    }
    state.editor.draft = definition;
    state.save = { state: 'saving', action: mode };
    render();
    try {
      const mutation = mode === 'create'
        ? await createMethod(definition, context)
        : await updateMethod(definition.id, state.editor.expectedRevision, definition, context);
      const savedRef = extractMutationRef(mutation);
      if (!savedRef || savedRef.id !== definition.id || savedRef.type !== 'objective' || !savedRef.revision) {
        state.save = { state: 'saved_unverified', message: '保存応答にObjectiveの同じID・新版が含まれていません。', mutation };
        render();
        return state.save;
      }
      const expectedRevision = state.editor.expectedRevision;
      if (mode !== 'create' && (!expectedRevision || savedRef.revision === expectedRevision)) {
        state.save = {
          state: 'saved_unverified',
          message: '更新応答にexpectedRevisionとは異なる新版が含まれていません。',
          mutation,
          expectedRevision,
          reference: savedRef,
        };
        render();
        return state.save;
      }
      const readMethod = portMethod(port, 'readObjective');
      const readback = readMethod ? normalizeObjectiveRecord(await readMethod(savedRef.id, context, savedRef.revision)) : null;
      const returnedDefinition = readback ? { id: readback.id, type: readback.type, revision: readback.revision, digest: readback.digest } : null;
      const referenceMatches = definitionsEqual(savedRef, returnedDefinition);
      if (!referenceMatches || !readback || (mode !== 'create' && (!expectedRevision || readback.revision === expectedRevision))) {
        state.save = { state: 'saved_unverified', message: '保存応答後の同じID・新版のreadbackを確認できません。', mutation, readback };
        render();
        return state.save;
      }
      if (state.editor.constraintRefsChanged) {
        const replaceRefs = portMethod(port, 'replaceObjectiveConstraintRefs');
        await replaceRefs(savedRef, state.editor.constraintRefs ?? [], context);
        const readConstraintRefs = portMethod(port, 'listObjectiveConstraintRefs') ?? portMethod(port, 'listConstraintReferences');
        const constraintPayload = readConstraintRefs
          ? await readConstraintRefs(savedRef, context)
          : null;
        const verifiedRefs = normalizeReferenceCollection(constraintPayload).refs;
        if (!verifiedRefs || !referencesEqual(verifiedRefs, state.editor.constraintRefs)) {
          state.save = { state: 'saved_unverified', message: 'Objectiveは保存されましたが、Constraint参照のreadbackが一致しません。', mutation, readback, constraintRefs: verifiedRefs };
          render();
          return state.save;
        }
      }
      state.selected = readback;
      state.editor = {
        state: 'ready', mode: 'edit', draft: editorDraftFromObjective(readback), expectedRevision: readback.revision,
        constraintRefs: state.editor.constraintRefs ?? [], originalConstraintRefs: state.editor.constraintRefs ?? [], constraintRefsChanged: false,
      };
      state.save = { state: 'verified', action: mode, reference: savedRef, readback };
      state.connection = 'ready';
      // Readiness belongs to a revision; re-read it for the one just saved.
      state.readiness = { state: 'unknown', ready: null, issues: null };
      render();
      await loadReadiness(readback);
      await loadObjectives();
      return state.save;
    } catch (error) {
      const normalized = normalizeObjectiveError(error);
      state.save = { state: normalized.state, message: normalized.message, currentRevision: normalized.currentRevision, error: normalized.error, draft: definition };
      render();
      return state.save;
    }
  }

  async function loadStoryLinks(storyId) {
    state.view = 'story';
    state.story = { state: 'loading', storyId: storyId ?? '', links: null, absence_confirmed: false };
    render();
    const method = portMethod(port, 'listStoryObjectiveLinks');
    if (!method) {
      state.story = { state: 'api_unavailable', storyId, links: null, absence_confirmed: false, message: 'Story→Objective relation APIが未提供です。' };
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
    contractVersion: OBJECTIVE_EDITOR_CONTRACT_VERSION,
  };
  render();
  if (options.autoLoad !== false) void loadObjectives();
  return controller;
}

export const createObjectiveEditorModule = createObjectiveEditorController;
export default createObjectiveEditorController;
