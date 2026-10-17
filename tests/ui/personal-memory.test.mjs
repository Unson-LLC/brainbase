import { describe, expect, it, vi } from 'vitest';
import {
  createPersonalMemoryUI,
  DEFAULT_PERSONAL_MEMORY_STATES,
  filterPersonalMemories,
  parsePersonalMemoryRoute,
  personalMemoryRouteTarget,
} from '../../ui/personal-memory.js';
import { createPersonalMemoryHttpPort } from '../../ui/personal-memory-http-port.js';
import { collectText, FakeDocument, findAll, jsonResponse, visibleText, waitFor } from './graph-ui-harness.mjs';

const NOW = new Date('2026-10-17T03:00:00.000Z');

function memory(id, overrides = {}) {
  return {
    id,
    kind: 'value',
    text: `記憶 ${id} の本文`,
    tags: [],
    state: 'active',
    supersededBy: null,
    origin: { organizationLabel: '架空商事', projectLabel: '社内基盤', workplace: '会話', inferred: false },
    occurredAt: '2026-10-11T12:40:00.000Z',
    updatedAt: '2026-10-14T00:00:00.000Z',
    recallScope: 'organization',
    history: [],
    ...overrides,
  };
}

const MEMORIES = [
  memory('m-active', { text: '可逆な決定は早く決め、不可逆な決定だけ時間をかける', updatedAt: '2026-10-16T00:00:00.000Z' }),
  memory('m-old', { kind: 'work', text: '週次の振り返りは日曜の夜に回す', state: 'superseded', supersededBy: 'm-new', history: [{ state: 'superseded', at: '2026-10-12T00:00:00.000Z', reason: null }] }),
  memory('m-gone', { kind: 'self', text: '朝は会議を入れない', state: 'retracted', history: [{ state: 'retracted', at: '2026-10-10T00:00:00.000Z', reason: '本人が却下' }] }),
  memory('m-local', { kind: 'judgment', text: '手元で覚えた判断', state: 'unrecorded', origin: { organizationLabel: '手元', projectLabel: null, workplace: null, inferred: false }, recallScope: 'general', updatedAt: '2026-10-15T00:00:00.000Z' }),
  memory('m-guess', { kind: 'relationship', text: '契約の判断を先に法務へ回したい人', origin: { organizationLabel: '架空商事', projectLabel: '架空案件A', workplace: null, inferred: true }, updatedAt: '2026-10-13T00:00:00.000Z' }),
];

function fakePort(overrides = {}) {
  return {
    isOwner: vi.fn(() => true),
    listMemories: vi.fn(async (filter) => ({ status: 'ok', items: filterPersonalMemories(MEMORIES, filter), nextCursor: null })),
    readMemory: vi.fn(async (id) => {
      const item = MEMORIES.find((candidate) => candidate.id === id);
      return item ? { status: 'ok', item } : { status: 'not_found' };
    }),
    listJudgmentsUsing: vi.fn(async (id, limit) => {
      if (id !== 'm-active') return { status: 'ok', items: [], total: 0 };
      const all = Array.from({ length: 7 }, (_, index) => ({ decisionId: `jr_${7 - index}`, title: `判断 ${7 - index}`, at: `2026-10-${String(16 - index).padStart(2, '0')}T00:00:00.000Z`, kind: null }));
      return { status: 'ok', items: all.slice(0, limit), total: all.length };
    }),
    countJudgmentsUsing: vi.fn(async () => ({ status: 'ok', counts: { 'm-active': 7, 'm-local': 0 } })),
    ...overrides,
  };
}

async function mount(options = {}) {
  const document = new FakeDocument();
  const root = document.createElement('div');
  const rail = options.rail === null ? null : document.createElement('aside');
  const routes = [];
  const view = createPersonalMemoryUI({
    root,
    rail,
    document,
    port: options.port ?? fakePort(),
    judgmentHref: (decisionId) => `#value-proofs?decision=${encodeURIComponent(decisionId)}`,
    candidatesCommand: 'brainbase onboard:candidates',
    route: options.route,
    onRouteChange: options.onRouteChange ?? ((route) => { routes.push(route); view.applyRoute(route); }),
    now: () => NOW,
  });
  await view.load();
  return { view, root, rail, routes };
}

const rows = (root) => findAll(root, (node) => node.attributes?.role === 'row' && node.tagName === 'BUTTON');
const button = (root, text) => findAll(root, (node) => node.tagName === 'BUTTON' && collectText(node) === text)[0];

describe('routes', () => {
  it('keeps the kind, state, organization and opened memory, never the words or the body', () => {
    const target = personalMemoryRouteTarget({ kinds: ['work', 'self'], states: ['superseded'], organization: '架空商事', memoryId: 'm-old', query: '日曜の夜' });
    // Kinds keep one canonical order, so the same filter has one address.
    expect(target).toBe('memory?kind=self%2Cwork&state=superseded&org=%E6%9E%B6%E7%A9%BA%E5%95%86%E4%BA%8B&id=m-old');
    expect(target).not.toContain(encodeURIComponent('日曜'));
    expect(parsePersonalMemoryRoute(new URLSearchParams(target.split('?')[1]))).toEqual({ kinds: ['self', 'work'], states: ['superseded'], organization: '架空商事', memoryId: 'm-old' });
    expect(personalMemoryRouteTarget({ kinds: [], states: DEFAULT_PERSONAL_MEMORY_STATES, organization: null, memoryId: null })).toBe('memory');
    expect(parsePersonalMemoryRoute(new URLSearchParams('state=bogus')).states).toEqual(DEFAULT_PERSONAL_MEMORY_STATES);
  });
});

describe('あなたの記憶 (story-personal-memory-viewer-v1)', () => {
  it('lists current memories by default and never mixes in superseded or retracted ones (AC-03, AC-04, AC-05)', async () => {
    const { root, view } = await mount();
    const text = visibleText(root);
    expect(text).toContain('この画面はあなただけが見ています。組織の管理者も読めません。');
    expect(rows(root).map((row) => row.attributes['data-key'])).toEqual(['m-active', 'm-local', 'm-guess']);
    expect(text).not.toContain('週次の振り返りは日曜の夜に回す');
    expect(text).not.toContain('朝は会議を入れない');
    expect(text).toContain('状態：有効・状態の記録なし');
    // The local writer keeps no state: shown as such, never as 有効.
    const local = rows(root).find((row) => row.attributes['data-key'] === 'm-local');
    expect(collectText(local)).toContain('判断');
    expect(collectText(local)).not.toContain('有効');
    expect(collectText(local)).toContain('手元');
    expect(text).toContain('使われた判断 7件');
    expect(text).toContain('まだ使われていない');
    expect(text).toContain('推定');
    view.destroy();
  });

  it('shows superseded and retracted memories only when chosen, with their state marked (AC-05)', async () => {
    const { root, routes, view } = await mount();
    button(root, '状態：有効・状態の記録なし').dispatch('click');
    button(root, '置き換え済み').dispatch('click');
    await waitFor(() => rows(root).some((row) => row.attributes['data-key'] === 'm-old'));
    const old = rows(root).find((row) => row.attributes['data-key'] === 'm-old');
    expect(collectText(old)).toContain('置き換え済み');
    expect(old.className).toContain('is-past');
    expect(routes.at(-1).states).toEqual(['active', 'unrecorded', 'superseded']);
    expect(visibleText(root)).not.toContain('朝は会議を入れない');
    view.destroy();
  });

  it('removes one filter by its × and all of them with すべて外す, keeping the words out of the route (AC-04)', async () => {
    const port = fakePort();
    const { root, routes, view } = await mount({ port, route: { kinds: ['value'], states: ['retracted'], organization: '架空商事', memoryId: null } });
    expect(visibleText(root)).toContain('種類：大切にすること');
    const search = findAll(root, (node) => node.tagName === 'INPUT' && node.attributes.name === 'query')[0];
    search.value = '会議';
    search.dispatch('input');
    await waitFor(() => port.listMemories.mock.calls.some(([filter]) => filter.query === '会議'));
    for (const route of routes) expect(JSON.stringify(route)).not.toContain('会議');
    findAll(root, (node) => node.tagName === 'BUTTON' && node.attributes['aria-label'] === '種類の絞り込みを外す')[0].dispatch('click');
    expect(routes.at(-1).kinds).toEqual([]);
    button(root, 'すべて外す').dispatch('click');
    await waitFor(() => rows(root).length === 3);
    expect(routes.at(-1)).toEqual({ kinds: [], states: DEFAULT_PERSONAL_MEMORY_STATES, organization: null, memoryId: null });
    expect(findAll(root, (node) => node.tagName === 'INPUT' && node.attributes.name === 'query')[0].value).toBe('');
    view.destroy();
  });

  it('opens the detail in fact, state, origin, scope, use order, with the id in the route (AC-06, AC-07)', async () => {
    const { root, rail, routes, view } = await mount();
    rows(root)[0].dispatch('click');
    expect(routes.at(-1).memoryId).toBe('m-active');
    await waitFor(() => collectText(rail).includes('判断 7'));
    const text = collectText(rail);
    const order = ['可逆な決定は早く決め', '状態', '出どころ', 'AIが使う範囲', 'この記憶を使った判断', '記録の詳細'].map((part) => text.indexOf(part));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain('架空商事の仕事でだけ使われます');
    const links = findAll(rail, (node) => node.tagName === 'A' && String(node.attributes.href).startsWith('#value-proofs'));
    expect(links.map((link) => link.attributes.href)).toEqual(['jr_7', 'jr_6', 'jr_5', 'jr_4', 'jr_3'].map((id) => `#value-proofs?decision=${id}`));
    button(rail, 'すべて見る（7件）').dispatch('click');
    await waitFor(() => findAll(rail, (node) => node.tagName === 'A').length === 7);
    expect(findAll(rail, (node) => node.tagName === 'DETAILS').length).toBe(1);
    view.destroy();
  });

  it('marks an origin taken from the signed-in organization as inferred and an unknown one as 不明 (AC-06)', async () => {
    const port = fakePort({
      readMemory: vi.fn(async (id) => ({ status: 'ok', item: id === 'm-guess' ? MEMORIES[4] : memory('m-unknown', { origin: { organizationLabel: null, projectLabel: null, workplace: null, inferred: false }, recallScope: 'unknown' }) })),
    });
    const { rail, view } = await mount({ port, route: { kinds: [], states: DEFAULT_PERSONAL_MEMORY_STATES, organization: null, memoryId: 'm-guess' } });
    await waitFor(() => collectText(rail).includes('架空案件A'));
    expect(collectText(rail)).toContain('推定');
    view.applyRoute({ kinds: [], states: DEFAULT_PERSONAL_MEMORY_STATES, organization: null, memoryId: 'm-unknown' });
    await waitFor(() => collectText(rail).includes('使われる範囲を確かめられません'));
    expect(collectText(rail)).toContain('不明');
    view.destroy();
  });

  it('tells a memory never used from use that cannot be confirmed (AC-07)', async () => {
    const port = fakePort({
      listJudgmentsUsing: vi.fn(async (id) => (id === 'm-local' ? { status: 'ok', items: [], total: 0 } : { status: 'unavailable', reason: 'reference_source_mismatch' })),
      countJudgmentsUsing: vi.fn(async () => ({ status: 'unavailable', reason: 'reference_source_mismatch' })),
    });
    const { root, rail, view } = await mount({ port });
    expect(visibleText(root)).toContain('確認できない');
    expect(visibleText(root)).not.toContain('まだ使われていない');
    view.applyRoute({ kinds: [], states: DEFAULT_PERSONAL_MEMORY_STATES, organization: null, memoryId: 'm-active' });
    await waitFor(() => collectText(rail).includes('確認できない'));
    expect(collectText(rail)).not.toContain('まだ使われていない');
    view.applyRoute({ kinds: [], states: DEFAULT_PERSONAL_MEMORY_STATES, organization: null, memoryId: 'm-local' });
    await waitFor(() => collectText(rail).includes('まだ使われていない'));
    view.destroy();
  });

  it('tells zero memories from memories it could not read, and keeps the list while reloading (AC-09)', async () => {
    const empty = await mount({ port: fakePort({ listMemories: vi.fn(async () => ({ status: 'ok', items: [], nextCursor: null })) }) });
    expect(visibleText(empty.root)).toContain('まだ記憶はありません');
    expect(visibleText(empty.root)).toContain('brainbase onboard:candidates');
    empty.view.destroy();

    let fail = true;
    const port = fakePort({ listMemories: vi.fn(async (filter) => (fail ? { status: 'unavailable', reason: 'personal_kg_invalid' } : { status: 'ok', items: filterPersonalMemories(MEMORIES, filter), nextCursor: null })) });
    const broken = await mount({ port });
    const text = collectText(broken.root);
    expect(text).toContain('記憶を読めませんでした');
    expect(text).toContain('personal_kg_invalid');
    expect(text).not.toContain('まだ記憶はありません');
    fail = false;
    findAll(broken.root, (node) => node.tagName === 'BUTTON' && collectText(node) === '再試行')[0].dispatch('click');
    await waitFor(() => rows(broken.root).length === 3);

    let release;
    port.listMemories.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const reload = broken.view.load();
    expect(rows(broken.root).length).toBe(3);
    expect(visibleText(broken.root)).toContain('読み込んでいます');
    release({ status: 'ok', items: [], nextCursor: null });
    await reload;
    expect(visibleText(broken.root)).toContain('まだ記憶はありません');
    broken.view.destroy();
  });

  it('reads nothing and shows only the owner notice when the viewer is not the owner (AC-02)', async () => {
    const port = fakePort({ isOwner: vi.fn(() => false) });
    const { root, rail, view } = await mount({ port, route: { kinds: [], states: DEFAULT_PERSONAL_MEMORY_STATES, organization: null, memoryId: 'm-active' } });
    expect(visibleText(root)).toContain('この画面は本人だけが見られます');
    expect(port.listMemories).not.toHaveBeenCalled();
    expect(port.readMemory).not.toHaveBeenCalled();
    expect(port.listJudgmentsUsing).not.toHaveBeenCalled();
    expect(port.countJudgmentsUsing).not.toHaveBeenCalled();
    expect(collectText(rail)).not.toContain('可逆な決定');
    view.destroy();
  });

  it('offers no way to correct, retract, delete or export a memory (AC-10)', async () => {
    const { root, rail, view } = await mount({ route: { kinds: [], states: ['active', 'unrecorded', 'superseded', 'retracted'], organization: null, memoryId: 'm-old' } });
    await waitFor(() => collectText(rail).includes('置き換え先'));
    const labels = findAll({ children: [root, rail] }, (node) => node.tagName === 'BUTTON' || node.tagName === 'FORM' || node.tagName === 'TEXTAREA')
      .map((node) => `${node.tagName}:${collectText(node)}:${node.attributes?.['aria-label'] ?? ''}`);
    for (const label of labels) expect(label).not.toMatch(/訂正|取り消す|削除|書き出|編集|保存|エクスポート/u);
    expect(findAll(root, (node) => node.tagName === 'FORM' || node.tagName === 'TEXTAREA')).toEqual([]);
    view.destroy();
  });
});

describe('local HTTP port', () => {
  it('sends the launch token on every read, filters locally and keeps the words out of the request URL (AC-11)', async () => {
    const requests = [];
    const items = [memory('a', { text: '会議の前に決める', updatedAt: '2026-10-02T00:00:00.000Z' }), memory('b', { kind: 'work', text: '別の記憶' })];
    const port = createPersonalMemoryHttpPort({
      token: 'launch-token-0123456789',
      fetcher: async (path, init) => {
        requests.push({ path, init });
        if (path === '/api/personal-memory') return jsonResponse(200, { status: 'ok', items, next_cursor: null });
        if (path === '/api/personal-memory?view=judgment-counts') return jsonResponse(503, { status: 'unavailable', reason: 'reference_source_mismatch' });
        if (path === '/api/personal-memory/a/judgments?limit=5') return jsonResponse(200, { status: 'ok', items: [], total: 0 });
        if (path === '/api/personal-memory/zz') return jsonResponse(404, { status: 'not_found' });
        return jsonResponse(403, { error: { code: 'web_token_required' } });
      },
    });
    expect(port.isOwner()).toBe(true);
    expect(await port.listMemories({ query: '会議', kinds: ['value'] })).toEqual({ status: 'ok', items: [items[0]], nextCursor: null });
    expect(await port.countJudgmentsUsing(['a'])).toEqual({ status: 'unavailable', reason: 'reference_source_mismatch' });
    expect(await port.listJudgmentsUsing('a', 5)).toEqual({ status: 'ok', items: [], total: 0 });
    expect(await port.readMemory('zz')).toEqual({ status: 'not_found' });
    expect(await port.readMemory('a')).toEqual({ status: 'unavailable', reason: 'web_token_required' });
    for (const { path, init } of requests) {
      expect(path).not.toContain(encodeURIComponent('会議'));
      expect(init.headers['x-brainbase-review-token']).toBe('launch-token-0123456789');
    }
    expect(await createPersonalMemoryHttpPort({ fetcher: async () => { throw new Error('offline'); } }).listMemories({})).toEqual({ status: 'unavailable', reason: 'offline' });
  });
});
