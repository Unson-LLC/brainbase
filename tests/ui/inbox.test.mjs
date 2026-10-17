import { describe, expect, it, vi } from 'vitest';
import {
  countInboxWaiting,
  createInboxUI,
  inboxLaterChoices,
  inboxRouteTarget,
  parseInboxRoute,
  sortInboxItems,
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
  const view = createInboxUI({
    root,
    document,
    port: options.port ?? fakePort(),
    route: options.route,
    onRouteChange: (route) => { routes.push(route); view.applyRoute(route); },
    onNavigate: (href) => navigations.push(href),
    now: () => options.now ?? NOW,
  });
  await view.load();
  return { view, root, routes, navigations };
}

const text = (root) => collectText(root);
const sections = (root) => findAll(root, (node) => node.tagName === 'SECTION' && node.attributes?.['data-group']);
const rowsOf = (node) => findAll(node, (child) => child.attributes?.['data-inbox-item']);
const buttonIn = (node, label) => findAll(node, (child) => child.tagName === 'BUTTON' && collectText(child) === label)[0];
const linkIn = (node) => findAll(node, (child) => child.tagName === 'A')[0];

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

describe('お知らせ', () => {
  it('読み手が無いときは「まだ集めていません」と出し、0件と見せない', async () => {
    const { root } = await mount({ route: { tab: 'notices' } });
    expect(text(root)).toContain('お知らせはまだ集めていません');
    expect(text(root)).not.toContain('待っているものはありません');
  });
});
