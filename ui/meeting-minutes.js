/*
 * Shared meeting-minutes screen.
 *
 * The screen only speaks the provider-independent HTTP contract.  A host
 * supplies the fetcher, token and base path; no calendar, repository, or
 * organization connector is assumed here.
 */

export const MEETING_MINUTES_UI_CONTRACT_VERSION = 'brainbase.meeting-minutes-ui.v1';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
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

function displayDate(value) {
  if (!value) return '日時未登録';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP');
}

function localDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
  const locator = text(source.locator, '場所未確認');
  const revision = text(source.revision, '版未確認');
  return `${provider} / ${locator} / ${revision}`;
}

function versionContent(doc, version) {
  if (!isRecord(version)) return makeElement(doc, 'p', { textContent: '版の形式を確認できません。', className: 'bb-minutes-warning' });
  if (typeof version.body === 'string') {
    return makeElement(doc, 'pre', { className: 'bb-minutes-body', textContent: version.body });
  }
  if (isRecord(version.source_ref)) {
    return makeElement(doc, 'p', { className: 'bb-minutes-source', textContent: `外部参照: ${sourceLabel(version.source_ref)}` });
  }
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

export function createMeetingMinutesUI({
  root,
  rail = null,
  page = null,
  document: explicitDocument,
  fetcher,
  token,
  basePath = '/api/meeting-minutes',
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

  const screen = makeElement(doc, 'div', { className: 'bb-minutes-screen', attrs: { 'data-contract-version': MEETING_MINUTES_UI_CONTRACT_VERSION } });
  const heading = makeElement(doc, 'header', { className: 'bb-minutes-heading' });
  heading.append(
    makeElement(doc, 'div', { className: 'bb-minutes-eyebrow', textContent: page?.source ?? '正本の議事録' }),
    makeElement(doc, 'h1', { textContent: '議事録' }),
    makeElement(doc, 'p', { className: 'bb-minutes-lead', textContent: '会議と議事録を保存し、版と確認履歴を同じ場所で確かめます。' }),
  );
  const status = makeElement(doc, 'p', { className: 'bb-minutes-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const columns = makeElement(doc, 'div', { className: 'bb-minutes-columns' });
  const listPane = makeElement(doc, 'section', { className: 'bb-minutes-list-pane', attrs: { 'aria-label': '会議一覧' } });
  const detailPane = makeElement(doc, 'section', { className: 'bb-minutes-detail-pane', attrs: { 'aria-label': '会議詳細' } });
  columns.append(listPane, detailPane);
  screen.append(heading, status, columns);
  root.replaceChildren(screen);

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

  function appendLoadError(parent, message, retry) {
    const notice = makeElement(doc, 'div', {
      className: 'bb-minutes-load-error',
      attrs: { role: 'alert' },
    });
    notice.append(makeElement(doc, 'p', { textContent: message }));
    notice.append(button(doc, '再試行', () => { void retry(); }));
    parent.append(notice);
  }

  function renderList() {
    clear(listPane);
    const head = makeElement(doc, 'div', { className: 'bb-minutes-pane-head' });
    head.append(makeElement(doc, 'h2', { textContent: '会議一覧' }));
    head.append(button(doc, '会議を作成', () => renderCreateForm(), { className: 'bb-minutes-button is-primary' }));
    listPane.append(head);
    if (state.listError) {
      appendLoadError(listPane, `会議一覧を読み込めませんでした。理由: ${state.listError}`, loadMeetings);
    }
    if (state.meetings.length === 0) {
      if (state.listError) return;
      listPane.append(makeElement(doc, 'p', { className: 'bb-minutes-empty', textContent: '保存された会議はありません。会議を作成するとここに表示されます。' }));
      return;
    }
    const list = makeElement(doc, 'div', { className: 'bb-minutes-meeting-list' });
    for (const entry of state.meetings) {
      const meeting = entry?.meeting;
      if (!isRecord(meeting) || typeof meeting.meeting_id !== 'string') continue;
      const item = makeElement(doc, 'button', {
        className: `bb-minutes-meeting-item${state.meetingId === meeting.meeting_id ? ' is-selected' : ''}`,
        type: 'button',
        attrs: { type: 'button' },
      });
      item.append(
        makeElement(doc, 'strong', { textContent: text(meeting.title, '無題の会議') }),
        makeElement(doc, 'span', { className: 'bb-minutes-item-meta', textContent: displayDate(meeting.scheduled_at) }),
        makeElement(doc, 'span', { className: 'bb-minutes-item-meta', textContent: `${Array.isArray(entry.minutes) ? entry.minutes.length : 0}件の議事録` }),
      );
      item.addEventListener('click', () => void loadDetail(meeting.meeting_id));
      list.append(item);
    }
    listPane.append(list);
  }

  function selectedDetail() {
    return state.detail && state.detail.meeting?.meeting_id === state.meetingId ? state.detail : null;
  }

  function renderRail(version, documentRecord) {
    if (!rail) return;
    clear(rail);
    const block = makeElement(doc, 'section', { className: 'bb-minutes-rail-block' });
    block.append(makeElement(doc, 'h2', { textContent: '確認対象' }));
    if (!version) {
      block.append(makeElement(doc, 'p', { textContent: '版を選ぶと、本文と確認状態をここに表示します。' }));
    } else {
      const versions = detailVersions(state.detail, documentRecord?.minutes_id);
      block.append(
        makeElement(doc, 'p', { className: 'bb-minutes-rail-title', textContent: text(documentRecord?.title, '議事録') }),
        makeElement(doc, 'p', { textContent: versionLabel(versions, version) }),
        makeElement(doc, 'p', { textContent: version.confirmation ? `確認済み（${displayDate(version.confirmation.confirmed_at)}）` : '未確認' }),
      );
    }
    rail.append(block);
  }

  function renderVersion(detail, documentRecord, selectedVersion) {
    const versions = detailVersions(detail, documentRecord.minutes_id);
    const selected = selectedVersion ?? versions.find((version) => version.version_id === documentRecord.current_version_id) ?? versions[versions.length - 1];
    state.versionId = selected?.version_id ?? null;
    const selectedLabel = versionLabel(versions, selected);
    const section = makeElement(doc, 'section', { className: 'bb-minutes-document' });
    const header = makeElement(doc, 'div', { className: 'bb-minutes-document-head' });
    header.append(
      makeElement(doc, 'div', { className: 'bb-minutes-document-title', textContent: text(documentRecord.title, '議事録') }),
      makeElement(doc, 'span', { className: 'bb-minutes-revision', textContent: `現在 ${selectedLabel}` }),
    );
    section.append(header);
    const history = makeElement(doc, 'div', { className: 'bb-minutes-version-history', attrs: { 'aria-label': '版履歴' } });
    history.append(makeElement(doc, 'h4', { textContent: '版履歴' }));
    for (const version of [...versions].reverse()) {
      const selectedClass = version.version_id === selected?.version_id ? ' is-selected' : '';
      const versionButton = makeElement(doc, 'button', { className: `bb-minutes-version${selectedClass}`, type: 'button', attrs: { type: 'button' } });
      versionButton.append(
        makeElement(doc, 'strong', { textContent: versionLabel(versions, version) }),
        makeElement(doc, 'span', { textContent: version.confirmation ? '確認済み' : '未確認' }),
        makeElement(doc, 'span', { className: 'bb-minutes-item-meta', textContent: displayDate(version.created_at) }),
      );
      versionButton.addEventListener('click', () => { clear(detailPane); renderDetail(detail, documentRecord, version); });
      history.append(versionButton);
    }
    section.append(history);
    const content = makeElement(doc, 'div', { className: 'bb-minutes-version-content' });
    content.append(makeElement(doc, 'h4', { textContent: `${selectedLabel}の本文` }), versionContent(doc, selected));
    if (selected?.predecessor_version_id) {
      const predecessor = versions.find((version) => version.version_id === selected.predecessor_version_id);
      content.append(makeElement(doc, 'p', {
        className: 'bb-minutes-item-meta',
        textContent: `訂正元: ${versionLabel(versions, predecessor)}`,
      }));
    }
    section.append(content);
    if (selected) {
      const actions = makeElement(doc, 'div', { className: 'bb-minutes-actions' });
      const confirm = button(doc, selected.confirmation ? '確認済み' : 'この版を確認', async () => {
        if (selected.confirmation) return;
        confirm.disabled = true;
        try {
          await mutate(`/${encodeURIComponent(detail.meeting.meeting_id)}/minutes/${encodeURIComponent(documentRecord.minutes_id)}/confirm`, {
            version_id: selected.version_id,
            expected_revision: documentRecord.revision,
          });
          setStatus('確認を保存しました。', 'success');
          await loadDetail(detail.meeting.meeting_id);
        } catch (error) {
          confirm.disabled = false;
          setStatus(error instanceof Error ? error.message : '確認を保存できませんでした。', 'error');
        }
      }, { className: 'bb-minutes-button is-primary', disabled: Boolean(selected.confirmation) });
      actions.append(confirm);
      section.append(actions);
    }
    appendIdentifiers(doc, section, {
      meetingId: detail.meeting?.meeting_id,
      minutesId: documentRecord.minutes_id,
      versionId: selected?.version_id,
    });
    appendSaveForm(section, detail, documentRecord);
    renderRail(selected, documentRecord);
    return section;
  }

  function appendSaveForm(section, detail, documentRecord) {
    const form = makeElement(doc, 'form', { className: 'bb-minutes-save-form' });
    form.append(makeElement(doc, 'h4', { textContent: '訂正版を保存' }));
    const field = labelInput(doc, '本文（保存すると新しい版になります）', { type: 'textarea', name: 'body', placeholder: '議事録の本文を入力' });
    field.input.rows = 8;
    const save = makeElement(doc, 'button', { className: 'bb-minutes-button is-primary', textContent: '新しい版を保存', type: 'submit' });
    form.append(field.wrapper, save);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
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
        renderRail(null, null);
        return;
      }
      detailPane.append(makeElement(doc, 'p', { className: 'bb-minutes-empty', textContent: '会議を選ぶと詳細を表示します。' }));
      renderRail(null, null);
      return;
    }
    const meeting = detail.meeting;
    const header = makeElement(doc, 'header', { className: 'bb-minutes-detail-head' });
    header.append(makeElement(doc, 'h2', { textContent: text(meeting.title, '無題の会議') }));
    header.append(makeElement(doc, 'p', { className: 'bb-minutes-item-meta', textContent: `${displayDate(meeting.scheduled_at)} / ${Array.isArray(meeting.participant_ids) && meeting.participant_ids.length ? meeting.participant_ids.join('、') : '参加者未登録'}` }));
    detailPane.append(header);
    const documents = Array.isArray(detail.minutes) ? detail.minutes : [];
    if (documents.length === 0) detailPane.append(makeElement(doc, 'p', { className: 'bb-minutes-warning', textContent: '議事録文書を読み取れません。' }));
    for (const documentRecordValue of documents) {
      detailPane.append(renderVersion(detail, documentRecordValue, documentRecordValue.minutes_id === documentRecord?.minutes_id ? selectedVersion : null));
    }
    detailPane.append(renderCreateMinutesForm(detail));
  }

  function renderCreateMinutesForm(detail) {
    const form = makeElement(doc, 'form', { className: 'bb-minutes-create-form' });
    form.append(makeElement(doc, 'h3', { textContent: '議事録文書を追加' }));
    const title = labelInput(doc, '議事録の名前', { name: 'title', value: '議事録' });
    const body = labelInput(doc, '本文', { type: 'textarea', name: 'body', placeholder: '本文を入力' });
    body.input.rows = 5;
    const save = makeElement(doc, 'button', { className: 'bb-minutes-button', textContent: '議事録を追加', type: 'submit' });
    form.append(title.wrapper, body.wrapper, save);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
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

  async function loadMeetings() {
    state.loading = true;
    setStatus('会議一覧を読み込んでいます。');
    try {
      const payload = await call('');
      if (!isRecord(payload) || !Array.isArray(payload.meetings) || payload.absence_confirmed !== true) throw new Error('会議一覧の形式を確認できません。');
      state.meetings = payload.meetings;
      state.listError = null;
      const selectedMeetingStillListed = state.meetingId !== null
        && state.meetings.some((entry) => entry?.meeting?.meeting_id === state.meetingId);
      if (state.meetingId !== null && !selectedMeetingStillListed) {
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
      setStatus(state.meetings.length ? `${state.meetings.length}件の会議を読み込みました。` : '保存された会議はありません。');
    } catch (error) {
      state.listError = loadErrorMessage(error, '会議一覧を読み込めませんでした。');
      const preserve = preserveLoadedStateOnFailure(error);
      const hadDetail = Boolean(state.detail) || state.meetingId !== null;
      if (!preserve) {
        state.meetings = [];
        if (hadDetail) {
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
      state.loading = false;
    }
    return state.meetings;
  }

  async function loadDetail(meetingId) {
    state.meetingId = meetingId;
    state.minutesId = null;
    state.detailError = null;
    renderList();
    setStatus('会議詳細を読み込んでいます。');
    try {
      const detail = await call(`/${encodeURIComponent(meetingId)}`);
      if (!isRecord(detail) || !isRecord(detail.meeting) || !Array.isArray(detail.minutes) || !Array.isArray(detail.versions)) throw new Error('会議詳細の形式を確認できません。');
      state.detail = detail;
      state.detailError = null;
      renderDetail(detail);
      setStatus('会議詳細を読み込みました。');
    } catch (error) {
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
