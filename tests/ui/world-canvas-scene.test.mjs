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
async function mount({ workFor = (code) => makeWork(code), selected = {} } = {}) {
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
  const view = createWorldView({ root, document: doc, fetcher, selection, presentation: 'canvas' });
  mounted.push(view);
  const stage = root.querySelector('.bb-world-stage');
  stage.setRect({ left: 50, top: 60, width: 960, height: 640 });
  await waitFor(() => runtime.renderers.length > 0 && root.querySelector('.bb-world-canvas-city').children.length === 3);
  for (const observer of runtime.observers) observer.callback();
  frame();
  return {
    root, stage, doc, view, selection, requests,
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
