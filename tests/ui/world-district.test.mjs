import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeElement, findAll } from './graph-ui-harness.mjs';
import { projectWorldWork } from '../../src/world-extension.js';

vi.mock('../../workspace-kit.js', () => import('../../ui/workspace-kit.js'));
const runtime = vi.hoisted(() => ({ renderer: null, controls: null, frames: [], resize: null }));
vi.mock('../../ui/world/world-vendor.js', async () => {
  const three = await import('three');
  class Renderer {
    constructor() {
      this.domElement = new SceneElement('canvas');
      this.shadowMap = {};
      this.capabilities = { getMaxAnisotropy: () => 1 };
      this.dispose = vi.fn();
      runtime.renderer = this;
    }
    setPixelRatio(value) { this.pixelRatio = value; }
    setSize(width, height) { this.size = { width, height }; }
    render(scene, camera) {
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      this.scene = scene;
      this.camera = camera;
    }
  }
  class Controls {
    constructor(camera) {
      this.camera = camera;
      this.target = new three.Vector3();
      this.enabled = true;
      this.dispose = vi.fn();
      runtime.controls = this;
    }
    update() { this.camera.lookAt(this.target); }
  }
  return { THREE: { ...three, WebGLRenderer: Renderer }, MapControls: Controls };
});
import { THREE } from '../../ui/world/world-vendor.js';
import { createDistrictView, projectDistrictSelection } from '../../ui/world/world-district.js';

class SceneElement extends FakeElement {
  constructor(tag) {
    super(tag);
    this.style = {};
    this.offsetWidth = 90;
    this.offsetHeight = 20;
    this.classList = { toggle: () => {} };
  }
  prepend(child) { child.parentNode = this; this.children.unshift(child); }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  focus() {}
  getBoundingClientRect() { return this.rect ?? this.parentNode?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 }; }
  getContext() {
    return new Proxy({ createLinearGradient: () => ({ addColorStop() {} }) }, {
      get: (target, property) => target[property] ?? (() => {}),
    });
  }
}

const business = { id: 'sample', code: 'sample', name: 'Sample' };
const makeWork = (ids = ['work-a', 'work-b']) => projectWorldWork({
  business,
  tasks: { state: 'complete', items: ids.map((id) => ({ id, title: id, status: 'pending', project_codes: ['sample'], source_refs: [], created_at: '2026-10-01T00:00:00.000Z' })) },
  persons: { state: 'complete', items: [] },
  decisions: { state: 'complete', items: [] },
  relations: { state: 'complete', items: [] },
}, { now: new Date('2026-10-09T00:00:00.000Z') });

function harness(options = {}) {
  const doc = { createElement: (tag) => new SceneElement(tag) };
  const stage = new SceneElement('div');
  stage.rect = { left: 50, top: 80, width: 800, height: 600 };
  const onProjectSelection = vi.fn();
  const view = createDistrictView({ doc, stage, reducedMotion: true, onProjectSelection, ...options });
  return { view, stage, onProjectSelection, camera: runtime.controls.camera, controls: runtime.controls };
}

function frame(time = 100) {
  const callbacks = runtime.frames.splice(0);
  for (const callback of callbacks) callback(time);
}

beforeEach(() => {
  runtime.frames = [];
  vi.stubGlobal('devicePixelRatio', 2);
  vi.stubGlobal('requestAnimationFrame', (callback) => { runtime.frames.push(callback); return runtime.frames.length; });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { runtime.resize = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('district selection projection', () => {
  const viewport = { width: 800, height: 400, left: 130, top: 250 };
  const stage = { width: 1000, height: 700, left: 100, top: 200 };
  function project(anchor, options = {}) {
    const camera = new THREE.PerspectiveCamera(90, 2, 1, 100);
    return projectDistrictSelection({ taskId: 'work-a', anchor: new THREE.Vector3(...anchor), camera, viewport, stage, ...options });
  }

  it('uses CSS viewport size and its stage-local offset instead of pixel ratio or page coordinates', () => {
    expect(project([0, 0, -10])).toEqual({ taskId: 'work-a', x: 430, y: 250, visible: true });
    expect(project([5, 5, -10])).toMatchObject({ taskId: 'work-a', visible: true });
    expect(project([5, 5, -10]).x).toBeCloseTo(530);
    expect(project([5, 5, -10]).y).toBeCloseTo(150);
  });

  it.each([
    ['behind the camera', [0, 0, 10]],
    ['in front of the near plane', [0, 0, -0.5]],
    ['beyond the far plane', [0, 0, -101]],
    ['left of the viewport', [-30, 0, -10]],
    ['right of the viewport', [30, 0, -10]],
    ['above the viewport', [0, 20, -10]],
    ['below the viewport', [0, -20, -10]],
    ['on the camera plane', [0, 0, 0]],
  ])('hides an anchor %s', (_, anchor) => {
    expect(project(anchor)).toMatchObject({ taskId: 'work-a', visible: false });
  });

  it('hides zero-sized, explicitly hidden, or stage-clipped anchors and clears without stale coordinates', () => {
    expect(project([0, 0, -10], { viewport: { ...viewport, width: 0 } }).visible).toBe(false);
    expect(project([0, 0, -10], { visible: false }).visible).toBe(false);
    expect(project([0, 0, -10], { stage: { ...stage, width: 100 } }).visible).toBe(false);
    expect(project([0, 0, -10], { taskId: null })).toEqual({ taskId: null, x: null, y: null, visible: false });
  });

  it('updates the camera matrix before projecting after pan and rotation', () => {
    const camera = new THREE.PerspectiveCamera(90, 2, 1, 100);
    camera.position.set(10, 0, 0);
    expect(project([0, 0, -10], { camera }).x).toBeCloseTo(230);
    camera.lookAt(0, 0, -10);
    expect(project([0, 0, -10], { camera }).x).toBeCloseTo(430);
  });

  it('uses the current projection matrix after zoom', () => {
    const camera = new THREE.PerspectiveCamera(90, 2, 1, 100);
    const before = project([5, 0, -10], { camera });
    camera.zoom = 2;
    camera.updateProjectionMatrix();
    expect(project([5, 0, -10], { camera }).x - 430).toBeCloseTo((before.x - 430) * 2);
  });
});

describe('district host presentation contract', () => {
  it('keeps the camera on select and clear when focusing is disabled, with immediate callbacks', () => {
    const { view, camera, controls, onProjectSelection } = harness({ focusSelection: false });
    view.show(business, makeWork());
    const position = camera.position.clone();
    const target = controls.target.clone();
    onProjectSelection.mockClear();
    expect(view.select('work-a')).toBe(true);
    expect(onProjectSelection).toHaveBeenCalledTimes(1);
    expect(onProjectSelection.mock.lastCall[0]).toMatchObject({ taskId: 'work-a', visible: true });
    expect(camera.position.equals(position)).toBe(true);
    expect(controls.target.equals(target)).toBe(true);
    view.clearSelection();
    expect(onProjectSelection.mock.lastCall[0]).toEqual({ taskId: null, x: null, y: null, visible: false });
    frame();
    expect(camera.position.equals(position)).toBe(true);
    expect(controls.target.equals(target)).toBe(true);
    view.dispose();
  });

  it('retains default fly-to-selection behavior', () => {
    const { view, camera, controls } = harness();
    view.show(business, makeWork());
    const position = camera.position.clone();
    const target = controls.target.clone();
    view.select('work-a');
    expect(camera.position.equals(position)).toBe(false);
    expect(controls.target.equals(target)).toBe(false);
    view.dispose();
  });

  it('reprojects every rendered frame, on resize, and immediately on hide and disposal', () => {
    const { view, camera, controls, stage, onProjectSelection } = harness({ focusSelection: false });
    view.show(business, makeWork());
    view.select('work-a');
    frame();
    const before = onProjectSelection.mock.lastCall[0];
    camera.position.x += 5;
    controls.target.x += 5;
    const calls = onProjectSelection.mock.calls.length;
    frame(200);
    expect(onProjectSelection).toHaveBeenCalledTimes(calls + 1);
    expect(onProjectSelection.mock.lastCall[0].x).not.toBe(before.x);
    stage.rect.width = 1200;
    runtime.resize();
    expect(camera.aspect).toBe(2);
    expect(onProjectSelection.mock.lastCall[0].taskId).toBe('work-a');
    controls.target.x += 1000;
    camera.position.x += 1000;
    frame(300);
    expect(onProjectSelection.mock.lastCall[0].visible).toBe(false);
    view.hide();
    expect(onProjectSelection.mock.lastCall[0]).toMatchObject({ taskId: 'work-a', visible: false });
    const hiddenCalls = onProjectSelection.mock.calls.length;
    frame(400);
    expect(onProjectSelection).toHaveBeenCalledTimes(hiddenCalls);
    view.dispose();
    expect(onProjectSelection.mock.lastCall[0].visible).toBe(false);
  });

  it('preserves the selected task and panned camera on refresh, clearing a removed task', () => {
    const { view, camera, controls, onProjectSelection } = harness({ focusSelection: false });
    view.show(business, makeWork());
    view.select('work-a');
    camera.position.x += 3;
    controls.target.x += 3;
    const position = camera.position.clone();
    const target = controls.target.clone();
    view.refresh(business, makeWork(['work-a', 'work-b', 'work-c']));
    expect(onProjectSelection.mock.lastCall[0]).toMatchObject({ taskId: 'work-a', visible: true });
    frame();
    expect(camera.position.equals(position)).toBe(true);
    expect(controls.target.equals(target)).toBe(true);
    view.refresh(business, makeWork(['work-b']));
    expect(onProjectSelection.mock.lastCall[0]).toEqual({ taskId: null, x: null, y: null, visible: false });
    expect(camera.position.equals(position)).toBe(true);
    view.dispose();
  });

  it('stops an old flight on refresh so later frames cannot move the preserved camera', () => {
    const { view, camera, controls, onProjectSelection } = harness({ reducedMotion: false });
    view.show(business, makeWork());
    frame(0);
    frame(1300);
    view.select('work-a');
    frame(1400);
    frame(1700);
    const position = camera.position.clone();
    const target = controls.target.clone();
    view.refresh(business, makeWork());
    frame(3000);
    expect(camera.position.equals(position)).toBe(true);
    expect(controls.target.equals(target)).toBe(true);
    expect(controls.enabled).toBe(true);
    expect(onProjectSelection.mock.lastCall[0]).toMatchObject({ taskId: 'work-a', visible: true });
    view.dispose();
  });

  it('keeps legacy warning and legend chrome by default and relocates it only by explicit opt-in', () => {
    const failed = { status: 'unavailable', reason: 'upstream_timeout' };
    for (const showChrome of [true, false]) {
      const { view, stage } = harness({ showChrome });
      view.show(business, failed);
      const legend = findAll(stage, (node) => node.className === 'bb-world-district-legend')[0];
      const notice = findAll(stage, (node) => node.className === 'bb-world-district-notice')[0];
      expect(legend.hidden).toBe(!showChrome);
      expect(notice.hidden).toBe(!showChrome);
      expect(notice.textContent).toContain('upstream_timeout');
      expect(notice.textContent).toContain('仕事が0件という意味ではありません');
      view.refresh(business, makeWork());
      expect(notice.hidden).toBe(true);
      view.hide();
      expect(legend.hidden).toBe(true);
      view.dispose();
    }
  });

  it('handles Escape once, leaving an already-handled capture event alone', () => {
    const onEscape = vi.fn();
    const { view } = harness({ onEscape });
    const canvas = runtime.renderer.domElement;
    const preventDefault = vi.fn();
    canvas.dispatch('keydown', { key: 'Escape', defaultPrevented: true, preventDefault });
    expect(onEscape).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    canvas.dispatch('keydown', { key: 'Escape', defaultPrevented: false, preventDefault });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    view.dispose();
  });
});
