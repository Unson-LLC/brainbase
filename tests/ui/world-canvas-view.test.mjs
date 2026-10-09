import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../workspace-kit.js', () => import('../../ui/workspace-kit.js'));
import { createWorldView, WORLD_CANVAS_PRESENTATION_VERSION } from '../../ui/world/world-view.js';
import { projectWorldWork } from '../../src/world-extension.js';
import { FakeDocument, findAll, jsonResponse, waitFor } from './world-canvas-harness.mjs';

const businesses = ['alpha', 'beta'].map((code) => ({ id: `id-${code}`, code, name: code, kind: null, status: 'active', purpose: null, summary: `${code} summary`, engagements: [], activity: { decisions: 0, window_days: 30 } }));
const tasksFor = (business, state = 'complete', title = 'Actual task') => projectWorldWork({
  business,
  tasks: { state, read_at: '2026-10-09T06:00:00Z', items: [{ id: `task-${business.code}`, title, status: 'waiting', project_codes: [business.code], source_refs: [{ type: 'web', url: 'https://example.test/task-evidence' }], description: 'Original complete record', assignee_person_id: 'person-a' }] },
  persons: { state: 'complete', items: [{ id: 'person-a', payload: { name: 'Recorded Person' } }] },
  decisions: { state: 'complete', items: [] }, relations: { state: 'complete', items: [] },
}, { now: new Date('2026-10-09T06:10:00Z') });
const works = new Map(businesses.map((business) => [business.code, tasksFor(business)]));
const businessPayload = { status: 'ok', businesses, unplaced: [], excluded: { inactive: 0 }, source: { authority: 'organization_graph', server: 'https://example.test' }, vocabulary: { kinds: [], statuses: [] } };
const response = (body, status = 200) => jsonResponse(status, body);
const activeViews = [];
afterEach(() => { activeViews.splice(0).forEach((view) => view.dispose()); vi.unstubAllGlobals(); });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function mount({ routes = {}, saved = {}, presentation = 'canvas' } = {}) {
  const doc = new FakeDocument();
  const root = doc.createElement('main');
  const rail = doc.createElement('aside');
  rail.textContent = 'Host rail stays untouched';
  doc.body.append(root, rail);
  const writes = [];
  const calls = [];
  const fetcher = async (path) => {
    calls.push(path);
    if (Object.hasOwn(routes, path)) return typeof routes[path] === 'function' ? routes[path]() : routes[path];
    if (path.endsWith('/businesses')) return response(businessPayload);
    if (path.endsWith('/organization-judgments')) return response({ status: 'unavailable', reason: 'judgment_journal_not_connected' });
    if (path.endsWith('/work-summary')) return response({ status: 'ok', as_of: '2026-10-09T06:00:00Z', businesses: Object.fromEntries([...works].map(([key, work]) => [key, work.summary])) });
    const code = path.match(/\/businesses\/([^/]+)\/work$/u)?.[1];
    return response(works.get(code) ?? { status: 'unavailable' });
  };
  const view = createWorldView({ root, rail, presentation, document: doc, fetcher, selection: { read: () => saved, write: (value) => writes.push(value) }, taskHref: (site) => `/tasks/${site.task_id}`, projectHref: (project) => `/projects/${project.id}` });
  activeViews.push(view);
  root.querySelector('.bb-world-stage').setRect({ width: 900, height: 600 });
  const city = () => root.querySelector('.bb-world-canvas-city');
  const choose = (code) => { city().value = code; city().dispatch('change'); };
  return { doc, root, rail, view, writes, calls, city, choose };
}

// The real read pipeline and real canonical projection are exercised here with
// WebGL unavailable. These assertions do not establish browser/canvas visual QA.
describe('World canvas source integration', () => {
  it('owns presentation without mutating external rail and preserves full real details', async () => {
    const app = mount({ saved: { business: 'alpha', site: 'task-alpha' } });
    await waitFor(() => app.root.querySelector('.bb-world-canvas-task-body').textContent.includes('Actual task'));
    expect(WORLD_CANVAS_PRESENTATION_VERSION).toBe('brainbase.world-canvas.v1');
    expect(app.rail.textContent).toBe('Host rail stays untouched');
    expect(app.root.querySelector('.bb-ws-page')).toBeNull();
    const bubble = app.root.querySelector('.bb-world-canvas-task');
    expect(bubble.hidden).toBe(false);
    expect(bubble.textContent).toContain('Original complete record');
    expect(bubble.querySelector('a[href="/tasks/task-alpha"]')).not.toBeNull();
    expect(app.root.querySelector('.bb-world-canvas-rail-body').textContent).toContain('出典と時点');
    expect(app.writes.at(-1)).toEqual({ business: 'alpha', site: 'task-alpha' });
    app.root.querySelector('.bb-world-canvas-task button').dispatch('click');
    expect(app.writes.at(-1)).toEqual({ business: 'alpha', site: null });
    expect(bubble.hidden).toBe(true);
  });

  it('dismisses help and task before navigating city/world and does not double-handle Escape', async () => {
    const app = mount({ saved: { business: 'alpha', site: 'task-alpha' } });
    await waitFor(() => app.writes.at(-1)?.site === 'task-alpha');
    app.root.querySelector('.bb-world-canvas-help-button').dispatch('click');
    app.doc.activeElement.dispatch('keydown', { key: 'Escape' });
    expect(app.writes.at(-1)).toEqual({ business: 'alpha', site: 'task-alpha' });
    app.root.querySelector('.bb-world-canvas-task').dispatch('keydown', { key: 'Escape' });
    expect(app.writes.at(-1)).toEqual({ business: 'alpha', site: null });
    app.city().dispatch('keydown', { key: 'Escape' });
    expect(app.writes.at(-1)).toEqual({ business: 'alpha', site: null });
    app.city().dispatch('keydown', { key: 'Escape' });
    expect(app.writes.at(-1)).toEqual({ business: null, site: null });
  });

  it('late city reads cannot reopen the previous URL task or overwrite the newly selected city', async () => {
    const first = deferred();
    const app = mount({ saved: { business: 'alpha', site: 'task-alpha' }, routes: { '/api/extensions/world/businesses/alpha/work': () => first.promise } });
    await waitFor(() => app.calls.includes('/api/extensions/world/businesses/alpha/work'));
    app.choose('beta');
    await waitFor(() => app.root.querySelector('.bb-world-canvas-rail-body').textContent.includes('beta summary'));
    first.resolve(response(works.get('alpha')));
    await settle();
    expect(app.writes.at(-1)).toEqual({ business: 'beta', site: null });
    expect(app.root.querySelector('.bb-world-canvas-task').hidden).toBe(true);
    expect(app.root.querySelector('.bb-world-canvas-rail-body').textContent).toContain('beta summary');
  });

  it('reset while a task is pending cancels restoration without treating the response as a new selection', async () => {
    const pending = deferred();
    const app = mount({ saved: { business: 'alpha', site: 'task-alpha' }, routes: { '/api/extensions/world/businesses/alpha/work': () => pending.promise } });
    await waitFor(() => app.calls.includes('/api/extensions/world/businesses/alpha/work'));
    app.root.querySelector('.bb-world-canvas-reset').dispatch('click');
    pending.resolve(response(works.get('alpha')));
    await settle();
    expect(app.writes.at(-1)).toEqual({ business: null, site: null });
    expect(app.root.querySelector('.bb-world-canvas-task').hidden).toBe(true);
  });

  it('failed refresh replaces stale facts with explicit unavailable state and keeps the city', async () => {
    let reads = 0;
    const app = mount({ saved: { business: 'alpha', site: 'task-alpha' }, routes: { '/api/extensions/world/businesses/alpha/work': () => ++reads === 1 ? response(works.get('alpha')) : response({}, 502) } });
    await waitFor(() => app.writes.at(-1)?.site === 'task-alpha');
    app.doc.dispatch('visibilitychange');
    await waitFor(() => app.root.querySelector('.bb-world-canvas-quests').textContent.includes('仕事：読めない'));
    expect(app.root.querySelector('.bb-world-canvas-task').hidden).toBe(true);
    expect(app.root.querySelector('.bb-world-canvas-rail-body').textContent).toContain('HTTP 502');
    expect(app.writes.at(-1)).toEqual({ business: 'alpha', site: null });
  });

  it('updates changed facts even when district growth has not changed', async () => {
    let reads = 0;
    const app = mount({ saved: { business: 'alpha', site: 'task-alpha' }, routes: { '/api/extensions/world/businesses/alpha/work': () => response(++reads === 1 ? works.get('alpha') : tasksFor(businesses[0], 'complete', 'Updated actual task')) } });
    await waitFor(() => app.writes.at(-1)?.site === 'task-alpha');
    app.doc.dispatch('visibilitychange');
    await waitFor(() => app.root.querySelector('.bb-world-canvas-task-body').textContent.includes('Updated actual task'));
    expect(app.writes.at(-1)).toEqual({ business: 'alpha', site: 'task-alpha' });
  });

  it('shows failed Graph, unconnected judgment and partial work as distinct notices without fake warning text', async () => {
    const app = mount({ routes: { '/api/extensions/world/work-summary': response({ status: 'ok', businesses: { alpha: { state: 'partial', open: 0, needs_check: [] }, beta: { state: 'failed', open: null, needs_check: null } } }) } });
    await waitFor(() => app.root.querySelector('.bb-world-canvas-quests').textContent.includes('一部だけ読めた'));
    const notes = app.root.querySelector('.bb-world-canvas-quests');
    expect(notes.textContent).toContain('判断の記録：未接続');
    expect(notes.textContent).toContain('仕事が読めない事業 1件');
    expect(notes.textContent).not.toContain('記録の要確認');
    expect(findAll(notes, (node) => ['A', 'BUTTON'].includes(node.tagName))).toEqual([]);
  });

  it('offers every recorded task through a keyboard-accessible directory and focuses explicit details', async () => {
    const app = mount();
    await waitFor(() => !app.city().disabled);
    app.choose('alpha');
    await waitFor(() => app.root.querySelector('.bb-world-task-directory'));
    const edge = app.root.querySelector('.bb-world-canvas-edge');
    edge.focus();
    edge.dispatch('click');
    const directory = app.root.querySelector('.bb-world-task-directory');
    expect(directory.querySelector('summary').textContent).toBe('仕事を選ぶ（1件）');
    const taskButton = directory.querySelector('button');
    taskButton.focus();
    taskButton.dispatch('click');
    const bubble = app.root.querySelector('.bb-world-canvas-task');
    expect(bubble.hidden).toBe(false);
    expect(bubble.contains(app.doc.activeElement)).toBe(true);
    expect(app.writes.at(-1)).toEqual({ business: 'alpha', site: 'task-alpha' });
  });

  it('omitted business summaries and null counts stay unknown rather than zero', async () => {
    const app = mount({ routes: { '/api/extensions/world/work-summary': response({ status: 'ok', businesses: { alpha: { state: 'complete', open: null, needs_check: [] } } }) } });
    await waitFor(() => app.root.querySelector('.bb-world-canvas-quests').textContent.includes('未完了の件数：未確認'));
    expect(app.root.querySelector('.bb-world-canvas-quests').textContent).toContain('仕事が読めない事業 1件');
    expect(app.root.querySelector('.bb-world-canvas-rail-body').textContent).toContain('未完了の件数は未確認');
    expect(app.root.querySelector('.bb-world-canvas-rail-body').textContent).not.toContain('未完了 0');
  });

  it('keeps a failed Graph visible without presenting a zero-business success', async () => {
    const app = mount({ routes: { '/api/extensions/world/businesses': response({}, 503) } });
    await waitFor(() => app.root.querySelector('.bb-world-canvas-quests').textContent.includes('事業：読めない'));
    expect(app.root.querySelector('.bb-world-canvas-quests').textContent).toContain('0件ではありません');
    expect(app.city().disabled).toBe(true);
  });

  it('dispose prevents late data from changing UI or selection', async () => {
    const pending = deferred();
    const app = mount({ routes: { '/api/extensions/world/businesses': () => pending.promise } });
    app.view.dispose();
    pending.resolve(response(businessPayload));
    await settle();
    expect(app.writes).toEqual([]);
    expect(app.calls).toEqual(['/api/extensions/world/businesses']);
    expect(app.root.querySelector('.bb-world-canvas-ui')).toBeNull();
  });

  it('default presentation retains host rail/header and does not mount canvas overlays', async () => {
    const app = mount({ presentation: 'standard' });
    await waitFor(() => app.root.querySelector('.bb-world-fallback'));
    expect(app.root.querySelector('.bb-world-canvas-ui')).toBeNull();
    expect(app.root.querySelector('.bb-ws-page')).not.toBeNull();
    expect(app.rail.textContent).not.toBe('Host rail stays untouched');
  });
});
