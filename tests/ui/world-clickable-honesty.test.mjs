/* story-world-clickable-honesty-v1: what looks pressable in the world either goes somewhere when pressed
 * or looks unpressable and says why.  Real World/District modules, geometry and raycasting; only browser
 * rendering/DOM are faked, so this does not substitute for the browser check of the look. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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
import { THREE } from '../../ui/world/world-vendor.js';
import { createWorldView } from '../../ui/world/world-view.js';
import { createWorldCanvasUI } from '../../ui/world/world-canvas-ui.js';

const NOW = new Date('2026-10-09T00:00:00.000Z');
const businesses = projectWorldFromGraph({
  entities: ['alpha', 'beta'].map((code) => ({ id: code, type: 'project', name: code === 'alpha' ? 'Alpha' : 'Beta', metadata: { code } })),
  edges: [],
}, NOW).businesses;
const complete = { state: 'complete', items: [] };
/** Alpha has one street of one work and one of three, and no assignee anywhere (so work to check). */
const STREETS = [['世界の画面を直す', 1], ['組織版の配備', 3]];
const makeWork = (code) => projectWorldWork({
  business: businesses.find((entry) => entry.code === code),
  tasks: { state: 'complete', read_at: NOW.toISOString(), items: STREETS.flatMap(([purpose, count]) => Array.from({ length: count }, (_, index) => ({
    id: `${code}-${purpose}-${index}`, title: `${purpose} ${index + 1}`, status: 'in_progress', purpose_label: purpose,
    project_codes: [code], source_refs: [], created_at: NOW.toISOString(),
  }))) },
  persons: complete, decisions: complete, relations: complete,
}, { now: NOW });

function frame(time = 100) {
  const pending = runtime.frames.splice(0);
  for (const callback of pending) callback(time);
}
const worldRenderer = () => runtime.renderers.find((renderer) => !renderer.domElement.classList.contains('bb-world-district-canvas'));
const districtRenderer = () => runtime.renderers.find((renderer) => renderer.domElement.classList.contains('bb-world-district-canvas'));
function pickAt(renderer, worldPoint) {
  const point = worldPoint.clone().project(renderer.camera);
  const rect = renderer.domElement.getBoundingClientRect();
  const event = { clientX: rect.left + (point.x + 1) * rect.width / 2, clientY: rect.top + (1 - point.y) * rect.height / 2 };
  renderer.domElement.dispatch('pointerdown', event);
  renderer.domElement.dispatch('pointerup', event);
}
function sceneObject(renderer, kind) {
  let found = null;
  renderer?.scene?.traverse((object) => { if (!found && object.userData.kind === kind) found = object; });
  return found;
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

describe('a quest row either goes somewhere or says why it does not (AC-01〜03)', () => {
  function quests() {
    const doc = new FakeDocument();
    const stage = doc.createElement('div').setRect({ width: 1200, height: 740 });
    doc.body.append(stage);
    const ui = createWorldCanvasUI({ doc, stage });
    mounted.push(ui);
    return { ui, rows: () => [...stage.querySelector('.bb-world-canvas-quests').children] };
  }

  it('makes the whole row of a link or an action pressable, and draws a row with neither flat with its reason', () => {
    const { ui, rows } = quests();
    const onClick = vi.fn();
    ui.addNote({ summary: '振り分けを待っている会議 3件', tone: 'attention', link: { href: '?screen=meeting-triage', label: '会議の振り分けを開く', className: 'bb-world-waiting-queue-link' } });
    ui.addNote({ summary: '記録の要確認 12件・5事業', tone: 'attention', action: { label: '区画を選ぶ', onClick } });
    ui.addNote({ summary: '判断の記録：未接続', tone: 'warning', reason: '各メンバーのMacにあり、組織版には送っていません' });
    ui.addNote({ summary: '昨夜の記憶の整理：済み', tone: 'info' });
    const [link, action, unconnected, info] = rows();
    expect(link.classList.contains('has-way')).toBe(true);
    expect(link.querySelector('a').getAttribute('href')).toBe('?screen=meeting-triage');
    expect(action.classList.contains('has-way')).toBe(true);
    action.querySelector('button').click();
    expect(onClick).toHaveBeenCalledTimes(1);
    for (const row of [unconnected, info]) {
      expect(row.classList.contains('is-static')).toBe(true);
      expect(row.querySelectorAll('a, button')).toHaveLength(0);
    }
    expect(collectText(unconnected)).toContain('各メンバーのMacにあり、組織版には送っていません');
    expect(info.querySelector('.bb-world-canvas-quest-reason')).toBeNull();
  });

  it('stretches the one way down over the row and draws a row without one as a sign, not a button', () => {
    const css = readFileSync(new URL('../../ui/world/world-canvas-ui.css', import.meta.url), 'utf8').replace(/\s+/gu, ' ');
    expect(css).toMatch(/\.bb-world-canvas-quest\.has-way \{ position: relative; pointer-events: auto; cursor: pointer;/u);
    expect(css).toMatch(/\.bb-world-canvas-quest-action::before \{ content: ""; position: absolute; inset: 0;/u);
    expect(css).toMatch(/\.bb-world-canvas-quest\.is-static \{ border-style: dashed;[^}]*box-shadow: none;/u);
  });
});

describe('the world of an organization web, whose judgments are not connected', () => {
  it('says in the row why the judgments are not there, and the row of work to check opens the entrances (AC-02, AC-03)', async () => {
    const app = await mount();
    await waitFor(() => app.quest('記録の要確認'));
    const unconnected = app.quest('判断の記録：未接続');
    expect(unconnected.classList.contains('is-static')).toBe(true);
    expect(collectText(unconnected)).toContain('各メンバーのMacにあり、組織版には送っていません');
    expect(app.drawerOpen()).toBe(false);
    app.quest('記録の要確認').querySelector('button').click();
    expect(app.drawerOpen()).toBe(true);
    expect(app.drawerText()).toContain('どの区画に入りますか');
    expect(app.drawerText()).toContain('Alphaの区画に入る');
  });

  it('a pressed plaza opens what it is and why nothing stands there, never zero judgments (AC-04)', async () => {
    const app = await mount();
    const label = [...app.root.querySelectorAll('.bb-world-label.is-plaza')].map((node) => node.textContent);
    expect(label).toContain('広場（判断：未接続）');
    const plaza = sceneObject(worldRenderer(), 'plaza');
    pickAt(worldRenderer(), plaza.localToWorld(new THREE.Vector3(0, 0.72, 0)));
    expect(app.drawerOpen()).toBe(true);
    expect(app.drawerText()).toContain('判断の種類1つにつき建物が1つ');
    expect(app.drawerText()).toContain('判断の記録：未接続');
    expect(app.drawerText()).toContain('広場に建物が無いのは、判断が0件だからではありません');
    expect(app.drawerText()).not.toContain('どの事業にも置けない判断');
  });

  it('the plaza\'s name is a way in too', async () => {
    const app = await mount();
    const name = [...app.root.querySelectorAll('.bb-world-label.is-plaza')].find((node) => node.textContent.startsWith('広場'));
    expect(name.classList.contains('is-enterable')).toBe(true);
    name.click();
    expect(app.drawerOpen()).toBe(true);
    expect(app.drawerText()).toContain('判断の種類（全体）');
  });

  it('a street\'s sign lists the work it counts, and the hall opens what the business is for (AC-05, AC-06)', async () => {
    const app = await mount();
    app.selectCity('alpha');
    await waitFor(() => { frame(); return app.root.querySelectorAll('.bb-world-label.is-street').length === 2; });
    const signs = [...app.root.querySelectorAll('.bb-world-label.is-street')];
    expect(signs.map((node) => node.textContent)).toEqual(['世界の画面を直す（1件）', '組織版の配備（3件）']);
    expect(signs.every((node) => node.classList.contains('is-enterable'))).toBe(true);
    signs[1].click();
    expect(app.drawerOpen()).toBe(true);
    const pick = app.root.querySelector('.bb-world-pick');
    expect(collectText(pick)).toContain('通り「組織版の配備」の仕事 3件');
    expect([...pick.querySelectorAll('.bb-world-rail-pick')].map((node) => node.textContent)).toEqual(['組織版の配備 1', '組織版の配備 2', '組織版の配備 3']);
    signs[0].click();
    expect(collectText(app.root.querySelector('.bb-world-pick'))).toContain('通り「世界の画面を直す」の仕事 1件');

    app.root.querySelector('[aria-label="都市の詳細を閉じる"]').click();
    expect(app.drawerOpen()).toBe(false);
    const hall = sceneObject(districtRenderer(), 'hall');
    expect(hall).not.toBeNull();
    const box = new THREE.Box3().setFromObject(hall);
    pickAt(districtRenderer(), new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y - 0.05, (box.min.z + box.max.z) / 2));
    expect(app.drawerOpen()).toBe(true);
    expect(app.drawerText()).toContain('Alpha');
    const hallName = [...app.root.querySelectorAll('.bb-world-label.is-plaza')].find((node) => node.textContent.startsWith('庁舎：Alpha'));
    expect(hallName.classList.contains('is-enterable')).toBe(true);
  });

  it('the district\'s row of work to check opens the city details (AC-02)', async () => {
    const app = await mount();
    app.selectCity('alpha');
    await waitFor(() => app.quest('記録の要確認 4件'));
    const row = app.quest('記録の要確認 4件');
    expect(row.classList.contains('has-way')).toBe(true);
    row.querySelector('button').click();
    expect(app.drawerOpen()).toBe(true);
    expect(app.drawerText()).toContain('Alpha');
  });
});

describe('a world whose judgments are connected keeps its plaza (AC-07, AC-08)', () => {
  it('lists the unplaced judgments and links 判断の履歴 by the host\'s own route', async () => {
    const app = await mount({ organization: false, judgmentHref: (id) => (id ? `?screen=value-proofs&decision=${id}` : '?screen=value-proofs') });
    expect([...app.root.querySelectorAll('.bb-world-label.is-plaza')].map((node) => node.textContent)).toContain('広場（判断）');
    expect(app.quest('判断の記録')).toBeUndefined();
    const plaza = sceneObject(worldRenderer(), 'plaza');
    pickAt(worldRenderer(), plaza.localToWorld(new THREE.Vector3(0, 0.72, 0)));
    expect(app.drawerOpen()).toBe(true);
    expect(app.drawerText()).toContain('どの事業にも置けない判断（0件）');
    const history = [...app.drawer().querySelectorAll('a')].find((node) => node.textContent === '「判断の履歴」で開く');
    expect(history.getAttribute('href')).toBe('?screen=value-proofs');
  });
});
