/*
 * Shared parts of the local Graph screens (「プロジェクトと関係者」「情報と関係」).
 *
 * - A client for the Graph routes (`GET {base}/...`, `POST {base}/corrections`).
 * - Read-state rendering that never turns Graph v1, a data directory without
 *   Brainbase data, or a failed read into zero items.
 * - Plain-Japanese labels for types, relations, provenance and validity.
 * - The correction form used by both screens.  Every correction needs a
 *   one-sentence reason, sends the digest of the record it was based on, keeps
 *   the draft and shows the current record on a conflict, and shows the values
 *   read back after a save.  Records are never deleted; an entity or relation
 *   ends with an end date.
 *
 * The host injects the fetcher, base path and launch token.  Nothing here
 * keeps global state.  Pages load `graph-view-shared.css` with the screen CSS.
 */

export const GRAPH_VIEW_SHARED_CONTRACT_VERSION = 'brainbase.graph-view-shared.v1';

export const GRAPH_ENTITY_TYPE_LABELS = Object.freeze({
  person: '人物',
  org: '組織',
  project: 'プロジェクト',
  decision: '判断',
});

export const GRAPH_ENTITY_TYPE_MEANINGS = Object.freeze({
  person: 'Graphに登録された人',
  org: 'Graphに登録された組織',
  project: '目的を持つ、区切りのある仕事',
  decision: '続けて使う判断や原則。以前の判断を置き換えることがあります',
});

/**
 * `outgoing` follows the counterpart name when this record is the start of the
 * relation; `incoming` follows it when this record is the end.
 */
export const GRAPH_RELATION_LABELS = Object.freeze({
  member_of: Object.freeze({ label: '所属', meaning: '人物が組織に所属している', outgoing: 'に所属', incoming: 'が所属' }),
  participates_in: Object.freeze({ label: '参加', meaning: '人物がプロジェクトに参加している', outgoing: 'に参加', incoming: 'が参加' }),
  accountable_for: Object.freeze({ label: '責任', meaning: '人物がプロジェクトの成果や判断に責任を持つ', outgoing: 'に責任を持つ', incoming: 'が責任を持つ' }),
  owned_by: Object.freeze({ label: '所有', meaning: 'プロジェクトを組織が所有している', outgoing: 'が所有', incoming: 'を所有' }),
  governs: Object.freeze({ label: '方針', meaning: '判断や原則がプロジェクトの進め方を決める', outgoing: 'の進め方を決める', incoming: 'が進め方を決める' }),
  supersedes: Object.freeze({ label: '置き換え', meaning: '判断が以前の判断を置き換える', outgoing: 'を置き換える', incoming: 'に置き換えられた' }),
});

/** Relations a correction may add (the host refuses any other). */
export const GRAPH_NEW_RELATIONS = Object.freeze({
  participates_in: Object.freeze({ from: 'person', to: 'project' }),
  accountable_for: Object.freeze({ from: 'person', to: 'project' }),
  member_of: Object.freeze({ from: 'person', to: 'org' }),
});

export const GRAPH_SOURCE_KIND_LABELS = Object.freeze({
  user_approved: '利用者が承認',
  migration: '移行',
  import: '取り込み',
  onboarding: 'オンボーディング',
});

const REVIEW_STATUS_LABELS = Object.freeze({ approved: '承認済み', pending: '確認待ち', rejected: '却下', edited: '修正して承認', merged: '統合' });

const FIELD_LABELS = Object.freeze({
  name: '名前',
  aliases: '別名',
  summary: '要約',
  validFrom: '開始日',
  validTo: '終了日',
  goal: '目的',
  status: '状態',
  'metadata.goal': '目的',
  'metadata.status': '状態',
  role: '役割',
  context: '文脈',
  fromId: '起点',
  toId: '終点',
  relation: '関係の種類',
  provenance: '出典',
});

const CORRECTION_KIND_LABELS = Object.freeze({
  update_entity: '記録を直した',
  update_edge: '関係を直した',
  create_edge: '関係を加えた',
});

/** Inputs of the correction form. `date` inputs hold a local day (YYYY-MM-DD). */
export const GRAPH_CORRECTION_FIELDS = Object.freeze({
  name: Object.freeze({ label: '名前', control: 'text', max: 200 }),
  aliases: Object.freeze({ label: '別名', control: 'text', max: 2000, help: '複数あるときは「、」で区切ります。' }),
  summary: Object.freeze({ label: '要約', control: 'textarea', max: 2000 }),
  goal: Object.freeze({ label: '目的', control: 'textarea', max: 2000 }),
  status: Object.freeze({ label: '状態', control: 'text', max: 200, help: '自由記述です。例: 進行中、保留、完了' }),
  validFrom: Object.freeze({ label: '開始日', control: 'date' }),
  validTo: Object.freeze({ label: '終了日', control: 'date', help: 'この日の0時から、終わったものとして扱います。空にすると終了日を消します。' }),
  role: Object.freeze({ label: '役割', control: 'text', max: 200, help: '自由記述です。例: 最終判断、進行管理' }),
  context: Object.freeze({ label: '文脈', control: 'textarea', max: 2000, help: 'どのように関わっているか' }),
});

export const GRAPH_CORRECTION_ERROR_MESSAGES = Object.freeze({
  correction_reason_required: '理由を1文で書いてください。',
  correction_reason_invalid: '理由は改行を含まない1文（500文字まで）にしてください。',
  correction_no_change: '変更がありません。直したい項目を書き換えてください。',
  correction_digest_required: '元にした記録を確かめられません。読み直してから、もう一度直してください。',
  correction_delete_not_allowed: '記録は削除できません。終わったものは終了日で表します。',
  correction_relation_not_allowed: 'この種類の関係は、ここでは加えられません。',
  correction_relation_change_not_allowed: '関係の種類は変えられません。今の関係を終えてから、新しい関係を加えてください。',
  correction_endpoint_change_not_allowed: '関係の相手は変えられません。今の関係を終えてから、新しい関係を加えてください。',
  correction_endpoint_type_invalid: 'この組み合わせの関係は加えられません。',
  correction_field_not_allowed: 'この項目は、ここでは直せません。',
  correction_changes_required: '変更がありません。直したい項目を書き換えてください。',
  entity_not_found: '対象の記録が見つかりません。読み直してください。',
  edge_not_found: '対象の関係が見つかりません。読み直してください。',
  entity_id_ambiguous: '同じIDの記録が複数あるため直せません。CLIで確かめてください。',
  graph_not_initialized: 'Brainbaseのデータがまだありません。',
  migration_required: 'Graphの移行が必要です。ホストは自動で移行しません。',
  readback_mismatch: '保存後に読み直した内容が一致しませんでした。読み直して確かめてください。',
  web_token_required: '起動時のトークンを確かめられません。ページを開き直してください。',
  write_protection_missing: 'このホストでは保存できません。',
  cross_origin_rejected: '別のサイトからの保存は受け付けません。',
  host_rejected: 'このアドレスからの保存は受け付けません。',
  payload_too_large: '入力が大きすぎます。',
  unsupported_media_type: 'ホストに送る形式が正しくありません。',
  network_error: 'ホストに接続できません。',
  invalid_response: 'ホストの応答を読み取れません。',
});

const DEFAULT_APPLIES_TO = Object.freeze(['search', 'get_context', 'resolve_entity']);
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

// ---------------------------------------------------------------------------
// DOM helpers

export function getDocument(explicit) {
  const value = explicit ?? (typeof document === 'undefined' ? null : document);
  if (!value || typeof value.createElement !== 'function') throw new Error('document_unavailable');
  return value;
}

export function makeElement(doc, tag, { className, text, attrs = {} } = {}) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  return element;
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function notice(doc, tone, message, role = 'status') {
  return makeElement(doc, 'p', { className: `bb-graph-notice is-${tone}`, text: message, attrs: { role } });
}

export function badge(doc, label, tone = '') {
  return makeElement(doc, 'span', { className: `bb-graph-badge${tone ? ` is-${tone}` : ''}`, text: label });
}

export function button(doc, label, onClick, { className = 'bb-graph-button', attrs = {} } = {}) {
  const element = makeElement(doc, 'button', { className, text: label, attrs: { type: 'button', ...attrs } });
  element.addEventListener('click', (event) => {
    event?.preventDefault?.();
    return onClick(event);
  });
  return element;
}

export function facts(doc, rows, className = 'bb-graph-facts') {
  const list = makeElement(doc, 'dl', { className });
  for (const [label, value] of rows) {
    if (value === null || value === undefined || value === '') continue;
    const dd = makeElement(doc, 'dd');
    if (typeof value === 'object' && value.tagName) dd.append(value);
    else dd.textContent = String(value);
    list.append(makeElement(doc, 'dt', { text: label }), dd);
  }
  return list;
}

/** Ids and digests stay in this disclosure, never in the visible copy. */
export function recordDetails(doc, rows) {
  const details = makeElement(doc, 'details', { className: 'bb-graph-audit' });
  details.append(makeElement(doc, 'summary', { text: '記録の詳細' }), facts(doc, rows, 'bb-graph-facts is-mono'));
  return details;
}

// ---------------------------------------------------------------------------
// Dates and validity

/** The calendar day written in an RFC 3339 value, without converting time zones. */
export function formatDay(value) {
  const match = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})T/u.exec(value) : null;
  return match ? match[1] : null;
}

export function formatDateTime(value) {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) return '日時不明';
  const date = new Date(time);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Today (or `date`) as a local calendar day, the value a date input uses. */
export function localDay(date = new Date()) {
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of a calendar day as RFC 3339 with the local offset. */
export function dayToRfc3339(day) {
  const match = typeof day === 'string' ? DAY_PATTERN.exec(day) : null;
  if (!match) return null;
  const local = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (local.getFullYear() !== Number(match[1]) || local.getMonth() !== Number(match[2]) - 1 || local.getDate() !== Number(match[3])) return null;
  const east = -local.getTimezoneOffset();
  const pad = (number) => String(number).padStart(2, '0');
  const sign = east >= 0 ? '+' : '-';
  return `${day}T00:00:00${sign}${pad(Math.floor(Math.abs(east) / 60))}:${pad(Math.abs(east) % 60)}`;
}

export function validityText(validFrom, validTo) {
  const from = formatDay(validFrom);
  const to = formatDay(validTo);
  if (from && to) return `${from} から ${to} に終了`;
  if (from) return `${from} から`;
  if (to) return `${to} に終了`;
  return '期限なし';
}

/** Badge for a record's validity at the response time. */
export function activityBadge(doc, record, asOf) {
  if (record.active === true) return badge(doc, '有効', 'success');
  const starts = typeof record.validFrom === 'string' ? Date.parse(record.validFrom) : Number.NaN;
  const at = typeof asOf === 'string' ? Date.parse(asOf) : Number.NaN;
  if (!Number.isNaN(starts) && !Number.isNaN(at) && starts > at) return badge(doc, '開始前', 'muted');
  return badge(doc, '終了', 'muted');
}

// ---------------------------------------------------------------------------
// Payload checks

export function isEntityView(value) {
  return isRecord(value) && typeof value.id === 'string' && typeof value.type === 'string' && typeof value.name === 'string'
    && typeof value.digest === 'string' && Array.isArray(value.aliases);
}

export function isEdgeView(value) {
  return isRecord(value) && typeof value.id === 'string' && typeof value.relation === 'string' && typeof value.digest === 'string'
    && (value.direction === 'incoming' || value.direction === 'outgoing')
    && isRecord(value.counterpart) && typeof value.counterpart.id === 'string' && typeof value.counterpart.name === 'string'
    && isRecord(value.provenance) && isRecord(value.provenance.reference);
}

export function relationLabel(relation) {
  return GRAPH_RELATION_LABELS[relation]?.label ?? relation;
}

export function typeLabel(type) {
  return GRAPH_ENTITY_TYPE_LABELS[type] ?? type;
}

// ---------------------------------------------------------------------------
// Client

function shellArg(value) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value) ? value : JSON.stringify(value);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function errorOf(status, payload) {
  const error = isRecord(payload?.error) ? payload.error : {};
  const code = typeof error.code === 'string' && error.code ? error.code : status ? `http_${status}` : 'invalid_response';
  const detail = textOrNull(error.message);
  const known = GRAPH_CORRECTION_ERROR_MESSAGES[code];
  const message = code === 'correction_invalid' || code === 'invalid_json'
    ? `入力が保存の条件を満たしていません${detail ? `（${detail}）` : ''}。`
    : known ?? (detail ? `保存できませんでした（${detail}）。` : `保存できませんでした（HTTP ${status}）。`);
  return { code, detail, message, error };
}

/**
 * Graph routes client.  `read` resolves to one of
 * `{ state: 'ok' | 'migration_required' | 'not_initialized', payload }`,
 * `{ state: 'error', code, reason, status }` or `{ state: 'invalid', reason }`.
 * `correct` resolves to `{ state: 'saved', payload }`,
 * `{ state: 'conflict', code, message, current }` or `{ state: 'error', code, message }`.
 */
export function createGraphClient({ fetcher, basePath = '/api/graph', token, tokenHeader = 'X-Brainbase-Review-Token' } = {}) {
  const request = typeof fetcher === 'function'
    ? fetcher
    : typeof globalThis.fetch === 'function' ? (path, init) => globalThis.fetch(path, init) : null;
  const base = String(basePath).replace(/\/+$/u, '');

  function url(path, params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      query.set(key, String(value));
    }
    const search = query.toString();
    return `${base}${path}${search ? `?${search}` : ''}`;
  }

  return Object.freeze({
    basePath: base,
    url,
    async read(path, params) {
      if (!request) return { state: 'error', code: 'fetcher_missing', reason: '取得先が設定されていません', status: 0 };
      let response;
      try {
        response = await request(url(path, params));
      } catch (error) {
        return { state: 'error', code: 'network_error', reason: error instanceof Error ? error.message : 'ホストに接続できません', status: 0 };
      }
      const payload = await readJson(response);
      if (!response.ok) {
        const error = isRecord(payload?.error) ? payload.error : {};
        return {
          state: 'error',
          code: textOrNull(error.code) ?? `http_${response.status}`,
          reason: textOrNull(error.message) ?? textOrNull(error.code) ?? `HTTP ${response.status}`,
          status: response.status,
        };
      }
      if (!isRecord(payload)) return { state: 'invalid', reason: '応答の形式が不正です' };
      if (payload.status === 'migration_required' || payload.status === 'not_initialized' || payload.status === 'ok') {
        return { state: payload.status, payload };
      }
      return { state: 'invalid', reason: '応答の形式が不正です' };
    },
    async correct(body) {
      if (!request) return { state: 'error', code: 'fetcher_missing', message: '保存先が設定されていません。' };
      let response;
      try {
        response = await request(url('/corrections'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { [tokenHeader]: token } : {}) },
          body: JSON.stringify(body),
        });
      } catch {
        return { state: 'error', code: 'network_error', message: GRAPH_CORRECTION_ERROR_MESSAGES.network_error };
      }
      const payload = await readJson(response);
      if (response.ok) {
        if (isRecord(payload) && payload.status === 'saved' && isRecord(payload.record) && typeof payload.digest === 'string') {
          return { state: 'saved', payload };
        }
        return { state: 'error', code: 'invalid_response', message: GRAPH_CORRECTION_ERROR_MESSAGES.invalid_response };
      }
      const failure = errorOf(response.status, payload);
      const current = isRecord(failure.error.current) && isRecord(failure.error.current.record) ? failure.error.current : null;
      if (response.status === 409 && current) {
        return { state: 'conflict', code: failure.code, message: failure.message, current };
      }
      return { state: 'error', code: failure.code, message: failure.message };
    },
  });
}

// ---------------------------------------------------------------------------
// Read states

function commandList(doc, commands) {
  const list = makeElement(doc, 'ol', { className: 'bb-graph-commands' });
  for (const command of commands) {
    const item = makeElement(doc, 'li');
    item.append(makeElement(doc, 'code', { text: command }));
    list.append(item);
  }
  return list;
}

/**
 * Renders a read state and returns true only when the caller should render
 * the payload.  Graph v1, a missing data set and a failure are never zero items.
 */
export function renderGraphReadState(doc, container, readState, { onRetry, loadingText = '読み込んでいます。' } = {}) {
  const state = readState?.state ?? 'loading';
  if (state === 'ok') return true;
  if (state === 'loading' || state === 'idle') {
    container.append(notice(doc, 'muted', loadingText));
    return false;
  }
  if (state === 'migration_required') {
    const payload = readState.payload ?? {};
    const box = makeElement(doc, 'div', { className: 'bb-graph-state is-warning', attrs: { role: 'alert' } });
    box.append(
      makeElement(doc, 'strong', { text: 'Graphの移行が必要です' }),
      makeElement(doc, 'p', {
        text: 'このデータはGraph v1のため、表示も訂正もできません。0件ではありません。ホストは自動で移行しません。次のコマンドで、内容を確かめてから移行してください。',
      }),
    );
    if (Number.isInteger(payload.legacyEntityCount)) {
      box.append(makeElement(doc, 'p', { text: `Graph v1には${payload.legacyEntityCount}件の記録があります。` }));
    }
    const commands = [payload.command, payload.writeCommand].filter((command) => typeof command === 'string' && command);
    if (commands.length > 0) box.append(commandList(doc, commands));
    container.append(box);
    return false;
  }
  if (state === 'not_initialized') {
    const payload = readState.payload ?? {};
    const box = makeElement(doc, 'div', { className: 'bb-graph-state is-muted', attrs: { role: 'status' } });
    box.append(
      makeElement(doc, 'strong', { text: 'まだ登録がありません' }),
      makeElement(doc, 'p', { text: 'このデータの場所には、Brainbaseのデータがまだありません。次のコマンドで始められます。CodexやClaude Codeからは、MCPのオンボーディング（brainbase_onboarding_start）でも始められます。' }),
    );
    const dir = textOrNull(payload.source?.dataDir);
    const command = textOrNull(payload.command) ?? 'brainbase onboard:start';
    box.append(commandList(doc, [dir ? `${command} --dir ${shellArg(dir)}` : command]));
    container.append(box);
    return false;
  }
  if (state === 'not_found') {
    container.append(notice(doc, 'warning', readState.reason ?? '見つかりません。読み直してください。', 'alert'));
    return false;
  }
  if (state === 'unknown') {
    const box = makeElement(doc, 'div', { className: 'bb-graph-state is-warning', attrs: { role: 'alert' } });
    box.append(makeElement(doc, 'p', { text: '記録の有無を確かめられません。0件ではありません。' }));
    if (typeof onRetry === 'function') box.append(button(doc, '再試行', onRetry));
    container.append(box);
    return false;
  }
  const reason = readState.reason ?? '理由不明';
  const box = makeElement(doc, 'div', { className: 'bb-graph-state is-danger', attrs: { role: 'alert' } });
  box.append(makeElement(doc, 'p', { text: `読み取れませんでした（${reason}）。0件ではありません。` }));
  if (typeof onRetry === 'function') box.append(button(doc, '再試行', onRetry));
  container.append(box);
  return false;
}

/** Records that could not be read are counted apart from the readable ones. */
export function renderGraphIssues(doc, issues) {
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const box = makeElement(doc, 'div', { className: 'bb-graph-state is-warning', attrs: { role: 'alert' } });
  box.append(makeElement(doc, 'p', { text: `出典や訂正の履歴のうち、読めない記録が${issues.length}件あります。読めた記録だけを表示しています。` }));
  const list = makeElement(doc, 'ul', { className: 'bb-graph-issue-list' });
  for (const issue of issues) {
    if (!isRecord(issue)) continue;
    const where = `${String(issue.file ?? '不明')}${Number.isInteger(issue.line) ? `（${issue.line}行目）` : ''}`;
    list.append(makeElement(doc, 'li', { text: `${where}: ${String(issue.reason ?? '理由不明')}` }));
  }
  box.append(list);
  return box;
}

// ---------------------------------------------------------------------------
// Provenance and history

/** Plain-Japanese provenance: kind, and the source record it resolves to. */
export function provenanceSummary(provenance) {
  const kind = GRAPH_SOURCE_KIND_LABELS[provenance?.sourceKind] ?? (textOrNull(provenance?.sourceKind) ?? '記録なし');
  const reference = isRecord(provenance?.reference) ? provenance.reference : { status: 'none' };
  if (reference.status === 'unresolved') {
    return { kind, reference: `出典 ${String(reference.sourceId)}（未解決）`, unresolved: true };
  }
  if (reference.status !== 'resolved') return { kind, reference: null, unresolved: false };
  if (reference.kind === 'extracted_candidate') {
    return { kind, reference: `取り込み候補「${reference.label ?? reference.candidateId}」（${reference.file}）`, unresolved: false };
  }
  if (reference.kind === 'onboarding_run_candidate') {
    const review = REVIEW_STATUS_LABELS[reference.reviewStatus] ?? reference.reviewStatus;
    return {
      kind,
      reference: `オンボーディングの候補「${reference.label ?? reference.candidateId}」（実行 ${reference.runId}${review ? `、${review}` : ''}、${reference.file}）`,
      unresolved: false,
    };
  }
  if (reference.kind === 'graph_correction') {
    return { kind, reference: `訂正 ${formatDay(reference.at) ?? ''}「${reference.reason}」（${reference.file}）`, unresolved: false };
  }
  return { kind, reference: null, unresolved: false };
}

export function renderProvenance(doc, provenance) {
  const summary = provenanceSummary(provenance);
  const wrap = makeElement(doc, 'span', { className: 'bb-graph-source' });
  wrap.append(badge(doc, summary.kind, 'muted'));
  if (summary.reference) {
    wrap.append(makeElement(doc, 'span', { className: `bb-graph-source-ref${summary.unresolved ? ' is-unresolved' : ''}`, text: summary.reference }));
  }
  return wrap;
}

export function renderCorrectionHistory(doc, history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const details = makeElement(doc, 'details', { className: 'bb-graph-history' });
  details.append(makeElement(doc, 'summary', { text: `訂正の履歴（${history.length}件）` }));
  const list = makeElement(doc, 'ol', { className: 'bb-graph-history-list' });
  for (const record of history) {
    if (!isRecord(record)) continue;
    const fields = Array.isArray(record.changedFields) ? record.changedFields.map((field) => FIELD_LABELS[field] ?? field).join('・') : '';
    list.append(makeElement(doc, 'li', {
      text: `${formatDateTime(record.at)} ${CORRECTION_KIND_LABELS[record.kind] ?? '直した'}${fields ? `（${fields}）` : ''}。理由: ${String(record.reason ?? '')}`,
    }));
  }
  details.append(list);
  return details;
}

// ---------------------------------------------------------------------------
// Correction form

/** Form values of an entity or relation, from a read view or a raw stored record. */
export function graphRecordValues(record) {
  const metadata = isRecord(record?.metadata) ? record.metadata : {};
  const pick = (value) => (typeof value === 'string' ? value : '');
  return {
    name: pick(record?.name),
    aliases: Array.isArray(record?.aliases) ? record.aliases.filter((alias) => typeof alias === 'string').join('、') : '',
    summary: pick(record?.summary),
    validFrom: formatDay(record?.validFrom) ?? '',
    validTo: formatDay(record?.validTo) ?? '',
    goal: pick(typeof record?.goal === 'string' ? record.goal : metadata.goal),
    status: pick(typeof record?.status === 'string' && record?.type === 'project' ? record.status : metadata.status),
    role: pick(record?.role),
    context: pick(record?.context),
  };
}

function displayValue(field, value) {
  if (field === 'validFrom' || field === 'validTo') return value ? value : 'なし';
  return value ? value : '未記入';
}

function valueRows(record, fields) {
  const values = graphRecordValues(record);
  return fields.map((field) => [GRAPH_CORRECTION_FIELDS[field]?.label ?? FIELD_LABELS[field] ?? field, displayValue(field, values[field])]);
}

function renderValues(doc, record, fields, leadingRows = []) {
  return facts(doc, [...leadingRows, ...valueRows(record, fields)], 'bb-graph-facts');
}

function splitAliases(value) {
  const seen = [];
  for (const part of String(value).split(/[、,，\n]/u)) {
    const alias = part.trim();
    if (alias && !seen.includes(alias)) seen.push(alias);
  }
  return seen;
}

/** Relation choices a correction can add from or to an entity of this type. */
export function newRelationOptions(anchorType, allowed = Object.keys(GRAPH_NEW_RELATIONS)) {
  return allowed.flatMap((id) => {
    const definition = GRAPH_NEW_RELATIONS[id];
    if (!definition) return [];
    if (definition.from === anchorType) return [{ id, anchorIs: 'from', counterpartType: definition.to }];
    if (definition.to === anchorType) return [{ id, anchorIs: 'to', counterpartType: definition.from }];
    return [];
  });
}

/**
 * Turns the form into a correction request.  Only fields the owner changed
 * from what the form first showed are sent, so a value someone else saved in
 * an untouched field is never overwritten.
 */
export function buildCorrectionRequest(form) {
  const reason = String(form.reason ?? '').trim();
  if (!reason) return { ok: false, message: GRAPH_CORRECTION_ERROR_MESSAGES.correction_reason_required };
  if (/[\r\n]/u.test(reason) || reason.length > 500) return { ok: false, message: GRAPH_CORRECTION_ERROR_MESSAGES.correction_reason_invalid };

  if (form.kind === 'create_edge') {
    const option = form.relationOptions.find((candidate) => candidate.id === form.draft.relation);
    if (!option) return { ok: false, message: '関わり方を選んでください。' };
    const counterpartId = String(form.draft.counterpartId ?? '');
    if (!counterpartId) return { ok: false, message: '相手を選んでください。' };
    const edge = {
      fromId: option.anchorIs === 'from' ? form.anchor.id : counterpartId,
      relation: option.id,
      toId: option.anchorIs === 'from' ? counterpartId : form.anchor.id,
    };
    const role = String(form.draft.role ?? '').trim();
    const context = String(form.draft.context ?? '').trim();
    if (role) edge.role = role;
    if (context) edge.context = context;
    if (form.draft.validFrom) {
      const validFrom = dayToRfc3339(form.draft.validFrom);
      if (!validFrom) return { ok: false, message: '開始日の形式が正しくありません。' };
      edge.validFrom = validFrom;
    }
    return { ok: true, body: { kind: 'create_edge', reason, edge } };
  }

  const changes = {};
  for (const field of form.fields) {
    const before = String(form.original[field] ?? '');
    const after = String(form.draft[field] ?? '');
    if (after.trim() === before.trim()) continue;
    if (field === 'validFrom' || field === 'validTo') {
      if (after.trim() === '') {
        changes[field] = null;
        continue;
      }
      const value = dayToRfc3339(after.trim());
      if (!value) return { ok: false, message: `${GRAPH_CORRECTION_FIELDS[field].label}の形式が正しくありません。` };
      changes[field] = value;
    } else if (field === 'aliases') {
      changes.aliases = splitAliases(after);
    } else if (field === 'name') {
      if (!after.trim()) return { ok: false, message: '名前は空にできません。' };
      changes.name = after.trim();
    } else {
      changes[field] = after.trim() === '' ? null : after.trim();
    }
  }
  if (Object.keys(changes).length === 0) return { ok: false, message: GRAPH_CORRECTION_ERROR_MESSAGES.correction_no_change };
  const body = form.kind === 'update_entity'
    ? { kind: 'update_entity', entityId: form.targetId, expectedDigest: form.expectedDigest, reason, changes }
    : { kind: 'update_edge', edgeId: form.targetId, expectedDigest: form.expectedDigest, reason, changes };
  return { ok: true, body };
}

function readBackFields(form, payload) {
  if (form.kind === 'create_edge') return ['role', 'context', 'validFrom', 'validTo'];
  const changed = Array.isArray(payload?.correction?.changedFields) ? payload.correction.changedFields : [];
  const fields = changed.map((field) => field.replace(/^metadata\./u, '')).filter((field) => GRAPH_CORRECTION_FIELDS[field]);
  return fields.length > 0 ? fields : form.fields;
}

/** What a new relation connects, as rows shown before its values. */
function createdRows(form, record) {
  const counterpartId = record?.fromId === form.anchor.id ? record?.toId : record?.fromId;
  const counterpart = form.candidates?.items?.find((entity) => entity.id === counterpartId);
  const relation = form.relationNames[record?.relation] ?? relationLabel(record?.relation);
  return [
    [form.relationLabel, relation],
    ['相手', counterpart ? counterpart.name : String(counterpartId ?? '')],
  ];
}

function mcpNote(payload) {
  const tools = Array.isArray(payload?.appliesTo) && payload.appliesTo.length > 0 ? payload.appliesTo : DEFAULT_APPLIES_TO;
  return `次にMCPの ${tools.join('・')} を使うときから、この内容が使われます。`;
}

function fieldControl(doc, form, field, callbacks) {
  const definition = GRAPH_CORRECTION_FIELDS[field];
  const id = `${form.formId}-${field}`;
  const wrap = makeElement(doc, 'div', { className: 'bb-graph-field' });
  wrap.append(makeElement(doc, 'label', { text: definition.label, attrs: { for: id } }));
  const control = definition.control === 'textarea'
    ? makeElement(doc, 'textarea', { attrs: { id, name: field, rows: 3, maxlength: definition.max } })
    : makeElement(doc, 'input', { attrs: { id, name: field, type: definition.control === 'date' ? 'date' : 'text', maxlength: definition.max } });
  control.value = String(form.draft[field] ?? '');
  const update = (event) => callbacks.onInput(field, event?.target?.value ?? control.value);
  control.addEventListener('input', update);
  control.addEventListener('change', update);
  wrap.append(control);
  if (definition.help) wrap.append(makeElement(doc, 'small', { className: 'bb-graph-help', text: definition.help }));
  return wrap;
}

function reasonControl(doc, form, callbacks) {
  const id = `${form.formId}-reason`;
  const wrap = makeElement(doc, 'div', { className: 'bb-graph-field is-reason' });
  wrap.append(makeElement(doc, 'label', { text: '理由（1文、必須）', attrs: { for: id } }));
  const control = makeElement(doc, 'input', {
    attrs: { id, name: 'reason', type: 'text', required: true, maxlength: 500, placeholder: '例: 役割が変わったため。', 'aria-required': 'true' },
  });
  control.value = String(form.reason ?? '');
  const update = (event) => callbacks.onReason(event?.target?.value ?? control.value);
  control.addEventListener('input', update);
  control.addEventListener('change', update);
  wrap.append(control, makeElement(doc, 'small', { className: 'bb-graph-help', text: '直した理由は履歴に残り、後から「いつ何を直したか」をたどれます。' }));
  return wrap;
}

function selectControl(doc, { id, name, label, options, value, onChange, disabled = false }) {
  const wrap = makeElement(doc, 'div', { className: 'bb-graph-field' });
  wrap.append(makeElement(doc, 'label', { text: label, attrs: { for: id } }));
  const select = makeElement(doc, 'select', { attrs: { id, name, disabled } });
  for (const option of options) {
    const element = makeElement(doc, 'option', { text: option.label, attrs: { value: option.value } });
    if (option.value === value) {
      element.setAttribute('selected', 'selected');
      element.selected = true;
    }
    select.append(element);
  }
  select.value = value;
  const update = (event) => onChange(event?.target?.value ?? select.value);
  select.addEventListener('change', update);
  select.addEventListener('input', update);
  wrap.append(select);
  return wrap;
}

function candidateOptionLabel(entity) {
  const aliases = Array.isArray(entity.aliases) && entity.aliases.length > 0 ? `（${entity.aliases.join('、')}）` : '';
  return `${entity.name}${aliases}${entity.active === false ? '（終了）' : ''}`;
}

function renderCreateFields(doc, form, callbacks) {
  const group = makeElement(doc, 'div', { className: 'bb-graph-fields' });
  const option = form.relationOptions.find((candidate) => candidate.id === form.draft.relation) ?? form.relationOptions[0];
  group.append(selectControl(doc, {
    id: `${form.formId}-relation`,
    name: 'relation',
    label: form.relationLabel,
    value: form.draft.relation,
    options: form.relationOptions.map((candidate) => ({
      value: candidate.id,
      label: `${form.relationNames[candidate.id] ?? relationLabel(candidate.id)}（${GRAPH_RELATION_LABELS[candidate.id]?.meaning ?? candidate.id}）`,
    })),
    onChange: callbacks.onRelation,
  }));

  const counterpartLabel = typeLabel(option.counterpartType);
  const search = makeElement(doc, 'div', { className: 'bb-graph-field bb-graph-candidate-search' });
  const searchId = `${form.formId}-candidate-q`;
  search.append(makeElement(doc, 'label', { text: `${counterpartLabel}を名前で絞り込む`, attrs: { for: searchId } }));
  const row = makeElement(doc, 'div', { className: 'bb-graph-inline' });
  const query = makeElement(doc, 'input', { attrs: { id: searchId, name: 'candidateQuery', type: 'search', maxlength: 200 } });
  query.value = String(form.candidates.query ?? '');
  const updateQuery = (event) => { form.candidates.query = event?.target?.value ?? query.value; };
  query.addEventListener('input', updateQuery);
  query.addEventListener('change', updateQuery);
  row.append(query, button(doc, '探す', () => callbacks.onSearchCandidates(form.candidates.query)));
  search.append(row);
  group.append(search);

  const candidates = form.candidates;
  if (candidates.state === 'ok') {
    const options = [{ value: '', label: `${counterpartLabel}を選んでください` }, ...candidates.items.map((entity) => ({ value: entity.id, label: candidateOptionLabel(entity) }))];
    group.append(selectControl(doc, {
      id: `${form.formId}-counterpart`,
      name: 'counterpartId',
      label: `相手（${counterpartLabel}）`,
      value: String(form.draft.counterpartId ?? ''),
      options,
      onChange: (value) => callbacks.onInput('counterpartId', value),
    }));
    if (candidates.items.length === 0) {
      group.append(notice(doc, 'muted', `条件に合う${counterpartLabel}がいません。まだ登録していない場合は、CLIやMCPで先に登録してください。`));
    }
    if (candidates.truncated) group.append(notice(doc, 'muted', `候補が多いため、先頭の${candidates.items.length}件だけを出しています。名前で絞り込んでください。`));
  } else {
    const holder = makeElement(doc, 'div', { className: 'bb-graph-candidate-state' });
    renderGraphReadState(doc, holder, candidates, { onRetry: () => callbacks.onSearchCandidates(candidates.query), loadingText: `${counterpartLabel}の候補を読み込んでいます。` });
    group.append(holder);
  }

  for (const field of ['role', 'context', 'validFrom']) group.append(fieldControl(doc, form, field, callbacks));
  return group;
}

/**
 * The correction panel.  `form` is the state held by `createGraphCorrection`;
 * callbacks are the controller's handlers.
 */
export function renderCorrectionPanel(doc, form, callbacks) {
  const panel = makeElement(doc, 'section', { className: `bb-graph-correction is-${form.phase}`, attrs: { 'aria-label': form.title, tabindex: '-1' } });
  const head = makeElement(doc, 'div', { className: 'bb-graph-correction-head' });
  head.append(makeElement(doc, 'h3', { text: form.title }));
  if (form.subject) head.append(makeElement(doc, 'p', { className: 'bb-graph-lead', text: form.subject }));
  panel.append(head);

  if (form.phase === 'saved') {
    const payload = form.saved;
    const verified = payload?.readback?.verified === true && payload?.readback?.historyRecorded === true;
    panel.append(notice(doc, verified ? 'success' : 'warning', verified
      ? '保存しました。保存後に読み直し、保存した内容と一致することを確かめました。理由と前後の内容は履歴に残しました。'
      : '保存の応答はありましたが、読み直しを確かめられませんでした。読み直して確かめてください。', verified ? 'status' : 'alert'));
    const readBack = makeElement(doc, 'div', { className: 'bb-graph-readback', attrs: { 'aria-label': '読み直した内容' } });
    readBack.append(
      makeElement(doc, 'strong', { text: '読み直した内容' }),
      renderValues(doc, payload.record, readBackFields(form, payload), form.kind === 'create_edge' ? createdRows(form, payload.record) : []),
    );
    panel.append(readBack, notice(doc, 'accent', mcpNote(payload)));
    panel.append(recordDetails(doc, [['記録ID', payload.record?.id], ['保存した内容のdigest', payload.digest], ['訂正ID', payload.correction?.id]]));
    panel.append(button(doc, '閉じる', callbacks.onClose));
    return panel;
  }

  if (form.phase === 'conflict') {
    const exists = form.conflictCode === 'edge_already_exists';
    panel.append(notice(doc, 'warning', exists
      ? 'この関わりはすでに登録されているため、加えませんでした。今の内容を下に示します。終わった関わりをもう一度始めるときは、その関わりの終了日を消してください。入力は残しています。'
      : 'ほかの保存で内容が変わっていたため、保存しませんでした。今の内容を下に示します。入力は残しています。今の内容を確かめてから、もう一度保存してください。', 'alert'));
    const current = makeElement(doc, 'div', { className: 'bb-graph-current', attrs: { 'aria-label': '今の内容' } });
    const fields = exists ? ['role', 'context', 'validFrom', 'validTo'] : form.fields;
    current.append(makeElement(doc, 'strong', { text: '今の内容' }), renderValues(doc, form.current.record, fields));
    current.append(recordDetails(doc, [['記録ID', form.current.record?.id], ['今の内容のdigest', form.current.digest]]));
    panel.append(current);
  } else if (form.message) {
    panel.append(notice(doc, form.message.tone, form.message.text, form.message.tone === 'danger' ? 'alert' : 'status'));
  }

  const formElement = makeElement(doc, 'form', { className: 'bb-graph-form', attrs: { novalidate: true } });
  formElement.addEventListener('submit', (event) => {
    event?.preventDefault?.();
    // Returned so a host (or a test) can wait for the save to finish.
    return callbacks.onSubmit();
  });
  if (form.kind === 'create_edge') {
    formElement.append(renderCreateFields(doc, form, callbacks));
  } else {
    const group = makeElement(doc, 'div', { className: 'bb-graph-fields' });
    for (const field of form.fields) group.append(fieldControl(doc, form, field, callbacks));
    formElement.append(group);
  }
  formElement.append(reasonControl(doc, form, callbacks));
  const actions = makeElement(doc, 'div', { className: 'bb-graph-actions' });
  const saving = form.phase === 'saving';
  const submitLabel = saving ? '保存しています' : form.phase === 'conflict' && form.conflictCode === 'digest_conflict' ? '今の内容に対して保存する' : '保存する';
  actions.append(
    makeElement(doc, 'button', { className: 'bb-graph-button is-primary', text: submitLabel, attrs: { type: 'submit', disabled: saving } }),
    button(doc, '取り消す', callbacks.onClose, { attrs: { disabled: saving } }),
  );
  formElement.append(actions);
  panel.append(formElement);
  return panel;
}

/**
 * Holds one open correction at a time.  `rerender` redraws the owning view;
 * `onSaved(payload, form)` lets it read the saved record back into its lists;
 * `onConflict(form)` lets it refresh what it shows.
 */
export function createGraphCorrection({ client, rerender, onSaved, onConflict, now = () => new Date() } = {}) {
  if (!client) throw new TypeError('client is required');
  let form = null;
  let focusPending = false;
  let sequence = 0;
  // Label/input ids stay unique when two screens are on one page.
  const idPrefix = `bb-graph-form-${Math.random().toString(36).slice(2, 8)}`;
  const redraw = () => rerender?.();

  function baseForm(kind, extra) {
    sequence += 1;
    focusPending = true;
    return {
      kind,
      formId: `${idPrefix}-${sequence}`,
      phase: 'editing',
      message: null,
      reason: '',
      current: null,
      conflictCode: null,
      saved: null,
      ...extra,
    };
  }

  async function searchCandidates(query = '') {
    if (!form || form.kind !== 'create_edge') return;
    const target = form;
    const option = target.relationOptions.find((candidate) => candidate.id === target.draft.relation) ?? target.relationOptions[0];
    target.candidates = { state: 'loading', items: [], query };
    redraw();
    const result = await client.read('/search', { q: query, type: option.counterpartType, limit: 100 });
    if (form !== target) return;
    if (result.state === 'ok' && Array.isArray(result.payload.results) && result.payload.results.every(isEntityView)) {
      target.candidates = {
        state: 'ok',
        items: result.payload.results.filter((entity) => entity.id !== target.anchor.id && entity.type === option.counterpartType),
        truncated: result.payload.truncated === true,
        query,
      };
    } else if (result.state === 'ok') {
      target.candidates = { state: 'invalid', reason: '応答の形式が不正です', query };
    } else {
      target.candidates = { ...result, query };
    }
    redraw();
  }

  const callbacks = {
    onInput(field, value) {
      if (form) form.draft[field] = value;
    },
    onReason(value) {
      if (form) form.reason = value;
    },
    onRelation(value) {
      if (!form || form.kind !== 'create_edge') return;
      const previous = form.relationOptions.find((candidate) => candidate.id === form.draft.relation);
      const next = form.relationOptions.find((candidate) => candidate.id === value);
      if (!next) return;
      form.draft.relation = value;
      if (previous?.counterpartType !== next.counterpartType) {
        form.draft.counterpartId = '';
        void searchCandidates('');
      } else {
        redraw();
      }
    },
    onSearchCandidates: (query) => searchCandidates(query ?? ''),
    onSubmit: () => controller.submit(),
    onClose: () => controller.close(),
  };

  const controller = {
    get form() { return form; },
    get callbacks() { return callbacks; },
    /** Correct an entity.  `fields` limits what the form shows. */
    openEntity(record, { fields, title = '記録を直す', subject } = {}) {
      const values = graphRecordValues(record);
      const shown = (fields ?? ['name', 'aliases', 'summary', 'validFrom', 'validTo', ...(record.type === 'project' ? ['goal', 'status'] : [])]);
      const original = Object.fromEntries(shown.map((field) => [field, values[field]]));
      form = baseForm('update_entity', {
        title,
        subject: subject ?? `${typeLabel(record.type)}「${record.name}」`,
        targetId: record.id,
        expectedDigest: record.digest,
        fields: shown,
        original,
        draft: { ...original },
      });
      redraw();
      return form;
    },
    /** Correct a relation.  `mode`: 'role' (role and context), 'end' (end date, today by default) or 'edit' (all). */
    openEdge(edge, { mode = 'edit', title, subject } = {}) {
      const values = graphRecordValues(edge);
      const fields = mode === 'role' ? ['role', 'context'] : mode === 'end' ? ['validTo'] : ['role', 'context', 'validTo'];
      const original = Object.fromEntries(fields.map((field) => [field, values[field]]));
      const draft = { ...original };
      if (mode === 'end' && !draft.validTo) draft.validTo = localDay(now());
      form = baseForm('update_edge', {
        title: title ?? (mode === 'role' ? '役割を直す' : mode === 'end' ? '関わりを終える' : '関係を直す'),
        subject: subject ?? null,
        targetId: edge.id,
        expectedDigest: edge.digest,
        fields,
        original,
        draft,
      });
      redraw();
      return form;
    },
    /** Add a relation to or from `anchor`. */
    openCreate(anchor, { relations, relationNames = {}, relationLabel: label = '関係の種類', title = '関係を加える', subject } = {}) {
      const relationOptions = newRelationOptions(anchor.type, relations);
      if (relationOptions.length === 0) return null;
      form = baseForm('create_edge', {
        title,
        subject: subject ?? `${typeLabel(anchor.type)}「${anchor.name}」`,
        anchor: { id: anchor.id, type: anchor.type, name: anchor.name },
        relationOptions,
        relationNames,
        relationLabel: label,
        fields: ['role', 'context', 'validFrom'],
        original: {},
        draft: { relation: relationOptions[0].id, counterpartId: '', role: '', context: '', validFrom: '' },
        candidates: { state: 'loading', items: [], query: '' },
      });
      void searchCandidates('');
      return form;
    },
    close() {
      form = null;
      redraw();
    },
    async submit() {
      const target = form;
      if (!target || target.phase === 'saving') return target;
      const built = buildCorrectionRequest(target);
      if (!built.ok) {
        target.message = { tone: 'danger', text: built.message };
        if (target.phase !== 'conflict') target.phase = 'editing';
        redraw();
        return target;
      }
      target.phase = 'saving';
      target.message = null;
      redraw();
      const result = await client.correct(built.body);
      if (form !== target) return target;
      if (result.state === 'saved') {
        target.phase = 'saved';
        target.saved = result.payload;
        focusPending = true;
        redraw();
        await onSaved?.(result.payload, target);
        return target;
      }
      if (result.state === 'conflict') {
        target.phase = 'conflict';
        target.conflictCode = result.code;
        target.current = result.current;
        target.message = null;
        // The owner now sees the current record; the next save is based on it
        // and still sends only the fields the owner changed.  Untouched fields
        // show the current values so the form never suggests reverting them.
        if (target.kind !== 'create_edge' && typeof result.current.digest === 'string') {
          target.expectedDigest = result.current.digest;
          const currentValues = graphRecordValues(result.current.record);
          for (const field of target.fields) {
            const touched = String(target.draft[field] ?? '').trim() !== String(target.original[field] ?? '').trim();
            target.original[field] = currentValues[field];
            if (!touched) target.draft[field] = currentValues[field];
          }
        }
        focusPending = true;
        redraw();
        await onConflict?.(target);
        return target;
      }
      target.phase = 'error';
      target.message = { tone: 'danger', text: result.message };
      redraw();
      return target;
    },
    /** The open panel, or null. */
    render(doc) {
      if (!form) return null;
      const panel = renderCorrectionPanel(doc, form, callbacks);
      if (focusPending) {
        focusPending = false;
        const focus = () => {
          panel.scrollIntoView?.({ block: 'nearest' });
          panel.focus?.({ preventScroll: true });
        };
        if (typeof queueMicrotask === 'function') queueMicrotask(focus);
        else setTimeout(focus, 0);
      }
      return panel;
    },
  };
  return controller;
}
