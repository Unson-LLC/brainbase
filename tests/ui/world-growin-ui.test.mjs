/*
 * Growin (UR) UI requests for the standard (non-canvas) World view:
 *   RQ-003 (UR-003): the permanent legend/explanation folds into a "？" disclosure.
 *   RQ-006 (UR-006): the sky switch becomes an icon button, auto/day/dusk/night.
 * Most assertions run with WebGL unavailable and check DOM behaviour, not browser
 * visual QA. The district-aware block below mocks the WebGL vendor (as
 * world-clickable-honesty does) so a real scene and district exist, and the
 * placement of the new controls — which jsdom cannot measure — is covered by
 * asserting the classes are present and that the CSS file pins/sizes them.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../workspace-kit.js', () => import('../../ui/workspace-kit.js'));
const runtime = vi.hoisted(() => ({ doc: null, renderers: [], controls: [], frames: [], observers: [], districtSky: [], sceneSky: [] }));
vi.mock('../../ui/world/world-vendor.js', async () => {
  const three = await import('three');
  class Renderer {
    constructor() {
      this.domElement = runtime.doc.createElement('canvas');
      this.shadowMap = {};
      this.capabilities = { getMaxAnisotropy: () => 1 };
      this.dispose = vi.fn();
      // Tag each renderer so world-side and district-side writes can be told apart.
      // The whole-world scene and the district each build their own renderer; without
      // an id the shared mock funnels every exposure write into one array, and the
      // district's applySky() alone would satisfy a "the scene reacted" check.
      this.id = runtime.renderers.length;
      runtime.renderers.push(this);
      // The scene's setSky is internal, but applySky()'s only observable effect
      // on this side is the mode's exposure written onto the renderer. Record each
      // write with its renderer id so a header sky click can be checked against the
      // world's own renderer, the way runtime.districtSky checks the district.
      let exposure = 1;
      Object.defineProperty(this, 'toneMappingExposure', {
        get: () => exposure,
        set: (value) => { exposure = value; runtime.sceneSky.push({ id: this.id, value }); },
      });
    }
    setPixelRatio(value) { this.pixelRatio = value; }
    setSize(width, height) {
      const rect = this.domElement.parentNode.getBoundingClientRect();
      this.domElement.setRect({ left: rect.left, top: rect.top, width, height });
    }
    render(scene, camera) { scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); this.scene = scene; this.camera = camera; }
  }
  class Controls {
    constructor(camera, canvas) { this.camera = camera; this.canvas = canvas; this.target = new three.Vector3(); this.enabled = true; this.dispose = vi.fn(); runtime.controls.push(this); }
    update() { this.camera.lookAt(this.target); }
  }
  return { THREE: { ...three, WebGLRenderer: Renderer }, MapControls: Controls };
});
// Wrap the real district so its sky mode is observable (the scene's setSky is
// internal, but the header handler pushes the same value to both on one line).
vi.mock('../../ui/world/world-district.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    createDistrictView: (options) => {
      const view = mod.createDistrictView(options);
      return { ...view, setSky: (mode) => { runtime.districtSky.push(mode); return view.setSky(mode); } };
    },
  };
});
import { createWorldView } from '../../ui/world/world-view.js';
import { SKY_MODES } from '../../ui/world/world-canvas-ui.js';
import { skyAt } from '../../ui/world/world-placement.js';
import { projectWorldWork } from '../../src/world-extension.js';
import { FakeDocument, findAll, jsonResponse, waitFor } from './world-canvas-harness.mjs';

const businesses = ['alpha'].map((code) => ({ id: `id-${code}`, code, name: code, kind: null, status: 'active', purpose: null, summary: `${code} summary`, engagements: [], activity: { decisions: 0, window_days: 30 } }));
const businessPayload = { status: 'ok', businesses, unplaced: [], excluded: { inactive: 0 }, source: { authority: 'organization_graph', server: 'https://example.test' }, vocabulary: { kinds: [], statuses: [] } };
const response = (body, status = 200) => jsonResponse(status, body);

const activeViews = [];
afterEach(() => { activeViews.splice(0).forEach((view) => view.dispose()); vi.unstubAllGlobals(); });

function mountStandard() {
  const doc = new FakeDocument();
  const root = doc.createElement('main');
  const rail = doc.createElement('aside');
  doc.body.append(root, rail);
  const fetcher = async (path) => {
    if (path.endsWith('/businesses')) return response(businessPayload);
    if (path.endsWith('/organization-judgments')) return response({ status: 'unavailable', reason: 'judgment_journal_not_connected' });
    if (path.endsWith('/work-summary')) return response({ status: 'ok', as_of: '2026-10-09T06:00:00Z', businesses: {} });
    return response({ status: 'unavailable' });
  };
  const view = createWorldView({ root, rail, presentation: 'standard', document: doc, fetcher, selection: { read: () => ({}), write: () => {} } });
  activeViews.push(view);
  root.querySelector('.bb-world-stage')?.setRect?.({ width: 900, height: 600 });
  return { doc, root, view };
}

describe('RQ-003 / UR-003: the World legend is a closed "？" disclosure, not a permanent overlay', () => {
  it('starts closed with keyboard and aria-expanded wiring, and keeps the legend readable once opened', () => {
    const { root } = mountStandard();
    const toggle = root.querySelector('.bb-world-legend-toggle');
    const panel = root.querySelector('.bb-world-legend-panel');
    expect(toggle).not.toBeNull();
    expect(panel).not.toBeNull();
    // A native button, so Enter/Space activate it; state is exposed to assistive tech.
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.textContent).toBe('？');
    expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
    // The information is tucked away, not removed.
    expect(panel.textContent).toContain('任せている');
    expect(panel.textContent).toContain('赤い旗＝任せたのに訂正・取り消し');

    toggle.click();
    expect(panel.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('no longer renders the legend as a permanent sibling of the stage HUD', () => {
    const { root } = mountStandard();
    const stage = root.querySelector('.bb-world-stage');
    const legend = root.querySelector('.bb-world-legend');
    // The legend lives inside the collapsed panel, which is hidden by default.
    expect(legend).not.toBeNull();
    expect(root.querySelector('.bb-world-legend-panel').contains(legend)).toBe(true);
    expect(stage.children.some((child) => child.className === 'bb-world-legend')).toBe(false);
  });
});

describe('RQ-006 / UR-006: the sky switch is an icon button with auto/day/dusk/night', () => {
  it('reuses the canvas sky artwork and labels, cycling four modes without a text button', () => {
    const { root } = mountStandard();
    const sky = root.querySelector('.bb-world-sky');
    expect(sky).not.toBeNull();
    expect(sky.tagName).toBe('BUTTON');
    // The old plain-text "空：時刻" label is gone; meaning comes from aria-label/title + icon.
    expect(sky.textContent).not.toContain('空：時刻');
    expect(sky.querySelector('.bb-world-sky-icon')).not.toBeNull();
    expect(sky.getAttribute('aria-label')).toBe('空：自動（現在時刻）。次は昼');
    expect(sky.getAttribute('title')).toBe('空：自動（現在時刻）。次は昼');

    for (const [label, next] of [['昼', '夕方'], ['夕方', '夜'], ['夜', '自動（現在時刻）'], ['自動（現在時刻）', '昼']]) {
      sky.click();
      expect(sky.getAttribute('aria-label')).toBe(`空：${label}。次は${next}`);
      expect(sky.getAttribute('title')).toBe(`空：${label}。次は${next}`);
    }
  });
});

describe('RQ-151/152 placement: the new controls carry positionable classes and the CSS pins/sizes them', () => {
  // jsdom has no layout engine, so the overflow-clipped placement (the "？" button
  // hiding behind the full-height canvas) and the oversized bare SVG cannot be
  // measured here. Instead assert the controls carry the classes and that the CSS
  // file declares the position/size rules those classes rely on.
  const css = readFileSync(new URL('../../ui/world/world-view.css', import.meta.url), 'utf8');
  const rule = (selector) => css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*\\{([^}]*)\\}`, 'u'))?.[1] ?? '';

  it('places the "？" disclosure and panel out of the canvas flow (absolute, above the canvas)', () => {
    const { root } = mountStandard();
    const toggle = root.querySelector('.bb-world-legend-toggle');
    const panel = root.querySelector('.bb-world-legend-panel');
    expect(toggle.classList.contains('bb-world-legend-toggle')).toBe(true);
    expect(panel.classList.contains('bb-world-legend-panel')).toBe(true);
    // The toggle must be lifted out of normal flow or the full-height canvas buries it.
    expect(rule('.bb-world-legend-toggle')).toMatch(/position:\s*absolute/u);
    expect(rule('.bb-world-legend-toggle')).toMatch(/z-index/u);
    // The panel is an absolutely positioned, size-bounded overlay above the canvas.
    expect(rule('.bb-world-legend-panel')).toMatch(/position:\s*absolute/u);
    expect(rule('.bb-world-legend-panel')).toMatch(/z-index/u);
    expect(rule('.bb-world-legend-panel')).toMatch(/max-width|width/u);
  });

  it('sizes the header sky icon SVG so it does not balloon and break the header', () => {
    const { root } = mountStandard();
    const sky = root.querySelector('.bb-world-sky');
    const icon = sky.querySelector('.bb-world-sky-icon');
    expect(sky.classList.contains('bb-world-sky')).toBe(true);
    expect(icon.classList.contains('bb-world-sky-icon')).toBe(true);
    // innerHTML is a string in this harness (no parser), so check the SVG markup directly.
    expect(icon.innerHTML).toContain('<svg');
    // The canvas rule (.bb-world-canvas-sky-icon svg) does not reach this one, so the
    // non-canvas class needs its own explicit SVG size.
    expect(rule('.bb-world-sky-icon svg')).toMatch(/width/u);
    expect(rule('.bb-world-sky-icon svg')).toMatch(/height/u);
  });
});

describe('RQ-151/152 behaviour with a live scene and district (WebGL vendor mocked)', () => {
  beforeEach(() => {
    runtime.renderers = [];
    runtime.controls = [];
    runtime.frames = [];
    runtime.observers = [];
    runtime.districtSky = [];
    runtime.sceneSky = [];
    vi.stubGlobal('requestAnimationFrame', (callback) => { runtime.frames.push(callback); return runtime.frames.length; });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback; runtime.observers.push(this); }
      observe() {}
      disconnect() {}
    });
  });

  const NOW = new Date('2026-10-09T06:10:00Z');
  const complete = { state: 'complete', items: [] };
  const workFor = (business) => projectWorldWork({
    business,
    tasks: { state: 'complete', read_at: NOW.toISOString(), items: [
      { id: `task-${business.code}`, title: 'Actual task', status: 'in_progress', purpose_label: '現場', project_codes: [business.code], source_refs: [], created_at: NOW.toISOString() },
    ] },
    persons: complete, decisions: complete, relations: complete,
  }, { now: NOW });

  function frame(time = 100) { for (const callback of runtime.frames.splice(0)) callback(time); }

  async function mountWebgl() {
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
    const root = doc.createElement('main');
    const rail = doc.createElement('aside');
    doc.body.append(root, rail);
    const works = new Map(businesses.map((business) => [business.code, workFor(business)]));
    const fetcher = async (path) => {
      if (path.endsWith('/businesses')) return response(businessPayload);
      if (path.endsWith('/organization-judgments')) return response({ status: 'unavailable', reason: 'judgment_journal_not_connected' });
      if (path.endsWith('/work-summary')) return response({ status: 'ok', as_of: NOW.toISOString(), businesses: Object.fromEntries([...works].map(([code, work]) => [code, work.summary])) });
      const code = path.match(/\/businesses\/([^/]+)\/work$/u)?.[1];
      if (code) return response(works.get(code) ?? { status: 'unavailable' });
      return response({ status: 'unavailable' });
    };
    const view = createWorldView({ root, rail, presentation: 'standard', document: doc, fetcher, selection: { read: () => ({}), write: () => {} } });
    activeViews.push(view);
    root.querySelector('.bb-world-stage').setRect({ left: 0, top: 0, width: 900, height: 600 });
    await waitFor(() => runtime.renderers.length > 0);
    for (const observer of runtime.observers) observer.callback();
    frame();
    const enterButton = await waitFor(() => findAll(rail, (node) => node.tagName === 'BUTTON' && node.textContent.includes('の区画に入る'))[0]);
    return { doc, root, rail, view, enterButton };
  }

  it('keeps the "？" disclosure exactly as the viewer left it when entering and leaving a city', async () => {
    const app = await mountWebgl();
    const toggle = app.root.querySelector('.bb-world-legend-toggle');
    const panel = app.root.querySelector('.bb-world-legend-panel');
    toggle.click();
    expect(panel.hidden).toBe(false);
    // Enter the district: the old coupling that force-hid the legend on entry is gone.
    app.enterButton.click();
    await waitFor(() => app.root.querySelector('.bb-world-district-canvas'));
    expect(panel.hidden).toBe(false);
    // Leave back to the whole world: nothing reopens or re-hides the disclosure either.
    findAll(app.root, (node) => node.tagName === 'BUTTON' && node.textContent === '全体に戻る')[0].click();
    expect(panel.hidden).toBe(false);
  });

  it('leaves the "？" disclosure closed when the viewer never opened it, through entering and leaving a city', async () => {
    const app = await mountWebgl();
    const toggle = app.root.querySelector('.bb-world-legend-toggle');
    const panel = app.root.querySelector('.bb-world-legend-panel');
    // Untouched: the disclosure starts closed and nothing should open it on its own.
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Enter the district: the removed coupling must not open the legend either.
    app.enterButton.click();
    await waitFor(() => app.root.querySelector('.bb-world-district-canvas'));
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Leave back to the whole world: still closed, aria state in step with it.
    findAll(app.root, (node) => node.tagName === 'BUTTON' && node.textContent === '全体に戻る')[0].click();
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('cycling the header sky icon reaches the open district (and the scene with it)', async () => {
    const app = await mountWebgl();
    // The whole-world scene's renderer, built at mount before any district exists.
    const worldRenderer = runtime.renderers[0];
    app.enterButton.click();
    await waitFor(() => app.root.querySelector('.bb-world-district-canvas'));
    const sky = app.root.querySelector('.bb-world-sky');
    const before = runtime.districtSky.length;
    const beforeScene = runtime.sceneSky.length;
    // One click advances auto → day; the handler pushes that value to scene and district together.
    sky.click();
    expect(runtime.districtSky.slice(before)).toContain(SKY_MODES[1].value);
    // The world's own renderer — not the district's — must receive the day sky's exposure, proving the
    // header's scene?.setSky(...) line ran. Drop that line and only district writes land here, so it fails.
    const worldWrites = runtime.sceneSky.slice(beforeScene).filter((entry) => entry.id === worldRenderer.id);
    expect(worldWrites.map((entry) => entry.value)).toContain(skyAt(0, SKY_MODES[1].value).exposure);
    expect(sky.getAttribute('aria-label')).toContain(SKY_MODES[1].label);
  });
});
