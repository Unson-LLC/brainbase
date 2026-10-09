/* Real World/District modules, geometry, projection and raycasting; only browser rendering/DOM are
 * faked. These exercise source behavior and do not substitute for visible browser/layout QA. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { FakeDocument, buttonsNamed, jsonResponse, waitFor } from './world-canvas-harness.mjs';
import { createWorldExtension, projectWorldFromGraph, projectWorldWork } from '../../src/world-extension.js';

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

const NOW = new Date('2026-10-09T00:00:00.000Z');
const businesses = projectWorldFromGraph({
  entities: ['alpha', 'beta'].map((code) => ({ id: code, type: 'project', name: code === 'alpha' ? 'Alpha' : 'Beta', metadata: { code } })),
  edges: [],
}, NOW).businesses;
const complete = { state: 'complete', items: [] };
const makeWork = (code, ids = [`${code}-task`], status = 'pending') => projectWorldWork({
  business: businesses.find((entry) => entry.code === code),
  tasks: { state: 'complete', read_at: NOW.toISOString(), items: ids.map((id) => ({
    id, title: `Task ${id}`, status, project_codes: [code], source_refs: [], created_at: NOW.toISOString(),
  })) },
  persons: complete, decisions: complete, relations: complete,
}, { now: NOW });

function defer() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function frame(time = 100) {
  const pending = runtime.frames.splice(0);
  for (const callback of pending) callback(time);
}
function districtRenderer() { return runtime.renderers.find((renderer) => renderer.domElement.classList.contains('bb-world-district-canvas')); }
function districtControls() { return runtime.controls.find((controls) => controls.canvas.classList.contains('bb-world-district-canvas')); }
function lots() {
  const found = [];
  districtRenderer()?.scene?.traverse((object) => { if (object.userData.kind === 'site') found.push(object); });
  return found;
}
function pickLot(taskId) {
  const renderer = districtRenderer();
  const lot = lots().find((entry) => entry.userData.site.task_id === taskId);
  expect(lot, `rendered lot ${taskId}`).toBeDefined();
  const point = lot.localToWorld(new THREE.Vector3(0, 0.05, 0)).project(renderer.camera);
  const rect = renderer.domElement.getBoundingClientRect();
  const event = { clientX: rect.left + (point.x + 1) * rect.width / 2, clientY: rect.top + (1 - point.y) * rect.height / 2 };
  renderer.domElement.dispatch('pointerdown', event);
  renderer.domElement.dispatch('pointerup', event);
}

const mounted = [];
async function mount({ workFor = (code) => makeWork(code), selected = {}, businessExits, presentation = 'canvas' } = {}) {
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
  const selection = { read: () => selected, write: vi.fn() };
  const requests = [];
  const fetcher = async (path) => {
    requests.push(path);
    if (path === '/api/extensions/world/businesses') return jsonResponse(200, { status: 'ok', source: { authority: 'local_graph' }, businesses, unplaced: [], excluded: { inactive: 0 } });
    if (path === '/api/value-proofs/home') return jsonResponse(200, { status: 'available', sections: {}, delegation_map: { judged: 0, rows: [] } });
    if (path === '/api/extensions/world/judgment-places') return jsonResponse(200, { status: 'available', places: [] });
    if (path === '/api/extensions/world/work-summary') return jsonResponse(200, { status: 'ok', businesses: Object.fromEntries(businesses.map(({ code }) => [code, makeWork(code).summary])) });
    const code = path.match(/^\/api\/extensions\/world\/businesses\/([^/]+)\/work$/u)?.[1];
    if (code) return jsonResponse(200, await workFor(code));
    throw new Error(`unexpected read ${path}`);
  };
  const rail = doc.createElement('aside');
  doc.body.append(rail);
  const view = createWorldView({ root, rail, document: doc, fetcher, selection, presentation, ...(businessExits ? { businessExits } : {}) });
  mounted.push(view);
  const stage = root.querySelector('.bb-world-stage');
  stage.setRect({ left: 50, top: 60, width: 960, height: 640 });
  await waitFor(() => runtime.renderers.length > 0 && (presentation !== 'canvas' || root.querySelector('.bb-world-canvas-city').children.length === 3));
  for (const observer of runtime.observers) observer.callback();
  frame();
  return {
    root, rail, stage, doc, view, selection, requests,
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

describe('full canvas scene integration without a browser renderer', () => {
  it('opens a picked real lot, follows pan, and closes without moving the district camera', async () => {
    const app = await mount();
    app.selectCity('alpha');
    await waitFor(() => districtRenderer());
    frame();
    const controls = districtControls();
    const position = controls.camera.position.clone();
    const target = controls.target.clone();
    pickLot('alpha-task');
    const task = app.root.querySelector('.bb-world-canvas-task');
    expect(task.hidden).toBe(false);
    expect(task.textContent).toContain('Task alpha-task');
    expect(app.selection.write).toHaveBeenLastCalledWith({ business: 'alpha', site: 'alpha-task' });
    expect(controls.camera.position.equals(position)).toBe(true);
    expect(controls.target.equals(target)).toBe(true);
    const beforeLeft = task.style.left;
    controls.camera.position.x += 5;
    controls.target.x += 5;
    frame(200);
    expect(task.style.left).not.toBe(beforeLeft);
    const pannedPosition = controls.camera.position.clone();
    const pannedTarget = controls.target.clone();
    app.root.querySelector('[aria-label="仕事の詳細を閉じる"]').click();
    frame(300);
    expect(task.hidden).toBe(true);
    expect(controls.camera.position.equals(pannedPosition)).toBe(true);
    expect(controls.target.equals(pannedTarget)).toBe(true);
    expect(app.selection.write).toHaveBeenLastCalledWith({ business: 'alpha', site: null });
  });

  it('handles one Escape per level and hides/reveals the selected bubble when panned offscreen', async () => {
    const app = await mount({ selected: { business: 'alpha', site: 'alpha-task' } });
    await waitFor(() => districtRenderer());
    frame();
    const controls = districtControls();
    const task = app.root.querySelector('.bb-world-canvas-task');
    expect(task.hidden).toBe(false);
    controls.camera.position.x += 1000;
    controls.target.x += 1000;
    frame(200);
    expect(task.hidden).toBe(true);
    controls.camera.position.x -= 1000;
    controls.target.x -= 1000;
    frame(300);
    expect(task.hidden).toBe(false);
    const canvas = districtRenderer().domElement;
    canvas.dispatch('keydown', { key: 'Escape' });
    expect(task.hidden).toBe(true);
    expect(canvas.hidden).toBe(false);
    expect(app.selection.write).toHaveBeenLastCalledWith({ business: 'alpha', site: null });
    canvas.dispatch('keydown', { key: 'Escape' });
    expect(canvas.hidden).toBe(true);
  });

  it('ignores a late previous-city read while keeping the new city and its actual lots', async () => {
    const pendingAlpha = defer();
    const app = await mount({ workFor: (code) => code === 'alpha' ? pendingAlpha.promise : makeWork(code) });
    app.selectCity('alpha');
    app.selectCity('beta');
    await waitFor(() => districtRenderer());
    frame();
    expect(lots().map((lot) => lot.userData.site.task_id)).toEqual(['beta-task']);
    pendingAlpha.resolve({ status: 'unavailable', reason: 'old_alpha_failure' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    frame(200);
    expect(lots().map((lot) => lot.userData.site.task_id)).toEqual(['beta-task']);
    expect(app.root.querySelector('.bb-world-canvas-city').value).toBe('beta');
    expect(app.root.querySelector('.bb-world-canvas-notes').textContent).not.toContain('old_alpha_failure');
    pickLot('beta-task');
    expect(app.root.querySelector('.bb-world-canvas-task').textContent).toContain('Task beta-task');
  });

  it('rebuilds failed district geometry after an explicit successful retry', async () => {
    let reads = 0;
    const app = await mount({ workFor: (code) => ++reads === 1 ? { status: 'unavailable', reason: 'retry_failure' } : makeWork(code) });
    app.selectCity('alpha');
    await waitFor(() => districtRenderer());
    frame();
    expect(lots()).toHaveLength(0);
    expect(districtRenderer().scene.fog.far).toBe(34);
    const controls = districtControls();
    controls.camera.position.x += 3;
    controls.target.x += 3;
    const position = controls.camera.position.clone();
    const retry = buttonsNamed(app.root, 'もう一度読む')[0];
    expect(retry).toBeDefined();
    retry.click();
    await waitFor(() => reads === 2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    frame(200);
    expect(lots().map((lot) => lot.userData.site.task_id)).toEqual(['alpha-task']);
    expect(districtRenderer().scene.fog.far).toBe(170);
    expect(controls.camera.position.equals(position)).toBe(true);
    expect(app.root.querySelector('.bb-world-canvas-notes').textContent).not.toContain('retry_failure');
    pickLot('alpha-task');
    expect(app.root.querySelector('.bb-world-canvas-task').hidden).toBe(false);
  });

  it('refreshes a selected task from fresh records without moving its panned camera', async () => {
    let reads = 0;
    const app = await mount({ selected: { business: 'alpha', site: 'alpha-task' }, workFor: (code) => {
      const work = makeWork(code);
      if (++reads > 1) work.sites[0].title = 'Updated task record';
      return work;
    } });
    await waitFor(() => districtRenderer());
    frame();
    const controls = districtControls();
    controls.camera.position.x += 4;
    controls.target.x += 4;
    frame(150);
    const position = controls.camera.position.clone();
    const target = controls.target.clone();
    app.doc.dispatch('visibilitychange');
    await waitFor(() => app.root.querySelector('.bb-world-canvas-task').textContent.includes('Updated task record'));
    frame(200);
    expect(app.root.querySelector('.bb-world-canvas-task').hidden).toBe(false);
    expect(lots()[0].userData.site.title).toBe('Updated task record');
    expect(controls.camera.position.equals(position)).toBe(true);
    expect(controls.target.equals(target)).toBe(true);
    expect(app.selection.write).toHaveBeenLastCalledWith({ business: 'alpha', site: 'alpha-task' });
  });

  it('keeps a restored cancelled task inspectable as a detached record across rendered frames', async () => {
    const app = await mount({ selected: { business: 'alpha', site: 'alpha-task' }, workFor: (code) => makeWork(code, [`${code}-task`], 'cancelled') });
    await waitFor(() => districtRenderer());
    const task = app.root.querySelector('.bb-world-canvas-task');
    expect(task.hidden).toBe(false);
    expect(task.classList.contains('is-unanchored')).toBe(true);
    expect(task.textContent).toContain('この仕事は地図上に描いていません');
    frame();
    expect(lots()).toHaveLength(0);
    expect(task.hidden).toBe(false);
    frame(200);
    expect(task.hidden).toBe(false);
  });

  it('does not render a late read after disposal', async () => {
    const pending = defer();
    const app = await mount({ workFor: () => pending.promise });
    app.selectCity('alpha');
    app.view.dispose();
    pending.resolve(makeWork('alpha'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    frame();
    expect(districtRenderer()).toBeUndefined();
    expect(app.root.querySelector('.bb-world-canvas-ui')).toBeNull();
    expect(runtime.renderers[0].dispose).toHaveBeenCalled();
  });
});

function stations() {
  const found = [];
  districtRenderer()?.scene?.traverse((object) => { if (object.userData.kind === 'exit') found.push(object); });
  return found;
}
const partsOf = (station) => {
  const names = new Set();
  station.traverse((object) => { if (object.userData.part) names.add(object.userData.part); });
  return names;
};
function pickStation(id) {
  const renderer = districtRenderer();
  const station = stations().find((entry) => entry.userData.exit.id === id);
  expect(station, `rendered station ${id}`).toBeDefined();
  const box = new THREE.Box3().setFromObject(station);
  const point = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y - 0.05, (box.min.z + box.max.z) / 2).project(renderer.camera);
  const rect = renderer.domElement.getBoundingClientRect();
  const event = { clientX: rect.left + (point.x + 1) * rect.width / 2, clientY: rect.top + (1 - point.y) * rect.height / 2 };
  renderer.domElement.dispatch('pointerdown', event);
  renderer.domElement.dispatch('pointerup', event);
}
/** Waits for a condition on the drawn scene, rendering a frame on each look (the scene is read from the last render). */
const whenRendered = (check) => waitFor(() => { frame(); return districtRenderer()?.scene && check(); });
const toolsFor = (code) => ({ status: 'complete', read_at: NOW.toISOString(), exits: [
  { id: `${code}-hq`, label: `${code} HQ`, href: 'https://hq.example.test', state: 'available', attention: { count: 3, label: '未対応', as_of: NOW.toISOString() } },
  { id: `${code}-drive`, label: `${code} Drive`, href: '/drive', state: 'restricted', attention: { label: '未読' } },
  { id: `${code}-repo`, label: `${code} repo`, href: 'https://repo.example.test', state: 'unknown' },
  { id: `${code}-old`, label: `${code} old`, href: 'https://old.example.test', state: 'unavailable' },
] });

describe('stations for the tools of a business (story-world-business-exits-v1 AC-07)', () => {
  it('stands one station per tool outside the gate, its look saying its state and its sign the count', async () => {
    const app = await mount({ businessExits: async (business) => toolsFor(business.code) });
    app.selectCity('alpha');
    await whenRendered(() => stations().length === 4);
    frame();
    const byId = new Map(stations().map((station) => [station.userData.exit.id, station]));
    expect(partsOf(byId.get('alpha-hq')).has('light')).toBe(true);
    expect(partsOf(byId.get('alpha-hq')).has('gate')).toBe(false);
    expect(partsOf(byId.get('alpha-drive')).has('gate')).toBe(true);
    expect(partsOf(byId.get('alpha-drive')).has('light')).toBe(false);
    for (const id of ['alpha-repo', 'alpha-old']) {
      expect(partsOf(byId.get(id)).has('fog')).toBe(true);
      expect(partsOf(byId.get(id)).has('light')).toBe(false);
    }
    // Outside the gate: in front of every lot of the district.
    const lotZ = Math.max(...lots().map((lot) => lot.position.z));
    for (const station of stations()) expect(station.position.z).toBeGreaterThan(lotZ);
    const signs = [...app.root.querySelectorAll('.bb-world-label.is-exit')].map((node) => node.textContent);
    expect(signs).toEqual(['駅：alpha HQ・3件', '駅：alpha Drive・件数未確認', '駅：alpha repo', '駅：alpha old']);
    const legend = app.root.querySelector('.bb-world-canvas-help-content').textContent;
    expect(legend).toContain('明かりのついた駅＝使える');
    expect(legend).toContain('改札が閉じた駅＝権限が必要');
    expect(legend).toContain('霧の駅＝未確認・読めない');
  });

  it('a picked station opens the city details with its tool selected, without leaving the world', async () => {
    const app = await mount({ businessExits: async (business) => toolsFor(business.code) });
    app.selectCity('alpha');
    await whenRendered(() => stations().length === 4);
    frame();
    const href = globalThis.location?.href;
    pickStation('alpha-drive');
    const drawer = app.root.querySelector('.bb-world-canvas-drawer');
    expect(drawer.classList.contains('is-open')).toBe(true);
    const selectedRow = app.root.querySelector('.bb-world-exit.is-selected');
    expect(selectedRow.getAttribute('data-exit-id')).toBe('alpha-drive');
    expect(selectedRow.getAttribute('aria-current')).toBe('true');
    expect(app.root.querySelector('.bb-world-canvas-task').hidden).toBe(true);
    expect(globalThis.location?.href).toBe(href);
    expect(app.selection.write).toHaveBeenLastCalledWith({ business: 'alpha', site: null });
    // From a task's details too: the task closes and the tool's row is selected.
    pickLot('alpha-task');
    expect(app.root.querySelector('.bb-world-canvas-task').hidden).toBe(false);
    pickStation('alpha-hq');
    expect(app.root.querySelector('.bb-world-canvas-task').hidden).toBe(true);
    expect(app.root.querySelector('.bb-world-exit.is-selected').getAttribute('data-exit-id')).toBe('alpha-hq');
  });

  it('keeps a late answer of the previous city out of the open district', async () => {
    const pendingAlpha = defer();
    const app = await mount({ businessExits: (business) => (business.code === 'alpha' ? pendingAlpha.promise : toolsFor('beta')) });
    app.selectCity('alpha');
    app.selectCity('beta');
    await whenRendered(() => stations().length === 4);
    pendingAlpha.resolve(toolsFor('alpha'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    frame(200);
    expect(stations().map((station) => station.userData.exit.id)).toEqual(['beta-hq', 'beta-drive', 'beta-repo', 'beta-old']);
    expect(app.root.querySelector('.bb-world-canvas-rail-body').textContent).not.toContain('alpha HQ');
  });

  it('puts the tools section in the host rail of the standard presentation, and a picked station selects its row there', async () => {
    const app = await mount({ presentation: 'standard', selected: { business: 'alpha' }, businessExits: async (business) => toolsFor(business.code) });
    await whenRendered(() => stations().length === 4);
    const section = () => app.rail.querySelector('section[aria-label="この事業の道具"]');
    expect(app.rail.children.at(-1)).toBe(section());
    expect(section().querySelectorAll('.bb-world-exit')).toHaveLength(4);
    pickStation('alpha-repo');
    expect(section().querySelector('.bb-world-exit.is-selected').getAttribute('data-exit-id')).toBe('alpha-repo');
    expect(app.root.querySelector('.bb-world-district-legend').textContent).toContain('霧の駅＝未確認・読めない');
  });

  it('draws no station and no yard without businessExits (AC-02)', async () => {
    const app = await mount();
    app.selectCity('alpha');
    await whenRendered(() => lots().length === 1);
    frame();
    expect(stations()).toHaveLength(0);
    expect(app.root.querySelectorAll('.bb-world-label.is-exit')).toHaveLength(0);
    expect(app.root.textContent).not.toContain('駅');
  });
});

describe('World production asset closure', () => {
  it('registers every local JS/CSS dependency of the served world modules', async () => {
    const files = new Set(createWorldExtension().uiFiles);
    for (const file of files) {
      if (!/\.(?:js|css)$/u.test(file) || file === 'world-vendor.js') continue;
      const source = await readFile(new URL(`../../ui/world/${file}`, import.meta.url), 'utf8');
      for (const [, imported] of source.matchAll(/(?:from\s*|import\s*|@import\s*)['"]\.\/([^'"]+)['"]/gu)) {
        expect(files.has(imported), `${file} imports unregistered ${imported}`).toBe(true);
      }
    }
  });
});
