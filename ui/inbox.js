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
export function inboxLaterChoices(now = new Date()) {
  const choices = [];
  const evening = at(now, 0, 18);
  if (evening.getTime() > now.getTime()) choices.push({ id: 'evening', label: '今日の夕方', until: evening });
  choices.push({ id: 'tomorrow', label: '明日の朝', until: at(now, 1, 9) });
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  choices.push({ id: 'monday', label: '来週の月曜の朝', until: at(now, toMonday, 9) });
  return choices;
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
} = {}) {
  if (!root) throw new TypeError('root is required');
  if (!port || typeof port.readInbox !== 'function' || typeof port.setDisposition !== 'function') {
    throw new TypeError('port is required');
  }
  const doc = explicitDocument ?? (typeof document === 'undefined' ? null : document);
  if (!doc || typeof doc.createElement !== 'function') throw new Error('document_unavailable');
  const crumbs = Array.isArray(page?.crumbs) ? page.crumbs : ['受信箱'];
  const readNow = () => (typeof now === 'function' ? now() : now);

  const state = {
    route: normalizeRoute(initialRoute),
    phase: 'idle',
    result: null,
    reason: null,
    dispositions: new Map(),
    laterOpen: null,
    notice: null,
    notices: null,
    destroyed: false,
  };
  let generation = 0;

  function go(route) {
    const next = normalizeRoute({ ...state.route, ...route });
    if (typeof onRouteChange === 'function') onRouteChange(next);
    else applyRoute(next);
  }

  function reportCount() {
    if (typeof onCount !== 'function') return;
    onCount(state.result ? countInboxWaiting({ ...state.result, dispositions: [...state.dispositions.values()] }, readNow()) : { count: null, unreadable: [] });
  }

  async function loadNotices() {
    if (typeof port.readNotices !== 'function') {
      state.notices = { phase: 'not_collected' };
      return;
    }
    let result;
    try {
      result = await port.readNotices();
    } catch (error) {
      result = { status: 'unavailable', reason: error instanceof Error ? error.message : 'request_failed' };
    }
    state.notices = result?.status === 'ok' && Array.isArray(result.items)
      ? { phase: 'ok', items: result.items }
      : { phase: 'unavailable', reason: result?.reason ?? 'response_invalid' };
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
    if (state.route.tab === 'notices' && state.notices === null) await loadNotices();
    if (current !== generation || state.destroyed) return;
    if (result?.status === 'ok' && Array.isArray(result.sources) && Array.isArray(result.items)) {
      state.result = result;
      state.dispositions = dispositionMap(result.dispositions);
      state.phase = 'ready';
      state.reason = null;
    } else {
      state.result = null;
      state.phase = 'error';
      state.reason = result?.reason ?? 'response_invalid';
    }
    render();
    reportCount();
  }

  function applyRoute(route) {
    state.route = normalizeRoute(route);
    state.laterOpen = null;
    if (state.route.tab === 'notices' && state.notices === null) {
      void loadNotices().then(() => render());
    }
    render();
  }

  async function dispose(item, change, failureTitle) {
    const previous = state.dispositions.get(item.id) ?? null;
    if (change.state === 'open') state.dispositions.delete(item.id);
    else state.dispositions.set(item.id, { itemId: item.id, revision: change.revision, state: change.state, until: change.until ?? null, at: readNow().toISOString() });
    state.laterOpen = null;
    state.notice = null;
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
    state.notice = `${failureTitle}。理由: ${reasonText(result?.reason ?? 'response_invalid')}。`;
    render();
    reportCount();
  }

  async function runAction(item, action) {
    let result;
    try {
      result = await port.runAction(item.id, action.id);
    } catch (error) {
      result = { status: 'unavailable', reason: error instanceof Error ? error.message : 'request_failed' };
    }
    if (state.destroyed) return;
    if (result?.status === 'ok') {
      state.notice = null;
      await load();
      return;
    }
    state.notice = `「${action.label}」を実行できませんでした。理由: ${reasonText(result?.reason ?? 'response_invalid')}。`;
    render();
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
    for (const choice of inboxLaterChoices(readNow())) {
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
    const received = relativeTime(item.receivedAt, readNow());
    if (received) meta.append(el(doc, 'span', { text: received, attrs: { title: formatShort(item.receivedAt) ?? undefined } }));
    const disposition = state.dispositions.get(item.id);
    if (view === 'later' && disposition?.until) meta.append(el(doc, 'span', { className: 'bb-inbox-until', text: `${formatShort(disposition.until)}に戻ります` }));
    if (textOf(item.detail)) main.append(el(doc, 'p', { className: 'bb-inbox-detail', text: item.detail }));
    if (meta.children?.length !== 0) main.append(meta);
    row.append(main);

    const controls = el(doc, 'div', { className: 'bb-inbox-row-actions' });
    if (view === 'waiting') {
      if (typeof port.runAction === 'function') {
        for (const action of Array.isArray(item.actions) ? item.actions : []) {
          if (!textOf(action?.id) || !textOf(action?.label)) continue;
          controls.append(workspaceButton(doc, { text: action.label, variant: action.tone === 'primary' ? 'primary' : action.tone === 'danger' ? 'danger' : 'default', onClick: () => void runAction(item, action) }));
        }
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
        workspaceButton(doc, { text: '片付けた', variant: 'quiet', onClick: () => void dispose(item, { state: 'cleared', revision: item.revision ?? null }, '片付けられませんでした') }),
      );
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
    const view = el(doc, 'div', { className: 'bb-inbox', attrs: { 'data-contract-version': INBOX_UI_CONTRACT_VERSION } });
    view.append(workspacePageHeader(doc, { crumbs, title: '受信箱', source: page?.source ?? undefined }));
    view.append(renderTabs(waitingCount));
    if (state.phase === 'loading') view.append(el(doc, 'div', { className: 'bb-inbox-loading', text: '読み込んでいます', attrs: { role: 'status' } }));
    if (state.notice) view.append(workspaceNotice(doc, { label: 'できませんでした', text: state.notice, tone: 'warning', role: 'alert' }));
    if (state.route.tab === 'notices') {
      view.append(renderNotices());
    } else if (state.phase === 'error' && !shown) {
      view.append(workspaceErrorCard(doc, { title: '受信箱を読めませんでした', message: `理由: ${reasonText(state.reason)}。0件ではありません。`, onRetry: () => void load() }));
    } else if (shown) {
      view.append(state.route.view === 'waiting' ? renderWaiting(shown) : renderSet(shown, state.route.view));
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
      root.replaceChildren();
    },
  };
  render();
  return controller;
}

export default createInboxUI;
