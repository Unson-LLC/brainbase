/*
 * Brainbase knowledge outcome surface.
 *
 * This file is intentionally independent from app.js.  The host application
 * provides the same-origin API functions and project/session context; this
 * module owns only the knowledge workflow's DOM and local state.  Every
 * mutation is followed by an explicit readback check before it is labelled
 * verified.
 */

const UNKNOWN = '未確認';
const EMPTY = 'empty';
const READY = 'ready';
const KNOWLEDGE_RELATION_TYPES = Object.freeze([
  ['related_to', '関連する'],
  ['references', '参照する'],
  ['depends_on', '依存する'],
  ['derived_from', '派生元'],
  ['supersedes', '置き換える'],
  ['applies_to', '適用する'],
  ['evidenced_by', '根拠とする'],
]);

export const KNOWLEDGE_STORY_IDS = Object.freeze([
  'story-brainbase-outcome-knowledge-discovery',
  'story-brainbase-outcome-knowledge-capture',
  'story-brainbase-outcome-knowledge-canonical-save',
  'story-brainbase-outcome-knowledge-lifecycle',
  'story-brainbase-outcome-knowledge-codex-use',
  'story-brainbase-outcome-knowledge-preview',
]);

export const KNOWLEDGE_ROUTES = Object.freeze({
  foundation: 'foundation',
  items: 'items',
  drafts: 'drafts',
  captureProposal: 'capture/proposal',
  lifecycle: 'lifecycle',
  supersessions: 'supersessions',
  history: 'history',
  preview: 'preview',
  documentSourceRegistration: 'document-source-registration',
});

const STATE_LABELS = Object.freeze({
  loading: '読み込み中',
  ready: '取得済み',
  results: '検索結果',
  empty: '該当なし',
  permission_denied: '権限不足',
  forbidden: '権限不足',
  error_retryable: '取得失敗',
  error: '取得失敗',
  unknown: '確認できません',
  draft: '下書き',
  candidate: '未確定候補',
  saving: '保存中',
  saved_unverified: '保存済み・未確認',
  verified: '正本と一致',
  conflict: '版の競合',
  unregistered: '未登録',
  stale: '旧版',
  isolated: '隔離実行',
});

const TYPE_LABELS = Object.freeze({
  fact: '事実',
  decision: '判断',
  principle: '原則',
  procedure: '手順',
  term: '用語',
  policy: '方針',
});

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

function text(value, fallback = UNKNOWN) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function optionalText(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : null;
}

function typeLabel(value) {
  const normalized = optionalText(value).toLowerCase();
  return TYPE_LABELS[normalized] ?? text(value);
}

function stateLabel(value) {
  return STATE_LABELS[value] ?? (value ? text(value) : UNKNOWN);
}

function normaliseStatus(value) {
  const status = optionalText(value).toLowerCase();
  if (['permission_denied', 'forbidden', 'permission_insufficient', 'not_allowed'].includes(status)) return 'permission_denied';
  if (['loading', 'ready', 'results', 'empty', 'error_retryable', 'error', 'unknown'].includes(status)) return status;
  if (['saved', 'persisted', 'saved_unverified'].includes(status)) return 'saved_unverified';
  if (['verified', 'readback_verified', 'committed_verified'].includes(status)) return 'verified';
  if (['candidate', 'draft'].includes(status)) return status;
  if (['conflict', 'version_conflict'].includes(status)) return 'conflict';
  return status || 'unknown';
}

function safeHref(value) {
  const candidate = optionalText(value).trim();
  return /^https?:\/\//i.test(candidate) ? candidate : null;
}

function displayDateTime(value) {
  const candidate = optionalText(value).trim();
  if (!candidate) return UNKNOWN;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? candidate : date.toLocaleString('ja-JP');
}

export function toLocalDateTimeValue(value) {
  const candidate = optionalText(value).trim();
  if (!candidate) return '';
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalDateTimeValue(value, originalValue = null) {
  const candidate = optionalText(value).trim();
  if (!candidate) return null;
  if (candidate === toLocalDateTimeValue(originalValue)) return originalValue;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function fieldValue(source, ...keys) {
  for (const key of keys) {
    if (source && Object.hasOwn(source, key) && source[key] !== null && source[key] !== undefined) return source[key];
  }
  return undefined;
}

function ownerValue(owner) {
  if (typeof owner === 'string') return owner;
  if (!owner || typeof owner !== 'object') return UNKNOWN;
  return text(fieldValue(owner, 'name', 'display_name', 'label', 'id'));
}

function sourceState(source) {
  const value = optionalText(fieldValue(source, 'content_state', 'contentState', 'state')).toLowerCase();
  if (['fetched', 'retrieved', 'available', 'present'].includes(value)) return 'fetched';
  if (['pointer_only', 'pointer-only', 'reference_only'].includes(value)) return 'pointer_only';
  return value || 'unknown';
}

function sourceLabel(source) {
  if (!source || typeof source !== 'object') return UNKNOWN;
  return text(fieldValue(source, 'kind', 'label', 'type', 'name'));
}

export function renderKnowledgeDestination(root, model = {}, callbacks = {}) {
  clear(root);
  const section = makeElement('section', { className: 'knowledge-destination' });
  section.append(makeElement('h3', { text: '知識文書の保存先' }));
  const registration = model.registration && typeof model.registration === 'object' ? model.registration : null;
  if (registration) {
    section.append(makeElement('p', {
      className: 'knowledge-inline-status',
      text: `現在の登録: ${text(registration.repository_owner)} / ${text(registration.repository_name)} / ${text(registration.branch)} / ${text(registration.path_scope)}`,
    }));
  } else if (model.state === 'unregistered') {
    section.append(makeElement('p', { className: 'knowledge-notice warning', text: '保存先は未登録です。リポジトリ、ブランチ、保存範囲を確認して登録してください。', attrs: { role: 'status' } }));
  } else if (model.state === 'loading') {
    section.append(makeElement('p', { className: 'knowledge-inline-status', text: '保存先を読み込んでいます。', attrs: { role: 'status' } }));
  }
  if (model.state === 'conflict') {
    section.append(statusNotice({ state: 'conflict', detail: model.message || '別の変更が先に保存されました。入力は保持しています。' }, { retry: Boolean(callbacks.onReload), onRetry: callbacks.onReload }));
  } else if (['permission_denied', 'error_retryable', 'unknown'].includes(model.state)) {
    section.append(statusNotice(model, { retry: Boolean(callbacks.onReload), onRetry: callbacks.onReload }));
  } else if (model.state === 'verified') {
    section.append(makeElement('p', { className: 'knowledge-success-copy', text: '登録内容を再取得し、保存先と版が一致しました。', attrs: { role: 'status' } }));
  }
  if (!callbacks.canEdit) { root.append(section); return section; }
  const draft = model.draft && typeof model.draft === 'object' && Object.keys(model.draft).length
    ? model.draft
    : registration ?? {};
  const form = makeElement('form', { className: 'knowledge-destination-form' });
  const controls = {};
  for (const [name, labelText, placeholder] of [
    ['repository_owner', 'リポジトリ所有者', '例: Unson-LLC'],
    ['repository_name', 'リポジトリ名', '確認済みの名前を入力'],
    ['branch', 'ブランチ', '既定値は自動入力しません'],
    ['path_scope', '保存範囲', 'リポジトリ相対パス'],
  ]) {
    const label = makeElement('label', { className: 'knowledge-field' });
    label.append(makeElement('span', { text: labelText }));
    const input = makeElement('input', { className: 'knowledge-control', value: draft[name] ?? '', attrs: { name, maxlength: '240', required: 'required', placeholder } });
    controls[name] = input; label.append(input); form.append(label);
  }
  const submit = makeElement('button', { className: 'knowledge-button primary', text: model.state === 'saving' ? '保存中…' : registration ? '保存先を変更' : '保存先を登録', attrs: { type: 'submit' }, disabled: model.state === 'saving' });
  form.append(submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    callbacks.onSave?.({
      repository_owner: controls.repository_owner.value,
      repository_name: controls.repository_name.value,
      branch: controls.branch.value,
      path_scope: controls.path_scope.value,
      expected_revision: model.revision ?? registration?.revision ?? null,
    });
  });
  section.append(form); root.append(section); return section;
}

function sourcePointer(source) {
  if (!source || typeof source !== 'object') return null;
  return fieldValue(source, 'pointer', 'url', 'ref', 'reference', 'path');
}

function normaliseSource(source) {
  if (!source || typeof source !== 'object') return { state: 'unknown', kind: UNKNOWN, pointer: null, refs: null };
  const refs = asArray(fieldValue(source, 'refs', 'references', 'evidence_refs', 'evidenceRefs'));
  return {
    state: sourceState(source),
    kind: sourceLabel(source),
    pointer: sourcePointer(source),
    refs,
    excerpt: fieldValue(source, 'excerpt', 'quote', 'text'),
  };
}

function normaliseApplicability(value) {
  if (!value || typeof value !== 'object') return { state: 'unknown', conditions: null };
  const state = optionalText(fieldValue(value, 'state', 'status')).toLowerCase();
  return {
    state: state || 'unknown',
    conditions: fieldValue(value, 'conditions', 'when', 'description'),
    project: fieldValue(value, 'project', 'project_code', 'projectCode'),
  };
}

function normaliseLifecycle(item) {
  const lifecycle = item?.lifecycle && typeof item.lifecycle === 'object' ? item.lifecycle : {};
  return {
    status: text(fieldValue(lifecycle, 'status') ?? fieldValue(item, 'status'), UNKNOWN),
    applicable: fieldValue(lifecycle, 'applicable', 'is_applicable'),
    effective_at: fieldValue(lifecycle, 'effective_at', 'effectiveAt'),
    expires_at: fieldValue(lifecycle, 'expires_at', 'expiresAt'),
  };
}

export function normalizeKnowledgeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const source = normaliseSource(fieldValue(item, 'source', 'provenance'));
  const applicability = normaliseApplicability(fieldValue(item, 'applicability', 'applicable_when'));
  const relations = asArray(fieldValue(item, 'relations', 'related', 'edges'));
  const version = fieldValue(item, 'version', 'revision', 'revision_number');
  return {
    id: fieldValue(item, 'id', 'knowledge_id', 'canonical_id') ?? null,
    type: fieldValue(item, 'type', 'kind', 'entity_type') ?? null,
    title: fieldValue(item, 'title', 'name', 'subject') ?? null,
    summary: fieldValue(item, 'summary', 'statement', 'body') ?? null,
    content: fieldValue(item, 'content', 'canonical_content') ?? null,
    scope: fieldValue(item, 'scope', 'visibility') ?? null,
    owner: fieldValue(item, 'owner', 'responsible', 'owner_id', 'owner_person_id') ?? null,
    source,
    applicability,
    lifecycle: normaliseLifecycle(item),
    version: (typeof version === 'string' && version.trim()) || Number.isFinite(version) ? version : null,
    updated_at: fieldValue(item, 'updated_at', 'updatedAt', 'modified_at') ?? null,
    relations,
    usage: fieldValue(item, 'usage', 'codex_usage', 'answer_evidence') ?? null,
    raw: item,
  };
}

export function normalizeKnowledgeCollection(payload) {
  const body = payload && typeof payload === 'object' ? (payload.data && typeof payload.data === 'object' ? payload.data : payload) : {};
  const recordsValue = fieldValue(body, 'records', 'items', 'results');
  const explicitState = normaliseStatus(fieldValue(body, 'state', 'status'));
  const absenceConfirmed = body.absence_confirmed === true;
  const records = Array.isArray(recordsValue) ? recordsValue.map(normalizeKnowledgeItem).filter(Boolean) : null;
  let state = explicitState;
  if (records === null) state = explicitState === EMPTY ? EMPTY : explicitState === 'permission_denied' ? 'permission_denied' : 'unknown';
  else if (records.length > 0) state = READY;
  else state = explicitState === EMPTY || absenceConfirmed ? EMPTY : 'unknown';
  return {
    state,
    records,
    absence_confirmed: absenceConfirmed,
    searched_scope: Array.isArray(body.searched_scope) ? body.searched_scope : null,
    query: fieldValue(body, 'query', 'q') ?? null,
    warnings: Array.isArray(body.warnings) ? body.warnings : null,
    raw: payload,
  };
}

function errorFromPayload(payload, status = null) {
  const source = payload && typeof payload === 'object' ? payload.error ?? payload : {};
  const code = optionalText(fieldValue(source, 'code', 'error_code', 'type')) || (status === 403 ? 'permission_denied' : 'unknown_upstream_error');
  const error = new Error(code);
  error.code = code;
  error.status = status ?? fieldValue(source, 'status', 'http_status');
  error.detail = fieldValue(source, 'message', 'detail', 'reason');
  return error;
}

async function unwrapResponse(response) {
  if (response && typeof response.json === 'function') {
    const payload = await response.json();
    if (response.ok === false) throw errorFromPayload(payload, response.status);
    return payload;
  }
  if (response && typeof response === 'object' && (response.ok === false || response.error)) throw errorFromPayload(response, response.status);
  return response;
}

export async function callKnowledgeApi(api, path, init = {}) {
  if (typeof api !== 'function') throw errorFromPayload({ code: 'api_unavailable' });
  try {
    return await unwrapResponse(await api(path, init));
  } catch (caught) {
    if (caught?.code) throw caught;
    const error = new Error(caught instanceof Error ? caught.message : String(caught));
    error.code = 'unknown_upstream_error';
    error.cause = caught;
    throw error;
  }
}

export function projectCodeOf(project) {
  const code = typeof project === 'string' ? project : fieldValue(project, 'code', 'project_code', 'projectCode');
  if (!optionalText(code).trim()) throw errorFromPayload({ code: 'project_context_missing' });
  return String(code).trim();
}

const DESTINATION_REGISTRATION_FIELDS = Object.freeze([
  'repository_owner',
  'repository_name',
  'branch',
  'path_scope',
]);

export function normalizeKnowledgeDestinationRegistration(payload, projectCode) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.status !== 'registered') return null;
  const registration = payload.registration;
  if (!registration || typeof registration !== 'object' || Array.isArray(registration)) return null;
  if (registration.project_code !== projectCode) return null;
  if (typeof registration.tenant_id !== 'string' || !registration.tenant_id.trim()) return null;
  if (registration.organization_id !== registration.tenant_id) return null;
  if (registration.source_class !== 'owning_repo' || registration.content_type !== 'team_document') return null;
  if (registration.registration_status !== 'active') return null;
  if (!Number.isInteger(registration.revision) || registration.revision < 1) return null;
  if (DESTINATION_REGISTRATION_FIELDS.some((field) => typeof registration[field] !== 'string' || !registration[field].trim())) return null;
  return registration;
}

export function knowledgePath(project, suffix = '') {
  const base = `/api/projects/${encodeURIComponent(projectCodeOf(project))}/knowledge`;
  return suffix ? `${base}/${suffix.replace(/^\/+/, '')}` : base;
}

export function buildKnowledgeItemsPath(project, filters = {}) {
  const query = new URLSearchParams();
  const q = optionalText(filters.q ?? filters.query).trim();
  const scope = optionalText(filters.scope).trim();
  const status = optionalText(filters.status).trim();
  if (q) query.set('q', q);
  if (scope) query.set('scope', scope);
  if (status) query.set('status', status);
  if (filters.limit !== undefined && filters.limit !== null) query.set('limit', String(filters.limit));
  const encoded = query.toString();
  return `${knowledgePath(project, KNOWLEDGE_ROUTES.items)}${encoded ? `?${encoded}` : ''}`;
}

function operationKey(name, id, version, body = {}) {
  const input = `${name}:${id ?? 'new'}:${version ?? 'unknown'}:${JSON.stringify(body)}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return `knowledge-${name}-${Math.abs(hash >>> 0).toString(16)}`;
}

function apiErrorText(error) {
  const code = optionalText(error?.code || error?.message) || 'unknown_upstream_error';
  const messages = {
    authentication_required: 'ログインが必要です。セッションを確認してください。',
    project_not_allowed: 'このプロジェクトを確認する権限がありません。',
    knowledge_project_not_accessible: 'このプロジェクトの知識を確認する権限がありません。',
    permission_denied: '知識の変更権限がありません。現在の役割では実行できません。',
    forbidden: '知識の変更権限がありません。現在の役割では実行できません。',
    version_conflict: '最新の版と競合しました。入力内容を残したまま、最新情報を再取得してください。',
    readback_mismatch: '保存後の正本確認が一致しませんでした。未完了として再確認してください。',
    upstream_unavailable: '知識APIに接続できません。入力を保持して再試行してください。',
    unknown_upstream_error: '知識APIの結果を確認できません。入力を保持して再試行してください。',
    api_unavailable: '知識APIが未接続です。接続を確認してください。',
    project_context_missing: 'プロジェクトが選択されていません。',
  };
  return messages[code] ?? `知識APIを確認できません（${code}）。入力を保持して再試行してください。`;
}

function isVersionConflict(error) {
  return ['version_conflict', 'knowledge_draft_revision_conflict', 'knowledge_lifecycle_version_conflict', 'knowledge_save_idempotency_conflict', 'knowledge_draft_not_editable'].includes(error?.code);
}

function statusNotice(model, options = {}) {
  const state = normaliseStatus(model?.state ?? model?.status);
  const noticeClass = ['permission_denied', 'error', 'error_retryable', 'conflict'].includes(state) ? 'knowledge-notice error' : state === 'unknown' ? 'knowledge-notice warning' : 'knowledge-notice';
  const notice = makeElement('div', { className: noticeClass, attrs: { role: ['permission_denied', 'error', 'error_retryable', 'conflict'].includes(state) ? 'alert' : 'status' } });
  const title = stateLabel(state);
  const detail = model?.message || model?.error || model?.reason;
  append(notice, makeElement('strong', { text: title }), makeElement('span', { text: detail || options.detail || '' }));
  if (options.retry && typeof options.onRetry === 'function') {
    const retry = makeElement('button', { className: 'knowledge-button secondary', text: '再試行', attrs: { type: 'button' } });
    retry.addEventListener('click', () => options.onRetry());
    notice.append(retry);
  }
  return notice;
}

function skeletonRow() {
  const row = makeElement('div', { className: 'knowledge-skeleton-row', attrs: { 'aria-hidden': 'true' } });
  append(row, makeElement('span', { className: 'knowledge-skeleton-line short' }), makeElement('span', { className: 'knowledge-skeleton-line' }), makeElement('span', { className: 'knowledge-skeleton-line tiny' }));
  return row;
}

function renderDefinitionList(parent, pairs) {
  const definition = makeElement('dl', { className: 'knowledge-definition' });
  for (const [term, value] of pairs) append(definition, makeElement('dt', { text: term }), makeElement('dd', { text: value }));
  parent.append(definition);
  return definition;
}

function renderSource(parent, source) {
  const section = makeElement('section', { className: 'knowledge-subsection' });
  append(section, makeElement('h4', { text: '出典' }));
  const pointer = safeHref(source?.pointer);
  const pointerNode = pointer
    ? makeElement('a', { className: 'knowledge-source-link', text: source.pointer, attrs: { href: pointer, target: '_blank', rel: 'noopener noreferrer' } })
    : makeElement('span', { className: 'knowledge-source-link', text: source?.pointer || UNKNOWN });
  append(section, renderDefinitionList(makeElement('div'), [
    ['種別', text(source?.kind)],
    ['本文', source?.state === 'fetched' ? '取得済み' : source?.state === 'pointer_only' ? '参照先のみ（本文未取得）' : '本文取得状態未確認'],
  ]));
  const pointerRow = makeElement('p', { className: 'knowledge-source-pointer' });
  append(pointerRow, makeElement('strong', { text: '参照先: ' }), pointerNode);
  section.append(pointerRow);
  if (source?.state === 'fetched' && source.excerpt) append(section, makeElement('p', { className: 'knowledge-long-text', text: source.excerpt }));
  if (Array.isArray(source?.refs) && source.refs.length) {
    const refs = makeElement('ul', { className: 'knowledge-reference-list' });
    for (const ref of source.refs) append(refs, makeElement('li', { text: typeof ref === 'string' ? ref : text(ref?.id ?? ref?.pointer ?? ref?.url) }));
    section.append(refs);
  }
  parent.append(section);
  return section;
}

export function renderDiscoveryFilters(root, filters = {}, callbacks = {}) {
  clear(root);
  const form = makeElement('form', { className: 'knowledge-filters', attrs: { 'aria-label': '知識を探す条件' } });
  const queryLabel = makeElement('label', { text: 'キーワード' });
  const query = makeElement('input', { className: 'knowledge-control', value: filters.q ?? filters.query ?? '', attrs: { type: 'search', name: 'q', maxlength: '200', placeholder: 'タイトル・要旨を検索' } });
  queryLabel.append(query);
  const scopeLabel = makeElement('label', { text: '範囲' });
  const scope = makeElement('select', { className: 'knowledge-control', attrs: { name: 'scope' } });
  for (const [value, label] of [['project', 'このプロジェクト'], ['organization', '組織から継承'], ['all', '両方']]) append(scope, makeElement('option', { text: label, value, attrs: { value, ...(filters.scope === value ? { selected: 'selected' } : {}) } }));
  scope.value = filters.scope || 'all';
  scopeLabel.append(scope);
  const statusLabel = makeElement('label', { text: '状態' });
  const status = makeElement('select', { className: 'knowledge-control', attrs: { name: 'status' } });
  for (const [value, label] of [['active', '有効'], ['inactive', '失効を含む'], ['all', 'すべて']]) append(status, makeElement('option', { text: label, value, attrs: { value, ...(filters.status === value ? { selected: 'selected' } : {}) } }));
  status.value = filters.status || 'active';
  statusLabel.append(status);
  const submit = makeElement('button', { className: 'knowledge-button primary', text: '探す', attrs: { type: 'submit' } });
  const reset = makeElement('button', { className: 'knowledge-button secondary', text: '条件をクリア', attrs: { type: 'button' } });
  append(form, queryLabel, scopeLabel, statusLabel, makeElement('div', { className: 'knowledge-filter-actions' }));
  form.lastChild.append(submit, reset);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    callbacks.onChange?.({ q: query.value.trim(), scope: scope.value, status: status.value });
  });
  reset.addEventListener('click', () => {
    query.value = '';
    scope.value = 'all';
    status.value = 'active';
    callbacks.onChange?.({ q: '', scope: 'all', status: 'active' });
  });
  root.append(form);
  return form;
}

export function renderKnowledgeList(root, model = {}, callbacks = {}) {
  clear(root);
  const collection = model.records === undefined && (model.items || model.results || model.state) ? normalizeKnowledgeCollection(model) : model;
  const section = makeElement('section', { className: 'knowledge-list-panel', attrs: { 'aria-labelledby': 'knowledge-list-title' } });
  const header = makeElement('div', { className: 'knowledge-panel-head' });
  append(header, makeElement('div', {},), makeElement('span', { className: 'knowledge-count', text: Array.isArray(collection.records) ? `${collection.records.length}件` : UNKNOWN }));
  header.firstChild.append(makeElement('h3', { text: '知識・判断', attrs: { id: 'knowledge-list-title' } }), makeElement('p', { text: collection.searched_scope ? `検索範囲: ${collection.searched_scope.join(' / ')}` : '検索範囲: 未確認' }));
  section.append(header);
  const state = normaliseStatus(collection.state);
  if (state === 'loading') {
    const skeleton = makeElement('div', { className: 'knowledge-list-rows', attrs: { 'aria-label': '知識を読み込み中' } });
    for (let index = 0; index < 4; index += 1) skeleton.append(skeletonRow());
    section.append(skeleton);
  } else if (state === EMPTY) {
    section.append(makeElement('div', { className: 'knowledge-empty', text: 'この条件に一致する知識はありません。自然文から登録案を作成できます。' }));
  } else if (state === 'permission_denied') {
    section.append(statusNotice({ state, detail: '必要なプロジェクト権限を確認してください。' }, { retry: true, onRetry: callbacks.onRetry }));
  } else if (['error', 'error_retryable'].includes(state)) {
    section.append(statusNotice(collection, { retry: true, onRetry: callbacks.onRetry }));
  } else if (state === 'unknown' || !Array.isArray(collection.records)) {
    section.append(statusNotice({ state: 'unknown', detail: '結果の有無を確認できません。空の一覧とは扱いません。' }, { retry: true, onRetry: callbacks.onRetry }));
  } else {
    const rows = makeElement('div', { className: 'knowledge-list-rows' });
    if (!collection.records.length) rows.append(makeElement('div', { className: 'knowledge-empty', text: '検索結果を確認できません。空の一覧とは扱いません。' }));
    for (const item of collection.records) {
      const row = makeElement('button', { className: 'knowledge-list-row', attrs: { type: 'button', 'aria-pressed': String(item.id === callbacks.selectedId) } });
      const title = item.title ? text(item.title) : 'タイトル未確認';
      append(row,
        makeElement('span', { className: 'knowledge-row-title', text: title }),
        makeElement('span', { className: 'knowledge-row-type', text: item.type ? typeLabel(item.type) : UNKNOWN }),
        makeElement('span', { className: 'knowledge-row-scope', text: item.scope ? text(item.scope) : UNKNOWN }),
        makeElement('span', { className: 'knowledge-row-state', text: item.lifecycle.status !== UNKNOWN ? text(item.lifecycle.status) : UNKNOWN }),
      );
      row.addEventListener('click', () => callbacks.onSelect?.(item));
      rows.append(row);
    }
    section.append(rows);
  }
  root.append(section);
  return section;
}

export function renderKnowledgeDetail(root, item, callbacks = {}) {
  clear(root);
  const section = makeElement('section', { className: 'knowledge-detail-panel', attrs: { 'aria-labelledby': 'knowledge-detail-title' } });
  if (!item) {
    append(section, makeElement('h3', { text: '詳細', attrs: { id: 'knowledge-detail-title' } }), makeElement('p', { className: 'knowledge-detail-empty', text: '一覧から知識を選ぶと、由来・適用範囲・履歴を確認できます。' }));
    root.append(section);
    return section;
  }
  append(section,
    makeElement('span', { className: 'knowledge-eyebrow', text: item.type ? typeLabel(item.type) : UNKNOWN }),
    makeElement('h3', { text: item.title ? text(item.title) : 'タイトル未確認', attrs: { id: 'knowledge-detail-title' } }),
  );
  const summary = makeElement('p', { className: 'knowledge-long-text', text: item.summary ? text(item.summary) : '要旨未確認' });
  section.append(summary);
  renderDefinitionList(section, [
    ['正本ID', item.id ? text(item.id) : UNKNOWN],
    ['版', item.version !== null && item.version !== undefined && String(item.version).trim() !== '' ? String(item.version) : UNKNOWN],
    ['範囲', item.scope ? text(item.scope) : UNKNOWN],
    ['責任者', ownerValue(item.owner)],
    ['有効状態', item.lifecycle.status],
    ['適用', item.applicability.state ? text(item.applicability.state) : UNKNOWN],
    ['発効', displayDateTime(item.lifecycle.effective_at)],
    ['失効', displayDateTime(item.lifecycle.expires_at)],
    ['更新', displayDateTime(item.updated_at)],
  ]);
  const applicability = makeElement('section', { className: 'knowledge-subsection' });
  append(applicability, makeElement('h4', { text: '適用条件' }), makeElement('p', { className: 'knowledge-long-text', text: item.applicability.conditions ? text(item.applicability.conditions) : UNKNOWN }));
  section.append(applicability);
  renderSource(section, item.source);
  const relations = makeElement('section', { className: 'knowledge-subsection' });
  append(relations, makeElement('h4', { text: '関連先' }));
  if (Array.isArray(item.relations) && item.relations.length) {
    const list = makeElement('ul', { className: 'knowledge-reference-list' });
    for (const relation of item.relations) append(list, makeElement('li', { text: typeof relation === 'string' ? relation : text(relation?.id ?? relation?.target_id ?? relation?.type) }));
    relations.append(list);
  } else append(relations, makeElement('p', { text: item.relations === null ? '関連先を確認できません。' : '関連先は登録されていません。' }));
  section.append(relations);
  if (item.usage) renderCodexUseEvidence(section, item.usage);
  const actions = makeElement('div', { className: 'knowledge-detail-actions' });
  if (callbacks.onPreview) {
    const preview = makeElement('button', { className: 'knowledge-button secondary', text: 'この版を試験する', attrs: { type: 'button' } });
    preview.addEventListener('click', () => callbacks.onPreview(item));
    actions.append(preview);
  }
  section.append(actions);
  root.append(section);
  return section;
}

function formField(labelText, control, hint = '') {
  const label = makeElement('label', { className: 'knowledge-field', text: labelText });
  label.append(control);
  if (hint) label.append(makeElement('small', { text: hint }));
  return label;
}

export function renderDraftCapture(root, model = {}, callbacks = {}) {
  clear(root);
  const draft = model.draft ?? model;
  const section = makeElement('section', { className: 'knowledge-capture-panel', attrs: { 'aria-labelledby': 'knowledge-capture-title' } });
  append(section, makeElement('span', { className: 'knowledge-eyebrow', text: '登録案を作る' }), makeElement('h3', { text: '自然文から未確定候補を作成', attrs: { id: 'knowledge-capture-title' } }), makeElement('p', { text: '入力した文章や許可資料から提案を作ります。提案は確認が終わるまで正本へ保存されません。' }));
  const form = makeElement('form', { className: 'knowledge-capture-form', attrs: { 'aria-busy': ['loading', 'saving'].includes(normaliseStatus(draft.state)) ? 'true' : 'false' } });
  const resumeId = makeElement('input', { className: 'knowledge-control', value: draft.resume_id ?? '', attrs: { name: 'resume_id', maxlength: '200', placeholder: '保存済み下書きID' } });
  const resume = makeElement('button', { className: 'knowledge-button secondary', text: '下書きを再開', attrs: { type: 'button' } });
  resume.addEventListener('click', () => callbacks.onResume?.(resumeId.value.trim()));
  const resumeRow = makeElement('div', { className: 'knowledge-form-actions' });
  resumeRow.append(resume);
  const sourceText = optionalText(draft.input_text ?? draft.text ?? model.input_text);
  const input = makeElement('textarea', { className: 'knowledge-control knowledge-textarea', value: sourceText, attrs: { name: 'input_text', rows: '8', maxlength: '20000', required: 'required', placeholder: '例: 顧客への初回提案では、まず利用目的と判断期限を確認する。' } });
  const sourcePointerInput = makeElement('input', { className: 'knowledge-control', value: draft.source?.pointer ?? draft.source_pointer ?? '', attrs: { name: 'source_pointer', maxlength: '2048', placeholder: '許可された資料のURLまたはrepo相対参照（任意）' } });
  const sourceKindInput = makeElement('input', { className: 'knowledge-control', value: draft.source?.kind ?? draft.source_kind ?? '', attrs: { name: 'source_kind', maxlength: '120', placeholder: '資料種別（任意）' } });
  append(form,
    formField('保存済み下書きを再開', resumeId, '一覧APIはないため、保存時に表示された下書きIDを入力してください。'),
    resumeRow,
    formField('自然文', input, '資料中の命令は権限や保存操作として実行しません。'),
    formField('許可資料の参照先', sourcePointerInput, '本文取得済みとは限らないため、参照先と本文状態は別に表示します。'),
    formField('資料種別', sourceKindInput),
  );
  const savedId = draft.draft_id ?? draft.id;
  if (savedId) form.append(makeElement('p', { className: 'knowledge-inline-status', text: `保存済み下書きID: ${savedId}${draft.revision ?? draft.version ? ` / 版: ${draft.revision ?? draft.version}` : ''}` }));
  if (savedId && draft.resume_url) form.append(makeElement('a', { className: 'knowledge-button secondary', text: 'この下書きの再開リンク', attrs: { href: draft.resume_url } }));
  const actions = makeElement('div', { className: 'knowledge-form-actions' });
  const submit = makeElement('button', { className: 'knowledge-button primary', text: normaliseStatus(draft.state) === 'saving' ? 'AIで整理中…' : 'AIで整理', attrs: { type: 'submit' }, disabled: normaliseStatus(draft.state) === 'saving' });
  const discard = makeElement('button', { className: 'knowledge-button secondary', text: '入力を破棄', attrs: { type: 'button' } });
  discard.addEventListener('click', () => callbacks.onDiscard?.());
  actions.append(submit, discard);
  form.append(actions);
  if (['error', 'error_retryable', 'permission_denied', 'conflict', 'unknown'].includes(normaliseStatus(draft.state))) form.append(statusNotice({ state: draft.state, detail: draft.message || draft.error }, { retry: Boolean(callbacks.onRetry), onRetry: callbacks.onRetry }));
  if (draft.state === 'saving') form.append(makeElement('p', { className: 'knowledge-inline-status', text: '候補生成の応答を待っています。入力は保持されます。', attrs: { role: 'status' } }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
    callbacks.onSubmit?.({
      input_text: input.value,
      source: { pointer: sourcePointerInput.value.trim(), kind: sourceKindInput.value.trim() },
    });
  });
  section.append(form);
  root.append(section);
  return form;
}

function candidateShape(model) {
  const candidate = model?.candidate ?? model?.proposal ?? model?.draft?.candidate ?? model ?? {};
  return candidate && typeof candidate === 'object' ? candidate : {};
}

export function renderCandidateReview(root, model = {}, callbacks = {}) {
  clear(root);
  const candidate = candidateShape(model);
  const section = makeElement('section', { className: 'knowledge-review-panel', attrs: { 'aria-labelledby': 'knowledge-review-title' } });
  append(section, makeElement('span', { className: 'knowledge-eyebrow', text: '確認が必要です' }), makeElement('h3', { text: '未確定候補を確認', attrs: { id: 'knowledge-review-title' } }), makeElement('p', { text: '候補はAIの提案です。根拠のない責任者・事実を確定せず、原文と提案の差分を確認してください。' }));
  if (model.canonical === false || model.persisted === false || model.readback?.state === 'proposal_only') {
    section.append(makeElement('p', { className: 'knowledge-isolation-badge unknown', text: '未承認・未保存の提案' }));
  }
  const comparison = makeElement('div', { className: 'knowledge-comparison' });
  const original = makeElement('article', { className: 'knowledge-source-column' });
  append(original, makeElement('h4', { text: '入力原文' }), makeElement('p', { className: 'knowledge-long-text', text: text(model.input_text ?? model.source_text ?? model.draft?.input_text) }));
  const source = normaliseSource(model.source ?? candidate.source);
  renderSource(original, source);
  const proposal = makeElement('article', { className: 'knowledge-proposal-column' });
  append(proposal, makeElement('h4', { text: '提案（未確定）' }));
  const form = makeElement('form', { className: 'knowledge-review-form' });
  const proposalApplied = model.proposal_applied === true;
  const type = makeElement('select', { className: 'knowledge-control', attrs: { name: 'type', required: 'required' } });
  for (const [value, label] of [['fact', '事実'], ['decision', '判断'], ['principle', '原則'], ['procedure', '手順'], ['term', '用語'], ['policy', '方針']]) append(type, makeElement('option', { text: label, attrs: { value, ...(candidate.type === value ? { selected: 'selected' } : {}) } }));
  type.value = candidate.type ?? candidate.kind ?? '';
  const title = makeElement('input', { className: 'knowledge-control', value: candidate.title ?? '', attrs: { name: 'title', maxlength: '240', required: 'required' } });
  const summary = makeElement('textarea', { className: 'knowledge-control knowledge-textarea', value: candidate.summary ?? candidate.statement ?? '', attrs: { name: 'summary', rows: '5', maxlength: '10000', required: 'required' } });
  const scope = makeElement('select', { className: 'knowledge-control', attrs: { name: 'scope', required: 'required' } });
  for (const [value, label] of [['project', 'このプロジェクト'], ['organization', '組織共通']]) append(scope, makeElement('option', { text: label, attrs: { value, ...(candidate.scope === value ? { selected: 'selected' } : {}) } }));
  scope.value = candidate.scope ?? '';
  const decisionDomain = makeElement('select', { className: 'knowledge-control', attrs: { name: 'decision_domain', required: 'required' } });
  decisionDomain.append(makeElement('option', { text: '判断権限を選択', attrs: { value: '' } }));
  for (const domain of model.decision_domains ?? []) {
    const value = typeof domain === 'string' ? domain : domain?.id ?? domain?.domain;
    if (value) decisionDomain.append(makeElement('option', { text: typeof domain === 'string' ? domain : domain?.label ?? value, attrs: { value } }));
  }
  decisionDomain.value = candidate.decision_domain ?? '';
  const ownerCandidate = candidate.owner_candidate ?? null;
  const owner = makeElement('input', { className: 'knowledge-control', value: candidate.owner_id ?? (typeof candidate.owner === 'string' ? candidate.owner : candidate.owner?.id) ?? '', attrs: { name: 'owner_id', maxlength: '240', placeholder: '確認済みの責任者ID（未確認なら空欄）' } });
  const applicability = makeElement('textarea', { className: 'knowledge-control knowledge-textarea', value: candidate.applicability?.conditions ?? candidate.conditions ?? '', attrs: { name: 'applicability', rows: '4', maxlength: '6000', placeholder: 'どの場面で適用するか' } });
  const existingRelations = Array.isArray(candidate.relations) ? candidate.relations : [];
  const relationType = makeElement('select', { className: 'knowledge-control', attrs: { name: 'relation_type' } });
  relationType.append(makeElement('option', { text: '関係を選択', attrs: { value: '' } }));
  for (const [value, label] of KNOWLEDGE_RELATION_TYPES) relationType.append(makeElement('option', { text: label, attrs: { value } }));
  relationType.value = existingRelations.find((relation) => relation && typeof relation === 'object')?.relation ?? '';
  const relations = makeElement('input', { className: 'knowledge-control', value: existingRelations.map((relation) => typeof relation === 'object' ? relation.to_id ?? '' : '').filter(Boolean).join(', '), attrs: { name: 'relations', maxlength: '2000', placeholder: '関連先ID（カンマ区切り、任意）' } });
  append(form,
    formField('種別', type),
    formField('タイトル', title),
    formField('要旨', summary),
    formField('適用範囲', scope),
    formField('判断権限', decisionDomain, (model.decision_domains ?? []).length ? 'Graph RACIで確認できた権限だけを選べます。' : 'Graph RACIの判断権限を確認できません。'),
    formField('責任者', owner, ownerCandidate ? `AI候補: ${ownerCandidate}。確認後に入力してください。自動確定しません。` : '責任者候補は未確認です。推測で補完しません。'),
    formField('適用条件', applicability),
    formField('関係の意味', relationType, 'Ontologyで許可された関係だけを選べます。'),
    formField('関連先', relations),
  );
  const reuseLabel = makeElement('label', { className: 'knowledge-choice' });
  const reuse = makeElement('input', { attrs: { type: 'radio', name: 'selection', value: 'reuse', checked: 'checked' } });
  reuse.checked = model.selection === 'create' ? false : true;
  reuseLabel.append(reuse, makeElement('span', { text: '既存の正本候補を再利用' }));
  const createLabel = makeElement('label', { className: 'knowledge-choice' });
  const create = makeElement('input', { attrs: { type: 'radio', name: 'selection', value: 'create' } });
  create.checked = model.selection === 'create';
  createLabel.append(create, makeElement('span', { text: '別の正本項目として作成' }));
  const canonicalId = makeElement('input', { className: 'knowledge-control', value: candidate.canonical_id ?? model.canonical_id ?? '', attrs: { name: 'canonical_id', maxlength: '240', placeholder: '再利用する正本ID' } });
  const canonicalVersion = makeElement('input', { className: 'knowledge-control', value: candidate.canonical_version ?? candidate.expected_version ?? model.canonical_version ?? '', attrs: { name: 'canonical_version', maxlength: '240', placeholder: '再利用する正本の現在版' } });
  for (const control of [type, title, summary, scope, decisionDomain, owner, applicability, relationType, relations, reuse, create, canonicalId, canonicalVersion]) control.disabled = !proposalApplied;
  append(form, makeElement('fieldset', { className: 'knowledge-choice-group' }));
  form.lastChild.append(makeElement('legend', { text: '保存方法' }), reuseLabel, createLabel);
  form.append(formField('再利用する正本', canonicalId, '既存の正本候補を再利用する場合は正本IDが必要です。'));
  form.append(formField('再利用する正本の版', canonicalVersion, '並行更新を見逃さないよう、確認した現在版を指定します。'));
  const actions = makeElement('div', { className: 'knowledge-form-actions' });
  const apply = makeElement('button', { className: 'knowledge-button secondary', text: proposalApplied ? '入力欄へ反映済み' : '入力欄に反映', attrs: { type: 'button' }, disabled: proposalApplied || !callbacks.onApply });
  apply.addEventListener('click', () => callbacks.onApply?.());
  const save = makeElement('button', { className: 'knowledge-button secondary', text: '下書き保存', attrs: { type: 'submit' }, disabled: !proposalApplied || !callbacks.onSave });
  const commit = makeElement('button', { className: 'knowledge-button primary', text: '確認して正本へ保存', attrs: { type: 'button' }, disabled: !callbacks.onCommit });
  actions.append(apply, save, commit); form.append(actions);
  if (model.state && !['candidate', 'ready'].includes(normaliseStatus(model.state))) form.append(statusNotice(model, { retry: Boolean(callbacks.onRetry), onRetry: callbacks.onRetry }));
  const collect = () => ({
    type: type.value,
    title: title.value,
    summary: summary.value,
    scope: scope.value,
    decision_domain: decisionDomain.value,
    owner_id: owner.value.trim() || null,
    applicability: { conditions: applicability.value },
    relations: relations.value.split(',').map((value) => value.trim()).filter(Boolean).map((to_id) => ({ relation: relationType.value, to_id })),
    selection: create.checked ? 'create' : 'reuse',
    canonical_id: canonicalId.value.trim() || null,
    canonical_version: canonicalVersion.value.trim() || null,
  });
  const collectValid = () => {
    if (relations.value.trim() && !relationType.value) {
      relationType.setCustomValidity?.('関係の意味を選択してください。');
      form.reportValidity?.();
      return null;
    }
    relationType.setCustomValidity?.('');
    return collect();
  };
  form.addEventListener('submit', (event) => { event.preventDefault(); if (typeof form.reportValidity === 'function' && !form.reportValidity()) return; const values = collectValid(); if (values) callbacks.onSave?.(values); });
  commit.addEventListener('click', () => { const values = collectValid(); if (values) callbacks.onCommit?.(values); });
  proposal.append(form); comparison.append(original, proposal); section.append(comparison);
  const evidence = asArray(model.evidence);
  const exclusions = asArray(model.exclusions);
  if (evidence || exclusions) {
    const evidenceSection = makeElement('section', { className: 'knowledge-subsection' });
    append(evidenceSection, makeElement('h4', { text: '提案の根拠' }));
    if (evidence?.length) {
      const list = makeElement('ul', { className: 'knowledge-reference-list' });
      for (const entry of evidence) list.append(makeElement('li', { text: `${text(entry?.id ?? entry?.source_ref)} / 版 ${entry?.version ?? UNKNOWN}${entry?.source_ref ? ` / ${text(entry.source_ref)}` : ''}` }));
      evidenceSection.append(list);
    } else evidenceSection.append(makeElement('p', { className: 'knowledge-unknown-copy', text: '採用された根拠を確認できません。' }));
    if (exclusions?.length) {
      const list = makeElement('ul', { className: 'knowledge-reference-list' });
      for (const entry of exclusions) list.append(makeElement('li', { text: `除外: ${text(entry?.id)} / ${text(entry?.reason)}` }));
      evidenceSection.append(list);
    }
    section.append(evidenceSection);
  }
  root.append(section);
  return { form, collect };
}

export function renderCommitState(root, model = {}, callbacks = {}) {
  clear(root);
  const state = normaliseStatus(model.state ?? model.status);
  const section = makeElement('section', { className: `knowledge-commit-state ${state}`, attrs: { 'aria-labelledby': 'knowledge-commit-title' } });
  append(section, makeElement('h3', { text: '正本への保存', attrs: { id: 'knowledge-commit-title' } }), makeElement('p', { text: stateLabel(state) }));
  if (state === 'saving') section.append(makeElement('p', { className: 'knowledge-inline-status', text: '保存応答を受け取り、正本と関係を再取得しています。', attrs: { role: 'status' } }));
  else if (state === 'saved_unverified') {
    section.append(makeElement('p', { className: 'knowledge-warning-copy', text: '保存応答は受け取りましたが、正本のreadbackが一致していません。検索反映済みとは扱いません。' }));
    if (callbacks.onReadback) {
      const retry = makeElement('button', { className: 'knowledge-button secondary', text: '正本を再取得', attrs: { type: 'button' } });
      retry.addEventListener('click', () => callbacks.onReadback()); section.append(retry);
    }
  } else if (state === 'verified') section.append(makeElement('p', { className: 'knowledge-success-copy', text: '正本と関係のreadbackが一致しました。検索反映の状態は別に確認します。', attrs: { role: 'status' } }));
  else if (state === 'conflict') section.append(statusNotice({ state, detail: '最新の版を取得して差分を確認してください。' }, { retry: Boolean(callbacks.onReadback), onRetry: callbacks.onReadback }));
  else if (['error', 'error_retryable', 'permission_denied', 'unknown'].includes(state)) section.append(statusNotice(model, { retry: Boolean(callbacks.onReadback), onRetry: callbacks.onReadback }));
  renderDefinitionList(section, [
    ['正本ID', model.item_id ?? model.item?.id ?? UNKNOWN],
    ['版', model.version !== null && model.version !== undefined && String(model.version).trim() !== ''
      ? String(model.version)
      : model.item?.version !== null && model.item?.version !== undefined && String(model.item.version).trim() !== '' ? String(model.item.version) : UNKNOWN],
    ['検索反映', model.search_index_state ? stateLabel(model.search_index_state) : UNKNOWN],
  ]);
  root.append(section);
  return section;
}

export function renderLifecycle(root, item, callbacks = {}) {
  clear(root);
  const section = makeElement('section', { className: 'knowledge-lifecycle-panel', attrs: { 'aria-labelledby': 'knowledge-lifecycle-title' } });
  append(section, makeElement('h3', { text: '版と失効', attrs: { id: 'knowledge-lifecycle-title' } }), makeElement('p', { text: '改訂・置換・失効は履歴を残し、正本のreadback確認後に状態を更新します。' }));
  if (!item) { section.append(makeElement('p', { text: '対象の判断を選択してください。' })); root.append(section); return section; }
  renderDefinitionList(section, [['現在の版', item.version !== null && item.version !== undefined ? String(item.version) : UNKNOWN], ['状態', item.lifecycle?.status ?? UNKNOWN], ['正本ID', item.id ? text(item.id) : UNKNOWN]]);
  const canEdit = callbacks.canEdit !== false && (typeof callbacks.canEdit !== 'function' || callbacks.canEdit(item));
  const actions = makeElement('div', { className: 'knowledge-lifecycle-actions' });
  if (canEdit && callbacks.onRevision) {
    const revisionDraft = callbacks.revisionDraft && typeof callbacks.revisionDraft === 'object' ? callbacks.revisionDraft : null;
    const draftValue = (key, fallback) => revisionDraft && Object.prototype.hasOwnProperty.call(revisionDraft, key) ? revisionDraft[key] : fallback;
    const revisionDetails = makeElement('details', { className: 'knowledge-action-details' });
    const summary = makeElement('summary', { text: 'この判断を改訂' });
    const form = makeElement('form', { className: 'knowledge-lifecycle-form' });
    const title = makeElement('input', { className: 'knowledge-control', value: draftValue('title', item.title ?? ''), attrs: { name: 'title', maxlength: '240', required: 'required' } });
    const body = makeElement('textarea', { className: 'knowledge-control knowledge-textarea', value: draftValue('content', item.content ?? ''), attrs: { name: 'content', rows: '8', maxlength: '10000', required: 'required' } });
    const currentScope = draftValue('scope', item.scope ?? '');
    const scope = makeElement('select', { className: 'knowledge-control', attrs: { name: 'scope', required: 'required' } });
    append(scope, makeElement('option', { text: currentScope && !['project', 'organization'].includes(currentScope) ? `選択してください（現在値: ${currentScope}）` : '選択してください', attrs: { value: '' } }), ...[['project', 'このプロジェクト'], ['organization', '組織共通']].map(([value, label]) => makeElement('option', { text: label, attrs: { value } })));
    scope.value = ['project', 'organization'].includes(currentScope) ? currentScope : '';
    const ownerPersonId = makeElement('select', { className: 'knowledge-control', attrs: { name: 'owner_person_id', required: 'required' } });
    const currentOwnerId = typeof item.owner === 'object' ? item.owner?.id ?? item.owner?.person_id ?? '' : item.owner ?? '';
    const ownerCandidates = asArray(callbacks.ownerCandidates) ?? [];
    const availableOwners = [...ownerCandidates];
    if (currentOwnerId && !availableOwners.some((candidate) => candidate.id === currentOwnerId)) availableOwners.unshift({ id: currentOwnerId, name: ownerValue(item.owner) === currentOwnerId ? '現在の責任者（氏名未確認）' : ownerValue(item.owner) });
    append(ownerPersonId, makeElement('option', { text: '選択してください', attrs: { value: '' } }), ...availableOwners.map((candidate) => makeElement('option', { text: text(candidate.name, '氏名未確認'), attrs: { value: candidate.id } })));
    ownerPersonId.value = draftValue('owner_person_id', currentOwnerId) || '';
    const effectiveBaseline = draftValue('effective_at', item.lifecycle?.effective_at);
    const expiresBaseline = draftValue('expires_at', item.lifecycle?.expires_at);
    const effectiveAt = makeElement('input', { className: 'knowledge-control', value: toLocalDateTimeValue(effectiveBaseline), attrs: { name: 'effective_at', type: 'datetime-local' } });
    const expiresAt = makeElement('input', { className: 'knowledge-control', value: toLocalDateTimeValue(expiresBaseline), attrs: { name: 'expires_at', type: 'datetime-local' } });
    const reason = makeElement('textarea', { className: 'knowledge-control knowledge-textarea', value: draftValue('reason', ''), attrs: { name: 'reason', rows: '3', maxlength: '3000', required: 'required', placeholder: '変更理由' } });
    append(form, formField('タイトル', title), formField('本文', body), formField('適用範囲', scope), formField('責任者', ownerPersonId), formField('有効開始', effectiveAt), formField('有効期限', expiresAt), formField('変更理由', reason));
    const submit = makeElement('button', { className: 'knowledge-button primary', text: '改訂を保存', attrs: { type: 'submit' } });
    form.append(submit);
    form.addEventListener('submit', (event) => { event.preventDefault(); if (typeof form.reportValidity === 'function' && !form.reportValidity()) return; callbacks.onRevision?.({ title: title.value, content: body.value, scope: scope.value, owner_person_id: ownerPersonId.value, effective_at: fromLocalDateTimeValue(effectiveAt.value, effectiveBaseline), expires_at: fromLocalDateTimeValue(expiresAt.value, expiresBaseline), reason: reason.value, expected_version: item.version }); });
    revisionDetails.append(summary, form); actions.append(revisionDetails);
  }
  if (canEdit && callbacks.onSupersede) {
    const supersessionDraft = callbacks.supersessionDraft && typeof callbacks.supersessionDraft === 'object' ? callbacks.supersessionDraft : null;
    const candidates = (asArray(callbacks.supersessionCandidates) ?? []).filter((candidate) => candidate?.id && candidate.id !== item.id && candidate.version !== null);
    const supersedeDetails = makeElement('details', { className: 'knowledge-action-details' });
    const supersedeSummary = makeElement('summary', { text: 'この判断で古い判断を置換' });
    const form = makeElement('form', { className: 'knowledge-supersession-form' });
    const target = makeElement('select', { className: 'knowledge-control', attrs: { name: 'superseded_id', required: 'required' } });
    append(target, makeElement('option', { text: candidates.length ? '置換する判断を選択' : '検索結果に置換対象がありません', attrs: { value: '' } }), ...candidates.map((candidate) => makeElement('option', { text: `${text(candidate.title, 'タイトル未確認')}（版 ${candidate.version}）`, attrs: { value: candidate.id } })));
    target.value = supersessionDraft?.superseded_id ?? '';
    const effectiveBaseline = supersessionDraft?.effective_at ?? null;
    const effectiveAt = makeElement('input', { className: 'knowledge-control', value: toLocalDateTimeValue(effectiveBaseline), attrs: { name: 'effective_at', type: 'datetime-local', required: 'required' } });
    const reason = makeElement('textarea', { className: 'knowledge-control knowledge-textarea', value: supersessionDraft?.reason ?? '', attrs: { name: 'reason', rows: '3', maxlength: '3000', required: 'required', placeholder: '置換理由' } });
    append(form, makeElement('p', { text: '現在の検索結果から古い判断を選びます。置換後も履歴と根拠参照は保持されます。' }), formField('置換する判断', target), formField('置換の発効日時', effectiveAt), formField('置換理由', reason));
    const submit = makeElement('button', { className: 'knowledge-button primary', text: '置換を保存', attrs: { type: 'submit' }, disabled: candidates.length === 0 });
    form.append(submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
      const candidate = candidates.find((entry) => entry.id === target.value);
      if (!candidate) return;
      callbacks.onSupersede?.({ superseded_id: candidate.id, superseded_expected_version: candidate.version, replacement_expected_version: item.version, effective_at: fromLocalDateTimeValue(effectiveAt.value, effectiveBaseline), reason: reason.value });
    });
    supersedeDetails.append(supersedeSummary, form); actions.append(supersedeDetails);
  }
  if (canEdit && callbacks.onRetire) {
    const retireDetails = makeElement('details', { className: 'knowledge-action-details danger' });
    const summary = makeElement('summary', { text: 'この判断を失効' });
    const form = makeElement('form', { className: 'knowledge-lifecycle-form' });
    const reason = makeElement('textarea', { className: 'knowledge-control knowledge-textarea', attrs: { name: 'reason', rows: '3', maxlength: '3000', required: 'required', placeholder: '失効理由' } });
    append(form, makeElement('p', { text: '失効しても履歴と根拠参照は保持されます。正本自体を削除する操作ではありません。' }), formField('失効理由', reason));
    const submit = makeElement('button', { className: 'knowledge-button danger', text: '失効を確認', attrs: { type: 'submit' } });
    form.append(submit);
    form.addEventListener('submit', (event) => { event.preventDefault(); if (typeof form.reportValidity === 'function' && !form.reportValidity()) return; callbacks.onRetire?.({ reason: reason.value, expected_version: item.version }); });
    retireDetails.append(summary, form); actions.append(retireDetails);
  }
  if (!canEdit) actions.append(makeElement('p', { className: 'knowledge-permission-copy', text: '版の変更は、知識を管理する役割でのみ実行できます。' }));
  section.append(actions);
  const revisions = asArray(item.history ?? item.raw?.revisions ?? item.revisions);
  if (revisions) {
    const history = makeElement('section', { className: 'knowledge-subsection' });
    append(history, makeElement('h4', { text: '履歴' }));
    if (!revisions.length) history.append(makeElement('p', { text: '履歴は登録されていません。' }));
    else {
      const list = makeElement('ol', { className: 'knowledge-history-list' });
      for (const revision of revisions) append(list, makeElement('li', { text: `版 ${text(revision?.version)}: ${text(revision?.reason ?? revision?.change_reason)}` }));
      history.append(list);
    }
    section.append(history);
  } else section.append(makeElement('p', { className: 'knowledge-unknown-copy', text: '履歴を確認できません。' }));
  root.append(section);
  return section;
}

function renderResultEvidence(parent, result) {
  const row = makeElement('li', { className: 'knowledge-preview-result' });
  const item = normalizeKnowledgeItem(result?.item ?? result);
  const adopted = result?.adopted === true || result?.selected === true || result?.used === true;
  append(row,
    makeElement('strong', { text: item?.title ? text(item.title) : text(result?.id ?? result?.item_id) }),
    makeElement('span', { className: adopted ? 'knowledge-evidence-adopted' : 'knowledge-evidence-excluded', text: adopted ? '回答へ採用' : '除外' }),
    makeElement('span', { text: `版: ${item?.version ?? result?.version ?? UNKNOWN}` }),
  );
  if (!adopted && result?.excluded_reason) row.append(makeElement('p', { text: `除外理由: ${result.excluded_reason}` }));
  if (result?.evidence_ref || result?.evidence_refs) {
    const refs = Array.isArray(result.evidence_refs) ? result.evidence_refs : [result.evidence_ref];
    row.append(makeElement('p', { text: `取得根拠: ${refs.map((ref) => typeof ref === 'string' ? ref : text(ref?.id ?? ref?.pointer)).join(', ')}` }));
  }
  return row;
}

export function renderCodexUseEvidence(root, evidence) {
  const section = makeElement('section', { className: 'knowledge-use-evidence', attrs: { 'aria-labelledby': 'knowledge-use-evidence-title' } });
  append(section, makeElement('h4', { text: 'Codexでの利用', attrs: { id: 'knowledge-use-evidence-title' } }));
  if (!evidence || typeof evidence !== 'object') {
    section.append(makeElement('p', { className: 'knowledge-unknown-copy', text: '利用状況は未確認です。登録済みであることだけでは回答への採用を示しません。' }));
    root.append(section);
    return section;
  }
  const retrieval = evidence.retrieval ?? evidence.retrieval_state;
  const answer = evidence.answer ?? evidence.answer_state;
  renderDefinitionList(section, [['参照解決', retrieval ? stateLabel(normaliseStatus(retrieval)) : UNKNOWN], ['本文取得・採用', answer ? stateLabel(normaliseStatus(answer)) : UNKNOWN], ['回答証拠', evidence.evidence_id ?? evidence.receipt_id ?? UNKNOWN]]);
  if (evidence.reason) section.append(makeElement('p', { text: `理由: ${evidence.reason}` }));
  root.append(section);
  return section;
}

export function renderIsolatedPreview(root, model = {}, callbacks = {}) {
  clear(root);
  const preview = model.preview ?? model;
  const section = makeElement('section', { className: 'knowledge-preview-panel', attrs: { 'aria-labelledby': 'knowledge-preview-title' } });
  append(section, makeElement('span', { className: 'knowledge-eyebrow', text: '公開前テスト' }), makeElement('h3', { text: '隔離した質問試験', attrs: { id: 'knowledge-preview-title' } }), makeElement('p', { text: '下書き候補を通常のチーム検索へ混ぜず、質問への使われ方だけを確認します。' }));
  const form = makeElement('form', { className: 'knowledge-preview-form', attrs: { 'aria-busy': preview.state === 'loading' ? 'true' : 'false' } });
  const question = makeElement('textarea', { className: 'knowledge-control knowledge-textarea', value: preview.question ?? '', attrs: { name: 'question', rows: '4', maxlength: '6000', required: 'required', placeholder: '試したい質問を入力' } });
  const context = makeElement('textarea', { className: 'knowledge-control knowledge-textarea', value: preview.context ?? preview.scenario ?? '', attrs: { name: 'context', rows: '3', maxlength: '6000', placeholder: '想定場面（任意）' } });
  const sampleAnswer = makeElement('textarea', { className: 'knowledge-control knowledge-textarea', value: preview.sample_answer ?? '', attrs: { name: 'sample_answer', rows: '3', maxlength: '10000', placeholder: '比較したい回答（任意）' } });
  append(form, formField('質問', question), formField('想定場面', context), formField('比較用の回答', sampleAnswer, '実行で生成される回答とは別に比較します。'));
  const submit = makeElement('button', { className: 'knowledge-button primary', text: preview.state === 'loading' ? '試験中…' : '隔離して試験', attrs: { type: 'submit' }, disabled: preview.state === 'loading' });
  form.append(submit);
  if (['error', 'error_retryable', 'permission_denied', 'unknown'].includes(normaliseStatus(preview.state))) form.append(statusNotice(preview, { retry: Boolean(callbacks.onRetry), onRetry: callbacks.onRetry }));
  form.addEventListener('submit', (event) => {
    event.preventDefault(); if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
    callbacks.onSubmit?.({ question: question.value, context: context.value, sample_answer: sampleAnswer.value });
  });
  section.append(form);
  const isolationConfirmed = preview.isolated === true || preview.isolation === 'draft_only' || preview.isolation?.state === 'isolated';
  const isolation = isolationConfirmed ? '隔離実行' : '隔離状態未確認';
  append(section, makeElement('p', { className: isolationConfirmed ? 'knowledge-isolation-badge confirmed' : 'knowledge-isolation-badge unknown', text: isolation }));
  const citations = asArray(preview.citations ?? preview.executed_result?.citations) ?? [];
  const evidence = asArray(preview.evidence ?? preview.executed_result?.evidence) ?? [];
  const exclusions = asArray(preview.exclusions ?? preview.executed_result?.exclusions) ?? [];
  const candidates = asArray(preview.candidates);
  const results = asArray(preview.results ?? preview.retrieval_results ?? preview.matches) ?? (candidates ? [
    ...candidates.map((candidate) => {
      const citation = citations.find((entry) => entry?.id === candidate?.id && String(entry?.version) === String(candidate?.version));
      const excluded = exclusions.find((entry) => entry?.id === candidate?.id && (!entry?.version || String(entry.version) === String(candidate?.version)));
      const evidenceRefs = evidence.filter((entry) => entry?.id === candidate?.id && (!entry?.version || String(entry.version) === String(candidate?.version))).map((entry) => entry?.source_ref).filter(Boolean);
      return { ...candidate, adopted: Boolean(citation), excluded_reason: excluded?.reason ?? (citation ? null : '回答で未採用'), evidence_refs: evidenceRefs };
    }),
    ...exclusions.filter((entry) => !candidates.some((candidate) => candidate?.id === entry?.id)).map((entry) => ({ ...entry, adopted: false, excluded_reason: entry.reason })),
  ] : null);
  if (preview.state === 'ready' || preview.state === 'completed' || results) {
    const executed = makeElement('section', { className: 'knowledge-preview-executed' });
    append(executed, makeElement('h4', { text: '実行した検索結果' }));
    if (results === null) executed.append(makeElement('p', { className: 'knowledge-unknown-copy', text: '検索結果を確認できません。' }));
    else if (!results.length) executed.append(makeElement('p', { text: '候補に一致する検索結果はありませんでした。' }));
    else {
      const list = makeElement('ul', { className: 'knowledge-preview-results' });
      for (const result of results) list.append(renderResultEvidence(list, result));
      executed.append(list);
    }
    const executedResult = preview.executed_result && typeof preview.executed_result === 'object' ? preview.executed_result : {};
    if (preview.answer !== undefined || preview.answer_text !== undefined || executedResult.answer !== undefined || executedResult.answer_text !== undefined) executed.append(makeElement('div', { className: 'knowledge-preview-answer' }),);
    const answer = executed.lastChild;
    if (answer?.className === 'knowledge-preview-answer') append(answer, makeElement('h4', { text: '実行結果の回答' }), makeElement('p', { className: 'knowledge-long-text', text: preview.answer ?? preview.answer_text ?? executedResult.answer ?? executedResult.answer_text ?? UNKNOWN }));
    if (executedResult.state && !['completed', 'ready'].includes(executedResult.state)) executed.append(makeElement('p', { className: 'knowledge-warning-copy', text: `実行結果: ${text(executedResult.state)}${executedResult.reason ? `（${text(executedResult.reason)}）` : ''}` }));
    section.append(executed);
  }
  if (preview.sample_answer !== undefined || preview.example_answer !== undefined || preview.fixed_answer !== undefined) {
    const example = makeElement('section', { className: 'knowledge-preview-example' });
    append(example, makeElement('h4', { text: preview.sample_answer !== undefined ? '比較用の回答（実行結果とは別）' : '固定の回答例（実行結果とは別）' }), makeElement('p', { className: 'knowledge-long-text', text: preview.sample_answer ?? preview.example_answer ?? preview.fixed_answer ?? UNKNOWN }));
    section.append(example);
  }
  const testedVersion = preview.draft_version ?? preview.version?.draft?.version ?? preview.candidate_version;
  if (testedVersion !== undefined && preview.item_version !== undefined && String(testedVersion) !== String(preview.item_version)) section.append(makeElement('p', { className: 'knowledge-warning-copy', text: `この試験は旧版です（試験: ${testedVersion} / 現在: ${preview.item_version}）。` }));
  root.append(section);
  return section;
}

export function canManageKnowledge(session) {
  const value = typeof session === 'function' ? session() : session;
  if (!value || typeof value !== 'object') return false;
  if (value.canManageKnowledge === true || value.can_manage_knowledge === true) return true;
  return ['owner', 'admin', 'gm', 'ceo'].includes(optionalText(value.role).toLowerCase());
}

function defaultDraftBody(input) {
  const pointer = input.source?.pointer ?? input.source_pointer ?? null;
  return {
    kind: 'decision',
    title: '',
    content: input.input_text,
    applicability: {},
    source_pointer: pointer ? { uri: pointer } : null,
  };
}

function defaultCandidateBody(values, context = {}) {
  const pointer = context.source?.pointer ?? context.source_pointer ?? null;
  const applicabilityConditions = typeof values.applicability === 'object'
    ? values.applicability?.conditions ?? null
    : values.applicability ?? null;
  return {
    kind: values.type ?? values.kind ?? 'decision',
    type: values.type ?? values.kind ?? 'decision',
    title: values.title ?? '',
    content: context.input_text ?? values.content ?? '',
    summary: values.summary ?? '',
    applicability: {
      scope: values.scope ?? 'project',
      ...(applicabilityConditions ? { conditions: applicabilityConditions } : {}),
    },
    owner_id: values.owner_id ?? null,
    relations: Array.isArray(values.relations) ? values.relations : [],
    selection: values.selection ?? 'create',
    source_pointer: pointer ? { uri: pointer } : null,
  };
}

/**
 * Creates the knowledge outcome workspace.
 *
 * @param {object} options
 * @param {(session: object|null, projectCode: string|null) => boolean} [options.canEditDestination]
 *   Decides whether the current user may register this project's knowledge
 *   document destination. It receives the resolved session value and the
 *   project code; only a `true` result shows the registration form. Without
 *   it, the form follows `canManageKnowledge(session)`. Revision,
 *   supersession, and retirement always follow `canManageKnowledge`.
 */
export function createKnowledgeOutcomeController(options = {}) {
  const { root, api, apiMutation, project, session, onStateChange, onCommitted, onRetired, resolveDecisionDomain, serializeDraftInput, serializeCandidate, serializeRevision, serializeRetire, serializePreview } = options;
  if (!root || typeof root.replaceChildren !== 'function') throw new Error('knowledge_root_unavailable');
  const code = projectCodeOf(project);
  const canEditDestination = () => (typeof options.canEditDestination === 'function'
    ? options.canEditDestination((typeof session === 'function' ? session() : session) ?? null, code ?? null) === true
    : canManageKnowledge(session));
  const projectValue = typeof project === 'function' ? project() : project;
  const ownerCandidates = [];
  for (const candidate of [projectValue?.owner, ...(projectValue?.members?.items ?? [])]) {
    const id = fieldValue(candidate, 'id', 'person_id', 'personId', 'user_id', 'userId');
    if (!id || ownerCandidates.some((owner) => owner.id === id)) continue;
    ownerCandidates.push({ id, name: fieldValue(candidate, 'name', 'display_name', 'displayName', 'label') ?? '氏名未確認' });
  }
  const state = {
    view: 'discovery',
    filters: { q: '', scope: 'all', status: 'active' },
    list: { state: 'loading', records: null, absence_confirmed: false, searched_scope: null },
    selected: null,
    detail: { state: 'idle' },
    draft: { state: 'idle', input_text: '' },
    candidate: { state: 'idle' },
    commit: { state: 'idle' },
    lifecycle: { state: 'idle' },
    preview: { state: 'idle', question: '', context: '' },
    authority: { state: 'loading', domains: null },
    destination: { state: 'unknown', registration: null, draft: {}, message: '保存先APIの契約を確認できていません。' },
  };

  function resumeUrl(draftId) {
    const location = options.location ?? globalThis.location;
    if (!location?.href || !draftId) return null;
    const url = new URL(location.href);
    url.searchParams.set('knowledge_project', code);
    url.searchParams.set('knowledge_draft', draftId);
    return url.toString();
  }

  function notify() {
    onStateChange?.(state);
  }

  function render() {
    clear(root);
    const shell = makeElement('div', { className: 'knowledge-outcome' });
    const header = makeElement('header', { className: 'knowledge-outcome-head' });
    const headerMain = makeElement('div', { className: 'knowledge-header-main' });
    append(headerMain,
      makeElement('span', { className: 'knowledge-eyebrow', text: 'Brainbase Outcome' }),
      makeElement('h2', { text: '知識・判断を成果へつなぐ' }),
      makeElement('p', { text: '正本を探し、由来と状態を確認して、必要なときだけ更新します。' }),
    );
    const headerMeta = makeElement('div', { className: 'knowledge-header-meta' });
    headerMeta.append(makeElement('span', { className: 'knowledge-project-context', text: `プロジェクト: ${code}` }));
    append(header, headerMain, headerMeta);
    const nav = makeElement('nav', { className: 'knowledge-outcome-nav', attrs: { 'aria-label': '知識の操作' } });
    for (const [value, label] of [['discovery', '探す'], ['capture', '登録案を作る'], ['preview', '公開前テスト'], ['destination', '保存先']]) {
      const button = makeElement('button', { className: `knowledge-tab${state.view === value ? ' active' : ''}`, text: label, attrs: { type: 'button', 'aria-current': state.view === value ? 'page' : 'false' } });
      button.addEventListener('click', () => { state.view = value; render(); }); nav.append(button);
    }
    header.append(nav); shell.append(header);
    const body = makeElement('div', { className: 'knowledge-outcome-body knowledge-workspace', attrs: { 'data-view': state.view } });
    const primary = makeElement('main', { className: 'knowledge-outcome-primary knowledge-master', attrs: { 'aria-label': state.view === 'discovery' ? '知識の一覧' : '知識の操作' } });
    const discovery = makeElement('section', { className: 'knowledge-discovery-view', hidden: state.view !== 'discovery', attrs: { 'aria-labelledby': 'knowledge-discovery-title' } });
    const discoveryHeader = makeElement('div', { className: 'knowledge-view-heading' });
    append(discoveryHeader,
      makeElement('div', {},),
      makeElement('span', { className: 'knowledge-view-kicker', text: 'Discovery' }),
    );
    discoveryHeader.firstChild.append(makeElement('h3', { id: 'knowledge-discovery-title', text: '知識・判断を探す' }), makeElement('p', { text: '検索結果を選ぶと、右側に正本とライフサイクルを表示します。' }));
    discovery.append(discoveryHeader);
    const filters = makeElement('div', { className: 'knowledge-filter-region knowledge-discovery-toolbar' });
    renderDiscoveryFilters(filters, state.filters, { onChange: (next) => { state.filters = next; void loadItems(); }, });
    discovery.append(filters);
    const list = makeElement('div', { className: 'knowledge-discovery-list' });
    renderKnowledgeList(list, state.list, { selectedId: state.selected?.id, onSelect: (item) => { state.selected = item; state.detail = { state: 'ready', item }; state.lifecycle = { state: 'ready', item }; render(); }, onRetry: () => loadItems() });
    discovery.append(list);
    primary.append(discovery);
    const captureWorkspace = makeElement('section', { className: 'knowledge-focused-view knowledge-capture-view', hidden: state.view !== 'capture', attrs: { 'aria-labelledby': 'knowledge-capture-workspace-title' } });
    const captureHeading = makeElement('div', { className: 'knowledge-view-heading' });
    append(captureHeading, makeElement('div', {},), makeElement('span', { className: 'knowledge-view-kicker', text: 'Capture' }));
    captureHeading.firstChild.append(makeElement('h3', { id: 'knowledge-capture-workspace-title', text: '登録案を作る' }), makeElement('p', { text: '自然文を候補へ整理し、正本へ保存する前に内容と根拠を確認します。' }));
    captureWorkspace.append(captureHeading);
    const capture = makeElement('div', { className: 'knowledge-capture-form-region' });
    renderDraftCapture(capture, state.draft, { onSubmit: createDraft, onResume: resumeDraft, onDiscard: discardDraft, onRetry: () => createDraft({ input_text: state.draft.input_text, source: state.draft.source }) });
    captureWorkspace.append(capture);
    const review = makeElement('div', { className: 'knowledge-review-region', hidden: state.view !== 'capture' || state.candidate.state === 'idle' });
    if (state.candidate.state !== 'idle') {
      const commitLocked = state.commit.state === 'saving' || Boolean(state.commit.pending_save) || ['verified', 'saved_unverified'].includes(state.commit.state);
      renderCandidateReview(review, { ...state.candidate, decision_domains: state.authority.domains ?? [] }, {
        onApply: commitLocked ? null : applyProposal,
        onSave: commitLocked ? null : saveCandidate,
        onCommit: commitLocked || !(state.candidate.draft_id ?? state.draft.id) ? null : commitCandidate,
        onRetry: state.commit.pending_save ? retryPendingSave : () => createDraft({ input_text: state.draft.input_text, source: state.draft.source }),
      });
    }
    captureWorkspace.append(review);
    primary.append(captureWorkspace);
    const preview = makeElement('section', { className: 'knowledge-focused-view knowledge-preview-view', hidden: state.view !== 'preview', attrs: { 'aria-labelledby': 'knowledge-preview-workspace-title' } });
    const previewHeading = makeElement('div', { className: 'knowledge-view-heading' });
    append(previewHeading, makeElement('div', {},), makeElement('span', { className: 'knowledge-view-kicker', text: 'Preview' }));
    previewHeading.firstChild.append(makeElement('h3', { id: 'knowledge-preview-workspace-title', text: '公開前テスト' }), makeElement('p', { text: '隔離した質問で候補の使われ方と根拠を確認します。' }));
    preview.append(previewHeading);
    const previewContent = makeElement('div', { className: 'knowledge-preview-content' });
    renderIsolatedPreview(previewContent, state.preview, { onSubmit: runPreview, onRetry: () => runPreview({ question: state.preview.question, context: state.preview.context }) });
    preview.append(previewContent);
    primary.append(preview);
    const destination = makeElement('section', { className: 'knowledge-focused-view knowledge-destination-view', hidden: state.view !== 'destination', attrs: { 'aria-labelledby': 'knowledge-destination-workspace-title' } });
    const destinationHeading = makeElement('div', { className: 'knowledge-view-heading' });
    append(destinationHeading, makeElement('div', {},), makeElement('span', { className: 'knowledge-view-kicker', text: 'Source' }));
    destinationHeading.firstChild.append(makeElement('h3', { id: 'knowledge-destination-workspace-title', text: '知識文書の保存先' }), makeElement('p', { text: '正本ドキュメントの場所を登録し、保存後の状態を再取得して確認します。' }));
    destination.append(destinationHeading);
    const destinationContent = makeElement('div', { className: 'knowledge-destination-content' });
    renderKnowledgeDestination(destinationContent, state.destination, {
      canEdit: canEditDestination(),
      onReload: loadDestination,
      onSave: saveDestination,
    });
    destination.append(destinationContent);
    primary.append(destination);
    body.append(primary);
    const detail = makeElement('aside', { className: 'knowledge-outcome-detail knowledge-inspector', attrs: { 'aria-label': '選択した知識の詳細' } });
    const inspectorHeading = makeElement('div', { className: 'knowledge-inspector-heading' });
    append(inspectorHeading, makeElement('span', { className: 'knowledge-view-kicker', text: 'Inspector' }), makeElement('span', { className: 'knowledge-inspector-state', text: state.selected ? '選択中' : '未選択' }));
    detail.append(inspectorHeading);
    const detailContent = makeElement('div', { className: 'knowledge-inspector-detail' });
    renderKnowledgeDetail(detailContent, state.selected, { onPreview: (item) => { state.preview = { state: 'idle', question: '', context: '', item_id: item.id, candidate_version: item.version, item_version: item.version }; state.view = 'preview'; render(); } });
    detail.append(detailContent);
    const lifecycle = makeElement('div', { className: 'knowledge-inspector-lifecycle' });
    renderLifecycle(lifecycle, state.selected, { canEdit: canManageKnowledge(session), ownerCandidates, revisionDraft: state.lifecycle.revisionDraft, supersessionDraft: state.lifecycle.supersessionDraft, supersessionCandidates: state.list.records, onRevision: reviseItem, onSupersede: supersedeItem, onRetire: retireItem }); detail.append(lifecycle);
    if (state.commit.state !== 'idle') { const commit = makeElement('div'); renderCommitState(commit, state.commit, { onReadback: state.commit.pending_save ? retryPendingSave : readbackCommit }); detail.append(commit); }
    body.append(detail); shell.append(body); root.append(shell); notify();
    return shell;
  }

  async function loadItems() {
    state.list = { ...state.list, state: 'loading' }; render();
    try { state.list = normalizeKnowledgeCollection(await callKnowledgeApi(api, buildKnowledgeItemsPath(code, state.filters))); }
    catch (error) { state.list = { state: error.code === 'permission_denied' || error.status === 403 ? 'permission_denied' : 'error_retryable', records: null, message: apiErrorText(error), error: error.code }; }
    render(); return state.list;
  }

  function destinationPath() {
    const configured = typeof options.knowledgeDestinationPath === 'function'
      ? options.knowledgeDestinationPath(code)
      : options.knowledgeDestinationPath;
    return optionalText(configured).trim() || knowledgePath(code, KNOWLEDGE_ROUTES.documentSourceRegistration);
  }

  async function loadDestination() {
    const path = destinationPath();
    if (!path) {
      state.destination = { ...state.destination, state: 'unknown', message: '保存先APIの契約を確認できていません。入力値は保持します。' };
      render(); return state.destination;
    }
    state.destination = { ...state.destination, state: 'loading' }; render();
    try {
      const payload = await callKnowledgeApi(api, path);
      const registration = normalizeKnowledgeDestinationRegistration(payload, code);
      state.destination = registration
        ? { state: 'ready', registration, revision: registration.revision, draft: state.destination.draft ?? {}, message: null }
        : { state: 'unknown', registration: null, revision: null, draft: state.destination.draft ?? {}, message: '保存先APIの契約を確認できません。入力値は保持します。' };
    } catch (error) {
      const unregistered = error.status === 404 || error.code === 'knowledge_document_source_registration_not_found';
      state.destination = { ...state.destination, state: unregistered ? 'unregistered' : error.status === 403 ? 'permission_denied' : 'error_retryable', registration: unregistered ? null : state.destination.registration, message: unregistered ? null : apiErrorText(error), error: error.code };
    }
    render(); return state.destination;
  }

  async function saveDestination(input) {
    const path = destinationPath();
    state.destination = { ...state.destination, state: path ? 'saving' : 'unknown', draft: { ...input }, message: path ? null : '保存先APIの契約を確認できていません。入力値は保持します。' };
    render();
    if (!path) return state.destination;
    try {
      const mutation = await callKnowledgeApi(apiMutation, path, { method: 'PUT', body: input, key: operationKey('knowledge-destination', code, input.expected_revision, input) });
      const payload = await callKnowledgeApi(api, path);
      const registration = normalizeKnowledgeDestinationRegistration(payload, code);
      const savedRegistration = normalizeKnowledgeDestinationRegistration(mutation, code);
      const matches = registration
        && savedRegistration
        && DESTINATION_REGISTRATION_FIELDS.every((key) => registration[key] === input[key] && savedRegistration[key] === input[key])
        && registration.revision === savedRegistration.revision;
      state.destination = {
        state: matches ? 'verified' : 'unknown',
        registration: matches ? registration : null,
        revision: matches ? registration.revision : null,
        draft: matches ? {} : { ...input },
        message: matches ? null : '保存後の再取得結果が保存先の契約と一致しません。入力内容は保持します。',
      };
    } catch (error) {
      state.destination = { ...state.destination, state: isVersionConflict(error) || error.status === 409 ? 'conflict' : error.status === 403 ? 'permission_denied' : 'error_retryable', message: apiErrorText(error), error: error.code, draft: { ...input } };
    }
    render(); return state.destination;
  }

  async function selectItem(itemOrId) {
    const id = typeof itemOrId === 'object' ? itemOrId?.id : itemOrId;
    const listItem = typeof itemOrId === 'object' ? itemOrId : state.list.records?.find((item) => item.id === id);
    state.selected = listItem ?? null; state.detail = { state: 'loading' }; render();
    if (!id) { state.detail = { state: 'unknown', message: '正本IDを確認できません。' }; render(); return null; }
    try {
      const payload = await callKnowledgeApi(api, knowledgePath(code, `${KNOWLEDGE_ROUTES.items}/${encodeURIComponent(id)}`));
      const historyPayload = await callKnowledgeApi(api, knowledgePath(code, `${KNOWLEDGE_ROUTES.items}/${encodeURIComponent(id)}/${KNOWLEDGE_ROUTES.history}`));
      const item = normalizeKnowledgeItem(payload?.item ?? payload?.record ?? payload?.data ?? payload) ?? listItem;
      if (item) item.history = Array.isArray(historyPayload?.entries) ? historyPayload.entries : null;
      state.selected = item; state.detail = { state: 'ready', item }; state.lifecycle = { state: 'ready', item }; render(); return item;
    } catch (error) { state.detail = { state: error.code === 'permission_denied' ? 'permission_denied' : 'error_retryable', message: apiErrorText(error), error: error.code }; render(); return null; }
  }

  async function createDraft(input) {
    const preserved = { input_text: optionalText(input?.input_text), source: input?.source ?? null };
    state.draft = { ...state.draft, ...preserved, state: 'saving' }; state.view = 'capture'; render();
    try {
      const body = { content: preserved.input_text, ...(preserved.source ? { source: preserved.source } : {}), ...(Array.isArray(input?.source_refs) ? { source_refs: input.source_refs } : {}) };
      const payload = await callKnowledgeApi(apiMutation, knowledgePath(code, KNOWLEDGE_ROUTES.captureProposal), { method: 'POST', body, key: operationKey('capture-proposal', 'new', null, body) });
      const proposed = payload?.proposal ?? {};
      state.draft = { ...state.draft, ...preserved, state: 'candidate' };
      state.candidate = { ...payload, candidate: proposed, input_text: preserved.input_text, source: preserved.source, state: 'candidate', proposal_applied: false, draft_id: null, version: null };
    } catch (error) { state.draft = { ...state.draft, state: error.code === 'permission_denied' ? 'permission_denied' : 'error_retryable', message: apiErrorText(error), error: error.code }; }
    render(); return state.candidate;
  }

  async function resumeDraft(draftId) {
    const id = optionalText(draftId).trim();
    if (!id) { state.draft = { ...state.draft, state: 'unknown', message: '再開する下書きIDを入力してください。' }; render(); return null; }
    state.draft = { ...state.draft, resume_id: id, state: 'loading' }; state.view = 'capture'; render();
    try {
      const payload = await callKnowledgeApi(api, knowledgePath(code, `${KNOWLEDGE_ROUTES.drafts}/${encodeURIComponent(id)}`));
      const draft = payload?.draft ?? payload?.data ?? payload;
      const resolvedId = draft?.draft_id ?? draft?.id ?? id;
      const revision = draft?.revision ?? draft?.version ?? null;
      state.draft = { ...draft, id: resolvedId, draft_id: resolvedId, revision, input_text: draft?.content ?? '', resume_id: resolvedId, resume_url: resumeUrl(resolvedId), state: 'candidate' };
      state.candidate = { ...draft, candidate: draft?.candidate ?? draft, input_text: state.draft.input_text, draft_id: resolvedId, version: revision, proposal_applied: true, state: 'candidate' };
    } catch (error) {
      const failureState = error.code === 'permission_denied' || error.status === 403
        ? 'permission_denied'
        : error.code === 'knowledge_draft_not_found' || error.status === 404
          ? 'unknown'
          : error.status === 409 || isVersionConflict(error) ? 'conflict' : 'error_retryable';
      state.draft = { ...state.draft, state: failureState, message: apiErrorText(error), error: error.code };
    }
    render(); return state.candidate;
  }

  async function discardDraft() {
    const draftId = state.candidate.draft_id ?? state.draft.draft_id ?? state.draft.id;
    if (!draftId) { state.draft = { state: 'idle', input_text: '' }; state.candidate = { state: 'idle' }; render(); return state.draft; }
    const revision = state.candidate.version ?? state.draft.revision ?? state.draft.version;
    const preservedDraft = state.draft; const preservedCandidate = state.candidate;
    state.draft = { ...state.draft, state: 'saving' }; render();
    try {
      await callKnowledgeApi(apiMutation, knowledgePath(code, `${KNOWLEDGE_ROUTES.drafts}/${encodeURIComponent(draftId)}/discard`), { method: 'POST', body: { revision }, key: operationKey('draft-discard', draftId, revision, { revision }) });
      state.draft = { state: 'idle', input_text: '' }; state.candidate = { state: 'idle' };
    } catch (error) {
      state.draft = { ...preservedDraft, state: isVersionConflict(error) ? 'conflict' : 'error_retryable', message: apiErrorText(error), error: error.code };
      state.candidate = preservedCandidate;
    }
    render(); return state.draft;
  }

  function applyProposal() {
    state.candidate = { ...state.candidate, proposal_applied: true, state: 'candidate' };
    render();
    return state.candidate;
  }

  async function loadAuthorityDomains() {
    state.authority = { state: 'loading', domains: null };
    try {
      const payload = await callKnowledgeApi(api, knowledgePath(code, 'authority-domains'));
      state.authority = Array.isArray(payload?.domains)
        ? { state: 'ready', domains: payload.domains }
        : { state: 'unknown', domains: null, message: '判断権限の応答を確認できません。' };
    } catch (error) {
      state.authority = { state: error.code === 'permission_denied' ? 'permission_denied' : 'error_retryable', domains: null, message: apiErrorText(error) };
    }
    render(); return state.authority;
  }

  async function saveCandidate(values) {
    const draftId = state.candidate.draft_id ?? state.draft.id;
    if (!state.candidate.proposal_applied) { state.candidate = { ...state.candidate, state: 'unknown', message: 'AI提案を入力欄へ反映してから下書きを保存してください。' }; render(); return null; }
    const editedCandidate = { ...(state.candidate.candidate ?? {}), ...values };
    state.candidate = { ...state.candidate, candidate: editedCandidate, state: 'saving', input_text: state.draft.input_text }; render();
    try {
      const candidateBody = serializeCandidate ? serializeCandidate(values, state.candidate) : defaultCandidateBody(values, state.draft);
      const revision = state.candidate.version ?? state.draft.revision ?? state.draft.version;
      const body = draftId ? { ...candidateBody, revision } : candidateBody;
      const path = draftId ? `${KNOWLEDGE_ROUTES.drafts}/${encodeURIComponent(draftId)}` : KNOWLEDGE_ROUTES.drafts;
      const payload = await callKnowledgeApi(apiMutation, knowledgePath(code, path), { method: draftId ? 'PATCH' : 'POST', body, key: operationKey(draftId ? 'draft-update' : 'draft', draftId ?? 'new', revision, body) });
      const draft = payload?.draft ?? payload?.data ?? payload;
      state.candidate = { ...state.candidate, ...draft, candidate: { ...editedCandidate, ...(draft?.candidate ?? {}) }, state: 'candidate', proposal_applied: true, draft_id: draft?.draft_id ?? draft?.id ?? draftId, version: draft?.revision ?? draft?.version ?? state.candidate.version };
      const savedId = draft?.draft_id ?? draft?.id ?? draftId;
      state.draft = { ...state.draft, ...draft, id: savedId, draft_id: savedId, resume_url: resumeUrl(savedId), state: 'candidate' };
    } catch (error) { state.candidate = { ...state.candidate, state: isVersionConflict(error) ? 'conflict' : 'error_retryable', message: apiErrorText(error), error: error.code }; }
    render(); return state.candidate;
  }

  async function commitCandidate(values) {
    if (state.commit.state === 'saving' || state.commit.pending_save || ['verified', 'saved_unverified'].includes(state.commit.state)) return state.commit;
    const draftId = state.candidate.draft_id ?? state.draft.id;
    if (!draftId) { state.commit = { state: 'unknown', message: '下書きIDを確認できません。' }; render(); return null; }
    state.commit = { state: 'saving', item_id: null, version: null }; render();
    try {
      const resolvedDomain = await resolveDecisionDomain?.({ project, session: typeof session === 'function' ? session() : session, candidate: values });
      const decisionDomain = resolvedDomain ?? values.decision_domain ?? null;
      const allowedDomains = (state.authority.domains ?? []).map((domain) => typeof domain === 'string' ? domain : domain?.id ?? domain?.domain).filter(Boolean);
      if (!decisionDomain) {
        state.commit = { state: 'unknown', message: 'Graph RACIの判断権限ドメインを確認できません。適用範囲から推測して保存しません。' };
        render(); return state.commit;
      }
      if (!resolvedDomain && !allowedDomains.includes(decisionDomain)) {
        state.commit = { state: 'permission_denied', message: '選択した判断権限は現在のGraph RACIで確認できません。' };
        render(); return state.commit;
      }
      const candidateBody = serializeCandidate ? serializeCandidate(values, state.candidate) : defaultCandidateBody(values, state.draft);
      const selection = values.selection === 'reuse' ? 'reuse' : 'create';
      const canonicalId = optionalText(values.canonical_id).trim();
      const canonicalVersion = optionalText(values.canonical_version ?? values.expected_version).trim();
      if (selection === 'reuse' && (!canonicalId || !canonicalVersion)) {
        state.commit = { state: 'unknown', message: '再利用する正本IDと現在版を確認できません。' };
        render(); return state.commit;
      }
      const revision = state.candidate.version ?? state.draft.revision ?? state.draft.version ?? null;
      const updated = await callKnowledgeApi(apiMutation, knowledgePath(code, `${KNOWLEDGE_ROUTES.drafts}/${encodeURIComponent(draftId)}`), { method: 'PATCH', body: { ...candidateBody, revision }, key: operationKey('draft-update', draftId, revision, candidateBody) });
      const savedRevision = updated?.revision ?? revision;
      state.candidate = { ...state.candidate, ...updated, candidate: updated?.candidate ?? values, draft_id: updated?.draft_id ?? updated?.id ?? draftId, version: savedRevision };
      state.draft = { ...state.draft, ...updated, id: updated?.draft_id ?? updated?.id ?? draftId, revision: savedRevision };
      const body = { revision: savedRevision, decision_domain: decisionDomain, ...(selection === 'reuse' ? { canonical_id: canonicalId, expected_version: canonicalVersion } : {}) };
      const action = selection === 'reuse' ? 'reuse' : 'save';
      const key = operationKey(action, draftId, savedRevision, body);
      state.commit = { ...state.commit, pending_save: { draftId, body, key, action, expected_relations: candidateBody.relations } };
      const payload = await callKnowledgeApi(apiMutation, knowledgePath(code, `${KNOWLEDGE_ROUTES.drafts}/${encodeURIComponent(draftId)}/${action}`), { method: 'POST', body, key });
      const readback = await verifyMutationReadback(payload, candidateBody.relations, action);
      state.commit = readback;
      if (readback.item) { state.selected = readback.item; state.detail = { state: 'ready', item: readback.item }; state.lifecycle = { state: 'ready', item: readback.item }; }
      onCommitted?.(readback);
    } catch (error) { state.commit = { ...state.commit, state: isVersionConflict(error) ? 'conflict' : error.code === 'permission_denied' ? 'permission_denied' : 'error_retryable', message: apiErrorText(error), error: error.code }; }
    render(); return state.commit;
  }

  async function retryPendingSave() {
    const pending = state.commit.pending_save;
    if (!pending) return readbackCommit();
    state.commit = { ...state.commit, state: 'saving' }; render();
    try {
      const payload = await callKnowledgeApi(apiMutation, knowledgePath(code, `${KNOWLEDGE_ROUTES.drafts}/${encodeURIComponent(pending.draftId)}/${pending.action ?? 'save'}`), { method: 'POST', body: pending.body, key: pending.key });
      state.commit = await verifyMutationReadback(payload, pending.expected_relations, pending.action ?? 'save');
      if (state.commit.item) state.selected = state.commit.item;
      onCommitted?.(state.commit);
    } catch (error) {
      state.commit = { ...state.commit, pending_save: pending, state: isVersionConflict(error) ? 'conflict' : error.code === 'permission_denied' ? 'permission_denied' : 'error_retryable', message: apiErrorText(error), error: error.code };
    }
    render(); return state.commit;
  }

  function expectedRelationsMatch(actualRelations, expectedRelations) {
    const actual = Array.isArray(actualRelations) ? actualRelations : [];
    return (Array.isArray(expectedRelations) ? expectedRelations : []).every((expected) => actual.some((edge) => {
      const sameEdge = edge?.relation === expected?.relation
        && (edge?.to_id ?? edge?.target_id ?? edge?.id) === (expected?.to_id ?? expected?.target_id ?? expected?.id);
      if (!sameEdge) return false;
      return expected?.payload === undefined || JSON.stringify(edge?.payload) === JSON.stringify(expected.payload);
    }));
  }

  async function verifyMutationReadback(payload, expectedRelations = [], action = 'save') {
    const readback = payload?.readback;
    const itemId = payload?.canonical?.id ?? payload?.item?.id ?? payload?.item_id ?? readback?.item_id ?? payload?.id;
    const expectedVersion = payload?.expected_version ?? readback?.version ?? payload?.canonical?.version ?? payload?.item?.version ?? payload?.version ?? null;
    const expectedHash = payload?.canonical_content_hash ?? readback?.content_hash ?? payload?.content_hash ?? payload?.item?.content_hash ?? null;
    if (!itemId) return { state: 'saved_unverified', item_id: null, version: expectedVersion, expected_hash: expectedHash };
    try {
      const current = await callKnowledgeApi(api, knowledgePath(code, `${KNOWLEDGE_ROUTES.items}/${encodeURIComponent(itemId)}`));
      const item = normalizeKnowledgeItem(current?.item ?? current?.record ?? current?.data ?? current);
      const actualHash = current?.canonical_content_hash ?? current?.readback?.content_hash ?? current?.content_hash ?? item?.raw?.canonical_content_hash ?? item?.raw?.content_hash ?? null;
      const canonicalSaved = action === 'reuse'
        ? payload?.persistence?.readback_verified === true && payload?.canonical?.id === itemId
        : payload?.persistence?.event_saved === true || current?.readback?.canonical_saved === true || current?.canonical_saved === true;
      const graphSaved = payload?.persistence?.graph_saved === true || current?.readback?.graph_saved === true || current?.graph_saved === true;
      const sourceFetched = item?.source?.state === 'fetched';
      const relationsMatch = expectedRelationsMatch(item?.relations, expectedRelations);
      const matches = payload?.persistence?.readback_verified === true && item?.id === itemId && expectedVersion !== null && item.version === expectedVersion
        && expectedHash !== null && actualHash === expectedHash && canonicalSaved && graphSaved && sourceFetched && relationsMatch;
      return { state: matches ? 'verified' : 'saved_unverified', action, item_id: itemId, version: item?.version ?? expectedVersion, expected_version: expectedVersion, expected_hash: expectedHash, expected_relations: expectedRelations, relations_match: relationsMatch, receipt_verified: payload?.persistence?.readback_verified === true && canonicalSaved && graphSaved, item };
    } catch { return { state: 'saved_unverified', action, item_id: itemId, version: expectedVersion, expected_version: expectedVersion, expected_hash: expectedHash, expected_relations: expectedRelations, receipt_verified: false }; }
  }

  async function readbackCommit() {
    if (!state.commit.item_id) { state.commit = { ...state.commit, state: 'unknown', message: 'readback対象IDを確認できません。' }; render(); return null; }
    try { const payload = await callKnowledgeApi(api, knowledgePath(code, `${KNOWLEDGE_ROUTES.items}/${encodeURIComponent(state.commit.item_id)}`)); const item = normalizeKnowledgeItem(payload?.item ?? payload?.record ?? payload?.data ?? payload); const actualHash = payload?.canonical_content_hash ?? payload?.readback?.content_hash ?? payload?.content_hash ?? item?.raw?.canonical_content_hash ?? item?.raw?.content_hash ?? null; const relationsMatch = expectedRelationsMatch(item?.relations, state.commit.expected_relations); const matches = state.commit.receipt_verified === true && item?.id === state.commit.item_id && state.commit.expected_version !== null && item?.version === state.commit.expected_version && state.commit.expected_hash !== null && actualHash === state.commit.expected_hash && item?.source?.state === 'fetched' && relationsMatch; state.commit = { ...state.commit, state: matches ? 'verified' : 'saved_unverified', relations_match: relationsMatch, item, version: item?.version ?? state.commit.version }; if (item) state.selected = item; }
    catch (error) { state.commit = { ...state.commit, state: 'saved_unverified', message: apiErrorText(error) }; }
    render(); return state.commit;
  }

  async function reviseItem(change) {
    if (!state.selected?.id) return null;
    const supplied = serializeRevision ? serializeRevision(change, state.selected) : change;
    if (typeof supplied.content !== 'string' || !supplied.content.trim()) {
      state.lifecycle = { state: 'error_retryable', action: 'revision', revisionDraft: supplied, message: '正本の本文を取得してから改訂してください。要旨だけでは保存できません。', error: 'canonical_content_missing' };
      render(); return state.lifecycle;
    }
    state.lifecycle = { ...state.lifecycle, state: 'saving', action: 'revision', revisionDraft: supplied }; render();
    try {
      const body = { expected_version: supplied.expected_version ?? state.selected.version, reason: supplied.reason, content: supplied.content,
        ...(supplied.title ? { title: supplied.title } : {}), ...(supplied.scope !== undefined ? { scope: supplied.scope } : {}),
        ...(supplied.owner_person_id !== undefined ? { owner_person_id: supplied.owner_person_id } : {}),
        ...(supplied.effective_at !== undefined ? { effective_at: supplied.effective_at } : {}),
        ...(supplied.expires_at !== undefined ? { expires_at: supplied.expires_at } : {}) };
      const mutation = await callKnowledgeApi(apiMutation, knowledgePath(code, `${KNOWLEDGE_ROUTES.items}/${encodeURIComponent(state.selected.id)}/revisions`), { method: 'POST', body, key: operationKey('revision', state.selected.id, state.selected.version, body) });
      const expectedRaw = mutation?.item ?? mutation?.record ?? mutation?.data ?? mutation;
      const expected = normalizeKnowledgeItem(expectedRaw);
      const expectedHash = mutation?.canonical_content_hash ?? mutation?.readback?.content_hash ?? mutation?.content_hash ?? expected?.raw?.canonical_content_hash ?? expected?.raw?.content_hash ?? null;
      const readbackPayload = await callKnowledgeApi(api, knowledgePath(code, `${KNOWLEDGE_ROUTES.items}/${encodeURIComponent(state.selected.id)}`));
      const item = normalizeKnowledgeItem(readbackPayload?.item ?? readbackPayload?.record ?? readbackPayload?.data ?? readbackPayload);
      const actualHash = readbackPayload?.canonical_content_hash ?? readbackPayload?.readback?.content_hash ?? readbackPayload?.content_hash ?? item?.raw?.canonical_content_hash ?? item?.raw?.content_hash ?? null;
      const expectedSource = expected?.raw ?? {};
      const sameReturnedFields = ['title', 'summary', 'content', 'scope', 'owner', 'applicability', 'lifecycle'].every((key) => !Object.prototype.hasOwnProperty.call(expectedSource, key) || JSON.stringify(item?.[key]) === JSON.stringify(expected?.[key]));
      const matches = expected?.id === state.selected.id && expected.version !== null && item?.id === expected.id && item?.version === expected.version && expectedHash !== null && actualHash === expectedHash && sameReturnedFields;
      if (item) { state.selected = item; state.detail = { state: 'ready', item }; }
      state.lifecycle = { state: matches ? 'verified' : 'saved_unverified', action: 'revision', item_id: expected?.id ?? state.selected?.id, version: item?.version, expected_version: expected?.version, expected_hash: expectedHash, item };
    } catch (error) { state.lifecycle = { state: isVersionConflict(error) ? 'conflict' : error.code === 'permission_denied' ? 'permission_denied' : 'error_retryable', action: 'revision', revisionDraft: supplied, message: apiErrorText(error), error: error.code }; }
    render(); return state.lifecycle;
  }

  async function retireItem(change) {
    if (!state.selected?.id) return null;
    state.lifecycle = { ...state.lifecycle, state: 'saving' }; render();
    try {
      const supplied = serializeRetire ? serializeRetire(change, state.selected) : change;
      const body = { reason: supplied.reason, state: 'retired', expected_version: state.selected.version };
      await callKnowledgeApi(apiMutation, knowledgePath(code, `${KNOWLEDGE_ROUTES.items}/${encodeURIComponent(state.selected.id)}/${KNOWLEDGE_ROUTES.lifecycle}`), { method: 'POST', body, key: operationKey('retire', state.selected.id, state.selected.version, body) });
      const current = await callKnowledgeApi(api, knowledgePath(code, `${KNOWLEDGE_ROUTES.items}/${encodeURIComponent(state.selected.id)}`));
      const item = normalizeKnowledgeItem(current?.item ?? current?.record ?? current?.data ?? current);
      const result = { state: item?.id === state.selected.id && item.lifecycle.status === 'retired' ? 'verified' : 'saved_unverified', item_id: state.selected.id, version: item?.version ?? state.selected.version, item };
      state.lifecycle = { ...result, action: 'retire' }; if (result.item) { state.selected = result.item; state.detail = { state: 'ready', item: result.item }; } onRetired?.(result);
    } catch (error) { state.lifecycle = { state: error.code === 'version_conflict' ? 'conflict' : error.code === 'permission_denied' ? 'permission_denied' : 'error_retryable', message: apiErrorText(error), error: error.code }; }
    render(); return state.lifecycle;
  }

  async function supersedeItem(change) {
    if (!state.selected?.id) return null;
    const supplied = { ...change };
    state.lifecycle = { ...state.lifecycle, state: 'saving', action: 'supersession', supersessionDraft: supplied }; render();
    try {
      const body = { superseded_id: supplied.superseded_id, replacement_expected_version: supplied.replacement_expected_version ?? state.selected.version,
        superseded_expected_version: supplied.superseded_expected_version, effective_at: supplied.effective_at, reason: supplied.reason };
      const mutation = await callKnowledgeApi(apiMutation, knowledgePath(code, `${KNOWLEDGE_ROUTES.items}/${encodeURIComponent(state.selected.id)}/${KNOWLEDGE_ROUTES.supersessions}`), { method: 'POST', body, key: operationKey('supersession', state.selected.id, state.selected.version, body) });
      const expectedReplacement = normalizeKnowledgeItem(mutation?.replacement);
      const expectedSuperseded = normalizeKnowledgeItem(mutation?.superseded);
      const [replacementPayload, supersededPayload] = await Promise.all([
        callKnowledgeApi(api, knowledgePath(code, `${KNOWLEDGE_ROUTES.items}/${encodeURIComponent(state.selected.id)}`)),
        callKnowledgeApi(api, knowledgePath(code, `${KNOWLEDGE_ROUTES.items}/${encodeURIComponent(supplied.superseded_id)}`)),
      ]);
      const replacement = normalizeKnowledgeItem(replacementPayload?.item ?? replacementPayload?.record ?? replacementPayload?.data ?? replacementPayload);
      const superseded = normalizeKnowledgeItem(supersededPayload?.item ?? supersededPayload?.record ?? supersededPayload?.data ?? supersededPayload);
      const relationMatches = replacement?.relations?.some((edge) => edge?.relation === 'supersedes' && edge?.from_id === replacement.id && edge?.to_id === superseded.id && edge?.effective_at === supplied.effective_at);
      const matches = expectedReplacement?.version !== null && expectedSuperseded?.version !== null
        && replacement?.version === expectedReplacement.version && superseded?.version === expectedSuperseded.version
        && replacement?.lifecycle?.effective_at === supplied.effective_at && superseded?.lifecycle?.expires_at === supplied.effective_at && relationMatches;
      if (replacement) { state.selected = replacement; state.detail = { state: 'ready', item: replacement }; }
      state.lifecycle = { state: matches ? 'verified' : 'saved_unverified', action: 'supersession', item_id: replacement?.id, version: replacement?.version, superseded_item_id: superseded?.id, item: replacement };
    } catch (error) {
      state.lifecycle = { state: isVersionConflict(error) ? 'conflict' : error.code === 'permission_denied' ? 'permission_denied' : 'error_retryable', action: 'supersession', supersessionDraft: supplied, message: apiErrorText(error), error: error.code };
    }
    render(); return state.lifecycle;
  }

  async function runPreview(input) {
    state.preview = { ...state.preview, ...input, state: 'loading' }; state.view = 'preview'; render();
    try {
      const savedDraftId = state.candidate.draft_id ?? state.draft.draft_id ?? state.draft.id;
      const candidate = state.candidate.candidate ?? state.candidate;
      const selectedItem = state.preview.item_id && state.selected?.id === state.preview.item_id ? state.selected : null;
      const draftId = savedDraftId ?? selectedItem?.id;
      const draftVersion = savedDraftId
        ? state.draft.revision ?? state.draft.version ?? state.candidate.draft_revision ?? state.candidate.version
        : selectedItem?.version;
      const draftContent = savedDraftId
        ? state.draft.content ?? candidate.content ?? candidate.summary ?? state.draft.input_text
        : selectedItem?.content;
      if (!draftId || draftVersion === null || draftVersion === undefined || !String(draftVersion).trim() || !optionalText(draftContent).trim()) {
        state.preview = { ...state.preview, state: 'unknown', message: selectedItem && !optionalText(selectedItem.content).trim()
          ? '試験対象の正本全文を確認できません。要旨だけでは試験しません。'
          : '試験対象のID・版・全文を確認できません。' };
        render(); return null;
      }
      const previewVersion = typeof draftVersion === 'string' ? draftVersion : String(draftVersion);
      const serializedBody = serializePreview ? serializePreview(input, state.candidate) : {
        question: input.question,
        scenario: input.context ?? input.scenario ?? null,
        draft_version: previewVersion,
        draft: {
          id: draftId, version: previewVersion,
          title: savedDraftId ? candidate.title ?? state.draft.title ?? '' : selectedItem.title ?? '',
          summary: savedDraftId ? candidate.summary ?? state.draft.summary ?? '' : selectedItem.summary ?? '',
          content: draftContent,
          applicability_conditions: savedDraftId ? candidate.applicability ?? state.draft.applicability ?? null : selectedItem.applicability?.conditions ?? null,
        },
      };
      const body = {
        ...serializedBody,
        ...(input.sample_answer !== undefined ? { sample_answer: input.sample_answer } : {}),
        draft_version: previewVersion,
        draft: { ...(serializedBody?.draft ?? {}), id: serializedBody?.draft?.id ?? draftId, version: previewVersion },
      };
      const payload = await callKnowledgeApi(apiMutation, knowledgePath(code, KNOWLEDGE_ROUTES.preview), { method: 'POST', body, key: operationKey('preview', draftId, previewVersion, body) });
      state.preview = { ...state.preview, ...(payload?.preview ?? payload?.data ?? payload), state: 'ready' };
    } catch (error) { state.preview = { ...state.preview, state: error.code === 'permission_denied' ? 'permission_denied' : 'error_retryable', message: apiErrorText(error), error: error.code }; }
    render(); return state.preview;
  }

  const controller = { state, render, loadItems, loadAuthorityDomains, loadDestination, saveDestination, selectItem, createDraft, resumeDraft, discardDraft, applyProposal, saveCandidate, commitCandidate, retryPendingSave, readbackCommit, reviseItem, supersedeItem, retireItem, runPreview, paths: { items: () => buildKnowledgeItemsPath(code, state.filters), drafts: () => knowledgePath(code, KNOWLEDGE_ROUTES.drafts), destination: destinationPath } };
  render();
  const initialLocation = options.location ?? globalThis.location;
  if (initialLocation?.href) {
    const initialUrl = new URL(initialLocation.href);
    const initialDraftId = initialUrl.searchParams.get('knowledge_draft');
    if (initialDraftId && initialUrl.searchParams.get('knowledge_project') === code) void resumeDraft(initialDraftId);
  }
  if (options.autoLoad !== false) void loadItems();
  if (options.autoLoad !== false) void loadAuthorityDomains();
  if (options.autoLoad !== false && destinationPath()) void loadDestination();
  return controller;
}

export const createKnowledgeOutcomeModule = createKnowledgeOutcomeController;
