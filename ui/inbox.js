/*
 * 受信箱 (story-inbox-stage1-v1, docs/specs/inbox-stage1.md).
 *
 * What is waiting for the viewer — to answer, approve, sort or take in, and
 * tasks — on one screen with two tabs, 対応待ち and お知らせ.  The part never
 * reads anything by itself: the host passes a port (`readInbox`,
 * `setDisposition`, optional `runAction` and `readNotices`).  Each kind is
 * read on its own; a kind that could not be read says so and is never shown
 * as zero.  あとで and 片付けた belong to the host (the inbox is the canonical
 * place for them), and a row's buttons call the host's own operation: the part
 * has no write path of its own.
 *
 * The address keeps only the tab and the list being shown; titles, details
 * and item ids never enter it.
 */

import {
  makeWorkspaceElement,
  workspaceButton,
  workspaceErrorCard,
  workspaceNotice,
  workspacePageHeader,
} from './workspace-kit.js';

export const INBOX_UI_CONTRACT_VERSION = 'brainbase.inbox-ui.v1';

export const INBOX_GROUP_LABELS = Object.freeze({
  answer: '答える・決める',
  approve: '承認する',
  triage: '振り分ける・取り込む',
  task: 'タスク',
});
const GROUPS = Object.keys(INBOX_GROUP_LABELS);
const TABS = ['waiting', 'notices'];
const VIEWS = ['waiting', 'later', 'cleared'];

/** The three sections of the 今日決めること layout, in order. */
export const INBOX_TODAY_SECTIONS = Object.freeze([
  Object.freeze({ id: 'decide', label: '決めること', groups: Object.freeze(['answer', 'approve']) }),
  Object.freeze({ id: 'batch', label: 'まとめて片付くもの', groups: Object.freeze(['triage']) }),
  Object.freeze({ id: 'look', label: '見るだけ', groups: Object.freeze(['task']) }),
]);

const el = makeWorkspaceElement;

// Why a read failed, in the viewer's words; the code stays beside it for support.
const REASON_LABELS = Object.freeze({
  upstream_unavailable: '元の記録を読めません',
  forbidden: '読む権限がありません',
  unauthorized: 'ログインし直してください',
  store_unavailable: '受信箱の状態を保存できません',
  request_failed: '通信に失敗しました',
  response_invalid: '応答の形が正しくありません',
});

function reasonText(reason) {
  const code = String(reason ?? 'unknown');
  return REASON_LABELS[code] ? `${REASON_LABELS[code]}（${code}）` : code;
}

function textOf(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function timeOf(value) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? null : time;
}

function unitsOf(item) {
  return Number.isInteger(item?.units) && item.units >= 0 ? item.units : 1;
}

function normalizeRoute(route = {}) {
  return {
    tab: TABS.includes(route.tab) ? route.tab : 'waiting',
    view: VIEWS.includes(route.view) ? route.view : 'waiting',
  };
}

/** Reads `tab` and `view` from the address. Unknown values fall back to 対応待ち. */
export function parseInboxRoute(params) {
  return normalizeRoute({ tab: params.get('tab'), view: params.get('view') });
}

/** The shell's hash target for a route.  Anything else in the route is dropped. */
export function inboxRouteTarget(route) {
  const normalized = normalizeRoute(route);
  const params = new URLSearchParams();
  if (normalized.tab !== 'waiting') params.set('tab', normalized.tab);
  else if (normalized.view !== 'waiting') params.set('view', normalized.view);
  const query = params.toString();
  return query ? `inbox?${query}` : 'inbox';
}

/** Blocking first, then the nearest due date (none last), then the newest arrival. */
export function sortInboxItems(items) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const blocking = Number(right.blocking === true) - Number(left.blocking === true);
    if (blocking !== 0) return blocking;
    const leftDue = timeOf(left.dueAt);
    const rightDue = timeOf(right.dueAt);
    if (leftDue !== rightDue) {
      if (leftDue === null) return 1;
      if (rightDue === null) return -1;
      return leftDue - rightDue;
    }
    return (timeOf(right.receivedAt) ?? 0) - (timeOf(left.receivedAt) ?? 0);
  });
}

/** The disposition that still applies to an item now: same revision, and a later not yet passed. */
function activeDisposition(item, dispositions, now) {
  const disposition = dispositions.get(item.id);
  if (!disposition) return null;
  if ((disposition.revision ?? null) !== (item.revision ?? null)) return null;
  if (disposition.state === 'later') {
    const until = timeOf(disposition.until);
    return until !== null && until > now.getTime() ? disposition : null;
  }
  return disposition.state === 'cleared' ? disposition : null;
}

function dispositionMap(list) {
  const map = new Map();
  for (const disposition of Array.isArray(list) ? list : []) {
    if (textOf(disposition?.itemId)) map.set(disposition.itemId, disposition);
  }
  return map;
}

function readableItems(result) {
  const readable = new Set((result.sources ?? []).filter((source) => source.status === 'ok').map((source) => source.kind));
  return (Array.isArray(result.items) ? result.items : []).filter((item) => readable.has(item.kind) && GROUPS.includes(item.group));
}

/**
 * The 対応待ち count for the left menu: what is shown (hidden and cleared rows
 * left out, a summary row counts as its own number), from the kinds that could
 * be read.  `count` is null when the inbox itself could not be read.
 */
export function countInboxWaiting(result, now = new Date()) {
  if (result?.status !== 'ok') return { count: null, unreadable: [] };
  const dispositions = dispositionMap(result.dispositions);
  const count = readableItems(result)
    .filter((item) => !activeDisposition(item, dispositions, now))
    .reduce((sum, item) => sum + unitsOf(item), 0);
  const unreadable = (result.sources ?? []).filter((source) => source.status === 'unavailable').map((source) => source.label);
  return { count, unreadable };
}

function at(base, dayOffset, hour) {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, 0, 0, 0);
  return date;
}

/** あとで: this evening (only before 18:00), tomorrow morning, next Monday morning — by the viewer's clock. */
export function inboxLaterChoices(now = new Date(), { style } = {}) {
  const today = style === 'today';
  const choices = [];
  const evening = at(now, 0, today ? 21 : 18);
  if (evening.getTime() > now.getTime()) {
    choices.push({ id: 'evening', label: today ? '今夜 21:00' : '今日の夕方', until: evening });
  }
  choices.push({ id: 'tomorrow', label: today ? '明日の朝 9:00' : '明日の朝', until: at(now, 1, 9) });
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  choices.push({ id: 'monday', label: today ? '来週の月曜 9:00' : '来週の月曜の朝', until: at(now, toMonday, 9) });
  return choices;
}

export const INBOX_DISPOSITIONS_KEY = 'brainbase.inbox.dispositions.v1';
const CLEARED_KEPT_MS = 30 * 86_400_000;

/**
 * 片付けた・あとで kept in the viewer's browser (stage 1: the inbox has no
 * canonical store yet; stage 4 moves them there with the Slack sync).  One
 * key per person, because a browser can be shared by several accounts.  A
 * storage that cannot be reached reads as nothing kept and fails every write
 * with `store_unavailable`, so the screen puts the row back.
 */
export function createLocalInboxDispositions(storage, { personId = null, key = INBOX_DISPOSITIONS_KEY, now = () => new Date() } = {}) {
  const storageKey = textOf(personId) ? `${key}:${personId}` : key;
  const read = () => {
    try {
      const raw = storage?.getItem?.(storageKey);
      const value = raw ? JSON.parse(raw) : [];
      return Array.isArray(value) ? value.filter((entry) => textOf(entry?.itemId)) : [];
    } catch {
      return [];
    }
  };
  const current = (entries) => {
    const time = now().getTime();
    // A passed あとで and an old 片付けた are dropped so the key does not grow.
    return entries.filter((entry) => (entry.state === 'later'
      ? (timeOf(entry.until) ?? 0) > time
      : entry.state === 'cleared' && time - (timeOf(entry.at) ?? 0) < CLEARED_KEPT_MS));
  };
  return Object.freeze({
    list: () => current(read()),
    set(itemId, change) {
      if (!storage || typeof storage.setItem !== 'function') return { status: 'unavailable', reason: 'store_unavailable' };
      const others = current(read()).filter((entry) => entry.itemId !== itemId);
      const next = change?.state === 'later' || change?.state === 'cleared'
        ? [...others, { itemId, revision: change.revision ?? null, state: change.state, until: change.state === 'later' ? change.until : null, at: now().toISOString() }]
        : others;
      try {
        storage.setItem(storageKey, JSON.stringify(next));
        return { status: 'ok' };
      } catch {
        return { status: 'unavailable', reason: 'store_unavailable' };
      }
    },
  });
}

/** A port whose 片付けた・あとで live in `store` (see createLocalInboxDispositions). */
export function withLocalInboxDispositions(reader, store) {
  const port = {
    async readInbox() {
      const result = await reader.readInbox();
      return result?.status === 'ok' ? { ...result, dispositions: store.list() } : result;
    },
    async setDisposition(itemId, change) {
      return store.set(itemId, change);
    },
  };
  if (typeof reader.runAction === 'function') port.runAction = (itemId, actionId) => reader.runAction(itemId, actionId);
  if (typeof reader.readNotices === 'function') port.readNotices = () => reader.readNotices();
  return port;
}

function formatShort(value) {
  const time = timeOf(value);
  if (time === null) return null;
  const date = new Date(time);
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function relativeTime(value, now) {
  const time = timeOf(value);
  if (time === null) return null;
  const minutes = Math.floor((now.getTime() - time) / 60_000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}日前` : formatShort(value);
}

function waitingDays(value, now) {
  const time = timeOf(value);
  if (time === null) return null;
  return Math.max(0, Math.floor((now.getTime() - time) / 86_400_000));
}

export function createInboxUI({
  root,
  page,
  document: explicitDocument,
  port,
  route: initialRoute,
  onRouteChange,
  onNavigate,
  onCount,
  now = () => new Date(),
  layout: layoutOption = 'tabs',
  undoWindowMs: undoWindowMsOption = 0,
  timers: timersOption,
} = {}) {
  if (!root) throw new TypeError('root is required');
  if (!port || typeof port.readInbox !== 'function' || typeof port.setDisposition !== 'function') {
    throw new TypeError('port is required');
  }
  const doc = explicitDocument ?? (typeof document === 'undefined' ? null : document);
  if (!doc || typeof doc.createElement !== 'function') throw new Error('document_unavailable');
  const crumbs = Array.isArray(page?.crumbs) ? page.crumbs : ['受信箱'];
  const readNow = () => (typeof now === 'function' ? now() : now);
  const layout = layoutOption === 'today' ? 'today' : 'tabs';
  const undoWindowMs = Number.isFinite(undoWindowMsOption) && undoWindowMsOption > 0 ? undoWindowMsOption : 0;
  const timers = {
    set: typeof timersOption?.set === 'function' ? timersOption.set : (fn, ms) => globalThis.setTimeout(fn, ms),
    clear: typeof timersOption?.clear === 'function' ? timersOption.clear : (id) => globalThis.clearTimeout(id),
  };

  function normalizedRoute(route) {
    const next = normalizeRoute(route);
    return layout === 'today' ? { ...next, tab: 'waiting' } : next;
  }

  const state = {
    route: normalizedRoute(initialRoute),
    phase: 'idle',
    result: null,
    reason: null,
    dispositions: new Map(),
    laterOpen: null,
    notice: null,
    noticeOwner: null,
    notices: null,
    pending: new Map(),
    sent: new Set(),
    destroyed: false,
  };
  let generation = 0;

  function setNotice(message, owner = null) {
    state.notice = message;
    state.noticeOwner = owner;
  }

  function clearNotice() {
    state.notice = null;
    state.noticeOwner = null;
  }

  function clearNoticeFor(owner) {
    if (!state.notice || !state.noticeOwner) return;
    if (state.noticeOwner.itemId !== owner.itemId || state.noticeOwner.actionId !== owner.actionId) return;
    clearNotice();
  }

  function go(route) {
    const next = normalizedRoute({ ...state.route, ...route });
    if (typeof onRouteChange === 'function') onRouteChange(next);
    else applyRoute(next);
  }

  function reportCount() {
    if (typeof onCount !== 'function') return;
    if (!state.result) {
      onCount({ count: null, unreadable: [] });
      return;
    }
    const current = readNow();
    const base = countInboxWaiting({ ...state.result, dispositions: [...state.dispositions.values()] }, current);
    if ((state.pending.size === 0 && state.sent.size === 0) || base.count === null) {
      onCount(base);
      return;
    }
    const rows = new Map(readableItems(state.result).map((item) => [item.id, item]));
    let count = base.count;
    for (const id of new Set([...state.pending.keys(), ...state.sent])) {
      const row = rows.get(id);
      if (!row) continue;
      if (activeDisposition(row, state.dispositions, current)) continue;
      count -= unitsOf(row);
    }
    onCount({ count: Math.max(0, count), unreadable: base.unreadable });
  }

  function noticesWanted() {
    return layout === 'today' ? typeof port.readNotices === 'function' : state.route.tab === 'notices';
  }

  async function loadNotices() {
    if (typeof port.readNotices !== 'function') {
      state.notices = { phase: 'not_collected' };
      if (!state.destroyed) render();
      return;
    }
    let result;
    try {
      result = await port.readNotices();
    } catch (error) {
      result = { status: 'unavailable', reason: error instanceof Error ? error.message : 'request_failed' };
    }
    if (state.destroyed) return;
    state.notices = result?.status === 'ok' && Array.isArray(result.items)
      ? { phase: 'ok', items: result.items }
      : { phase: 'unavailable', reason: result?.reason ?? 'response_invalid' };
    render();
  }

  async function load() {
    if (state.destroyed) return;
    const current = ++generation;
    // The previous rows stay on screen while the next read runs.
    state.phase = 'loading';
    render();
    let result;
    try {
      result = await port.readInbox();
    } catch (error) {
      result = { status: 'unavailable', reason: error instanceof Error ? error.message : 'request_failed' };
    }
    if (current !== generation || state.destroyed) return;
    if (result?.status === 'ok' && Array.isArray(result.sources) && Array.isArray(result.items)) {
      state.result = result;
      state.dispositions = dispositionMap(result.dispositions);
      state.phase = 'ready';
      state.reason = null;
      state.sent.clear();
    } else {
      state.result = null;
      state.phase = 'error';
      state.reason = result?.reason ?? 'response_invalid';
    }
    // The inbox is shown as soon as it arrives; notices are read beside it and
    // never hold back the rows or the count when they are slow or failing.
    render();
    reportCount();
    if (noticesWanted() && state.notices === null) void loadNotices();
  }

  function applyRoute(route) {
    state.route = normalizedRoute(route);
    state.laterOpen = null;
    if (noticesWanted() && state.notices === null) {
      void loadNotices();
    }
    render();
  }

  async function dispose(item, change, failureTitle) {
    const previous = state.dispositions.get(item.id) ?? null;
    if (change.state === 'open') state.dispositions.delete(item.id);
    else state.dispositions.set(item.id, { itemId: item.id, revision: change.revision, state: change.state, until: change.until ?? null, at: readNow().toISOString() });
    state.laterOpen = null;
    clearNotice();
    render();
    reportCount();
    let result;
    try {
      result = await port.setDisposition(item.id, change);
    } catch (error) {
      result = { status: 'unavailable', reason: error instanceof Error ? error.message : 'request_failed' };
    }
    if (state.destroyed || result?.status === 'ok') return;
    if (previous) state.dispositions.set(item.id, previous);
    else state.dispositions.delete(item.id);
    setNotice(`${failureTitle}。理由: ${reasonText(result?.reason ?? 'response_invalid')}。`);
    render();
    reportCount();
  }

  async function runAction(item, action) {
    const owner = { itemId: item.id, actionId: action.id };
    let result;
    try {
      result = await port.runAction(item.id, action.id);
    } catch (error) {
      result = { status: 'unavailable', reason: error instanceof Error ? error.message : 'request_failed' };
    }
    if (state.destroyed) return;
    if (result?.status === 'ok') {
      clearNoticeFor(owner);
      await load();
      return;
    }
    setNotice(`「${action.label}」を実行できませんでした。理由: ${reasonText(result?.reason ?? 'response_invalid')}。`, owner);
    render();
  }

  function clearPendingTimer(entry) {
    if (entry.timerId !== null && entry.timerId !== undefined) timers.clear(entry.timerId);
  }

  async function commitPending(entry) {
    if (state.pending.get(entry.item.id) !== entry || state.destroyed) return;
    clearPendingTimer(entry);
    entry.sent = true;
    render();
    let result;
    try {
      result = await port.runAction(entry.item.id, entry.action.id);
    } catch (error) {
      result = { status: 'unavailable', reason: error instanceof Error ? error.message : 'request_failed' };
    }
    if (state.pending.get(entry.item.id) === entry) state.pending.delete(entry.item.id);
    if (state.destroyed) return;
    if (result?.status === 'ok') {
      state.sent.add(entry.item.id);
      clearNoticeFor({ itemId: entry.item.id, actionId: entry.action.id });
      await load();
      return;
    }
    setNotice(`「${entry.action.label}」を実行できませんでした。理由: ${reasonText(result?.reason ?? 'response_invalid')}。`, { itemId: entry.item.id, actionId: entry.action.id });
    render();
    reportCount();
  }

  function pressAction(item, action) {
    if (undoWindowMs <= 0) {
      void runAction(item, action);
      return;
    }
    const entry = { item, action, timerId: null };
    state.pending.set(item.id, entry);
    clearNotice();
    entry.timerId = timers.set(() => { void commitPending(entry); }, undoWindowMs);
    render();
    reportCount();
  }

  function undoPending(entry) {
    if (entry.sent === true) return;
    clearPendingTimer(entry);
    state.pending.delete(entry.item.id);
    render();
    reportCount();
  }

  function openItem(item, event) {
    if (item.clearOnOpen === true) void dispose(item, { state: 'cleared', revision: item.revision ?? null }, '開いた行を片付けられませんでした');
    const href = textOf(item.href);
    if (href && typeof onNavigate === 'function') {
      event?.preventDefault?.();
      onNavigate(href);
    }
  }

  function renderTabs(waitingCount) {
    const bar = el(doc, 'div', { className: 'bb-inbox-tabs', attrs: { role: 'tablist', 'aria-label': '受信箱' } });
    for (const [id, label] of [['waiting', '対応待ち'], ['notices', 'お知らせ']]) {
      const selected = state.route.tab === id;
      const tab = el(doc, 'button', {
        className: `bb-inbox-tab${selected ? ' is-selected' : ''}`,
        text: label,
        attrs: { type: 'button', role: 'tab', 'aria-selected': selected ? 'true' : 'false' },
      });
      if (id === 'waiting' && Number.isInteger(waitingCount) && waitingCount > 0) {
        tab.append(el(doc, 'span', { className: 'bb-inbox-count', text: waitingCount, attrs: { 'aria-label': `${waitingCount}件` } }));
      }
      tab.addEventListener('click', () => go({ tab: id, view: 'waiting' }));
      bar.append(tab);
    }
    return bar;
  }

  function renderLaterMenu(item) {
    const menu = el(doc, 'div', { className: 'bb-inbox-later-menu', attrs: { role: 'group', 'aria-label': 'あとでの時刻' } });
    for (const choice of inboxLaterChoices(readNow(), layout === 'today' ? { style: 'today' } : {})) {
      menu.append(workspaceButton(doc, {
        text: choice.label,
        variant: 'quiet',
        onClick: () => void dispose(item, { state: 'later', until: choice.until.toISOString(), revision: item.revision ?? null }, 'あとでにできませんでした'),
      }));
    }
    return menu;
  }

  function renderRow(item, view) {
    const row = el(doc, 'div', { className: `bb-inbox-row${item.blocking === true ? ' is-blocking' : ''}`, attrs: { role: 'listitem', 'data-inbox-item': item.id } });
    const main = el(doc, 'div', { className: 'bb-inbox-row-main' });
    const href = textOf(item.href);
    const title = el(doc, href ? 'a' : 'span', { className: 'bb-inbox-title', text: item.title, attrs: href ? { href } : {} });
    if (href) title.addEventListener('click', (event) => openItem(item, event));
    main.append(title);
    const meta = el(doc, 'div', { className: 'bb-inbox-meta' });
    if (item.blocking === true) meta.append(el(doc, 'span', { className: 'bb-inbox-blocking', text: '止めています' }));
    const due = formatShort(item.dueAt);
    if (due) meta.append(el(doc, 'span', { className: 'bb-inbox-due', text: `期限 ${due}` }));
    if (layout === 'today') {
      const days = waitingDays(item.receivedAt, readNow());
      if (days !== null) {
        meta.append(el(doc, 'span', {
          className: `bb-inbox-wait${days > 3 ? ' is-long' : ''}`,
          text: days === 0 ? '今日' : `待ち ${days}日`,
          attrs: { title: formatShort(item.receivedAt) ?? undefined },
        }));
      }
    } else {
      const received = relativeTime(item.receivedAt, readNow());
      if (received) meta.append(el(doc, 'span', { text: received, attrs: { title: formatShort(item.receivedAt) ?? undefined } }));
    }
    const disposition = state.dispositions.get(item.id);
    if (view === 'later' && disposition?.until) meta.append(el(doc, 'span', { className: 'bb-inbox-until', text: `${formatShort(disposition.until)}に戻ります` }));
    if (textOf(item.detail)) main.append(el(doc, 'p', { className: 'bb-inbox-detail', text: item.detail }));
    if (meta.children?.length !== 0) main.append(meta);
    row.append(main);

    const controls = el(doc, 'div', { className: 'bb-inbox-row-actions' });
    if (view === 'waiting') {
      const actions = typeof port.runAction === 'function'
        ? (Array.isArray(item.actions) ? item.actions : []).filter((action) => textOf(action?.id) && textOf(action?.label))
        : [];
      const hasPrimary = actions.some((action) => action.tone === 'primary');
      for (const action of actions) {
        controls.append(workspaceButton(doc, {
          text: action.label,
          variant: action.tone === 'primary' ? 'primary' : action.tone === 'danger' ? 'danger' : 'default',
          onClick: () => pressAction(item, action),
        }));
      }
      controls.append(
        workspaceButton(doc, {
          text: 'あとで',
          variant: 'quiet',
          attrs: { 'aria-expanded': state.laterOpen === item.id ? 'true' : 'false', 'aria-haspopup': 'true' },
          onClick: () => {
            state.laterOpen = state.laterOpen === item.id ? null : item.id;
            render();
          },
        }),
      );
      if (!(layout === 'today' && hasPrimary)) {
        controls.append(workspaceButton(doc, { text: '片付けた', variant: 'quiet', onClick: () => void dispose(item, { state: 'cleared', revision: item.revision ?? null }, '片付けられませんでした') }));
      }
    } else {
      controls.append(workspaceButton(doc, { text: '対応待ちに戻す', variant: 'quiet', onClick: () => void dispose(item, { state: 'open' }, '対応待ちに戻せませんでした') }));
    }
    row.append(controls);
    if (state.laterOpen === item.id) row.append(renderLaterMenu(item));
    return row;
  }

  function sourceLine(source) {
    if (source.status === 'not_connected') {
      return el(doc, 'p', { className: 'bb-inbox-source is-not-connected', text: `${source.label}は未接続です。` });
    }
    return el(doc, 'p', { className: 'bb-inbox-source is-unavailable', text: `${source.label}を読めませんでした。理由: ${reasonText(source.reason)}。0件ではありません。`, attrs: { role: 'status' } });
  }

  function partition(now) {
    const shown = { waiting: [], later: [], cleared: [] };
    for (const item of readableItems(state.result)) {
      if (state.pending.has(item.id) || state.sent.has(item.id)) continue;
      const disposition = activeDisposition(item, state.dispositions, now);
      shown[disposition ? disposition.state : 'waiting'].push(item);
    }
    return shown;
  }

  function renderWaiting(shown) {
    const view = el(doc, 'div', { className: 'bb-inbox-waiting' });
    const sources = state.result.sources;
    let anyContent = false;
    for (const group of GROUPS) {
      const rows = sortInboxItems(shown.waiting.filter((item) => item.group === group));
      const problems = sources.filter((source) => source.group === group && source.status !== 'ok');
      if (rows.length === 0 && problems.length === 0) continue;
      anyContent = true;
      const section = el(doc, 'section', { className: 'bb-inbox-group', attrs: { 'data-group': group, 'aria-label': INBOX_GROUP_LABELS[group] } });
      section.append(el(doc, 'h2', { className: 'bb-inbox-group-title', text: INBOX_GROUP_LABELS[group] }));
      if (rows.length > 0) {
        const list = el(doc, 'div', { className: 'bb-inbox-list', attrs: { role: 'list' } });
        for (const item of rows) list.append(renderRow(item, 'waiting'));
        section.append(list);
      }
      for (const source of problems) section.append(sourceLine(source));
      view.append(section);
    }
    const allRead = sources.every((source) => source.status !== 'unavailable');
    if (!anyContent && allRead) view.append(el(doc, 'p', { className: 'bb-inbox-empty', text: '待っているものはありません。' }));
    const uncollected = (Array.isArray(state.result.uncollected) ? state.result.uncollected : []).filter(textOf);
    if (uncollected.length > 0) {
      view.append(el(doc, 'p', { className: 'bb-inbox-uncollected', text: `まだ集めていない種類があります（${uncollected.join('・')}）。件数には入っていません。` }));
    }
    const links = el(doc, 'div', { className: 'bb-inbox-elsewhere' });
    if (shown.later.length > 0) links.append(workspaceButton(doc, { text: `あとで ${shown.later.length}件`, variant: 'quiet', onClick: () => go({ view: 'later' }) }));
    if (shown.cleared.length > 0) links.append(workspaceButton(doc, { text: `片付けた ${shown.cleared.length}件`, variant: 'quiet', onClick: () => go({ view: 'cleared' }) }));
    if (links.children.length > 0) view.append(links);
    return view;
  }

  function renderTodayWaiting(shown) {
    const view = el(doc, 'div', { className: 'bb-inbox-waiting is-today' });
    const sources = state.result.sources;
    for (const definition of INBOX_TODAY_SECTIONS) {
      const rows = sortInboxItems(shown.waiting.filter((item) => definition.groups.includes(item.group)));
      const problems = sources.filter((source) => definition.groups.includes(source.group) && source.status !== 'ok');
      if (rows.length > 0 || problems.length > 0) {
        const section = el(doc, 'section', {
          className: 'bb-inbox-group bb-inbox-today-section',
          attrs: { 'data-section': definition.id, 'data-group': definition.id, 'aria-label': definition.label },
        });
        section.append(el(doc, 'h2', { className: 'bb-inbox-group-title', text: definition.label }));
        if (rows.length > 0) {
          const list = el(doc, 'div', { className: 'bb-inbox-list', attrs: { role: 'list' } });
          for (const item of rows) list.append(renderRow(item, 'waiting'));
          section.append(list);
        }
        for (const source of problems) section.append(sourceLine(source));
        view.append(section);
      }
      if (definition.id === 'look' && typeof port.readNotices === 'function' && state.notices !== null) {
        view.append(renderNotices());
      }
    }
    const uncollected = (Array.isArray(state.result.uncollected) ? state.result.uncollected : []).filter(textOf);
    if (uncollected.length > 0) {
      view.append(el(doc, 'p', { className: 'bb-inbox-uncollected', text: `まだ集めていない種類があります（${uncollected.join('・')}）。件数には入っていません。` }));
    }
    const links = el(doc, 'div', { className: 'bb-inbox-elsewhere' });
    if (shown.later.length > 0) links.append(workspaceButton(doc, { text: `あとで ${shown.later.length}件`, variant: 'quiet', onClick: () => go({ view: 'later' }) }));
    if (shown.cleared.length > 0) links.append(workspaceButton(doc, { text: `片付けた ${shown.cleared.length}件`, variant: 'quiet', onClick: () => go({ view: 'cleared' }) }));
    if (links.children.length > 0) view.append(links);
    return view;
  }

  function renderUndoBand() {
    const entries = [...state.pending.values()];
    if (entries.length === 0) return null;
    const undoable = entries.filter((entry) => entry.sent !== true);
    const target = undoable.length > 0 ? undoable[undoable.length - 1] : null;
    const shown = target ?? entries[entries.length - 1];
    const band = el(doc, 'div', { className: 'bb-inbox-undo', attrs: { role: 'status' } });
    band.append(el(doc, 'span', { text: target ? `「${shown.action.label}」を実行します。` : `「${shown.action.label}」を実行しています。` }));
    if (target) band.append(workspaceButton(doc, { text: '元に戻す', variant: 'quiet', onClick: () => undoPending(target) }));
    return band;
  }

  function renderSet(shown, which) {
    const view = el(doc, 'div', { className: 'bb-inbox-set' });
    view.append(workspaceButton(doc, { text: '対応待ちへ', variant: 'quiet', onClick: () => go({ view: 'waiting' }) }));
    view.append(el(doc, 'h2', { className: 'bb-inbox-group-title', text: which === 'later' ? 'あとで' : '片付けた' }));
    const rows = which === 'later'
      ? [...shown.later].sort((left, right) => (timeOf(state.dispositions.get(left.id)?.until) ?? 0) - (timeOf(state.dispositions.get(right.id)?.until) ?? 0))
      : [...shown.cleared].sort((left, right) => (timeOf(state.dispositions.get(right.id)?.at) ?? 0) - (timeOf(state.dispositions.get(left.id)?.at) ?? 0));
    if (rows.length === 0) {
      view.append(el(doc, 'p', { className: 'bb-inbox-empty', text: which === 'later' ? 'あとでにしたものはありません。' : '片付けたものはありません。' }));
      return view;
    }
    const list = el(doc, 'div', { className: 'bb-inbox-list', attrs: { role: 'list' } });
    for (const item of rows) list.append(renderRow(item, which));
    view.append(list);
    return view;
  }

  function renderNotices() {
    const view = el(doc, 'div', { className: 'bb-inbox-notices' });
    const notices = state.notices;
    if (!notices || notices.phase === 'not_collected') {
      view.append(el(doc, 'p', { className: 'bb-inbox-uncollected', text: 'お知らせはまだ集めていません。AIに任せた仕事の終わり・議事録ができたこと・申請の結果は、これから集めます。' }));
    } else if (notices.phase === 'unavailable') {
      view.append(workspaceErrorCard(doc, { title: 'お知らせを読めませんでした', message: `理由: ${reasonText(notices.reason)}。0件ではありません。` }));
    } else if (notices.items.length === 0) {
      view.append(el(doc, 'p', { className: 'bb-inbox-empty', text: 'お知らせはありません。' }));
    }
    return view;
  }

  function render() {
    if (state.destroyed) return;
    const current = readNow();
    const shown = state.result ? partition(current) : null;
    const waitingCount = shown ? shown.waiting.reduce((sum, item) => sum + unitsOf(item), 0) : null;
    const isToday = layout === 'today';
    const view = el(doc, 'div', {
      className: `bb-inbox${isToday ? ' is-today' : ''}`,
      attrs: { 'data-contract-version': INBOX_UI_CONTRACT_VERSION },
    });
    view.append(workspacePageHeader(doc, { crumbs, title: '受信箱', source: page?.source ?? undefined }));
    if (!isToday) view.append(renderTabs(waitingCount));
    if (isToday && shown) {
      const decideCount = shown.waiting
        .filter((item) => INBOX_TODAY_SECTIONS[0].groups.includes(item.group))
        .reduce((sum, item) => sum + unitsOf(item), 0);
      view.append(el(doc, 'p', {
        className: 'bb-inbox-today-count',
        text: decideCount > 0 ? `今日決めること ${decideCount}件` : '今日決めることはありません',
      }));
    }
    if (state.phase === 'loading') view.append(el(doc, 'div', { className: 'bb-inbox-loading', text: '読み込んでいます', attrs: { role: 'status' } }));
    const undoBand = renderUndoBand();
    if (undoBand) view.append(undoBand);
    if (state.notice) view.append(workspaceNotice(doc, { label: 'できませんでした', text: state.notice, tone: 'warning', role: 'alert' }));
    if (!isToday && state.route.tab === 'notices') {
      view.append(renderNotices());
    } else if (state.phase === 'error' && !shown) {
      view.append(workspaceErrorCard(doc, { title: '受信箱を読めませんでした', message: `理由: ${reasonText(state.reason)}。0件ではありません。`, onRetry: () => void load() }));
    } else if (shown) {
      if (isToday) view.append(state.route.view === 'waiting' ? renderTodayWaiting(shown) : renderSet(shown, state.route.view));
      else view.append(state.route.view === 'waiting' ? renderWaiting(shown) : renderSet(shown, state.route.view));
    }
    root.replaceChildren(view);
  }

  const controller = {
    load,
    applyRoute,
    get state() {
      return { route: { ...state.route }, phase: state.phase, result: state.result, dispositions: [...state.dispositions.values()] };
    },
    destroy() {
      state.destroyed = true;
      generation += 1;
      const remaining = [...state.pending.values()];
      state.pending.clear();
      for (const entry of remaining) {
        clearPendingTimer(entry);
        if (entry.sent === true || typeof port.runAction !== 'function') continue;
        try {
          const result = port.runAction(entry.item.id, entry.action.id);
          if (result && typeof result.catch === 'function') result.catch(() => {});
        } catch {
          // The press still happened; there is no screen left to show the result on.
        }
      }
      root.replaceChildren();
    },
  };
  render();
  return controller;
}

export default createInboxUI;
