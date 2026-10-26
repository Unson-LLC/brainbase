import { describe, expect, it, vi } from 'vitest';
import {
  countInboxWaiting,
  createLocalInboxDispositions,
  createInboxUI,
  INBOX_TODAY_SECTIONS,
  inboxLaterChoices,
  inboxRouteTarget,
  parseInboxRoute,
  sortInboxItems,
  withLocalInboxDispositions,
} from '../../ui/inbox.js';
import { collectText, FakeDocument, findAll, waitFor } from './graph-ui-harness.mjs';

const NOW = new Date('2026-10-18T03:00:00.000Z');

const SOURCES = [
  { kind: 'assigned_task', label: '新しく割り当てられたタスク', group: 'task', status: 'ok' },
  { kind: 'memory_candidates', label: '取り込み待ち', group: 'triage', status: 'ok' },
  { kind: 'meeting_triage', label: '振り分け待ちの会議', group: 'triage', status: 'ok' },
];

function item(id, overrides = {}) {
  return {
    id,
    kind: 'assigned_task',
    group: 'task',
    title: `題名 ${id}`,
    detail: null,
    href: `#tasks?task=${id}`,
    receivedAt: '2026-10-17T00:00:00.000Z',
    dueAt: null,
    blocking: false,
    units: 1,
    revision: 'r1',
    ...overrides,
  };
}

const ITEMS = [
  item('task-a', { title: '見積もりを確認する', receivedAt: '2026-10-17T01:00:00.000Z', clearOnOpen: true }),
  item('task-b', { title: '契約書を読む', dueAt: '2026-10-20T00:00:00.000Z', clearOnOpen: true }),
  item('candidates', { kind: 'memory_candidates', group: 'triage', title: '取り込み待ち 12件', units: 12, href: '#candidates', revision: '12' }),
  item('triage', { kind: 'meeting_triage', group: 'triage', title: '振り分け待ちの会議 3件', units: 3, href: '#meeting-triage', revision: '3', blocking: true }),
];

function okResult(overrides = {}) {
  return { status: 'ok', sources: SOURCES, items: ITEMS, dispositions: [], uncollected: ['AIからの質問', 'ゲストの操作の承認'], ...overrides };
}

function fakePort(overrides = {}) {
  return {
    readInbox: vi.fn(async () => okResult()),
    setDisposition: vi.fn(async () => ({ status: 'ok' })),
    ...overrides,
  };
}

async function mount(options = {}) {
  const document = new FakeDocument();
  const root = document.createElement('div');
  const routes = [];
  const navigations = [];
  const counts = [];
  const view = createInboxUI({
    root,
    document,
    port: options.port ?? fakePort(),
    route: options.route,
    layout: options.layout,
    undoWindowMs: options.undoWindowMs,
    timers: options.timers,
    onRouteChange: (route) => { routes.push(route); view.applyRoute(route); },
    onNavigate: (href) => navigations.push(href),
    onCount: (count) => counts.push(count),
    now: () => options.now ?? NOW,
  });
  await view.load();
  return { view, root, routes, navigations, counts };
}

const text = (root) => collectText(root);
const sections = (root) => findAll(root, (node) => node.tagName === 'SECTION' && node.attributes?.['data-group']);
const todaySections = (root) => findAll(root, (node) => node.tagName === 'SECTION' && node.attributes?.['data-section']);
const rowsOf = (node) => findAll(node, (child) => child.attributes?.['data-inbox-item']);
const buttonIn = (node, label) => findAll(node, (child) => child.tagName === 'BUTTON' && collectText(child) === label)[0];
const linkIn = (node) => findAll(node, (child) => child.tagName === 'A')[0];

function fakeTimers() {
  let nextId = 1;
  const scheduled = new Map();
  return {
    scheduled,
    set(fn, ms) {
      const id = nextId++;
      scheduled.set(id, { fn, ms });
      return id;
    },
    clear(id) {
      scheduled.delete(id);
    },
    run(id) {
      const entry = scheduled.get(id);
      scheduled.delete(id);
      entry?.fn();
    },
    size: () => scheduled.size,
  };
}

const TODAY_SOURCES = [
  { kind: 'question', label: 'AIからの質問', group: 'answer', status: 'ok' },
  { kind: 'automation_step', label: '自動化の人の手順', group: 'approve', status: 'ok' },
  { kind: 'memory_candidates', label: '取り込み待ち', group: 'triage', status: 'ok' },
  { kind: 'assigned_task', label: '新しく割り当てられたタスク', group: 'task', status: 'ok' },
];

function todayItems() {
  return [
    item('answer-a', { kind: 'question', group: 'answer', title: '方針を決める', units: 2, receivedAt: '2026-10-14T00:00:00.000Z' }),
    item('approve-a', { kind: 'automation_step', group: 'approve', title: '経費を承認する', receivedAt: '2026-10-18T00:00:00.000Z', actions: [{ id: 'approve', label: '承認', tone: 'primary' }] }),
    item('triage-a', { kind: 'memory_candidates', group: 'triage', title: '候補を取り込む', units: 4, receivedAt: '2026-10-15T00:00:00.000Z' }),
    item('task-a', { kind: 'assigned_task', group: 'task', title: '資料を読む', receivedAt: '2026-10-18T00:00:00.000Z' }),
  ];
}

function todayResult(overrides = {}) {
  return {
    status: 'ok',
    sources: TODAY_SOURCES,
    items: todayItems(),
    dispositions: [],
    uncollected: ['ゲストの操作の承認'],
    ...overrides,
  };
}

describe('routes', () => {
  it('タブと一覧の切り替えだけをアドレスに残し、待っているものの中身を載せない', () => {
    expect(inboxRouteTarget({})).toBe('inbox');
    expect(inboxRouteTarget({ tab: 'notices' })).toBe('inbox?tab=notices');
    expect(inboxRouteTarget({ view: 'later' })).toBe('inbox?view=later');
    expect(inboxRouteTarget({ view: 'cleared', title: '見積もり', itemId: 'task-a' })).toBe('inbox?view=cleared');
    expect(parseInboxRoute(new URLSearchParams('tab=notices'))).toEqual({ tab: 'notices', view: 'waiting' });
    expect(parseInboxRoute(new URLSearchParams('tab=nope&view=nope'))).toEqual({ tab: 'waiting', view: 'waiting' });
  });
});

describe('sortInboxItems', () => {
  it('止めているもの、期限の近いもの、届いた新しいものの順に並べる', () => {
    const sorted = sortInboxItems([
      item('old', { receivedAt: '2026-10-10T00:00:00.000Z' }),
      item('new', { receivedAt: '2026-10-17T00:00:00.000Z' }),
      item('due-late', { dueAt: '2026-10-30T00:00:00.000Z' }),
      item('due-soon', { dueAt: '2026-10-19T00:00:00.000Z' }),
      item('blocking', { blocking: true, receivedAt: '2026-10-01T00:00:00.000Z' }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(['blocking', 'due-soon', 'due-late', 'new', 'old']);
  });
});

describe('countInboxWaiting', () => {
  it('見えている行の件数（まとめの行はその件数）を足す', () => {
    expect(countInboxWaiting(okResult(), NOW)).toEqual({ count: 17, unreadable: [] });
  });

  it('片付けた・あとでの行を数えず、時刻を過ぎた・版の変わったものは数える', () => {
    const result = okResult({
      dispositions: [
        { itemId: 'task-a', revision: 'r1', state: 'cleared', at: '2026-10-17T02:00:00.000Z' },
        { itemId: 'candidates', revision: '12', state: 'later', until: '2026-10-19T00:00:00.000Z', at: '2026-10-17T02:00:00.000Z' },
        { itemId: 'triage', revision: '2', state: 'cleared', at: '2026-10-17T02:00:00.000Z' },
        { itemId: 'task-b', revision: 'r1', state: 'later', until: '2026-10-18T00:00:00.000Z', at: '2026-10-17T02:00:00.000Z' },
      ],
    });
    // task-b's later has passed and triage's clear was for an older revision.
    expect(countInboxWaiting(result, NOW)).toEqual({ count: 4, unreadable: [] });
  });

  it('読めなかった種類は数えずに名前を返し、全体が読めないときは件数を出さない', () => {
    const result = okResult({
      sources: [...SOURCES.slice(0, 2), { ...SOURCES[2], status: 'unavailable', reason: 'upstream_unavailable' }],
      items: ITEMS.filter((entry) => entry.kind !== 'meeting_triage'),
    });
    expect(countInboxWaiting(result, NOW)).toEqual({ count: 14, unreadable: ['振り分け待ちの会議'] });
    expect(countInboxWaiting({ status: 'unavailable', reason: 'x' }, NOW)).toEqual({ count: null, unreadable: [] });
  });
});

describe('inboxLaterChoices', () => {
  it('今日の夕方・明日の朝・来週の月曜の朝を出し、過ぎた夕方は出さない', () => {
    const morning = new Date(2026, 9, 18, 10, 0); // Sunday
    expect(inboxLaterChoices(morning).map((choice) => [choice.label, choice.until.getDate(), choice.until.getHours()])).toEqual([
      ['今日の夕方', 18, 18], ['明日の朝', 19, 9], ['来週の月曜の朝', 19, 9],
    ]);
    const night = new Date(2026, 9, 15, 20, 0); // Thursday
    expect(inboxLaterChoices(night).map((choice) => [choice.label, choice.until.getDate()])).toEqual([['明日の朝', 16], ['来週の月曜の朝', 19]]);
  });
});

describe('inboxLaterChoices today', () => {
  it('style today は21時前だけ今夜21時を出し、明日の朝9時と来週の月曜9時を出す', () => {
    const morning = new Date(2026, 9, 18, 10, 0); // Sunday
    expect(inboxLaterChoices(morning, { style: 'today' }).map((choice) => [choice.label, choice.until.getDate(), choice.until.getHours()])).toEqual([
      ['今夜 21:00', 18, 21], ['明日の朝 9:00', 19, 9], ['来週の月曜 9:00', 19, 9],
    ]);
    const night = new Date(2026, 9, 15, 21, 30); // Thursday
    expect(inboxLaterChoices(night, { style: 'today' }).map((choice) => [choice.label, choice.until.getDate()])).toEqual([['明日の朝 9:00', 16], ['来週の月曜 9:00', 19]]);
  });
});

describe('対応待ち', () => {
  it('タブを2つ出し、することごとの区画を決まった順に並べ、行の無い区画を出さない', async () => {
    const { root } = await mount();
    const tabs = findAll(root, (node) => node.attributes?.role === 'tab').map(collectText);
    expect(tabs[0]).toMatch(/^対応待ち/u);
    expect(tabs[1]).toBe('お知らせ');
    expect(sections(root).map((node) => node.attributes['data-group'])).toEqual(['triage', 'task']);
    expect(text(root)).not.toContain('答える・決める');
    const [triage, task] = sections(root);
    expect(rowsOf(triage).map((row) => row.attributes['data-inbox-item'])).toEqual(['triage', 'candidates']);
    expect(rowsOf(task).map((row) => row.attributes['data-inbox-item'])).toEqual(['task-b', 'task-a']);
    expect(text(root)).toContain('止めています');
    expect(text(root)).not.toContain('待っているものはありません');
  });

  it('タブに対応待ちの件数を付ける', async () => {
    const { root } = await mount();
    const tab = findAll(root, (node) => node.attributes?.role === 'tab')[0];
    expect(collectText(tab)).toBe('対応待ち17');
  });

  it('読めなかった種類は区画に理由を出し、0件に見せない', async () => {
    const port = fakePort({
      readInbox: vi.fn(async () => okResult({
        sources: [SOURCES[0], { ...SOURCES[1], status: 'unavailable', reason: 'upstream_unavailable' }, { ...SOURCES[2], status: 'unavailable', reason: 'forbidden' }],
        items: ITEMS.filter((entry) => entry.kind === 'assigned_task'),
      })),
    });
    const { root } = await mount({ port });
    const triage = sections(root).find((node) => node.attributes['data-group'] === 'triage');
    expect(collectText(triage)).toContain('取り込み待ちを読めませんでした');
    expect(collectText(triage)).toContain('振り分け待ちの会議を読めませんでした');
    expect(collectText(triage)).toContain('0件ではありません');
  });

  it('全部読めて0件のときだけ「待っているものはありません」と出し、まだ集めていない種類を件数に数えずに添える', async () => {
    const { root } = await mount({ port: fakePort({ readInbox: vi.fn(async () => okResult({ items: [] })) }) });
    expect(text(root)).toContain('待っているものはありません');
    expect(text(root)).toContain('まだ集めていない種類があります');
    expect(text(root)).toContain('AIからの質問');
    const unread = await mount({
      port: fakePort({ readInbox: vi.fn(async () => okResult({ items: [], sources: [{ ...SOURCES[0], status: 'unavailable', reason: 'x' }] })) }),
    });
    expect(text(unread.root)).not.toContain('待っているものはありません');
  });

  it('接続の無い種類は「未接続」と出す', async () => {
    const { root } = await mount({
      port: fakePort({ readInbox: vi.fn(async () => okResult({ sources: [...SOURCES, { kind: 'meeting_source', label: '会議の取り込み元', group: 'triage', status: 'not_connected' }] })) }),
    });
    expect(text(root)).toContain('会議の取り込み元は未接続です');
  });

  it('全体が読めないときは理由と再試行を出し、再試行で読み直す', async () => {
    const readInbox = vi.fn(async () => ({ status: 'unavailable', reason: 'upstream_unavailable' }));
    const { root } = await mount({ port: fakePort({ readInbox }) });
    expect(text(root)).toContain('受信箱を読めませんでした');
    expect(text(root)).toContain('0件ではありません');
    readInbox.mockResolvedValueOnce(okResult());
    buttonIn(root, '再試行').dispatch('click');
    await waitFor(() => text(root).includes('見積もりを確認する'));
  });

  it('読み込みの途中は前の表示を保つ', async () => {
    let release;
    const readInbox = vi.fn(async () => okResult());
    const { root, view } = await mount({ port: fakePort({ readInbox }) });
    readInbox.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = view.load();
    expect(text(root)).toContain('見積もりを確認する');
    release(okResult({ items: [] }));
    await pending;
    expect(text(root)).toContain('待っているものはありません');
  });
});

describe('今日決めること（layout: today）', () => {
  it('タブを出さず、3段を決まった順に並べ、件数見出しに決めることの units 合計を出す', async () => {
    const { root } = await mount({
      layout: 'today',
      port: fakePort({ readInbox: vi.fn(async () => todayResult()), runAction: vi.fn(async () => ({ status: 'ok' })) }),
    });
    expect(findAll(root, (node) => node.attributes?.role === 'tab')).toEqual([]);
    expect(todaySections(root).map((node) => node.attributes['data-section'])).toEqual(INBOX_TODAY_SECTIONS.map((section) => section.id));
    expect(todaySections(root).map((node) => collectText(node.children[0]))).toEqual(['決めること', 'まとめて片付くもの', '見るだけ']);
    expect(text(root)).toContain('今日決めること 3件');
    expect(root.children[0].className).toBe('bb-inbox is-today');
  });

  it('決めることが0件なら今日決めることはありませんと出す', async () => {
    const { root } = await mount({
      layout: 'today',
      port: fakePort({ readInbox: vi.fn(async () => okResult()) }),
    });
    expect(text(root)).toContain('今日決めることはありません');
    expect(text(root)).not.toContain('今日決めること 0件');
  });

  it('段の中は sortInboxItems のまま並べ、待ち日数と3日超の is-long を出す', async () => {
    const { root } = await mount({
      layout: 'today',
      port: fakePort({ readInbox: vi.fn(async () => todayResult()), runAction: vi.fn(async () => ({ status: 'ok' })) }),
    });
    const [decide] = todaySections(root);
    expect(rowsOf(decide).map((row) => row.attributes['data-inbox-item'])).toEqual(['approve-a', 'answer-a']);
    const approveRow = rowsOf(decide).find((row) => row.attributes['data-inbox-item'] === 'approve-a');
    const answerRow = rowsOf(decide).find((row) => row.attributes['data-inbox-item'] === 'answer-a');
    expect(collectText(findAll(approveRow, (node) => node.className === 'bb-inbox-wait')[0])).toBe('今日');
    const long = findAll(answerRow, (node) => node.className === 'bb-inbox-wait is-long')[0];
    expect(collectText(long)).toBe('待ち 4日');
    expect(text(root)).not.toContain('時間前');
  });

  it('主ボタンのある行には片付けたを出さず、あとでは出す', async () => {
    const { root } = await mount({
      layout: 'today',
      port: fakePort({ readInbox: vi.fn(async () => todayResult()), runAction: vi.fn(async () => ({ status: 'ok' })) }),
    });
    const approveRow = rowsOf(todaySections(root)[0]).find((row) => row.attributes['data-inbox-item'] === 'approve-a');
    const answerRow = rowsOf(todaySections(root)[0]).find((row) => row.attributes['data-inbox-item'] === 'answer-a');
    expect(buttonIn(approveRow, '承認')).toBeDefined();
    expect(buttonIn(approveRow, 'あとで')).toBeDefined();
    expect(buttonIn(approveRow, '片付けた')).toBeUndefined();
    expect(buttonIn(answerRow, '片付けた')).toBeDefined();
  });

  it('あとでの選択肢を today の言葉にし、21時前だけ今夜を出す', async () => {
    const { root } = await mount({
      layout: 'today',
      now: new Date(2026, 9, 18, 10, 0),
      port: fakePort({ readInbox: vi.fn(async () => todayResult()) }),
    });
    const answerRow = () => rowsOf(todaySections(root)[0]).find((row) => row.attributes['data-inbox-item'] === 'answer-a');
    buttonIn(answerRow(), 'あとで').dispatch('click');
    expect(buttonIn(answerRow(), '今夜 21:00')).toBeDefined();
    expect(buttonIn(answerRow(), '明日の朝 9:00')).toBeDefined();
    expect(buttonIn(answerRow(), '来週の月曜 9:00')).toBeDefined();
    expect(buttonIn(answerRow(), '今日の夕方')).toBeUndefined();
  });

  it('読めない種類を、その group が属する段に出す', async () => {
    const { root } = await mount({
      layout: 'today',
      port: fakePort({
        readInbox: vi.fn(async () => todayResult({
          sources: [
            { ...TODAY_SOURCES[0], status: 'unavailable', reason: 'upstream_unavailable' },
            { ...TODAY_SOURCES[1], status: 'unavailable', reason: 'forbidden' },
            { ...TODAY_SOURCES[2], status: 'unavailable', reason: 'upstream_unavailable' },
            { ...TODAY_SOURCES[3], status: 'not_connected' },
          ],
          items: [],
        })),
      }),
    });
    const [decide, batch, look] = todaySections(root);
    expect(collectText(decide)).toContain('AIからの質問を読めませんでした');
    expect(collectText(decide)).toContain('自動化の人の手順を読めませんでした');
    expect(collectText(batch)).toContain('取り込み待ちを読めませんでした');
    expect(collectText(look)).toContain('新しく割り当てられたタスクは未接続です');
    expect(text(root)).not.toContain('待っているものはありません');
    expect(text(root)).toContain('まだ集めていない種類があります');
  });

  it('お知らせの読み手があるときだけ見るだけの段の下に出し、無ければ何も出さない', async () => {
    const withNotices = await mount({
      layout: 'today',
      port: fakePort({ readInbox: vi.fn(async () => todayResult()), readNotices: vi.fn(async () => ({ status: 'ok', items: [] })) }),
    });
    expect(text(withNotices.root)).toContain('お知らせはありません');
    expect(text(withNotices.root).indexOf('見るだけ')).toBeLessThan(text(withNotices.root).indexOf('お知らせはありません'));
    const without = await mount({
      layout: 'today',
      port: fakePort({ readInbox: vi.fn(async () => todayResult()) }),
    });
    expect(text(without.root)).not.toContain('お知らせはまだ集めていません');
    expect(text(without.root)).not.toContain('お知らせはありません');
  });

  it('お知らせが返らなくても受信箱の行と件数を出し、後から届いたお知らせを足す', async () => {
    let releaseNotices;
    const readNotices = vi.fn(() => new Promise((resolve) => { releaseNotices = resolve; }));
    const { root, counts } = await mount({
      layout: 'today',
      port: fakePort({ readInbox: vi.fn(async () => todayResult()), readNotices }),
    });
    expect(readNotices).toHaveBeenCalledTimes(1);
    expect(todaySections(root)).toHaveLength(3);
    expect(rowsOf(root).map((row) => row.attributes['data-inbox-item'])).toContain('answer-a');
    expect(text(root)).toContain('今日決めること 3件');
    expect(counts.at(-1)).toEqual({ count: 8, unreadable: [] });
    expect(text(root)).not.toContain('お知らせはありません');
    releaseNotices({ status: 'ok', items: [] });
    await waitFor(() => text(root).includes('お知らせはありません'));
    expect(findAll(root, (node) => node.className === 'bb-inbox-notices')).toHaveLength(1);
    expect(text(root).indexOf('見るだけ')).toBeLessThan(text(root).indexOf('お知らせはありません'));
    expect(counts.at(-1)).toEqual({ count: 8, unreadable: [] });
  });

  it('route.tab が notices でも、あとでへ移るときは tab を waiting に戻して view を残す', async () => {
    const { root, routes } = await mount({
      layout: 'today',
      route: { tab: 'notices' },
      now: new Date(2026, 9, 18, 10, 0),
      port: fakePort({
        readInbox: vi.fn(async () => todayResult({
          dispositions: [{ itemId: 'task-a', revision: 'r1', state: 'later', until: '2026-10-19T00:00:00.000Z', at: '2026-10-18T00:00:00.000Z' }],
        })),
      }),
    });
    buttonIn(root, 'あとで 1件').dispatch('click');
    expect(routes.at(-1)).toEqual({ tab: 'waiting', view: 'later' });
    expect(inboxRouteTarget(routes.at(-1))).toBe('inbox?view=later');
  });

  it('route.tab を無視して常に対応待ち側を描く', async () => {
    const { root } = await mount({
      layout: 'today',
      route: { tab: 'notices' },
      port: fakePort({ readInbox: vi.fn(async () => todayResult()), runAction: vi.fn(async () => ({ status: 'ok' })) }),
    });
    expect(todaySections(root)).toHaveLength(3);
    expect(text(root)).not.toContain('お知らせはまだ集めていません');
  });
});

describe('あとで・片付けた', () => {
  it('片付けたを押すと行を隠してホストへ伝え、片付けたの一覧から戻せる', async () => {
    const port = fakePort();
    const { root, routes } = await mount({ port });
    const row = rowsOf(root).find((node) => node.attributes['data-inbox-item'] === 'task-b');
    buttonIn(row, '片付けた').dispatch('click');
    expect(rowsOf(root).map((node) => node.attributes['data-inbox-item'])).not.toContain('task-b');
    expect(port.setDisposition).toHaveBeenCalledWith('task-b', { state: 'cleared', revision: 'r1' });
    await waitFor(() => text(root).includes('片付けた 1件'));
    buttonIn(root, '片付けた 1件').dispatch('click');
    expect(routes.at(-1)).toEqual({ tab: 'waiting', view: 'cleared' });
    const cleared = rowsOf(root);
    expect(cleared.map((node) => node.attributes['data-inbox-item'])).toEqual(['task-b']);
    buttonIn(cleared[0], '対応待ちに戻す').dispatch('click');
    expect(port.setDisposition).toHaveBeenLastCalledWith('task-b', { state: 'open' });
    await waitFor(() => rowsOf(root).length === 0);
  });

  it('あとでは選んだ時刻まで隠し、あとでの一覧に戻る時刻を出す', async () => {
    const port = fakePort();
    const { root } = await mount({ port, now: new Date(2026, 9, 18, 10, 0) });
    const candidates = () => rowsOf(root).find((node) => node.attributes['data-inbox-item'] === 'candidates');
    buttonIn(candidates(), 'あとで').dispatch('click');
    expect(buttonIn(candidates(), 'あとで').attributes['aria-expanded']).toBe('true');
    buttonIn(candidates(), '明日の朝').dispatch('click');
    const [, change] = port.setDisposition.mock.calls.at(-1);
    expect(change.state).toBe('later');
    expect(change.revision).toBe('12');
    expect(new Date(change.until).getHours()).toBe(9);
    expect(rowsOf(root).map((node) => node.attributes['data-inbox-item'])).not.toContain('candidates');
    expect(collectText(findAll(root, (node) => node.attributes?.role === 'tab')[0])).toBe('対応待ち5');
    buttonIn(root, 'あとで 1件').dispatch('click');
    expect(text(root)).toContain('10/19 9:00に戻ります');
  });

  it('ホストが失敗したら行を戻して理由を出す', async () => {
    const port = fakePort({ setDisposition: vi.fn(async () => ({ status: 'unavailable', reason: 'store_unavailable' })) });
    const { root } = await mount({ port });
    const row = rowsOf(root).find((node) => node.attributes['data-inbox-item'] === 'task-a');
    buttonIn(row, '片付けた').dispatch('click');
    await waitFor(() => text(root).includes('片付けられませんでした'));
    expect(rowsOf(root).map((node) => node.attributes['data-inbox-item'])).toContain('task-a');
  });

  it('開いたら外す行は、開いたときに片付けたへ移し、移動は止めない', async () => {
    const port = fakePort({ setDisposition: vi.fn(async () => ({ status: 'unavailable', reason: 'store_unavailable' })) });
    const { root, navigations } = await mount({ port });
    const row = rowsOf(root).find((node) => node.attributes['data-inbox-item'] === 'task-a');
    expect(linkIn(row).attributes.href).toBe('#tasks?task=task-a');
    linkIn(row).dispatch('click');
    expect(port.setDisposition).toHaveBeenCalledWith('task-a', { state: 'cleared', revision: 'r1' });
    expect(navigations).toEqual(['#tasks?task=task-a']);
    const aggregate = rowsOf(root).find((node) => node.attributes['data-inbox-item'] === 'candidates');
    linkIn(aggregate).dispatch('click');
    expect(port.setDisposition).toHaveBeenCalledTimes(1);
  });
});

describe('行のボタン', () => {
  it('ホストが付けた操作を行に出し、押すとホストの操作を呼んで読み直す', async () => {
    const runAction = vi.fn(async () => ({ status: 'ok' }));
    const readInbox = vi.fn(async () => okResult({
      items: [item('approval', { group: 'approve', kind: 'automation_step', title: '自動化の人の手順', actions: [{ id: 'approve', label: '承認', tone: 'primary' }, { id: 'reject', label: '却下', tone: 'danger' }] })],
      sources: [{ kind: 'automation_step', label: '自動化の人の手順', group: 'approve', status: 'ok' }],
    }));
    const { root } = await mount({ port: fakePort({ readInbox, runAction }) });
    const row = rowsOf(root)[0];
    buttonIn(row, '承認').dispatch('click');
    expect(runAction).toHaveBeenCalledWith('approval', 'approve');
    await waitFor(() => readInbox.mock.calls.length === 2);
  });

  it('runAction を渡さないホストでは操作のボタンを出さない', async () => {
    const readInbox = vi.fn(async () => okResult({
      items: [item('approval', { group: 'approve', actions: [{ id: 'approve', label: '承認' }] })],
    }));
    const { root } = await mount({ port: fakePort({ readInbox }) });
    expect(buttonIn(rowsOf(root)[0], '承認')).toBeUndefined();
  });
});

describe('元に戻す（undoWindowMs）', () => {
  const ACTION_SOURCES = [{ kind: 'automation_step', label: '自動化の人の手順', group: 'approve', status: 'ok' }];
  const ACTION_ITEMS = [item('approval', {
    kind: 'automation_step',
    group: 'approve',
    title: '自動化の人の手順',
    actions: [{ id: 'approve', label: '承認', tone: 'primary' }],
  })];

  function actionPort(overrides = {}) {
    return fakePort({
      readInbox: vi.fn(async () => okResult({ sources: ACTION_SOURCES, items: ACTION_ITEMS, uncollected: [] })),
      runAction: vi.fn(async () => ({ status: 'ok' })),
      ...overrides,
    });
  }

  it('押すとすぐ行と件数から外し、元に戻すと runAction を呼ばずに戻す', async () => {
    const timers = fakeTimers();
    const port = actionPort();
    const { root, counts } = await mount({ port, undoWindowMs: 5000, timers });
    expect(counts.at(-1)).toEqual({ count: 1, unreadable: [] });
    buttonIn(rowsOf(root)[0], '承認').dispatch('click');
    expect(port.runAction).not.toHaveBeenCalled();
    expect(rowsOf(root)).toEqual([]);
    expect(counts.at(-1)).toEqual({ count: 0, unreadable: [] });
    expect(text(root)).toContain('「承認」を実行します。');
    expect(timers.size()).toBe(1);
    buttonIn(root, '元に戻す').dispatch('click');
    expect(port.runAction).not.toHaveBeenCalled();
    expect(rowsOf(root).map((row) => row.attributes['data-inbox-item'])).toEqual(['approval']);
    expect(counts.at(-1)).toEqual({ count: 1, unreadable: [] });
    expect(text(root)).not.toContain('「承認」を実行します。');
    expect(timers.size()).toBe(0);
  });

  it('元に戻す待ちの間に再読み込みが走り、同じ id の units が 2→5 に変わっても、一覧は0行・onCount は 0（他の行が無いとき）になる', async () => {
    const timers = fakeTimers();
    const approval = (units) => item('approval', {
      kind: 'automation_step',
      group: 'approve',
      title: '自動化の人の手順',
      units,
      actions: [{ id: 'approve', label: '承認', tone: 'primary' }],
    });
    const readInbox = vi.fn()
      .mockResolvedValueOnce(okResult({ sources: ACTION_SOURCES, items: [approval(2)], uncollected: [] }))
      .mockResolvedValueOnce(okResult({ sources: ACTION_SOURCES, items: [approval(5)], uncollected: [] }));
    const port = actionPort({ readInbox });
    const { root, view, counts } = await mount({ port, undoWindowMs: 5000, timers });
    expect(counts.at(-1)).toEqual({ count: 2, unreadable: [] });
    buttonIn(rowsOf(root)[0], '承認').dispatch('click');
    expect(counts.at(-1)).toEqual({ count: 0, unreadable: [] });
    await view.load();
    expect(rowsOf(root)).toEqual([]);
    expect(counts.at(-1)).toEqual({ count: 0, unreadable: [] });
  });

  it('送信が始まったら元に戻すを出さず、二重に送らない', async () => {
    const timers = fakeTimers();
    let release;
    const runAction = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const port = actionPort({ runAction });
    const { root } = await mount({ port, undoWindowMs: 5000, timers });
    buttonIn(rowsOf(root)[0], '承認').dispatch('click');
    const [id] = [...timers.scheduled.keys()];
    timers.run(id);
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(text(root)).toContain('「承認」を実行しています。');
    expect(buttonIn(root, '元に戻す')).toBeUndefined();
    expect(rowsOf(root)).toEqual([]);
    timers.run(id);
    expect(runAction).toHaveBeenCalledTimes(1);
    release({ status: 'ok' });
    await waitFor(() => text(root).includes('自動化の人の手順'));
  });

  it('時間が過ぎたら1回だけ runAction を呼び、成功で読み直す', async () => {
    const timers = fakeTimers();
    const port = actionPort();
    const { root } = await mount({ port, undoWindowMs: 5000, timers });
    buttonIn(rowsOf(root)[0], '承認').dispatch('click');
    const [id] = [...timers.scheduled.keys()];
    timers.run(id);
    await waitFor(() => port.readInbox.mock.calls.length === 2);
    expect(port.runAction).toHaveBeenCalledTimes(1);
    expect(port.runAction).toHaveBeenCalledWith('approval', 'approve');
    await waitFor(() => text(root).includes('自動化の人の手順'));
    expect(text(root)).not.toContain('「承認」を実行します。');
  });

  it('送信が成功してから再取得が終わるまでは行もボタンも出さず、再クリックで二重送信しない', async () => {
    const timers = fakeTimers();
    let releaseRead;
    const readInbox = vi.fn()
      .mockResolvedValueOnce(okResult({ sources: ACTION_SOURCES, items: ACTION_ITEMS, uncollected: [] }))
      .mockImplementationOnce(() => new Promise((resolve) => { releaseRead = resolve; }));
    const port = actionPort({ readInbox });
    const { root } = await mount({ port, undoWindowMs: 5000, timers });
    buttonIn(rowsOf(root)[0], '承認').dispatch('click');
    const [id] = [...timers.scheduled.keys()];
    timers.run(id);
    await waitFor(() => readInbox.mock.calls.length === 2);
    expect(port.runAction).toHaveBeenCalledTimes(1);
    expect(rowsOf(root)).toEqual([]);
    expect(buttonIn(root, '承認')).toBeUndefined();
    expect(buttonIn(root, '元に戻す')).toBeUndefined();
    releaseRead(okResult({ sources: ACTION_SOURCES, items: [], uncollected: [] }));
    await waitFor(() => !text(root).includes('読み込んでいます'));
    expect(rowsOf(root)).toEqual([]);
    expect(port.runAction).toHaveBeenCalledTimes(1);
  });

  it('失敗したら行を戻して今と同じ文で知らせる', async () => {
    const timers = fakeTimers();
    const port = actionPort({ runAction: vi.fn(async () => ({ status: 'unavailable', reason: 'upstream_unavailable' })) });
    const { root } = await mount({ port, undoWindowMs: 5000, timers });
    buttonIn(rowsOf(root)[0], '承認').dispatch('click');
    const [id] = [...timers.scheduled.keys()];
    timers.run(id);
    await waitFor(() => text(root).includes('「承認」を実行できませんでした'));
    expect(text(root)).toContain('元の記録を読めません（upstream_unavailable）');
    expect(rowsOf(root).map((row) => row.attributes['data-inbox-item'])).toEqual(['approval']);
    expect(text(root)).not.toContain('「承認」を実行します。');
    expect(port.readInbox).toHaveBeenCalledTimes(1);
  });

  it('destroy で残っている操作はタイマーを止めてすぐ送る', async () => {
    const timers = fakeTimers();
    const port = actionPort();
    const { root, view } = await mount({ port, undoWindowMs: 5000, timers });
    buttonIn(rowsOf(root)[0], '承認').dispatch('click');
    view.destroy();
    expect(port.runAction).toHaveBeenCalledWith('approval', 'approve');
    expect(timers.size()).toBe(0);
    expect(root.children).toEqual([]);
  });

  it('pending が無いときの件数は countInboxWaiting の結果のまま', async () => {
    const { counts } = await mount({ port: fakePort() });
    expect(counts.at(-1)).toEqual(countInboxWaiting(okResult(), NOW));
  });

  it('undoWindowMs が0なら従来どおり結果を待って読み直し、帯を出さない', async () => {
    const timers = fakeTimers();
    const port = actionPort();
    const { root } = await mount({ port, undoWindowMs: 0, timers });
    buttonIn(rowsOf(root)[0], '承認').dispatch('click');
    expect(port.runAction).toHaveBeenCalledWith('approval', 'approve');
    expect(text(root)).not.toContain('「承認」を実行します。');
    expect(timers.size()).toBe(0);
    await waitFor(() => port.readInbox.mock.calls.length === 2);
  });
});

describe('createLocalInboxDispositions', () => {
  function memoryStorage() {
    const values = new Map();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), values };
  }

  it('人ごとの鍵に片付けた・あとでを残し、過ぎたあとでと30日を過ぎた片付けたを落とす', () => {
    const storage = memoryStorage();
    let clock = NOW;
    const store = createLocalInboxDispositions(storage, { personId: 'per_a', now: () => clock });
    expect(store.set('task-a', { state: 'cleared', revision: 'r1' })).toEqual({ status: 'ok' });
    expect(store.set('candidates', { state: 'later', until: '2026-10-19T00:00:00.000Z', revision: '12' })).toEqual({ status: 'ok' });
    expect([...storage.values.keys()]).toEqual(['brainbase.inbox.dispositions.v1:per_a']);
    expect(store.list().map((entry) => [entry.itemId, entry.state])).toEqual([['task-a', 'cleared'], ['candidates', 'later']]);
    expect(createLocalInboxDispositions(storage, { personId: 'per_b', now: () => clock }).list()).toEqual([]);
    clock = new Date('2026-10-20T00:00:00.000Z');
    expect(store.list().map((entry) => entry.itemId)).toEqual(['task-a']);
    clock = new Date('2026-11-18T00:00:00.000Z');
    expect(store.list()).toEqual([]);
    clock = NOW;
    store.set('task-a', { state: 'open' });
    expect(store.list().map((entry) => entry.itemId)).toEqual(['candidates']);
  });

  it('保存できないときは store_unavailable を返し、読めないときは何も残っていないとして読む', () => {
    expect(createLocalInboxDispositions(null).set('x', { state: 'cleared', revision: null })).toEqual({ status: 'unavailable', reason: 'store_unavailable' });
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const store = createLocalInboxDispositions(broken);
    expect(store.list()).toEqual([]);
    expect(store.set('x', { state: 'cleared', revision: null })).toEqual({ status: 'unavailable', reason: 'store_unavailable' });
  });

  it('withLocalInboxDispositions は読み手の結果に残した状態を添え、全体が読めないときはそのまま返す', async () => {
    const storage = memoryStorage();
    const store = createLocalInboxDispositions(storage, { now: () => NOW });
    const port = withLocalInboxDispositions({ readInbox: async () => okResult({ dispositions: undefined }) }, store);
    await port.setDisposition('task-a', { state: 'cleared', revision: 'r1' });
    expect((await port.readInbox()).dispositions.map((entry) => entry.itemId)).toEqual(['task-a']);
    expect(port.runAction).toBeUndefined();
    const failing = withLocalInboxDispositions({ readInbox: async () => ({ status: 'unavailable', reason: 'x' }) }, store);
    expect(await failing.readInbox()).toEqual({ status: 'unavailable', reason: 'x' });
  });
});

describe('お知らせ', () => {
  it('読み手が無いときは「まだ集めていません」と出し、0件と見せない', async () => {
    const { root } = await mount({ route: { tab: 'notices' } });
    expect(text(root)).toContain('お知らせはまだ集めていません');
    expect(text(root)).not.toContain('待っているものはありません');
  });
});
