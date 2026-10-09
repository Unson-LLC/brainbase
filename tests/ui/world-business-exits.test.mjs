/* story-world-business-exits-v1: the tools a business uses, in the city details and the list shown
 * without 3D. The real read pipeline and the real canonical work projection run with WebGL unavailable;
 * these assertions do not establish browser/canvas visual QA. */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../workspace-kit.js', () => import('../../ui/workspace-kit.js'));
import { createWorldView } from '../../ui/world/world-view.js';
import { projectWorldWork } from '../../src/world-extension.js';
import { FakeDocument, findAll, jsonResponse, waitFor } from './world-canvas-harness.mjs';

const businesses = ['alpha', 'beta'].map((code) => ({ id: `id-${code}`, code, name: code, kind: null, status: 'active', purpose: null, summary: `${code} summary`, engagements: [], activity: { decisions: 0, window_days: 30 } }));
const workFor = (business) => projectWorldWork({
  business,
  tasks: { state: 'complete', read_at: '2026-10-09T06:00:00Z', items: [{ id: `task-${business.code}`, title: 'Actual task', status: 'waiting', project_codes: [business.code], source_refs: [], assignee_person_id: null }] },
  persons: { state: 'complete', items: [] }, decisions: { state: 'complete', items: [] }, relations: { state: 'complete', items: [] },
}, { now: new Date('2026-10-09T06:10:00Z') });
const payload = (vocabulary = { kinds: [], statuses: [] }) => ({ status: 'ok', businesses, unplaced: [], excluded: { inactive: 0 }, source: { authority: 'organization_graph', server: 'https://example.test' }, vocabulary });

const toolsOf = (code) => ({
  status: 'complete',
  read_at: '2026-10-09T06:00:00Z',
  exits: [
    { id: `${code}-hq`, label: `${code} HQ · 候補の審査`, href: `https://hq.example.test/${code}`, state: 'available', note: '会社のGoogleアカウントでログイン', attention: { count: 3, label: '未対応の申請', as_of: '2026-10-09T06:00:00Z' } },
    { id: `${code}-drive`, label: `${code} Drive`, href: '/drive', state: 'restricted', action: { label: '利用を申請', href: `?screen=connections&tool=${code}-drive&request=1` }, attention: { label: '未読' } },
    { id: `${code}-repo`, label: `${code} repo`, href: 'https://github.example.test/repo', state: 'unknown' },
    { id: `${code}-old`, label: `${code} old`, href: 'https://old.example.test', state: 'unavailable' },
    { id: `${code}-bad`, label: 'bad', href: 'javascript:alert(1)', state: 'available' },
  ],
});

const views = [];
afterEach(() => { views.splice(0).forEach((view) => view.dispose()); vi.unstubAllGlobals(); });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

function mount({ presentation = 'canvas', businessExits, vocabulary, saved = {} } = {}) {
  const doc = new FakeDocument();
  const root = doc.createElement('main');
  const rail = doc.createElement('aside');
  doc.body.append(root, rail);
  const fetcher = async (path) => {
    if (path.endsWith('/businesses')) return jsonResponse(200, payload(vocabulary));
    if (path.endsWith('/organization-judgments')) return jsonResponse(200, { status: 'unavailable', reason: 'judgment_journal_not_connected' });
    if (path.endsWith('/work-summary')) return jsonResponse(200, { status: 'ok', as_of: '2026-10-09T06:00:00Z', businesses: Object.fromEntries(businesses.map((business) => [business.code, workFor(business).summary])) });
    const code = path.match(/\/businesses\/([^/]+)\/work$/u)?.[1];
    return jsonResponse(200, workFor(businesses.find((business) => business.code === code)));
  };
  const options = { root, rail, presentation, document: doc, fetcher, selection: { read: () => saved, write: () => {} } };
  if (businessExits !== undefined) options.businessExits = businessExits;
  const view = createWorldView(options);
  views.push(view);
  root.querySelector('.bb-world-stage').setRect({ width: 900, height: 600 });
  const choose = (code) => {
    const city = root.querySelector('.bb-world-canvas-city');
    city.value = code;
    city.dispatch('change');
  };
  const details = () => (presentation === 'canvas' ? root.querySelector('.bb-world-canvas-rail-body') : rail);
  return { doc, root, rail, view, choose, details };
}

const toolsBlock = (container) => findAll(container, (node) => node.tagName === 'SECTION' && node.getAttribute('aria-label') === 'この事業の道具');
const rows = (container) => findAll(container, (node) => node.classList?.contains('bb-world-exit'));

describe('the tools a business uses, in the city details (AC-01, AC-03)', () => {
  it('adds the tools after the existing city sections, with state words, notes and links that open outside or in place', async () => {
    const asked = [];
    const app = mount({ businessExits: async (business) => { asked.push(business.code); return toolsOf(business.code); } });
    await waitFor(() => app.root.querySelector('.bb-world-canvas-city')?.children.length === 3);
    app.choose('alpha');
    await waitFor(() => rows(app.details()).length === 4);
    // Without 3D the list reads every city once; opening a city does not ask again.
    expect([...asked].sort()).toEqual(['alpha', 'beta']);
    const blocks = app.details().children;
    const [block] = toolsBlock(app.details());
    // After every existing section of the city.
    expect(blocks.at(-1)).toBe(block);
    expect(blocks.indexOf(block)).toBeGreaterThan(blocks.findIndex((node) => node.getAttribute?.('aria-label') === '出典と時点'));
    const [hq, drive, repo, old] = rows(block);
    expect(hq.getAttribute('data-exit-id')).toBe('alpha-hq');
    expect(hq.textContent).toContain('alpha HQ · 候補の審査');
    expect(hq.textContent).toContain('使える');
    expect(hq.textContent).toContain('会社のGoogleアカウントでログイン');
    const open = hq.querySelector('a');
    expect(open.textContent).toBe('開く');
    expect(open.getAttribute('href')).toBe('https://hq.example.test/alpha');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
    expect(drive.textContent).toContain('権限が必要');
    const [driveOpen, request] = findAll(drive, (node) => node.tagName === 'A');
    // A link inside this host stays in the same tab.
    expect(driveOpen.getAttribute('href')).toBe('/drive');
    expect(driveOpen.getAttribute('target')).toBeNull();
    expect(request.textContent).toBe('利用を申請');
    expect(request.getAttribute('href')).toBe('?screen=connections&tool=alpha-drive&request=1');
    expect(request.getAttribute('target')).toBeNull();
    expect(repo.textContent).toContain('未確認');
    expect(old.textContent).toContain('読めない');
    // The javascript: link is not drawn; how many were dropped is said.
    expect(block.textContent).not.toContain('javascript:');
    expect(block.textContent).toContain('1件');
    expect(block.textContent).toContain('描いていません');
    expect(block.textContent).toContain('10/9 15:00');
  });

  it('names the states with the owner\'s words from the vocabulary (AC-04)', async () => {
    const app = mount({
      businessExits: (business) => toolsOf(business.code),
      vocabulary: { kinds: [], statuses: [], exit_states: [{ key: 'available', label: '入れる' }, { key: 'restricted', label: '申請が要る' }, { key: 'unknown', label: 'まだ見ていない' }, { key: 'unavailable', label: '止まっている' }] },
    });
    await waitFor(() => app.root.querySelector('.bb-world-canvas-city')?.children.length === 3);
    app.choose('alpha');
    await waitFor(() => rows(app.details()).length === 4);
    expect(rows(app.details()).map((row) => row.querySelector('.bb-world-exit-state').textContent)).toEqual(['入れる', '申請が要る', 'まだ見ていない', '止まっている']);
    const help = app.root.querySelector('.bb-world-canvas-help-content').textContent;
    expect(help).toContain('明かりのついた駅＝入れる');
    expect(help).toContain('改札が閉じた駅＝申請が要る');
    expect(help).toContain('霧の駅＝まだ見ていない・止まっている');
  });

  it('never shows an unread answer as an empty one (AC-05)', async () => {
    const answers = {
      alpha: { status: 'failed', reason: 'upstream_timeout', exits: [] },
      beta: { status: 'not_connected', exits: [] },
    };
    const app = mount({ businessExits: (business) => answers[business.code] });
    await waitFor(() => app.root.querySelector('.bb-world-canvas-city')?.children.length === 3);
    app.choose('alpha');
    await waitFor(() => toolsBlock(app.details())[0]?.textContent.includes('道具を読めません'));
    expect(toolsBlock(app.details())[0].textContent).toContain('道具を読めません（0件とは確認できません）');
    expect(toolsBlock(app.details())[0].textContent).toContain('upstream_timeout');
    expect(toolsBlock(app.details())[0].textContent).not.toContain('登録されていません');
    app.choose('beta');
    await waitFor(() => toolsBlock(app.details())[0]?.textContent.includes('未接続'));
    expect(toolsBlock(app.details())[0].textContent).toContain('道具を読めません（0件とは確認できません）');
  });

  it('says a partial read is partial, and only a read zero is "not registered" (AC-05)', async () => {
    const answers = {
      alpha: { status: 'partial', read_at: '2026-10-09T06:00:00Z', exits: [toolsOf('alpha').exits[0]] },
      beta: { status: 'complete', read_at: '2026-10-09T06:00:00Z', exits: [] },
    };
    const app = mount({ businessExits: async (business) => answers[business.code] });
    await waitFor(() => app.root.querySelector('.bb-world-canvas-city')?.children.length === 3);
    app.choose('alpha');
    await waitFor(() => rows(app.details()).length === 1);
    expect(toolsBlock(app.details())[0].textContent).toContain('一部だけ読めた');
    app.choose('beta');
    await waitFor(() => toolsBlock(app.details())[0]?.textContent.includes('この事業の道具は登録されていません'));
  });

  it('reads a throwing host as a failed read', async () => {
    const app = mount({ businessExits: () => { throw new Error('ledger_down'); } });
    await waitFor(() => app.root.querySelector('.bb-world-canvas-city')?.children.length === 3);
    app.choose('alpha');
    await waitFor(() => toolsBlock(app.details())[0]?.textContent.includes('ledger_down'));
    expect(toolsBlock(app.details())[0].textContent).toContain('道具を読めません（0件とは確認できません）');
  });

  it('shows attention with its count, label and time, and an unknown count as unconfirmed (AC-06)', async () => {
    const app = mount({ businessExits: (business) => toolsOf(business.code) });
    await waitFor(() => app.root.querySelector('.bb-world-canvas-city')?.children.length === 3);
    app.choose('alpha');
    await waitFor(() => rows(app.details()).length === 4);
    const [hq, drive] = rows(app.details());
    expect(hq.querySelector('.bb-world-exit-attention').textContent).toBe('未対応の申請 3件（10/9 15:00時点）');
    expect(drive.querySelector('.bb-world-exit-attention').textContent).toBe('未読 件数は未確認（時点不明）');
  });
});

describe('late answers and writing (AC-10)', () => {
  it('does not reopen the previous city\'s tools when its answer arrives after another city was opened', async () => {
    const pending = deferred();
    const answer = toolsOf('alpha');
    const before = JSON.stringify(answer);
    const app = mount({ businessExits: (business) => (business.code === 'alpha' ? pending.promise : toolsOf('beta')) });
    await waitFor(() => app.root.querySelector('.bb-world-canvas-city')?.children.length === 3);
    app.choose('alpha');
    await settle();
    app.choose('beta');
    await waitFor(() => rows(app.details()).length === 4);
    pending.resolve(answer);
    await settle();
    await settle();
    expect(app.details().textContent).toContain('beta HQ');
    expect(app.details().textContent).not.toContain('alpha HQ');
    expect(app.root.querySelector('.bb-world-canvas-city').value).toBe('beta');
    // The world never rewrites what the host gave it.
    expect(JSON.stringify(answer)).toBe(before);
    app.choose('alpha');
    await waitFor(() => app.details().textContent.includes('alpha HQ'));
  });
});

describe('without businessExits (AC-02)', () => {
  it('adds no tools section, no station legend and asks nothing', async () => {
    const app = mount();
    await waitFor(() => app.root.querySelector('.bb-world-canvas-city')?.children.length === 3);
    app.choose('alpha');
    await waitFor(() => app.details().textContent.includes('出典と時点'));
    expect(toolsBlock(app.root)).toHaveLength(0);
    expect(app.root.textContent).not.toContain('この事業の道具');
    expect(app.root.querySelector('.bb-world-canvas-help-content').textContent).not.toContain('駅');
    expect(findAll(app.root, (node) => node.classList?.contains('bb-world-fallback-exits'))).toHaveLength(0);
  });
});

describe('the list shown without 3D (AC-09)', () => {
  it('lists the same tools section under every city in the standard list', async () => {
    const app = mount({ presentation: 'standard', businessExits: async (business) => toolsOf(business.code) });
    await waitFor(() => findAll(app.root, (node) => node.classList?.contains('bb-world-exit')).length === 8);
    const list = app.root.querySelector('.bb-world-fallback');
    const sections = toolsBlock(list);
    expect(sections).toHaveLength(2);
    expect(sections[0].textContent).toContain('alpha HQ');
    expect(sections[1].textContent).toContain('beta HQ');
    expect(sections[0].querySelector('a').getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('lists the tools under every city in the canvas list too, and keeps an unread city unread', async () => {
    const app = mount({ businessExits: async (business) => (business.code === 'alpha' ? toolsOf('alpha') : { status: 'failed', reason: 'upstream_timeout', exits: [] }) });
    await waitFor(() => toolsBlock(app.root.querySelector('.bb-world-fallback') ?? app.root).length === 2
      && toolsBlock(app.root.querySelector('.bb-world-fallback'))[1].textContent.includes('道具を読めません'));
    const sections = toolsBlock(app.root.querySelector('.bb-world-fallback'));
    expect(rows(sections[0])).toHaveLength(4);
    expect(sections[1].textContent).toContain('道具を読めません（0件とは確認できません）');
  });
});
