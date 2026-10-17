/*
 * 「あなたの記憶」 (story-personal-memory-viewer-v1, docs/specs/personal-memory-viewer.md).
 *
 * The owner's own memories as a list with the selected one's detail on the
 * right.  The part never reads memories by itself: the host passes a port
 * (`listMemories`, `readMemory`, `listJudgmentsUsing`, optional
 * `countJudgmentsUsing`, `isOwner`), and the local Web host and the
 * organization edition answer it the same way.  Read only: there is no way
 * to correct, retract or export a memory here.
 *
 * The address keeps the kind, state, organization and opened memory id; the
 * words being searched for and the memory bodies never enter it.
 */

import {
  makeWorkspaceElement,
  workspaceButton,
  workspaceDefinition,
  workspaceDetailEmpty,
  workspaceErrorCard,
  workspaceLedger,
  workspaceNotice,
  workspacePageHeader,
  workspaceRailBlock,
  workspaceRailHead,
} from './workspace-kit.js';

export const PERSONAL_MEMORY_UI_CONTRACT_VERSION = 'brainbase.personal-memory-ui.v1';

export const PERSONAL_MEMORY_KIND_LABELS = Object.freeze({
  self: '自分',
  work: '仕事',
  relationship: '関係',
  value: '大切にすること',
  judgment: '判断',
  experience: '経験',
  sns_context: '発信',
});
const NO_KIND_LABEL = '種類の記録なし';

export const PERSONAL_MEMORY_STATE_LABELS = Object.freeze({
  active: '有効',
  unrecorded: '状態の記録なし',
  superseded: '置き換え済み',
  retracted: '取り消し',
});
const STATES = Object.keys(PERSONAL_MEMORY_STATE_LABELS);
const PAST_STATES = new Set(['superseded', 'retracted']);

/**
 * The memories that are current: 有効, and those whose writer keeps no state
 * record (the local `personal-kg.jsonl`).  The latter are shown as 状態の記録なし,
 * never as 有効.
 */
export const DEFAULT_PERSONAL_MEMORY_STATES = Object.freeze(['active', 'unrecorded']);
const UNKNOWN_ORIGIN = '不明';
const PRIVACY_LINE = 'この画面はあなただけが見ています。組織の管理者も読めません。';
const JUDGMENT_PREVIEW = 5;

const el = makeWorkspaceElement;

// Why a read is unavailable, in the owner's words; the code stays beside it for support.
const REASON_LABELS = Object.freeze({
  personal_kg_missing: '個人KGのファイルがありません',
  personal_kg_invalid: '個人KGのファイルの形式が正しくありません',
  personal_kg_unavailable: '個人KGを読めません',
  journal_unavailable: '判断の記録を読めません',
  journal_partial: '判断の記録を一部しか読めていません',
  reference_source_mismatch: '判断の記録が参照している記憶は、ここにある記憶とは別の置き場のものです',
  web_token_required: '起動時のトークンを確かめられません。ページを開き直してください',
});

function reasonText(reason) {
  const code = String(reason ?? 'unknown');
  return REASON_LABELS[code] ? `${REASON_LABELS[code]}（${code}）` : code;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeStates(values) {
  const states = STATES.filter((state) => values.includes(state));
  return states.length > 0 ? states : [...DEFAULT_PERSONAL_MEMORY_STATES];
}

function normalizeRoute(route = {}) {
  const kinds = Array.isArray(route.kinds) ? Object.keys(PERSONAL_MEMORY_KIND_LABELS).filter((kind) => route.kinds.includes(kind)) : [];
  return {
    kinds,
    states: normalizeStates(Array.isArray(route.states) ? route.states : []),
    organization: text(route.organization),
    memoryId: text(route.memoryId),
  };
}

/** Reads `kind`, `state`, `org` and `id` from the address. Unknown values fall back to the defaults. */
export function parsePersonalMemoryRoute(params) {
  const list = (name) => (params.get(name) ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  return normalizeRoute({ kinds: list('kind'), states: list('state'), organization: params.get('org'), memoryId: params.get('id') });
}

/** The shell's hash target for a route.  Anything else in the route (the search words) is dropped. */
export function personalMemoryRouteTarget(route) {
  const normalized = normalizeRoute(route);
  const params = new URLSearchParams();
  if (normalized.kinds.length > 0) params.set('kind', normalized.kinds.join(','));
  if (!sameList(normalized.states, DEFAULT_PERSONAL_MEMORY_STATES)) params.set('state', normalized.states.join(','));
  if (normalized.organization) params.set('org', normalized.organization);
  if (normalized.memoryId) params.set('id', normalized.memoryId);
  const query = params.toString();
  return query ? `memory?${query}` : 'memory';
}

function organizationOf(item) {
  return text(item?.origin?.organizationLabel) ?? UNKNOWN_ORIGIN;
}

/** The filter a port may apply on its side; the local port applies it after one read. */
export function filterPersonalMemories(items, { kinds, states, organization, query } = {}) {
  const words = text(query)?.toLowerCase() ?? null;
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (Array.isArray(kinds) && kinds.length > 0 && !kinds.includes(item.kind)) return false;
    if (Array.isArray(states) && states.length > 0 && !states.includes(item.state)) return false;
    if (text(organization) && organizationOf(item) !== text(organization)) return false;
    if (words) {
      const haystack = [item.text, ...(Array.isArray(item.tags) ? item.tags : [])].join('\n').toLowerCase();
      if (!haystack.includes(words)) return false;
    }
    return true;
  });
}

function kindLabel(kind) {
  return PERSONAL_MEMORY_KIND_LABELS[kind] ?? NO_KIND_LABEL;
}

function excerpt(value, length = 120) {
  const body = String(value ?? '').replace(/\s+/gu, ' ').trim();
  return body.length > length ? `${body.slice(0, length)}…` : body;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDay(value) {
  return formatDateTime(value)?.slice(0, 10) ?? null;
}

function relativeDay(value, now) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return '今日';
  if (days < 30) return `${days}日前`;
  return formatDay(value);
}

function stateBadge(doc, state) {
  return el(doc, 'span', { className: `bb-pm-state is-${state}`, text: PERSONAL_MEMORY_STATE_LABELS[state] ?? state });
}

function inferredBadge(doc) {
  return el(doc, 'span', { className: 'bb-pm-inferred', text: '推定', attrs: { title: 'ログイン中の組織から付いた出どころです' } });
}

function originLine(doc, origin) {
  const line = el(doc, 'span', { className: 'bb-pm-origin' });
  const organization = text(origin?.organizationLabel) ?? UNKNOWN_ORIGIN;
  const project = text(origin?.projectLabel);
  line.append(el(doc, 'span', { text: project ? `${organization} › ${project}` : organization }));
  if (origin?.inferred === true) line.append(inferredBadge(doc));
  return line;
}

function recallScopeText(item) {
  if (item.recallScope === 'organization') return `${text(item.origin?.organizationLabel) ?? 'その組織'}の仕事でだけ使われます`;
  if (item.recallScope === 'general') return 'どの組織の仕事でも使われます';
  return '使われる範囲を確かめられません';
}

function usageText(usage, id) {
  if (!usage || usage.phase === 'loading') return { text: '確かめています', className: 'is-loading' };
  if (usage.phase !== 'ok' || !Number.isInteger(usage.counts?.[id])) return { text: '確認できない', className: 'is-unknown' };
  const count = usage.counts[id];
  return count > 0 ? { text: `使われた判断 ${count}件`, className: '' } : { text: 'まだ使われていない', className: 'is-none' };
}

export function createPersonalMemoryUI({
  root,
  rail = null,
  page,
  document: explicitDocument,
  port,
  judgmentHref = () => null,
  candidatesHref = null,
  candidatesCommand = null,
  route: initialRoute,
  onRouteChange,
  now = () => new Date(),
} = {}) {
  if (!root) throw new TypeError('root is required');
  if (!port || typeof port.isOwner !== 'function' || typeof port.listMemories !== 'function'
    || typeof port.readMemory !== 'function' || typeof port.listJudgmentsUsing !== 'function') {
    throw new TypeError('port is required');
  }
  const doc = explicitDocument ?? (typeof document === 'undefined' ? null : document);
  if (!doc || typeof doc.createElement !== 'function') throw new Error('document_unavailable');
  const crumbs = Array.isArray(page?.crumbs) ? page.crumbs : ['あなたのBrainbase', 'あなたの記憶'];
  const readNow = () => (typeof now === 'function' ? now() : now);

  const state = {
    owner: null,
    route: normalizeRoute(initialRoute),
    query: '',
    list: { phase: 'idle', items: null, reason: null, nextCursor: null },
    usage: null,
    detail: null,
    judgments: null,
    openFilter: null,
    organizations: new Set(),
    destroyed: false,
  };
  let listGeneration = 0;
  let detailGeneration = 0;

  const detailHost = rail ?? el(doc, 'section', { className: 'bb-pm-detail-inline', attrs: { 'aria-label': '記憶の詳細' } });

  function go(route, options = {}) {
    const next = normalizeRoute({ ...state.route, ...route });
    if (typeof onRouteChange === 'function') onRouteChange(next, options);
    else applyRoute(next);
  }

  function isOwner() {
    if (state.owner === null) state.owner = port.isOwner() === true;
    return state.owner;
  }

  async function loadUsage(items, generation) {
    if (typeof port.countJudgmentsUsing !== 'function') {
      state.usage = { phase: 'unavailable', reason: 'not_supported' };
      return;
    }
    state.usage = { phase: 'loading' };
    let result;
    try {
      result = await port.countJudgmentsUsing(items.map((item) => item.id));
    } catch (error) {
      result = { status: 'unavailable', reason: error instanceof Error ? error.message : 'request_failed' };
    }
    if (generation !== listGeneration || state.destroyed) return;
    state.usage = result?.status === 'ok' && result.counts && typeof result.counts === 'object'
      ? { phase: 'ok', counts: result.counts }
      : { phase: 'unavailable', reason: result?.reason ?? 'response_invalid' };
    render();
  }

  async function load() {
    if (state.destroyed) return;
    if (!isOwner()) {
      render();
      return;
    }
    const generation = ++listGeneration;
    // The previous list stays on screen while the next one loads.
    state.list = { ...state.list, phase: 'loading' };
    render();
    let result;
    try {
      result = await port.listMemories({ kinds: state.route.kinds, organization: state.route.organization, query: state.query || undefined });
    } catch (error) {
      result = { status: 'unavailable', reason: error instanceof Error ? error.message : 'request_failed' };
    }
    if (generation !== listGeneration || state.destroyed) return;
    if (result?.status === 'ok' && Array.isArray(result.items)) {
      state.list = { phase: 'ready', items: result.items, reason: null, nextCursor: result.nextCursor ?? null };
      for (const item of result.items) state.organizations.add(organizationOf(item));
      const usage = loadUsage(result.items, generation);
      render();
      // The counts read the judgment journal and can be slow: the detail does not wait for them.
      const detail = state.route.memoryId && state.detail?.id !== state.route.memoryId ? loadDetail(state.route.memoryId) : null;
      await Promise.all([usage, detail]);
      return;
    }
    state.list = { phase: 'error', items: null, reason: result?.reason ?? 'response_invalid', nextCursor: null };
    render();
  }

  async function loadJudgments(id, limit) {
    const generation = detailGeneration;
    state.judgments = { id, phase: 'loading', result: state.judgments?.id === id ? state.judgments.result : null };
    render();
    let result;
    try {
      result = await port.listJudgmentsUsing(id, limit);
    } catch (error) {
      result = { status: 'unavailable', reason: error instanceof Error ? error.message : 'request_failed' };
    }
    if (generation !== detailGeneration || state.destroyed) return;
    state.judgments = result?.status === 'ok' && Array.isArray(result.items) && Number.isInteger(result.total)
      ? { id, phase: 'ok', result }
      : { id, phase: 'unavailable', reason: result?.reason ?? 'response_invalid' };
    render();
  }

  async function loadDetail(id) {
    if (!isOwner() || state.destroyed) return;
    const generation = ++detailGeneration;
    state.detail = { id, phase: 'loading', item: state.detail?.id === id ? state.detail.item : null };
    state.judgments = null;
    render();
    let result;
    try {
      result = await port.readMemory(id);
    } catch (error) {
      result = { status: 'unavailable', reason: error instanceof Error ? error.message : 'request_failed' };
    }
    if (generation !== detailGeneration || state.destroyed) return;
    if (result?.status === 'ok' && result.item) {
      state.detail = { id, phase: 'ready', item: result.item };
      await loadJudgments(id, JUDGMENT_PREVIEW);
      return;
    }
    state.detail = result?.status === 'not_found'
      ? { id, phase: 'not_found' }
      : { id, phase: 'error', reason: result?.reason ?? 'response_invalid' };
    render();
  }

  function applyRoute(route) {
    const next = normalizeRoute(route);
    const previous = state.route;
    state.route = next;
    state.openFilter = null;
    if (!isOwner()) {
      render();
      return;
    }
    const listChanged = !sameList(previous.kinds, next.kinds) || previous.organization !== next.organization;
    if (!next.memoryId) {
      detailGeneration += 1;
      state.detail = null;
      state.judgments = null;
    }
    if (listChanged || state.list.phase === 'idle') {
      void load();
      return;
    }
    if (next.memoryId && next.memoryId !== state.detail?.id) void loadDetail(next.memoryId);
    render();
  }

  function setQuery(value) {
    state.query = String(value ?? '');
    void load();
  }

  function toggleKind(kind) {
    const kinds = state.route.kinds.includes(kind) ? state.route.kinds.filter((entry) => entry !== kind) : [...state.route.kinds, kind];
    go({ kinds });
  }

  function toggleState(value) {
    const states = state.route.states.includes(value) ? state.route.states.filter((entry) => entry !== value) : [...state.route.states, value];
    go({ states: states.length > 0 ? states : [...DEFAULT_PERSONAL_MEMORY_STATES] });
  }

  function clearAll() {
    state.query = '';
    const reload = state.route.kinds.length === 0 && !state.route.organization;
    go({ kinds: [], states: [...DEFAULT_PERSONAL_MEMORY_STATES], organization: null });
    // Only the words changed: the route is the same, so the list reloads here.
    if (reload) void load();
  }

  function renderFilterChip(id, label, isDefault, onClear) {
    const chip = el(doc, 'span', { className: `bb-pm-chip${isDefault ? '' : ' is-active'}` });
    const open = workspaceButton(doc, {
      text: label,
      variant: 'quiet',
      attrs: { 'aria-expanded': state.openFilter === id ? 'true' : 'false', 'aria-haspopup': 'true' },
      onClick: () => {
        state.openFilter = state.openFilter === id ? null : id;
        render();
      },
    });
    open.className = 'bb-pm-chip-button';
    chip.append(open);
    if (!isDefault) {
      const clear = workspaceButton(doc, { text: '×', variant: 'quiet', attrs: { 'aria-label': `${label.split('：')[0]}の絞り込みを外す` }, onClick: onClear });
      clear.className = 'bb-pm-chip-clear';
      chip.append(clear);
    }
    return chip;
  }

  function renderOptions(label, options) {
    const group = el(doc, 'div', { className: 'bb-pm-filter-options', attrs: { role: 'group', 'aria-label': label } });
    for (const option of options) {
      const choice = workspaceButton(doc, { text: option.label, variant: 'quiet', attrs: { 'aria-pressed': option.selected ? 'true' : 'false' }, onClick: option.onSelect });
      choice.className = `bb-pm-option${option.selected ? ' is-selected' : ''}`;
      group.append(choice);
    }
    return group;
  }

  function renderFilters() {
    const { route } = state;
    const bar = el(doc, 'div', { className: 'bb-pm-filters', attrs: { role: 'search', 'aria-label': '記憶の絞り込み' } });
    const kindsDefault = route.kinds.length === 0;
    const statesDefault = sameList(route.states, DEFAULT_PERSONAL_MEMORY_STATES);
    bar.append(
      renderFilterChip('kind', `種類：${kindsDefault ? 'すべて' : route.kinds.map(kindLabel).join('・')}`, kindsDefault, () => go({ kinds: [] })),
      renderFilterChip('state', `状態：${route.states.map((value) => PERSONAL_MEMORY_STATE_LABELS[value]).join('・')}`, statesDefault, () => go({ states: [...DEFAULT_PERSONAL_MEMORY_STATES] })),
      renderFilterChip('organization', `出どころ：${route.organization ?? 'すべて'}`, !route.organization, () => go({ organization: null })),
    );
    const search = el(doc, 'input', { className: 'bb-pm-search', attrs: { type: 'search', name: 'query', placeholder: '語句で探す', 'aria-label': '語句で探す', autocomplete: 'off' } });
    search.value = state.query;
    search.addEventListener('input', () => setQuery(search.value));
    bar.append(search);
    const clear = workspaceButton(doc, { text: 'すべて外す', variant: 'quiet', disabled: kindsDefault && statesDefault && !route.organization && !state.query, onClick: clearAll });
    clear.className = 'bb-pm-clear-all';
    bar.append(clear);
    const wrap = el(doc, 'div', { className: 'bb-pm-filter-bar' });
    wrap.append(bar);
    if (state.openFilter === 'kind') {
      wrap.append(renderOptions('種類', Object.keys(PERSONAL_MEMORY_KIND_LABELS).map((kind) => ({
        label: kindLabel(kind), selected: route.kinds.includes(kind), onSelect: () => toggleKind(kind),
      }))));
    } else if (state.openFilter === 'state') {
      wrap.append(renderOptions('状態', STATES.map((value) => ({
        label: PERSONAL_MEMORY_STATE_LABELS[value], selected: route.states.includes(value), onSelect: () => toggleState(value),
      }))));
    } else if (state.openFilter === 'organization') {
      const organizations = [...new Set([...state.organizations, ...(route.organization ? [route.organization] : [])])].sort();
      wrap.append(renderOptions('出どころの組織', organizations.map((organization) => ({
        label: organization,
        selected: route.organization === organization,
        onSelect: () => go({ organization: route.organization === organization ? null : organization }),
      }))));
    }
    return wrap;
  }

  function renderSummary(items) {
    const counts = new Map();
    for (const item of items) counts.set(item.state, (counts.get(item.state) ?? 0) + 1);
    const parts = STATES.filter((value) => counts.has(value)).map((value) => `${PERSONAL_MEMORY_STATE_LABELS[value]} ${counts.get(value)}件`);
    const latest = items.map((item) => item.updatedAt).filter(Boolean).sort().at(-1);
    const updated = latest ? formatDateTime(latest) : null;
    return el(doc, 'p', { className: 'bb-pm-summary', text: `${parts.join('・')}。${updated ? `最終更新 ${updated}` : '更新日時の記録なし'}` });
  }

  function renderLedger(items) {
    const current = readNow();
    return workspaceLedger(doc, {
      className: 'bb-pm-ledger',
      ariaLabel: 'あなたの記憶',
      columns: ['種類', '記憶', '出どころ', '使われた判断', '更新'],
      empty: '絞り込みに合う記憶はありません。',
      rows: items.map((item) => {
        const body = el(doc, 'span', { className: 'bb-pm-excerpt' });
        if (PAST_STATES.has(item.state)) body.append(stateBadge(doc, item.state));
        body.append(el(doc, 'span', { text: excerpt(item.text) }));
        const updated = el(doc, 'span', { className: 'bb-pm-updated', text: relativeDay(item.updatedAt, current) ?? '記録なし', attrs: { title: formatDateTime(item.updatedAt) ?? undefined } });
        return {
          key: item.id,
          label: excerpt(item.text, 60),
          selected: state.route.memoryId === item.id,
          className: PAST_STATES.has(item.state) ? 'is-past' : '',
          cells: [
            { text: kindLabel(item.kind), className: 'bb-pm-kind' },
            body,
            originLine(doc, item.origin),
            usageText(state.usage, item.id),
            updated,
          ],
          onSelect: (id) => go({ memoryId: id }),
        };
      }),
    });
  }

  function renderEmpty() {
    const box = el(doc, 'div', { className: 'bb-pm-empty' });
    box.append(el(doc, 'strong', { text: 'まだ記憶はありません。' }), el(doc, 'p', { text: '夜の整理と候補の確認で増えます。' }));
    if (text(candidatesHref)) box.append(el(doc, 'a', { className: 'bb-pm-link', text: '候補の確認を開く', attrs: { href: candidatesHref } }));
    else if (text(candidatesCommand)) {
      const line = el(doc, 'p', { text: '候補の確認: ' });
      line.append(el(doc, 'code', { text: candidatesCommand }));
      box.append(line);
    }
    return box;
  }

  function renderJudgments(item) {
    const wrap = el(doc, 'div', { className: 'bb-pm-judgments' });
    const judgments = state.judgments?.id === item.id ? state.judgments : null;
    if (!judgments || (judgments.phase === 'loading' && !judgments.result)) {
      wrap.append(el(doc, 'p', { className: 'bb-pm-muted', text: '確かめています。' }));
      return wrap;
    }
    if (judgments.phase === 'unavailable') {
      wrap.append(el(doc, 'strong', { text: '確認できない' }), el(doc, 'p', { className: 'bb-pm-muted', text: `この記憶が使われたかを確かめられません。${reasonText(judgments.reason)}。0件ではありません。` }));
      return wrap;
    }
    const { items, total } = judgments.result;
    if (total === 0) {
      wrap.append(el(doc, 'p', { text: 'まだ使われていない' }));
      return wrap;
    }
    const list = el(doc, 'ol', { className: 'bb-pm-judgment-list' });
    for (const judgment of items) {
      const entry = el(doc, 'li');
      const href = judgmentHref(judgment.decisionId);
      const title = text(judgment.title) ?? '判断の内容は記録されていません';
      entry.append(href ? el(doc, 'a', { text: title, attrs: { href } }) : el(doc, 'span', { text: title }));
      const day = formatDay(judgment.at);
      if (day) entry.append(el(doc, 'span', { className: 'bb-pm-muted', text: day }));
      list.append(entry);
    }
    wrap.append(list);
    if (total > items.length) {
      wrap.append(workspaceButton(doc, { text: `すべて見る（${total}件）`, variant: 'quiet', onClick: () => void loadJudgments(item.id, total) }));
    }
    return wrap;
  }

  function renderHistory(item) {
    const wrap = el(doc, 'div', { className: 'bb-pm-status' });
    wrap.append(stateBadge(doc, item.state));
    if (item.state === 'superseded' && text(item.supersededBy)) {
      wrap.append(workspaceButton(doc, { text: '置き換え先を開く', variant: 'quiet', onClick: () => go({ memoryId: item.supersededBy }) }));
    }
    const history = Array.isArray(item.history) ? item.history : [];
    if (history.length === 0) {
      wrap.append(el(doc, 'p', { className: 'bb-pm-muted', text: '状態の移り変わりは記録されていません。' }));
      return wrap;
    }
    const list = el(doc, 'ol', { className: 'bb-pm-history' });
    for (const step of history) {
      const reason = text(step.reason);
      list.append(el(doc, 'li', { text: `${formatDay(step.at) ?? '日付なし'} ${PERSONAL_MEMORY_STATE_LABELS[step.state] ?? step.state}${reason ? `（${reason}）` : ''}` }));
    }
    wrap.append(list);
    return wrap;
  }

  function renderDetail() {
    detailHost.replaceChildren();
    if (!isOwner()) return;
    const box = el(doc, 'div', { className: 'bb-pm-detail' });
    detailHost.append(box);
    const detail = state.detail;
    if (!detail) {
      if (rail) box.append(workspaceDetailEmpty(doc, { mark: '↗', title: '記憶を選択', text: '行を選ぶと、記憶の本文、状態、出どころ、使った判断を確かめられます。' }));
      return;
    }
    const close = workspaceButton(doc, { text: '詳細を閉じる', variant: 'quiet', attrs: { 'aria-label': '記憶の詳細を閉じる' }, onClick: () => go({ memoryId: null }, { back: true }) });
    if (detail.phase === 'loading' && !detail.item) {
      box.append(el(doc, 'p', { className: 'bb-pm-muted', text: '記憶を読み込んでいます。', attrs: { role: 'status' } }));
      return;
    }
    if (detail.phase === 'not_found') {
      box.append(workspaceDetailEmpty(doc, { mark: '?', title: 'この記憶は見つかりません', text: '消えたか、IDが違います。' }), close);
      return;
    }
    if (detail.phase === 'error') {
      box.append(workspaceErrorCard(doc, { title: '記憶を読めませんでした', message: `理由: ${reasonText(detail.reason)}。`, onRetry: () => void loadDetail(detail.id) }), close);
      return;
    }
    const { item } = detail;
    const tags = Array.isArray(item.tags) ? item.tags.filter((tag) => text(tag)) : [];
    box.append(
      workspaceRailHead(doc, { kicker: kindLabel(item.kind), title: item.text, sub: tags.length > 0 ? tags.join('・') : undefined }),
      close,
      workspaceRailBlock(doc, { title: '状態', content: renderHistory(item) }),
    );
    const organization = el(doc, 'span');
    organization.append(el(doc, 'span', { text: text(item.origin?.organizationLabel) ?? UNKNOWN_ORIGIN }));
    if (item.origin?.inferred === true) organization.append(inferredBadge(doc));
    box.append(
      workspaceRailBlock(doc, {
        title: '出どころ',
        content: workspaceDefinition(doc, [
          ['組織', organization],
          ['プロジェクト', text(item.origin?.projectLabel) ?? UNKNOWN_ORIGIN],
          ['作業の場', text(item.origin?.workplace) ?? UNKNOWN_ORIGIN],
          ['発生', formatDateTime(item.occurredAt) ?? UNKNOWN_ORIGIN],
          ['更新', formatDateTime(item.updatedAt) ?? UNKNOWN_ORIGIN],
        ]),
      }),
      workspaceRailBlock(doc, { title: 'AIが使う範囲', content: el(doc, 'p', { text: recallScopeText(item) }) }),
      workspaceRailBlock(doc, { title: 'この記憶を使った判断', content: renderJudgments(item) }),
    );
    const record = el(doc, 'details', { className: 'bb-pm-record' });
    record.append(
      el(doc, 'summary', { text: '記録の詳細' }),
      workspaceDefinition(doc, [
        ['記録ID', el(doc, 'code', { text: item.id })],
        ['種類', item.kind ?? NO_KIND_LABEL],
        ['状態', PERSONAL_MEMORY_STATE_LABELS[item.state] ?? item.state],
      ]),
    );
    box.append(record);
  }

  function render() {
    if (state.destroyed) return;
    const view = el(doc, 'div', { className: 'bb-pm', attrs: { 'data-contract-version': PERSONAL_MEMORY_UI_CONTRACT_VERSION } });
    view.append(workspacePageHeader(doc, { crumbs, title: 'あなたの記憶', source: page?.source ?? undefined }));
    if (!isOwner()) {
      view.append(workspaceNotice(doc, { label: '本人だけ', text: 'この画面は本人だけが見られます。記憶は読み込んでいません。', tone: 'warning' }));
      root.replaceChildren(view);
      detailHost.replaceChildren();
      return;
    }
    view.append(el(doc, 'p', { className: 'bb-pm-privacy', text: PRIVACY_LINE }));
    const { list } = state;
    if (list.phase === 'loading') view.append(el(doc, 'div', { className: 'bb-pm-loading', text: '読み込んでいます', attrs: { role: 'status' } }));
    if (list.items) view.append(renderSummary(list.items));
    view.append(renderFilters());
    if (list.phase === 'error') {
      view.append(workspaceErrorCard(doc, { title: '記憶を読めませんでした', message: `理由: ${reasonText(list.reason)}。0件ではありません。`, onRetry: () => void load() }));
    } else if (list.items) {
      const filtered = filterPersonalMemories(list.items, { states: state.route.states });
      const unfiltered = list.items.length === 0 && state.route.kinds.length === 0 && !state.route.organization && !state.query;
      view.append(unfiltered ? renderEmpty() : renderLedger(filtered));
      if (list.nextCursor) view.append(el(doc, 'p', { className: 'bb-pm-muted', text: '読み込んだ範囲だけを表示しています。' }));
    }
    if (!rail) view.append(detailHost);
    // The search box keeps its focus and caret across renders.
    const active = doc.activeElement;
    const focusSearch = active && active.tagName === 'INPUT' && active.getAttribute?.('name') === 'query';
    const caret = focusSearch ? [active.selectionStart, active.selectionEnd] : null;
    root.replaceChildren(view);
    renderDetail();
    if (focusSearch) {
      const search = view.querySelector?.('input[name="query"]');
      search?.focus?.();
      if (caret) search?.setSelectionRange?.(...caret);
    }
  }

  const controller = {
    load,
    applyRoute,
    openMemory: (id) => go({ memoryId: id }),
    get state() {
      return { route: { ...state.route }, query: state.query, list: state.list, detail: state.detail, judgments: state.judgments, usage: state.usage };
    },
    destroy() {
      state.destroyed = true;
      listGeneration += 1;
      detailGeneration += 1;
      root.replaceChildren();
      detailHost.replaceChildren();
    },
  };
  if (state.route.memoryId) state.detail = null;
  render();
  return controller;
}

export default createPersonalMemoryUI;
