/*
 * Shared meeting-minutes screen.
 *
 * The screen only speaks the provider-independent HTTP contract.  A host
 * supplies the fetcher, token and base path; no calendar, repository, or
 * organization connector is assumed here.
 *
 * List order and labels are a projection. Canonical records are not rewritten.
 * Calendar links stay out until a meeting-side event id is verified.
 */

export const MEETING_MINUTES_UI_CONTRACT_VERSION = 'brainbase.meeting-minutes-ui.v1';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

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
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatMonthDay(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatStamp(value) {
  const date = parseDate(value);
  return date ? `${formatMonthDay(date)} ${formatClock(date)}` : '';
}

function dayHeading(date, today) {
  const label = `${formatMonthDay(date)}（${WEEKDAYS[date.getDay()]}）`;
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  return sameDay ? `今日 ${label}` : label;
}

function dateKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function relativeDay(date, today) {
  const days = Math.round((startOfLocalDay(today).getTime() - startOfLocalDay(date).getTime()) / 86400000);
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
  if (scheduled) return { kind: 'scheduled', at: scheduled.getTime(), date: scheduled };
  const calendar = calendarStart(meeting);
  if (calendar) return { kind: 'fallback', at: calendar.getTime(), date: calendar };
  const versionAt = latestVersionTime(entry);
  if (versionAt) return { kind: 'fallback', at: versionAt.getTime(), date: versionAt };
  const imported = importTime(entry);
  return { kind: 'unregistered', at: imported ? imported.getTime() : Number.NEGATIVE_INFINITY, date: imported };
}

function sortMeetings(meetings) {
  return meetings
    .map((entry, index) => ({ entry, index, timing: meetingTiming(entry) }))
    .sort((left, right) => {
      const leftBottom = left.timing.kind === 'unregistered';
      const rightBottom = right.timing.kind === 'unregistered';
      if (leftBottom !== rightBottom) return leftBottom ? 1 : -1;
      if (left.timing.at !== right.timing.at) return right.timing.at - left.timing.at;
      return left.index - right.index;
    })
    .map((item) => item.entry);
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
  return detail.versions.filter((version) => version?.minutes_id === minutesId);
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

function historyFacts(version, versions, latest, today) {
  const created = parseDate(version?.created_at);
  const stamp = created ? `${formatMonthDay(created)} ${formatClock(created)} 作成（${relativeDay(created, today)}）` : '作成日時は未記録';
  const state = versionState(version, versions, latest);
  const confirmed = state.code === 'confirmed'
    ? (state.detail || confirmationDetail(version.confirmation))
    : state.label;
  return `${stamp}・${creatorFact(version)}・${confirmed}`;
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
  canEditMinutes,
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
  };
  let listRequestGeneration = 0;
  let detailRequestGeneration = 0;

  const screen = makeElement(doc, 'div', { className: 'bb-minutes-screen', attrs: { 'data-contract-version': MEETING_MINUTES_UI_CONTRACT_VERSION } });
  const heading = makeElement(doc, 'header', { className: 'bb-minutes-heading' });
  heading.append(
    makeElement(doc, 'div', { className: 'bb-minutes-eyebrow', textContent: page?.source ?? '正本の議事録' }),
    makeElement(doc, 'h1', { textContent: '議事録' }),
    makeElement(doc, 'p', { className: 'bb-minutes-lead', textContent: '新しい会議から読み、確認待ちを見つけて確認します。' }),
  );
  const status = makeElement(doc, 'p', { className: 'bb-minutes-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const columns = makeElement(doc, 'div', { className: 'bb-minutes-columns' });
  const listPane = makeElement(doc, 'section', {
    className: 'bb-minutes-list-pane',
    attrs: { 'aria-label': '議事録', tabindex: '-1' },
  });
  const detailPane = makeElement(doc, 'section', { className: 'bb-minutes-detail-pane', attrs: { 'aria-label': '議事録詳細' } });
  columns.append(listPane, detailPane);
  screen.append(heading, status, columns);
  root.replaceChildren(screen);

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

  function renderMeetingRow(entry) {
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
      appendLinePart(line, makeElement(doc, 'span', { textContent: formatClock(timing.date) }));
    } else if (timing.kind === 'fallback') {
      appendLinePart(line, makeElement(doc, 'span', { textContent: `日時未登録・取り込み ${formatMonthDay(timing.date)}` }));
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
    if (canCreate()) {
      head.append(button(doc, '会議を作成', () => renderCreateForm(), { className: 'bb-minutes-button is-primary' }));
    }
    head.append(makeElement(doc, 'p', { className: 'bb-minutes-sort-note', textContent: `新しい順・${meetings.length}件` }));
    listPane.append(head);
    if (state.listError) {
      appendLoadError(listPane, `会議一覧を読み込めませんでした。理由: ${state.listError}`, () => loadMeetings({ restoreFocus: true }));
    }
    if (meetings.length === 0) {
      if (state.listError) return;
      listPane.append(makeElement(doc, 'p', {
        className: 'bb-minutes-empty',
        textContent: 'まだ議事録はありません。会議を取り込むと、ここに新しい順で並びます。',
      }));
      return;
    }
    const list = makeElement(doc, 'div', { className: 'bb-minutes-meeting-list' });
    const today = clock();
    let currentKey = null;
    for (const entry of meetings) {
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
    const unregistered = meetings.filter((entry) => meetingTiming(entry).kind === 'unregistered');
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
      versionButton.append(
        makeElement(doc, 'strong', { textContent: versionLabel(versions, version) }),
        stateChip(itemState),
        makeElement(doc, 'span', { className: 'bb-minutes-version-facts', textContent: historyFacts(version, versions, latest, clock()) }),
      );
      if (version.predecessor_version_id) {
        const predecessor = versions.find((candidate) => candidate.version_id === version.predecessor_version_id);
        versionButton.append(makeElement(doc, 'span', { textContent: `${versionLabel(versions, predecessor)}を訂正` }));
      }
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
    appendSaveForm(section, detail, documentRecord, selected);
    renderRail(selected, documentRecord, detail.meeting);
    return section;
  }

  function appendSaveForm(section, detail, documentRecord, selected) {
    if (!canEdit()) return;
    const form = makeElement(doc, 'form', { className: 'bb-minutes-save-form' });
    form.append(makeElement(doc, 'h4', { textContent: '訂正版を保存' }));
    const field = labelInput(doc, '本文（保存すると新しい版になります）', { type: 'textarea', name: 'body', placeholder: '議事録の本文を入力' });
    field.input.rows = 8;
    const save = makeElement(doc, 'button', { className: 'bb-minutes-button is-primary', textContent: '新しい版を保存', type: 'submit' });
    form.append(field.wrapper, save);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!canEdit()) {
        clear(detailPane);
        renderDetail(detail, documentRecord, selected);
        return;
      }
      save.disabled = true;
      try {
        await mutate(`/${encodeURIComponent(detail.meeting.meeting_id)}/minutes/${encodeURIComponent(documentRecord.minutes_id)}`, {
          body: field.input.value,
          expected_revision: documentRecord.revision,
        });
        setStatus('新しい版を保存しました。', 'success');
        await loadDetail(detail.meeting.meeting_id);
      } catch (error) {
        save.disabled = false;
        setStatus(error instanceof Error ? error.message : '版を保存できませんでした。', 'error');
      }
    });
    section.append(form);
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
      : timing.kind === 'fallback'
        ? `日時未登録・取り込み ${formatMonthDay(timing.date)}`
        : '会議の日時が未登録';
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
    const createForm = renderCreateMinutesForm(detail);
    if (createForm) detailPane.append(createForm);
  }

  function renderCreateMinutesForm(detail) {
    if (!canEdit()) return null;
    const form = makeElement(doc, 'form', { className: 'bb-minutes-create-form' });
    form.append(makeElement(doc, 'h3', { textContent: '議事録文書を追加' }));
    const title = labelInput(doc, '議事録の名前', { name: 'title', value: '議事録' });
    const body = labelInput(doc, '本文', { type: 'textarea', name: 'body', placeholder: '本文を入力' });
    body.input.rows = 5;
    const save = makeElement(doc, 'button', { className: 'bb-minutes-button', textContent: '議事録を追加', type: 'submit' });
    form.append(title.wrapper, body.wrapper, save);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!canEdit()) {
        clear(detailPane);
        renderDetail(detail);
        return;
      }
      save.disabled = true;
      try {
        await mutate(`/${encodeURIComponent(detail.meeting.meeting_id)}/minutes`, {
          title: title.input.value,
          body: body.input.value,
          expected_revision: detail.snapshot_revision,
        });
        setStatus('議事録文書を追加しました。', 'success');
        await loadMeetings();
        await loadDetail(detail.meeting.meeting_id);
      } catch (error) {
        save.disabled = false;
        setStatus(error instanceof Error ? error.message : '議事録を追加できませんでした。', 'error');
      }
    });
    return form;
  }

  function renderCreateForm() {
    clear(detailPane);
    if (!canCreate()) {
      detailPane.append(makeElement(doc, 'p', { className: 'bb-minutes-empty', textContent: '議事録を選ぶと、ここに本文が出ます。' }));
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
        clear(detailPane);
        detailPane.append(makeElement(doc, 'p', { className: 'bb-minutes-empty', textContent: '議事録を選ぶと、ここに本文が出ます。' }));
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
      if (state.detailError && state.detail === null) renderDetail(null);
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

  void loadMeetings();
  return {
    contractVersion: MEETING_MINUTES_UI_CONTRACT_VERSION,
    refresh: loadMeetings,
    openMeeting: loadDetail,
    state,
  };
}

export default createMeetingMinutesUI;
