/*
 * Shared meeting-minutes screen.
 *
 * The screen only speaks the provider-independent HTTP contract.  A host
 * supplies the fetcher, token and base path; no calendar, repository, or
 * organization connector is assumed here.
 *
 * List order and labels are a projection. Canonical records are not rewritten.
 * Calendar links stay out until a meeting-side event id is verified.
 * Filters and sort only narrow the loaded list; the host owns any filter that
 * changes what it asks the server for (story-meeting-minutes-list-filters-v1).
 */

import { workspaceCombobox } from './workspace-kit.js';

export const MEETING_MINUTES_UI_CONTRACT_VERSION = 'brainbase.meeting-minutes-ui.v1';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const TOKYO = 'Asia/Tokyo';
const SORTS = Object.freeze([
  { value: 'scheduled-desc', label: '会議の日時が新しい順' },
  { value: 'scheduled-asc', label: '会議の日時が古い順' },
  { value: 'updated-desc', label: '議事録の更新が新しい順' },
]);
const STATE_FILTERS = Object.freeze([
  { value: '', label: 'すべての状態' },
  { value: 'pending', label: '確認待ち' },
  { value: 'confirmed', label: '確認済み' },
]);
const EMPTY_FILTERS = Object.freeze({ query: '', from: '', to: '', participant: '', status: '' });

function tokyoParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TOKYO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value ?? '';
  let hour = Number(value('hour'));
  if (hour === 24) hour = 0;
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour,
    minute: Number(value('minute')),
  };
}

function tokyoDayNumber(date) {
  const { year, month, day } = tokyoParts(date);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function meetingLabelText(meetingLabel, meeting) {
  if (typeof meetingLabel !== 'function') return '';
  try {
    return text(meetingLabel(meeting));
  } catch {
    return '';
  }
}

function makeElement(doc, tag, { className, textContent, type, value, disabled, attrs = {} } = {}) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (textContent !== undefined) element.textContent = String(textContent);
  if (type) element.type = type;
  if (value !== undefined && 'value' in element) element.value = value;
  if (disabled !== undefined) element.disabled = Boolean(disabled);
  for (const [name, attrValue] of Object.entries(attrs)) {
    if (attrValue === undefined || attrValue === null || attrValue === false) continue;
    element.setAttribute(name, attrValue === true ? '' : String(attrValue));
  }
  return element;
}

function button(doc, label, onClick, options = {}) {
  const item = makeElement(doc, 'button', {
    className: options.className ?? 'bb-minutes-button',
    textContent: label,
    type: 'button',
    disabled: options.disabled,
    attrs: options.attrs,
  });
  item.addEventListener('click', onClick);
  return item;
}

function labelInput(doc, label, { type = 'text', value = '', name, placeholder } = {}) {
  const wrapper = makeElement(doc, 'label', { className: 'bb-minutes-field' });
  wrapper.append(makeElement(doc, 'span', { className: 'bb-minutes-label', textContent: label }));
  const input = makeElement(doc, type === 'textarea' ? 'textarea' : 'input', {
    className: 'bb-minutes-input', type: type === 'textarea' ? undefined : type, value,
    attrs: { name, placeholder },
  });
  wrapper.append(input);
  return { wrapper, input };
}

function parseDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(part) {
  return String(part).padStart(2, '0');
}

function formatClock(date) {
  const { hour, minute } = tokyoParts(date);
  return `${pad(hour)}:${pad(minute)}`;
}

function formatMonthDay(date) {
  const { month, day } = tokyoParts(date);
  return `${month}/${day}`;
}

function formatStamp(value) {
  const date = parseDate(value);
  return date ? `${formatMonthDay(date)} ${formatClock(date)}` : '';
}

function dayHeading(date, today) {
  const { year, month, day } = tokyoParts(date);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const label = `${month}/${day}（${weekday}）`;
  return tokyoDayNumber(date) === tokyoDayNumber(today) ? `今日 ${label}` : label;
}

function dateKey(date) {
  const { year, month, day } = tokyoParts(date);
  return `${year}-${month}-${day}`;
}

function relativeDay(date, today) {
  const days = tokyoDayNumber(today) - tokyoDayNumber(date);
  if (days === 0) return '今日';
  if (days === 1) return '昨日';
  if (days > 1) return `${days}日前`;
  if (days === -1) return '明日';
  return `${Math.abs(days)}日後`;
}

function httpUrl(value) {
  const raw = text(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function firstDate(values) {
  for (const value of values) {
    const date = parseDate(value);
    if (date) return date;
  }
  return null;
}

function calendarStart(meeting) {
  const meta = isRecord(meeting?.metadata) ? meeting.metadata : {};
  const event = isRecord(meeting?.calendar_event) ? meeting.calendar_event
    : isRecord(meta.calendar_event) ? meta.calendar_event : null;
  return firstDate([
    meeting?.calendar_start,
    event?.start,
    event?.starts_at,
    event?.start_at,
    meta.calendar_start,
    meta.event_start,
    meta.scheduled_start,
  ]);
}

function listedVersions(entry) {
  const versions = [];
  if (Array.isArray(entry?.versions)) versions.push(...entry.versions.filter(isRecord));
  for (const documentRecord of Array.isArray(entry?.minutes) ? entry.minutes : []) {
    if (Array.isArray(documentRecord?.versions)) versions.push(...documentRecord.versions.filter(isRecord));
  }
  return versions;
}

function latestVersionTime(entry) {
  let latest = null;
  for (const version of listedVersions(entry)) {
    const date = parseDate(version.created_at);
    if (date && (!latest || date > latest)) latest = date;
  }
  return latest ?? firstDate([
    entry?.latest_version_created_at,
    entry?.meeting?.latest_version_created_at,
    isRecord(entry?.meeting?.metadata) ? entry.meeting.metadata.latest_version_created_at : null,
  ]);
}

function importTime(entry) {
  let latest = parseDate(entry?.meeting?.created_at);
  for (const documentRecord of Array.isArray(entry?.minutes) ? entry.minutes : []) {
    const date = parseDate(documentRecord?.created_at);
    if (date && (!latest || date > latest)) latest = date;
  }
  return latest;
}

function meetingTiming(entry) {
  const meeting = isRecord(entry?.meeting) ? entry.meeting : {};
  const scheduled = parseDate(meeting.scheduled_at);
  if (scheduled) return { kind: 'scheduled', source: 'scheduled', at: scheduled.getTime(), date: scheduled };
  const calendar = calendarStart(meeting);
  if (calendar) return { kind: 'fallback', source: 'calendar', at: calendar.getTime(), date: calendar };
  const versionAt = latestVersionTime(entry);
  if (versionAt) return { kind: 'fallback', source: 'version', at: versionAt.getTime(), date: versionAt };
  const imported = importTime(entry);
  return { kind: 'unregistered', source: 'import', at: imported ? imported.getTime() : Number.NEGATIVE_INFINITY, date: imported };
}

function unscheduledLabel(timing) {
  if (!timing?.date) return '会議の日時が未登録';
  const day = formatMonthDay(timing.date);
  if (timing.source === 'calendar') return `日時未登録・予定の開始 ${day}`;
  if (timing.source === 'version') return `日時未登録・版の作成 ${day}`;
  return `日時未登録・取り込み ${day}`;
}

function byCreatedAt(versions) {
  return versions
    .map((version, index) => ({ version, index }))
    .sort((left, right) => {
      const leftTime = parseDate(left.version?.created_at)?.getTime() ?? Number.NEGATIVE_INFINITY;
      const rightTime = parseDate(right.version?.created_at)?.getTime() ?? Number.NEGATIVE_INFINITY;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.index - right.index;
    })
    .map((item) => item.version);
}

function updatedTime(entry) {
  let latest = latestVersionTime(entry);
  for (const documentRecord of Array.isArray(entry?.minutes) ? entry.minutes : []) {
    const date = parseDate(documentRecord?.updated_at);
    if (date && (!latest || date > latest)) latest = date;
  }
  return latest ?? importTime(entry);
}

function sortMeetings(meetings, sort = 'scheduled-desc') {
  const byUpdate = sort === 'updated-desc';
  const direction = sort === 'scheduled-asc' ? 1 : -1;
  return meetings
    .map((entry, index) => {
      const timing = meetingTiming(entry);
      const updated = byUpdate ? updatedTime(entry) : null;
      return {
        entry,
        index,
        bottom: byUpdate ? !updated : timing.kind === 'unregistered',
        at: byUpdate ? updated?.getTime() ?? Number.NEGATIVE_INFINITY : timing.at,
      };
    })
    .sort((left, right) => {
      if (left.bottom !== right.bottom) return left.bottom ? 1 : -1;
      // Meetings without a date keep the newest import first in every order.
      if (left.at !== right.at) return left.bottom ? right.at - left.at : (left.at - right.at) * direction;
      return left.index - right.index;
    })
    .map((item) => item.entry);
}

function searchText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja');
}

function tokyoDateValue(date) {
  const { year, month, day } = tokyoParts(date);
  return `${year}-${pad(month)}-${pad(day)}`;
}

function participantsOf(entry) {
  const ids = entry?.meeting?.participant_ids;
  return Array.isArray(ids) ? ids.map((id) => text(id)).filter(Boolean) : [];
}

function matchesFilters(entry, filters) {
  const terms = searchText(filters.query).split(/\s+/u).filter(Boolean);
  if (terms.length) {
    const documents = Array.isArray(entry?.minutes) ? entry.minutes : [];
    const haystack = searchText([entry?.meeting?.title, ...documents.map((documentRecord) => documentRecord?.title)].join('\n'));
    if (!terms.every((term) => haystack.includes(term))) return false;
  }
  if (filters.from || filters.to) {
    const timing = meetingTiming(entry);
    if (!timing.date) return false;
    const day = tokyoDateValue(timing.date);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
  }
  if (filters.participant && !participantsOf(entry).includes(filters.participant)) return false;
  if (filters.status && listState(entry)?.code !== filters.status) return false;
  return true;
}

function idempotencyKey() {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `meeting-minutes-${random}`;
}

function createHttpError(status, payload) {
  const error = isRecord(payload?.error) ? payload.error : {};
  const result = new Error(text(error.message, `HTTP ${status}`));
  result.name = 'MeetingMinutesUIHttpError';
  result.status = status;
  result.code = text(error.code, `http_${status}`);
  return result;
}

function loadErrorMessage(error, fallback) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function isAccessDenied(error) {
  const status = Number(error?.status);
  const code = text(error?.code);
  return status === 401 || status === 403 || status === 404
    || code === 'authorization_denied' || code === 'not_found';
}

function preserveLoadedStateOnFailure(error) {
  if (isAccessDenied(error)) return false;
  const status = Number(error?.status);
  if (Number.isFinite(status)) return status === 408 || status === 429 || status >= 500;
  return true;
}

function sourceLabel(source) {
  if (!isRecord(source)) return '';
  const provider = text(source.provider, '外部ソース');
  const locator = text(source.locator, '場所は記録されていません');
  const revision = text(source.revision, '版は記録されていません');
  return `${provider} / ${locator} / ${revision}`;
}

function renderMarkdown(doc, body) {
  const root = makeElement(doc, 'div', { className: 'bb-minutes-markdown' });
  const lines = String(body).replace(/\r\n/g, '\n').split('\n');
  let list = null;
  let listKind = null;
  const closeList = () => {
    if (list) root.append(list);
    list = null;
    listKind = null;
  };
  for (const line of lines) {
    if (/^\s*[-*_]{3,}\s*$/u.test(line)) {
      closeList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length, 3);
      root.append(makeElement(doc, `h${level + 2}`, {
        className: 'bb-minutes-md-heading',
        textContent: heading[2].trim(),
      }));
      continue;
    }
    const bullet = /^\s*[-*]\s+(.+)$/u.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/u.exec(line);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (!list || listKind !== kind) {
        closeList();
        list = makeElement(doc, kind, { className: 'bb-minutes-md-list' });
        listKind = kind;
      }
      list.append(makeElement(doc, 'li', { textContent: (bullet ?? numbered)[1].trim() }));
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    closeList();
    root.append(makeElement(doc, 'p', { className: 'bb-minutes-md-paragraph', textContent: line }));
  }
  closeList();
  return root;
}

function versionContent(doc, version) {
  if (!isRecord(version)) return makeElement(doc, 'p', { textContent: '版の形式を確認できません。', className: 'bb-minutes-warning' });
  if (isRecord(version.source_ref)) {
    return makeElement(doc, 'p', { className: 'bb-minutes-source', textContent: `本文は元の記録にあります。${sourceLabel(version.source_ref)}` });
  }
  if (typeof version.body === 'string') return renderMarkdown(doc, version.body);
  return makeElement(doc, 'p', { className: 'bb-minutes-warning', textContent: '本文または外部参照を確認できません。' });
}

function detailVersions(detail, minutesId) {
  if (!isRecord(detail) || !Array.isArray(detail.versions)) return [];
  return byCreatedAt(detail.versions.filter((version) => version?.minutes_id === minutesId));
}

function versionLabel(versions, version) {
  const index = versions.findIndex((candidate) => candidate?.version_id === version?.version_id);
  return index >= 0 ? `第${index + 1}版` : '版';
}

function confirmationDetail(confirmation) {
  const when = formatStamp(confirmation?.confirmed_at) || text(confirmation?.confirmed_at);
  const person = text(confirmation?.actor_id);
  if (when && person) return `${when} ${person}が確認`;
  if (when) return `${when} 確認した人の記録がありません`;
  if (person) return `${person}が確認`;
  return '確認済み';
}

function versionState(version, versions, latest) {
  if (!isRecord(version)) return { code: 'unknown', label: '確認の状態を確かめられません', tone: 'muted' };
  if (version.creating === true || version.status === 'creating') {
    return { code: 'creating', label: '版の作成中', tone: 'muted' };
  }
  if (version.confirmation != null && !isRecord(version.confirmation)) {
    return { code: 'unknown', label: '確認の状態を確かめられません', tone: 'muted' };
  }
  const isLatest = Boolean(latest) && version.version_id === latest.version_id;
  if (isRecord(version.confirmation)) {
    return { code: 'confirmed', label: '確認済み', tone: 'ok', detail: confirmationDetail(version.confirmation) };
  }
  if (!isLatest && latest) {
    return { code: 'replaced', label: `確認されないまま${versionLabel(versions, latest)}に置き換え`, tone: 'muted' };
  }
  return { code: 'pending', label: '確認待ち', tone: 'wait' };
}

function creatorFact(version) {
  const creator = text(version?.created_actor_id);
  return creator ? `作成 ${creator}` : '作成者は未記録';
}

function historyStamp(version, today) {
  const created = parseDate(version?.created_at);
  return created
    ? `${formatMonthDay(created)} ${formatClock(created)} 作成（${relativeDay(created, today)}）`
    : '作成日時は未記録';
}

function historySecondLine(version, versions, latest) {
  const state = versionState(version, versions, latest);
  const confirmed = state.code === 'confirmed'
    ? (state.detail || confirmationDetail(version.confirmation))
    : state.label;
  const parts = [creatorFact(version), confirmed];
  if (version?.predecessor_version_id) {
    const predecessor = versions.find((candidate) => candidate.version_id === version.predecessor_version_id);
    parts.push(`${versionLabel(versions, predecessor)}を訂正`);
  }
  return parts.join('・');
}

function listedVersionNumber(entry) {
  const versions = listedVersions(entry);
  const documents = Array.isArray(entry?.minutes) ? entry.minutes : [];
  if (versions.length >= 2) {
    const currentId = documents.map((documentRecord) => text(documentRecord?.current_version_id)).find(Boolean);
    const index = versions.findIndex((version) => version.version_id === currentId);
    return index >= 0 ? index + 1 : versions.length;
  }
  const count = documents.reduce((max, documentRecord) => Math.max(
    max,
    Array.isArray(documentRecord?.version_ids) ? documentRecord.version_ids.length : 0,
  ), 0);
  return count >= 2 ? count : 0;
}

function listState(entry) {
  const versions = listedVersions(entry);
  if (!versions.length) return null;
  const documents = Array.isArray(entry?.minutes) ? entry.minutes : [];
  const currentId = documents.map((documentRecord) => text(documentRecord?.current_version_id)).find(Boolean);
  const latest = versions.find((version) => version.version_id === currentId) ?? versions[versions.length - 1];
  return versionState(latest, versions, latest);
}

function appendIdentifiers(doc, parent, { meetingId, minutesId, versionId } = {}) {
  const details = makeElement(doc, 'details', { className: 'bb-minutes-identifiers' });
  details.append(makeElement(doc, 'summary', { textContent: '識別情報' }));
  const rows = [
    ['会議ID', meetingId],
    ['議事録ID', minutesId],
    ['版ID', versionId],
  ].filter(([, value]) => typeof value === 'string' && value);
  for (const [label, value] of rows) {
    details.append(makeElement(doc, 'div', {
      className: 'bb-minutes-identifier-row',
      textContent: `${label}: ${value}`,
    }));
  }
  parent.append(details);
}

function appendVersionActionExtensions(doc, section, {
  extensions,
  detail,
  documentRecord,
  version,
  request,
  mutate,
  refresh,
  setStatus,
  bodyRoot,
} = {}) {
  for (const extension of Array.isArray(extensions) ? extensions : []) {
    if (!extension || typeof extension !== 'object' || typeof extension.mount !== 'function') continue;
    const id = text(extension.id, 'version-action');
    const slot = makeElement(doc, 'div', {
      className: 'bb-minutes-version-extension',
      attrs: { 'data-minutes-version-extension': id },
    });
    section.append(slot);
    try {
      const mounted = extension.mount({
        root: slot,
        document: doc,
        detail,
        documentRecord,
        version,
        request,
        mutate,
        refresh,
        setStatus,
        bodyRoot,
      });
      if (mounted && typeof mounted.then === 'function') {
        mounted.catch(() => {
          slot.replaceChildren(makeElement(doc, 'p', {
            className: 'bb-minutes-warning',
            textContent: '追加の保存先情報を表示できません。',
          }));
        });
      }
    } catch {
      slot.replaceChildren(makeElement(doc, 'p', {
        className: 'bb-minutes-warning',
        textContent: '追加の保存先情報を表示できません。',
      }));
    }
  }
}

export function createMeetingMinutesUI({
  root,
  rail = null,
  page = null,
  document: explicitDocument,
  fetcher,
  token,
  basePath = '/api/meeting-minutes',
  versionActionExtensions = [],
  meetingLabel,
  canCreateMeeting,
  createUnavailableReason,
  canEditMinutes,
  hostFilters = [],
  now = () => new Date(),
} = {}) {
  if (!root) throw new TypeError('root is required');
  const doc = explicitDocument ?? (typeof document === 'undefined' ? null : document);
  if (!doc || typeof doc.createElement !== 'function') throw new Error('document_unavailable');
  const request = typeof fetcher === 'function'
    ? fetcher
    : typeof globalThis.fetch === 'function' ? (path, init) => globalThis.fetch(path, init) : null;
  const base = String(basePath).replace(/\/+$/u, '');
  const state = {
    meetings: [],
    detail: null,
    meetingId: null,
    minutesId: null,
    versionId: null,
    loading: false,
    listError: null,
    detailError: null,
    filters: { ...EMPTY_FILTERS },
    sort: SORTS[0].value,
  };
  let listRequestGeneration = 0;
  let detailRequestGeneration = 0;
  let createReasonSequence = 0;

  const screen = makeElement(doc, 'div', { className: 'bb-minutes-screen', attrs: { 'data-contract-version': MEETING_MINUTES_UI_CONTRACT_VERSION } });
  const heading = makeElement(doc, 'header', { className: 'bb-minutes-heading' });
  heading.append(
    makeElement(doc, 'div', { className: 'bb-minutes-eyebrow', textContent: page?.source ?? '正本の議事録' }),
    makeElement(doc, 'h1', { textContent: '議事録' }),
    makeElement(doc, 'p', { className: 'bb-minutes-lead', textContent: '新しい会議から読み、確認待ちを見つけて確認します。' }),
  );
  const status = makeElement(doc, 'p', { className: 'bb-minutes-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const toolbar = makeElement(doc, 'div', {
    className: 'bb-minutes-toolbar',
    attrs: { role: 'search', 'aria-label': '議事録の絞り込みと並べ替え' },
  });
  const columns = makeElement(doc, 'div', { className: 'bb-minutes-columns' });
  const listPane = makeElement(doc, 'section', {
    className: 'bb-minutes-list-pane',
    attrs: { 'aria-label': '議事録', tabindex: '-1' },
  });
  const detailPane = makeElement(doc, 'section', { className: 'bb-minutes-detail-pane', attrs: { 'aria-label': '議事録詳細' } });
  columns.append(listPane, detailPane);
  screen.append(heading, status, toolbar, columns);
  root.replaceChildren(screen);

  function filterField(label, control, className = '') {
    const field = makeElement(doc, 'div', { className: `bb-minutes-filter-field${className ? ` ${className}` : ''}` });
    field.append(makeElement(doc, 'span', { className: 'bb-minutes-label', textContent: label }), control);
    return field;
  }

  function filterCombobox(label, options, value, onChange) {
    return workspaceCombobox(doc, { label, options, value, className: 'bb-minutes-filter-combobox', onChange });
  }

  const keyword = makeElement(doc, 'input', {
    className: 'bb-minutes-input bb-minutes-filter-keyword',
    type: 'search',
    attrs: { 'aria-label': '会議名・議事録名で絞り込む', placeholder: '会議名・議事録名', autocomplete: 'off' },
  });
  keyword.addEventListener('input', () => { state.filters.query = keyword.value; renderList(); });
  const fromInput = makeElement(doc, 'input', { className: 'bb-minutes-input', type: 'date', attrs: { 'aria-label': '期間の始め' } });
  const toInput = makeElement(doc, 'input', { className: 'bb-minutes-input', type: 'date', attrs: { 'aria-label': '期間の終わり' } });
  fromInput.addEventListener('change', () => { state.filters.from = fromInput.value; renderList(); });
  toInput.addEventListener('change', () => { state.filters.to = toInput.value; renderList(); });
  const period = makeElement(doc, 'span', { className: 'bb-minutes-filter-period' });
  period.append(fromInput, makeElement(doc, 'span', { className: 'bb-minutes-filter-period-sep', textContent: '〜', attrs: { 'aria-hidden': 'true' } }), toInput);
  const participantBox = filterCombobox('参加者', [{ value: '', label: 'すべての参加者' }], '', (value) => { state.filters.participant = value; renderList(); });
  const statusBox = filterCombobox('確認の状態', STATE_FILTERS, '', (value) => { state.filters.status = value; renderList(); });
  const sortBox = filterCombobox('並べ替え', SORTS, state.sort, (value) => { state.sort = value; renderList(); });
  const hostSlot = makeElement(doc, 'div', { className: 'bb-minutes-filter-host' });
  const participantField = filterField('参加者', participantBox.root);
  const statusField = filterField('確認の状態', statusBox.root);
  const reset = button(doc, '条件を外す', () => clearFilters(), { className: 'bb-minutes-button bb-minutes-filter-reset' });
  toolbar.append(
    filterField('キーワード', keyword, 'is-keyword'),
    hostSlot,
    filterField('期間', period, 'is-period'),
    participantField,
    statusField,
    filterField('並べ替え', sortBox.root),
    reset,
  );
  const hostBoxes = new Map();

  function currentHostFilters() {
    let filters = hostFilters;
    if (typeof filters === 'function') {
      try { filters = filters(); } catch { filters = []; }
    }
    return (Array.isArray(filters) ? filters : []).filter((filter) => isRecord(filter) && text(filter.id));
  }

  function clientFiltersActive() {
    return Object.keys(EMPTY_FILTERS).some((key) => Boolean(state.filters[key]));
  }

  function filtersActive() {
    return clientFiltersActive() || currentHostFilters().some((filter) => text(filter.value));
  }

  function clearFilters() {
    state.filters = { ...EMPTY_FILTERS };
    keyword.value = '';
    fromInput.value = '';
    toInput.value = '';
    for (const filter of currentHostFilters()) {
      if (text(filter.value) && typeof filter.onChange === 'function') filter.onChange('');
    }
    renderList();
  }

  function renderToolbar(meetings) {
    const hosts = currentHostFilters();
    const seen = new Set();
    for (const filter of hosts) {
      const id = text(filter.id);
      seen.add(id);
      const options = Array.isArray(filter.options) ? filter.options : [];
      const value = text(filter.value);
      let entry = hostBoxes.get(id);
      if (!entry) {
        const box = workspaceCombobox(doc, {
          label: text(filter.label, id),
          options,
          value,
          placeholder: text(filter.placeholder, '選択してください'),
          className: 'bb-minutes-filter-combobox',
          onChange: (next) => {
            const current = currentHostFilters().find((candidate) => text(candidate.id) === id);
            if (typeof current?.onChange === 'function') current.onChange(next);
          },
        });
        entry = { box, field: filterField(text(filter.label, id), box.root) };
        hostBoxes.set(id, entry);
      }
      entry.box.update({ options, value, disabled: filter.disabled === true });
    }
    for (const [id, entry] of hostBoxes) {
      if (seen.has(id)) continue;
      entry.box.destroy();
      hostBoxes.delete(id);
    }
    hostSlot.replaceChildren(...hosts.map((filter) => hostBoxes.get(text(filter.id)).field));
    hostSlot.hidden = hosts.length === 0;

    // Offer only the conditions the loaded records can answer (P9).
    const participants = [...new Set(meetings.flatMap(participantsOf))]
      .sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }));
    if (state.filters.participant && !participants.includes(state.filters.participant)) state.filters.participant = '';
    participantBox.update({
      options: [{ value: '', label: 'すべての参加者' }, ...participants.map((participant) => ({ value: participant, label: participant }))],
      value: state.filters.participant,
    });
    participantField.hidden = participants.length === 0;
    const hasStates = meetings.some((entry) => listState(entry));
    if (!hasStates) state.filters.status = '';
    statusBox.update({ value: state.filters.status });
    statusField.hidden = !hasStates;
    sortBox.update({ value: state.sort });
    reset.hidden = !filtersActive();
  }

  function clock() {
    try {
      const value = typeof now === 'function' ? now() : new Date();
      if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    } catch {
      /* use the runtime clock */
    }
    return new Date();
  }

  function setStatus(message, kind = '') {
    status.textContent = message;
    status.className = `bb-minutes-status${kind ? ` is-${kind}` : ''}`;
  }

  async function call(path, init = {}) {
    if (!request) throw new Error('ホストに接続できません。');
    const headers = { Accept: 'application/json', ...(init.headers ?? {}) };
    if (token) headers['X-Brainbase-Review-Token'] = token;
    let response;
    try {
      response = await request(`${base}${path}`, { ...init, headers });
    } catch {
      throw new Error('ホストに接続できません。');
    }
    let payload = null;
    try { payload = await response.json(); } catch { /* handled below */ }
    if (!response.ok) throw createHttpError(response.status, payload);
    if (payload === null) throw new Error('ホストの応答を読み取れません。');
    return payload;
  }

  async function mutate(path, body) {
    return call(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey() },
      body: JSON.stringify(body),
    });
  }

  function clear(node) { node.replaceChildren(); return node; }

  function canCreate() {
    if (typeof canCreateMeeting === 'function') {
      try {
        return canCreateMeeting() === true;
      } catch {
        return false;
      }
    }
    return canCreateMeeting !== false;
  }

  /** One short reason from the host, shown beside a create button that cannot be pressed. */
  function createReason() {
    if (typeof createUnavailableReason === 'function') {
      try {
        return text(createUnavailableReason());
      } catch {
        return '';
      }
    }
    return text(createUnavailableReason);
  }

  function appendCreateUnavailable(parent) {
    const reason = createReason();
    if (!reason) return;
    const id = `bb-minutes-create-reason-${++createReasonSequence}`;
    parent.append(
      makeElement(doc, 'button', {
        className: 'bb-minutes-button is-primary',
        textContent: '会議を作成',
        type: 'button',
        disabled: true,
        attrs: { type: 'button', 'aria-describedby': id },
      }),
      makeElement(doc, 'span', { className: 'bb-minutes-create-reason', textContent: reason, attrs: { id } }),
    );
  }

  function canEdit() {
    if (typeof canEditMinutes === 'function') {
      try {
        return canEditMinutes() === true;
      } catch {
        return false;
      }
    }
    return canEditMinutes !== false;
  }

  function stateChip(versionStatus, { detailed = false } = {}) {
    const label = detailed && versionStatus.detail ? versionStatus.detail : versionStatus.label;
    return makeElement(doc, 'span', {
      className: `bb-minutes-state is-${versionStatus.tone}`,
      textContent: label,
    });
  }

  function appendLinePart(line, node) {
    if (line.children.length) line.append(makeElement(doc, 'span', { className: 'bb-minutes-line-sep', textContent: ' · ' }));
    line.append(node);
  }

  function appendReadOnlyNotice(parent, version) {
    const source = isRecord(version?.source_ref) ? version.source_ref : null;
    const url = httpUrl(source?.locator);
    const provider = text(source?.provider, '元の記録');
    const notice = makeElement(doc, 'div', { className: 'bb-minutes-edit-guard is-info' });
    notice.append(makeElement(doc, 'p', {
      textContent: canEdit()
        ? 'この画面では読むことと確認だけができます。'
        : 'この画面では読むことだけができます。確認はプロジェクトの編集権限がある人が行います。',
    }));
    if (url) {
      const line = makeElement(doc, 'p', { textContent: '本文を直すときは、元の記録で編集してください。' });
      line.append(makeElement(doc, 'a', {
        className: 'bb-minutes-source-link',
        textContent: `元の記録を開く（${provider}）`,
        attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' },
      }));
      notice.append(line);
    } else {
      notice.append(makeElement(doc, 'p', { textContent: '本文を直すときは、議事録を取り込んだ元で編集してください。' }));
    }
    parent.append(notice);
  }

  function appendLoadError(parent, message, retry) {
    const notice = makeElement(doc, 'div', {
      className: 'bb-minutes-load-error',
      attrs: { role: 'alert' },
    });
    notice.append(makeElement(doc, 'p', { textContent: message }));
    notice.append(button(doc, '再試行', () => { void retry(); }));
    parent.append(notice);
  }

  function renderMeetingRow(entry, { flat = false } = {}) {
    const meeting = entry.meeting;
    const timing = meetingTiming(entry);
    const item = makeElement(doc, 'button', {
      className: `bb-minutes-meeting-item${state.meetingId === meeting.meeting_id ? ' is-selected' : ''}`,
      type: 'button',
      attrs: { type: 'button' },
    });
    item.append(makeElement(doc, 'strong', {
      className: 'bb-minutes-item-title',
      textContent: text(meeting.title, '無題の会議'),
    }));
    const line = makeElement(doc, 'span', { className: 'bb-minutes-item-line' });
    if (timing.kind === 'scheduled') {
      // Without date headings the row carries its own date.
      const when = flat ? `${formatMonthDay(timing.date)} ${formatClock(timing.date)}` : formatClock(timing.date);
      appendLinePart(line, makeElement(doc, 'span', { textContent: when }));
    } else if (timing.kind === 'fallback' || (timing.kind === 'unregistered' && timing.date)) {
      appendLinePart(line, makeElement(doc, 'span', { textContent: unscheduledLabel(timing) }));
    }
    if (flat) {
      const updated = updatedTime(entry);
      appendLinePart(line, makeElement(doc, 'span', {
        className: 'bb-minutes-item-updated',
        textContent: updated ? `更新 ${formatMonthDay(updated)} ${formatClock(updated)}` : '更新日時は未記録',
      }));
    }
    const label = meetingLabelText(meetingLabel, meeting);
    if (label) appendLinePart(line, makeElement(doc, 'span', { className: 'bb-minutes-meeting-label', textContent: label }));
    const rowState = listState(entry);
    if (rowState) appendLinePart(line, stateChip(rowState));
    const versionNumber = listedVersionNumber(entry);
    if (versionNumber >= 2) appendLinePart(line, makeElement(doc, 'span', { textContent: `第${versionNumber}版` }));
    const minutesCount = Array.isArray(entry.minutes) ? entry.minutes.length : 0;
    if (minutesCount >= 2) appendLinePart(line, makeElement(doc, 'span', { textContent: `議事録 ${minutesCount}件` }));
    item.append(line);
    item.addEventListener('click', () => void loadDetail(meeting.meeting_id));
    return item;
  }

  function renderList() {
    clear(listPane);
    const head = makeElement(doc, 'div', { className: 'bb-minutes-pane-head' });
    const meetings = state.meetings.filter((entry) => isRecord(entry?.meeting) && typeof entry.meeting.meeting_id === 'string');
    renderToolbar(meetings);
    const visible = sortMeetings(meetings.filter((entry) => matchesFilters(entry, state.filters)), state.sort);
    if (canCreate()) {
      head.append(button(doc, '会議を作成', () => renderCreateForm(), { className: 'bb-minutes-button is-primary' }));
    } else {
      appendCreateUnavailable(head);
    }
    const narrowed = clientFiltersActive();
    head.append(makeElement(doc, 'p', {
      className: 'bb-minutes-sort-note',
      textContent: narrowed ? `${meetings.length}件中${visible.length}件` : `${meetings.length}件`,
    }));
    listPane.append(head);
    if (state.listError) {
      appendLoadError(listPane, `会議一覧を読み込めませんでした。理由: ${state.listError}`, () => loadMeetings({ restoreFocus: true }));
    }
    if (meetings.length === 0) {
      if (state.listError) return;
      listPane.append(makeElement(doc, 'p', {
        className: 'bb-minutes-empty',
        textContent: filtersActive()
          ? '条件に合う会議はありません。'
          : 'まだ議事録はありません。会議を取り込むと、ここに新しい順で並びます。',
      }));
      if (filtersActive()) listPane.append(button(doc, '条件を外す', () => clearFilters()));
      return;
    }
    if (visible.length === 0) {
      listPane.append(makeElement(doc, 'p', { className: 'bb-minutes-empty', textContent: '条件に合う会議はありません。' }));
      listPane.append(button(doc, '条件を外す', () => clearFilters()));
      return;
    }
    const list = makeElement(doc, 'div', { className: 'bb-minutes-meeting-list' });
    if (state.sort === 'updated-desc') {
      for (const entry of visible) list.append(renderMeetingRow(entry, { flat: true }));
      listPane.append(list);
      return;
    }
    const today = clock();
    let currentKey = null;
    for (const entry of visible) {
      const timing = meetingTiming(entry);
      if (timing.kind === 'unregistered') continue;
      const key = dateKey(timing.date);
      if (key !== currentKey) {
        currentKey = key;
        list.append(makeElement(doc, 'h3', {
          className: 'bb-minutes-date-heading',
          textContent: dayHeading(timing.date, today),
        }));
      }
      list.append(renderMeetingRow(entry));
    }
    const unregistered = visible.filter((entry) => meetingTiming(entry).kind === 'unregistered');
    if (unregistered.length) {
      list.append(makeElement(doc, 'h3', {
        className: 'bb-minutes-date-heading',
        textContent: '会議の日時が未登録（取り込んだ日の新しい順）',
      }));
      for (const entry of unregistered) list.append(renderMeetingRow(entry));
    }
    listPane.append(list);
  }

  function renderRail(version, documentRecord, meeting) {
    if (!rail) return;
    clear(rail);
    const block = makeElement(doc, 'section', { className: 'bb-minutes-rail-block' });
    block.append(makeElement(doc, 'h2', { textContent: '関連' }));
    if (!meeting && !version) {
      block.append(makeElement(doc, 'p', { textContent: '議事録を選ぶと、ここに本文が出ます。' }));
      rail.append(block);
      return;
    }
    block.append(makeElement(doc, 'h3', { textContent: '予定' }));
    block.append(makeElement(doc, 'p', { className: 'bb-minutes-rail-note', textContent: '予定とのつながりは未対応です。' }));
    block.append(makeElement(doc, 'h3', { textContent: 'プロジェクト' }));
    const label = meetingLabelText(meetingLabel, meeting);
    block.append(makeElement(doc, 'p', { textContent: label || 'プロジェクトは記録されていません' }));
    appendIdentifiers(doc, block, {
      meetingId: meeting?.meeting_id,
      minutesId: documentRecord?.minutes_id,
      versionId: version?.version_id,
    });
    rail.append(block);
  }

  function renderVersion(detail, documentRecord, selectedVersion, noticeState) {
    const versions = detailVersions(detail, documentRecord.minutes_id);
    const latest = versions.find((version) => version.version_id === documentRecord.current_version_id) ?? versions[versions.length - 1] ?? null;
    const selected = selectedVersion ?? latest;
    state.versionId = selected?.version_id ?? null;
    const selectedLabel = versionLabel(versions, selected);
    const selectedState = versionState(selected, versions, latest);
    const latestState = versionState(latest, versions, latest);
    const viewingOld = Boolean(selected && latest && selected.version_id !== latest.version_id);
    const section = makeElement(doc, 'section', { className: 'bb-minutes-document' });
    if (viewingOld) {
      const banner = makeElement(doc, 'div', { className: 'bb-minutes-old-version' });
      const latestName = latestState.code === 'confirmed' ? '確認済み' : latestState.label;
      banner.append(makeElement(doc, 'p', {
        textContent: `古い版を表示しています。最新は${versionLabel(versions, latest)}（${latestName}）です。`,
      }));
      banner.append(button(doc, '最新の版を見る', () => {
        clear(detailPane);
        renderDetail(detail, documentRecord, latest);
      }));
      section.append(banner);
    }
    const band = makeElement(doc, 'div', { className: 'bb-minutes-version-band' });
    const latestMark = selected && latest && selected.version_id === latest.version_id ? '（最新）' : '';
    band.append(makeElement(doc, 'strong', { textContent: `${selectedLabel}${latestMark}` }));
    const created = formatStamp(selected?.created_at);
    if (created) band.append(makeElement(doc, 'span', { className: 'bb-minutes-item-meta', textContent: created }));
    band.append(stateChip(selectedState, { detailed: true }));
    const history = makeElement(doc, 'div', { className: 'bb-minutes-version-history is-collapsed', attrs: { 'aria-label': '版の履歴' } });
    const historyButton = button(doc, `版の履歴（${versions.length}件）`, () => {
      const collapsed = history.className.includes('is-collapsed');
      history.className = collapsed ? 'bb-minutes-version-history' : 'bb-minutes-version-history is-collapsed';
      historyButton.textContent = collapsed ? `版の履歴を閉じる（${versions.length}件）` : `版の履歴（${versions.length}件）`;
    });
    band.append(historyButton);
    section.append(band);
    if (!noticeState.placed) {
      noticeState.placed = true;
      appendReadOnlyNotice(section, selected);
    }
    for (const version of [...versions].reverse()) {
      const versionButton = makeElement(doc, 'button', {
        className: `bb-minutes-version${version.version_id === selected?.version_id ? ' is-selected' : ''}`,
        type: 'button',
        attrs: { type: 'button' },
      });
      const itemState = versionState(version, versions, latest);
      const isLatest = Boolean(latest) && version.version_id === latest.version_id;
      const line1 = makeElement(doc, 'span', { className: 'bb-minutes-version-line' });
      line1.append(
        makeElement(doc, 'strong', { textContent: `${versionLabel(versions, version)}${isLatest ? '（最新）' : ''}` }),
        stateChip(itemState),
        makeElement(doc, 'span', { className: 'bb-minutes-version-stamp', textContent: historyStamp(version, clock()) }),
      );
      versionButton.append(
        line1,
        makeElement(doc, 'span', {
          className: 'bb-minutes-version-line is-secondary',
          textContent: historySecondLine(version, versions, latest),
        }),
      );
      versionButton.addEventListener('click', () => {
        clear(detailPane);
        renderDetail(detail, documentRecord, version);
      });
      history.append(versionButton);
    }
    section.append(history);
    const content = makeElement(doc, 'div', { className: 'bb-minutes-version-content' });
    const bodyRoot = makeElement(doc, 'div', {
      className: 'bb-minutes-external-body-slot',
      attrs: { 'data-minutes-external-body': 'true' },
    });
    content.append(versionContent(doc, selected), bodyRoot);
    section.append(content);
    if (selected && canEdit() && !isRecord(selected.confirmation) && selectedState.code !== 'unknown' && selectedState.code !== 'creating') {
      const confirm = button(doc, 'この版を確認済みにする', async () => {
        if (!canEdit()) {
          clear(detailPane);
          renderDetail(detail, documentRecord, selected);
          return;
        }
        confirm.disabled = true;
        try {
          await mutate(`/${encodeURIComponent(detail.meeting.meeting_id)}/minutes/${encodeURIComponent(documentRecord.minutes_id)}/confirm`, {
            version_id: selected.version_id,
            expected_revision: documentRecord.revision,
          });
          await loadDetail(detail.meeting.meeting_id);
          if (!state.detailError) setStatus(`${selectedLabel}を確認済みにしました。`, 'success');
        } catch (error) {
          confirm.disabled = false;
          setStatus(error instanceof Error ? error.message : '確認を保存できませんでした。', 'error');
        }
      }, { className: 'bb-minutes-button is-primary' });
      band.append(confirm);
    }
    appendVersionActionExtensions(doc, section, {
      extensions: versionActionExtensions,
      detail,
      documentRecord,
      version: selected,
      request: call,
      mutate,
      refresh: () => loadDetail(detail.meeting.meeting_id),
      setStatus,
      bodyRoot,
    });
    appendIdentifiers(doc, section, {
      meetingId: detail.meeting?.meeting_id,
      minutesId: documentRecord.minutes_id,
      versionId: selected?.version_id,
    });
    renderRail(selected, documentRecord, detail.meeting);
    return section;
  }

  function renderDetail(detail, documentRecord = null, selectedVersion = null) {
    clear(detailPane);
    if (state.detailError) {
      const retry = state.meetingId === null ? loadMeetings : () => loadDetail(state.meetingId);
      appendLoadError(detailPane, state.detailError.startsWith('会議詳細を読み込めませんでした。')
        ? state.detailError
        : `会議詳細を読み込めませんでした。理由: ${state.detailError}`, retry);
    }
    if (!detail || !isRecord(detail.meeting)) {
      if (state.detailError) {
        renderRail(null, null, null);
        return;
      }
      detailPane.append(makeElement(doc, 'p', { className: 'bb-minutes-empty', textContent: '議事録を選ぶと、ここに本文が出ます。' }));
      renderRail(null, null, null);
      return;
    }
    const meeting = detail.meeting;
    const header = makeElement(doc, 'header', { className: 'bb-minutes-detail-head' });
    header.append(makeElement(doc, 'h2', { textContent: text(meeting.title, '無題の会議') }));
    const label = meetingLabelText(meetingLabel, meeting);
    if (label) header.append(makeElement(doc, 'p', { className: 'bb-minutes-meeting-label', textContent: label }));
    const timing = meetingTiming({ meeting, minutes: detail.minutes, versions: detail.versions });
    const when = timing.kind === 'scheduled'
      ? `${formatMonthDay(timing.date)} ${formatClock(timing.date)}`
      : unscheduledLabel(timing);
    const participants = Array.isArray(meeting.participant_ids) && meeting.participant_ids.length
      ? meeting.participant_ids.join('、')
      : '';
    header.append(makeElement(doc, 'p', {
      className: 'bb-minutes-item-meta',
      textContent: participants ? `${when} / ${participants}` : when,
    }));
    detailPane.append(header);
    const documents = Array.isArray(detail.minutes) ? detail.minutes : [];
    const noticeState = { placed: false };
    if (documents.length === 0) {
      detailPane.append(makeElement(doc, 'p', { className: 'bb-minutes-warning', textContent: '議事録文書を読み取れません。' }));
      appendReadOnlyNotice(detailPane, null);
      noticeState.placed = true;
    }
    for (const documentRecordValue of documents) {
      detailPane.append(renderVersion(
        detail,
        documentRecordValue,
        documentRecordValue.minutes_id === documentRecord?.minutes_id ? selectedVersion : null,
        noticeState,
      ));
    }
  }

  function renderCreateUnavailable() {
    clear(detailPane);
    detailPane.append(makeElement(doc, 'p', { className: 'bb-minutes-empty', textContent: '議事録を選ぶと、ここに本文が出ます。' }));
    const reason = createReason();
    if (reason) detailPane.append(makeElement(doc, 'p', { className: 'bb-minutes-create-reason', textContent: reason }));
  }

  function renderCreateForm() {
    clear(detailPane);
    if (!canCreate()) {
      renderCreateUnavailable();
      return;
    }
    const form = makeElement(doc, 'form', { className: 'bb-minutes-create-form' });
    form.append(makeElement(doc, 'h2', { textContent: '会議を作成' }), makeElement(doc, 'p', { className: 'bb-minutes-item-meta', textContent: '外部サービスを接続しなくても、会議と議事録を保存できます。' }));
    const title = labelInput(doc, '会議名', { name: 'title', placeholder: '例: 週次定例' });
    const date = labelInput(doc, '日時（任意）', { type: 'datetime-local', name: 'scheduled_at' });
    const participants = labelInput(doc, '参加者（任意・カンマ区切り）', { name: 'participant_ids' });
    const minutesTitle = labelInput(doc, '最初の議事録名', { name: 'minutes_title', value: '議事録' });
    const body = labelInput(doc, '本文（任意）', { type: 'textarea', name: 'initial_body', placeholder: '会議の本文を入力' });
    body.input.rows = 8;
    const save = makeElement(doc, 'button', { className: 'bb-minutes-button is-primary', textContent: '会議を保存', type: 'submit' });
    form.append(title.wrapper, date.wrapper, participants.wrapper, minutesTitle.wrapper, body.wrapper, save);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!canCreate()) {
        save.disabled = true;
        renderList();
        renderCreateUnavailable();
        return;
      }
      save.disabled = true;
      try {
        const scheduledAt = date.input.value ? new Date(date.input.value).toISOString() : undefined;
        const payload = {
          title: title.input.value,
          ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
          participant_ids: participants.input.value.split(',').map((value) => value.trim()).filter(Boolean),
          minutes_title: minutesTitle.input.value,
          initial_body: body.input.value,
        };
        const created = await mutate('', payload);
        const id = created?.meeting?.meeting_id;
        setStatus('会議を保存しました。', 'success');
        await loadMeetings();
        if (typeof id === 'string') await loadDetail(id);
      } catch (error) {
        save.disabled = false;
        setStatus(error instanceof Error ? error.message : '会議を保存できませんでした。', 'error');
      }
    });
    detailPane.append(form);
  }

  async function loadMeetings({ restoreFocus = false } = {}) {
    const requestGeneration = ++listRequestGeneration;
    const isCurrentRequest = () => requestGeneration === listRequestGeneration;
    state.loading = true;
    setStatus('会議一覧を読み込んでいます。');
    try {
      const payload = await call('');
      if (!isCurrentRequest()) return state.meetings;
      if (!isRecord(payload) || !Array.isArray(payload.meetings) || payload.absence_confirmed !== true) throw new Error('会議一覧の形式を確認できません。');
      state.meetings = sortMeetings(payload.meetings);
      state.listError = null;
      const selectedMeetingStillListed = state.meetingId !== null
        && state.meetings.some((entry) => entry?.meeting?.meeting_id === state.meetingId);
      if (state.meetingId !== null && !selectedMeetingStillListed) {
        detailRequestGeneration += 1;
        state.detail = null;
        state.meetingId = null;
        state.minutesId = null;
        state.versionId = null;
        state.detailError = '会議詳細を読み込めませんでした。選択中の会議は現在の一覧に含まれません。アクセス権または絞り込み条件を確認して再試行してください。';
      } else if (!state.detail && state.meetingId === null) {
        const hadDetailError = Boolean(state.detailError);
        state.detailError = null;
        if (hadDetailError) renderDetail(null);
      }
      renderList();
      if (!state.detail) renderDetail(null);
      setStatus(state.meetings.length ? `${state.meetings.length}件の会議を読み込みました。` : 'まだ議事録はありません。');
      if (restoreFocus && typeof listPane.focus === 'function') listPane.focus({ preventScroll: true });
    } catch (error) {
      if (!isCurrentRequest()) return state.meetings;
      state.listError = loadErrorMessage(error, '会議一覧を読み込めませんでした。');
      const preserve = preserveLoadedStateOnFailure(error);
      const hadDetail = Boolean(state.detail) || state.meetingId !== null;
      if (!preserve) {
        state.meetings = [];
        if (hadDetail) {
          detailRequestGeneration += 1;
          state.detail = null;
          state.meetingId = null;
          state.minutesId = null;
          state.versionId = null;
          state.detailError = `会議詳細を読み込めませんでした。会議一覧へのアクセスを確認できません。理由: ${state.listError}`;
        }
      }
      renderList();
      if (!preserve && hadDetail) renderDetail(null);
      setStatus(state.listError, 'error');
    } finally {
      if (isCurrentRequest()) state.loading = false;
    }
    return state.meetings;
  }

  async function loadDetail(meetingId) {
    const requestGeneration = ++detailRequestGeneration;
    const isCurrentRequest = () => requestGeneration === detailRequestGeneration
      && state.meetingId === meetingId;
    state.meetingId = meetingId;
    state.minutesId = null;
    state.detailError = null;
    renderList();
    setStatus('会議詳細を読み込んでいます。');
    try {
      const detail = await call(`/${encodeURIComponent(meetingId)}`);
      if (!isCurrentRequest()) return state.detail;
      if (!isRecord(detail) || !isRecord(detail.meeting) || !Array.isArray(detail.minutes) || !Array.isArray(detail.versions)) throw new Error('会議詳細の形式を確認できません。');
      state.detail = detail;
      state.detailError = null;
      renderDetail(detail);
      setStatus('会議詳細を読み込みました。');
    } catch (error) {
      if (!isCurrentRequest()) return state.detail;
      const preserved = preserveLoadedStateOnFailure(error) && state.detail?.meeting?.meeting_id === meetingId
        ? state.detail
        : null;
      state.detail = preserved;
      state.detailError = loadErrorMessage(error, '会議詳細を読み込めませんでした。');
      renderDetail(preserved);
      setStatus(state.detailError, 'error');
    }
    return state.detail;
  }

  renderToolbar([]);
  renderDetail(null);
  void loadMeetings();
  return {
    contractVersion: MEETING_MINUTES_UI_CONTRACT_VERSION,
    refresh: loadMeetings,
    openMeeting: loadDetail,
    state,
  };
}

export default createMeetingMinutesUI;
