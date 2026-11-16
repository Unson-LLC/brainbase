/* story-world-sign-meaning-v1: a city's 要確認 and 一部だけ読めた say what they mean in a few words, and
 * pressing one opens why (from the recorded reason, never guessed) and what to do next.  Real World/District
 * modules; only browser rendering/DOM are faked, so this does not substitute for the browser check of the look. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDocument, collectText, jsonResponse, waitFor } from './world-canvas-harness.mjs';
import { projectWorldFromGraph, projectWorldWork } from '../../src/world-extension.js';

vi.mock('../../workspace-kit.js', () => import('../../ui/workspace-kit.js'));
const runtime = vi.hoisted(() => ({ doc: null, renderers: [], controls: [], frames: [], observers: [] }));
vi.mock('../../ui/world/world-vendor.js', async () => {
  const three = await import('three');
  class Renderer {
    constructor() {
      this.domElement = runtime.doc.createElement('canvas');
      this.shadowMap = {};
      this.capabilities = { getMaxAnisotropy: () => 1 };
      this.dispose = vi.fn();
      runtime.renderers.push(this);
    }
    setPixelRatio(value) { this.pixelRatio = value; }
    setSize(width, height) {
      const rect = this.domElement.parentNode.getBoundingClientRect();
      this.domElement.setRect({ left: rect.left, top: rect.top, width, height });
    }
    render(scene, camera) {
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      this.scene = scene;
      this.camera = camera;
    }
  }
  class Controls {
    constructor(camera, canvas) {
      this.camera = camera;
      this.canvas = canvas;
      this.target = new three.Vector3();
      this.enabled = true;
      this.dispose = vi.fn();
      runtime.controls.push(this);
    }
    update() { this.camera.lookAt(this.target); }
  }
  return { THREE: { ...three, WebGLRenderer: Renderer }, MapControls: Controls };
});
import { createWorldView } from '../../ui/world/world-view.js';
import { workSignBlocks, workSigns } from '../../ui/world/world-work-rail.js';

const NOW = new Date('2026-10-09T00:00:00.000Z');
const businesses = projectWorldFromGraph({
  entities: ['alpha', 'beta'].map((code) => ({ id: code, type: 'project', name: code === 'alpha' ? 'Alpha' : 'Beta', metadata: { code } })),
  edges: [],
}, NOW).businesses;
const complete = { state: 'complete', items: [] };
/** Alpha has one street of one work and one of three, and no assignee anywhere (so work to check). */
const STREETS = [['世界の画面を直す', 1], ['組織版の配備', 3]];
const READS = { alpha: { state: 'partial', reason: 'codes_not_permitted' }, beta: { state: 'complete', reason: null } };
const makeWork = (code) => projectWorldWork({
  business: businesses.find((entry) => entry.code === code),
  tasks: { ...READS[code], read_at: NOW.toISOString(), items: STREETS.flatMap(([purpose, count]) => Array.from({ length: count }, (_, index) => ({
    id: `${code}-${purpose}-${index}`, title: `${purpose} ${index + 1}`, status: 'in_progress', purpose_label: purpose,
    project_codes: [code], source_refs: [], created_at: NOW.toISOString(),
  }))) },
  persons: complete, decisions: complete, relations: complete,
}, { now: NOW });

function frame(time = 100) {
  const pending = runtime.frames.splice(0);
  for (const callback of pending) callback(time);
}
const mounted = [];
/** The world as an organization web mounts it: organization Graph, judgments not connected (ledger §6-7). */
async function mount({ organization = true, judgmentHref } = {}) {
  const doc = new FakeDocument();
  const create = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const node = create(tag);
    if (tag === 'canvas') node.getContext = (kind) => kind === '2d'
      ? new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) }, { get: (object, key) => object[key] ?? (() => {}) })
      : {};
    return node;
  };
  runtime.doc = doc;
  const root = doc.createElement('div');
  doc.body.append(root);
  const fetcher = async (path) => {
    if (path === '/api/extensions/world/businesses') return jsonResponse(200, { status: 'ok', source: { authority: organization ? 'organization_graph' : 'local_graph', server: 'https://example.test' }, businesses, unplaced: [], excluded: { inactive: 0 } });
    if (path === '/api/extensions/world/organization-judgments') return jsonResponse(200, { status: 'unavailable', scope: 'organization', withheld: 0, places: [], home: null, reason: 'judgment_journal_not_connected' });
    if (path === '/api/value-proofs/home') return jsonResponse(200, { status: 'available', sections: {}, delegation_map: { judged: 0, rows: [] } });
    if (path === '/api/extensions/world/judgment-places') return jsonResponse(200, { status: 'available', places: [] });
    if (path === '/api/extensions/world/work-summary') return jsonResponse(200, { status: 'ok', businesses: Object.fromEntries(businesses.map(({ code }) => [code, makeWork(code).summary])) });
    const code = path.match(/^\/api\/extensions\/world\/businesses\/([^/]+)\/work$/u)?.[1];
    if (code) return jsonResponse(200, makeWork(code));
    throw new Error(`unexpected read ${path}`);
  };
  const rail = doc.createElement('aside');
  doc.body.append(rail);
  const view = createWorldView({ root, rail, document: doc, fetcher, selection: { read: () => ({}), write: vi.fn() }, presentation: 'canvas', ...(judgmentHref ? { judgmentHref } : {}) });
  mounted.push(view);
  root.querySelector('.bb-world-stage').setRect({ left: 50, top: 60, width: 960, height: 640 });
  await waitFor(() => runtime.renderers.length > 0 && root.querySelector('.bb-world-canvas-city').children.length === 3);
  for (const observer of runtime.observers) observer.callback();
  frame();
  const drawer = () => root.querySelector('.bb-world-canvas-drawer');
  return {
    root,
    drawer,
    drawerOpen: () => drawer().classList.contains('is-open'),
    drawerText: () => collectText(drawer()),
    quest: (summary) => [...root.querySelectorAll('.bb-world-canvas-quest')].find((node) => node.getAttribute('aria-label')?.startsWith(summary)),
    selectCity(code) {
      const control = root.querySelector('.bb-world-canvas-city');
      control.value = code;
      control.dispatch('change');
    },
  };
}

beforeEach(() => {
  runtime.renderers = [];
  runtime.controls = [];
  runtime.frames = [];
  runtime.observers = [];
  vi.stubGlobal('requestAnimationFrame', (callback) => { runtime.frames.push(callback); return runtime.frames.length; });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; runtime.observers.push(this); }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  vi.unstubAllGlobals();
});


const summaryOf = (code) => makeWork(code).summary;

describe('a city\'s signs say what they mean (story-world-sign-meaning-v1)', () => {
  it('adds the meaning in a few words, and the recorded reason of a partial read', () => {
    expect(workSigns(summaryOf('alpha')).map((sign) => sign.text)).toEqual(['要確認 4：記録に抜け', '一部だけ読めた：権限外の案件あり']);
    expect(workSigns({ state: 'partial', needs_check: [], reason: 'page_limit_reached' }).map((sign) => sign.text)).toEqual(['一部だけ読めた：件数が上限']);
    // A reason the host did not give, or one this part does not know, gets no words (nothing is guessed).
    expect(workSigns({ state: 'partial', needs_check: [], reason: null }).map((sign) => sign.text)).toEqual(['一部だけ読めた']);
    expect(workSigns({ state: 'partial', needs_check: [], reason: 'something_new' }).map((sign) => sign.text)).toEqual(['一部だけ読めた']);
    expect(workSigns({ state: 'forbidden', reason: 'HTTP 403' }).map((sign) => sign.text)).toEqual(['仕事を読めない：権限がない']);
    expect(workSigns({ state: 'complete', needs_check: [] })).toEqual([]);
    expect(workSigns({ state: 'not_connected' })).toEqual([]);
  });

  it('explains each gap with where it is corrected, and a partial read with its reason and next step', () => {
    const doc = new FakeDocument();
    const picked = [];
    const blocks = workSignBlocks(doc, { summary: summaryOf('alpha'), onSelectGap: (kind) => picked.push(kind), onEnter: () => picked.push('enter') });
    const text = blocks.map(collectText).join('');
    expect(text).toContain('要確認 4件：記録に抜けがある仕事');
    expect(text).toContain('読めた未完了の仕事4件のうち4件に、タスクの記録から分からないことがあります。仕事が止まっている・遅れているという意味ではありません。');
    expect(text).toContain('担当の記録なし 4件 ›');
    expect(text).toContain('直し方：タスクの担当欄に、担当する人を登録する');
    expect(text).toContain('直し方：元になった議事録・Slack・資料のリンクを、タスクに足す');
    expect(text).toContain('一部だけ読めた：権限外の案件あり');
    expect(text).toContain('案件の一部は、あなたのタスクの権限の範囲外のため読んでいません');
    expect(text).toContain('読むには、その案件のタスクを見る権限が要ります。権限は組織の管理者が付けます。');
    const buttons = blocks.flatMap((block) => [...block.querySelectorAll('button')]);
    buttons.find((button) => button.textContent.startsWith('担当の記録なし')).click();
    buttons.find((button) => button.textContent.startsWith('区画に入って')).click();
    expect(picked).toEqual(['assignee_unrecorded', 'enter']);
  });

  it('says a reason was not recorded instead of guessing one', () => {
    const doc = new FakeDocument();
    const text = workSignBlocks(doc, { summary: { state: 'partial', open: 2, needs_check: [], gaps: {}, reason: null } }).map(collectText).join('');
    expect(text).toContain('理由は記録されていません');
    expect(text).toContain('記録された理由からは分かりません');
    const limit = workSignBlocks(doc, { summary: { state: 'partial', open: 2, needs_check: [], gaps: {}, reason: 'page_limit_reached' } }).map(collectText).join('');
    expect(limit).toContain('件数が多く、最初の200件だけを読みました');
    expect(limit).toContain('直す操作はありません');
    const failed = workSignBlocks(doc, { summary: { state: 'failed', reason: 'upstream_timeout' } }).map(collectText).join('');
    expect(failed).toContain('仕事を読めない：応答なし');
    expect(failed).toContain('0件とは確認できません');
    expect(failed).toContain('時間をおいて画面を開き直すと、もう一度読みます。');
  });

  it('pressing a sign opens its meaning without entering the city; a gap kind then opens the district on it', async () => {
    const app = await mount();
    const label = [...app.root.querySelectorAll('.bb-world-label.is-city')].find((node) => node.textContent.startsWith('Alpha'));
    const badges = [...label.querySelectorAll('.bb-world-badge')];
    expect(badges.map((badge) => badge.textContent)).toEqual(['要確認 4：記録に抜け', '一部だけ読めた：権限外の案件あり']);
    expect(badges.every((badge) => badge.classList.contains('is-pressable'))).toBe(true);
    badges[1].click();
    expect(app.drawerOpen()).toBe(true);
    const text = app.drawerText();
    expect(text).toContain('札の意味と、次にすること');
    expect(text).toContain('一部だけ読めた：権限外の案件あり');
    // Still the whole world: the sign did not enter the district (its name does).
    expect(app.root.querySelector('.bb-world-canvas-city').value).not.toBe('alpha');
    [...app.drawer().querySelectorAll('button')].find((button) => button.textContent.startsWith('担当の記録なし')).click();
    await waitFor(() => app.drawerText().includes('担当の記録なし 4件'));
    expect(collectText(app.root.querySelector('.bb-world-pick'))).toContain('担当の記録なし 4件');
  });

  it('the entrances say the same meaning and open it for the keyboard', async () => {
    const app = await mount();
    app.quest('仕事が一部だけ読めた事業 1件').querySelector('button').click();
    expect(app.drawerOpen()).toBe(true);
    expect(app.drawerText()).toContain('要確認 4：記録に抜け・一部だけ読めた：権限外の案件あり');
    [...app.drawer().querySelectorAll('button')].find((button) => button.textContent.startsWith('札の意味')).click();
    expect(app.drawerText()).toContain('札の意味と、次にすること');
  });
});
