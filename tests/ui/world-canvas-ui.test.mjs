import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createWorldCanvasUI } from '../../ui/world/world-canvas-ui.js';
import { FakeDocument, collectText } from './world-canvas-harness.mjs';

const mounted = [];
function mount({ width = 1200, height = 740, reducedMotion = false } = {}) {
  const doc = new FakeDocument();
  const stage = doc.createElement('div').setRect({ width, height });
  const canvas = doc.createElement('canvas');
  canvas.setAttribute('tabindex', '0');
  stage.append(canvas);
  doc.body.append(stage);
  const callbacks = { onReset: vi.fn(), onCity: vi.fn(), onSky: vi.fn(), onDismissTask: vi.fn() };
  const ui = createWorldCanvasUI({ doc, stage, reducedMotion, ...callbacks });
  const find = (part) => stage.querySelector(`.bb-world-canvas-${part}`);
  const toolbar = find('toolbar');
  toolbar.setRect({ left: width - Math.min(360, width - 24), top: width <= 460 ? 12 : 16, width: Math.min(360, width - 24), height: width <= 460 ? 36 : 40 });
  const node = (tag, text) => { const element = doc.createElement(tag); element.textContent = text; return element; };
  const result = { doc, stage, canvas, ui, find, node, ...callbacks };
  mounted.push(result);
  return result;
}
afterEach(() => {
  mounted.splice(0).forEach(({ ui }) => ui.dispose());
  vi.useRealTimers();
});

function opened(node) { return node.getAttribute('aria-hidden') === 'false' && !node.hidden; }

describe('canvas controls: host-owned business and sky state', () => {
  it('uses only supplied businesses; programmatic setters have no callbacks or persistence', () => {
    const { ui, find, onCity, onReset, onSky } = mount();
    expect(find('city').disabled).toBe(true);
    ui.setCities([{ code: 'alpha', name: '実際の事業' }, { code: 'beta', name: '第二事業' }, { code: 'alpha', name: '重複' }], 'beta');
    expect(find('city').children.map((item) => item.value)).toEqual(['', 'alpha', 'beta']);
    expect(find('city').value).toBe('beta');
    expect(collectText(find('city'))).toContain('実際の事業');
    ui.setCity('alpha');
    ui.setSky('night');
    expect(onCity).not.toHaveBeenCalled();
    expect(onSky).not.toHaveBeenCalled();
    find('city').value = 'alpha';
    find('city').dispatch('change');
    expect(onCity).toHaveBeenCalledExactlyOnceWith('alpha');
    find('city').value = 'invented';
    find('city').dispatch('change');
    expect(onCity).toHaveBeenCalledTimes(1);
    find('reset').click();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onCity).toHaveBeenCalledTimes(1);
  });

  it('makes all four sky modes reachable by keyboard with checked state and icon labels', () => {
    const { ui, doc, find, onSky } = mount();
    const sky = find('sky');
    sky.focus();
    sky.dispatch('keydown', { key: 'ArrowDown' });
    const options = find('sky-menu').children;
    expect(doc.activeElement).toBe(options[0]);
    expect(sky.getAttribute('aria-expanded')).toBe('true');
    options[0].dispatch('keydown', { key: 'End' });
    expect(doc.activeElement).toBe(options[3]);
    options[3].click();
    expect(onSky).toHaveBeenCalledExactlyOnceWith('night');
    expect(sky.getAttribute('aria-label')).toBe('空：夜');
    expect(find('sky-menu').hidden).toBe(true);
    expect(doc.activeElement).toBe(sky);
    expect(options.map((option) => option.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true']);
    ui.setSky('unknown');
    expect(sky.getAttribute('aria-label')).toBe('空：夜');
  });
});

describe('city drawer: pointer, keyboard, touch and cancellation', () => {
  it('reveals on edge hover without stealing focus and retains it across the inset gap', () => {
    vi.useFakeTimers();
    const { ui, doc, canvas, find, node, onCity, onReset } = mount();
    const content = node('p', '出典・時点・未接続・確認先まで全件');
    ui.showRail([content]);
    expect(opened(find('drawer'))).toBe(false);
    canvas.focus();
    find('edge').dispatch('pointerenter', { pointerType: 'mouse' });
    expect(opened(find('drawer'))).toBe(true);
    expect(doc.activeElement).toBe(canvas);
    expect(find('rail-body').children[0]).toBe(content);
    find('edge').dispatch('pointerleave', { relatedTarget: canvas });
    vi.advanceTimersByTime(120);
    expect(opened(find('drawer'))).toBe(true);
    find('drawer').dispatch('pointerenter', { pointerType: 'mouse' });
    vi.advanceTimersByTime(300);
    expect(opened(find('drawer'))).toBe(true);
    find('drawer').dispatch('pointerleave', { relatedTarget: canvas });
    vi.advanceTimersByTime(221);
    expect(opened(find('drawer'))).toBe(false);
    expect(onCity).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
  });

  it('moving directly between the edge and panel never starts a close timer', () => {
    vi.useFakeTimers();
    const { find } = mount();
    find('edge').dispatch('pointerenter', { pointerType: 'mouse' });
    find('edge').dispatch('pointerleave', { relatedTarget: find('drawer') });
    vi.advanceTimersByTime(500);
    expect(opened(find('drawer'))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps keyboard focus in the drawer, restores the edge on close and does not reopen it', () => {
    vi.useFakeTimers();
    const { ui, doc, find, node, canvas } = mount();
    const heading = node('h2', '正本の都市名');
    const link = node('a', '実際の確認先');
    ui.showRail([heading, link]);
    const edge = find('edge');
    edge.focus();
    expect(opened(find('drawer'))).toBe(true);
    expect(doc.activeElement).toBe(edge);
    edge.click();
    expect(doc.activeElement).toBe(heading);
    link.focus();
    find('drawer').dispatch('pointerleave', { relatedTarget: canvas });
    vi.advanceTimersByTime(500);
    expect(opened(find('drawer'))).toBe(true);
    find('drawer').querySelector('.bb-world-canvas-close').click();
    expect(doc.activeElement).toBe(edge);
    expect(opened(find('drawer'))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(500);
    expect(opened(find('drawer'))).toBe(false);
  });

  it('supports touch via the same edge button while touch pointerenter alone does nothing', () => {
    const { find, doc } = mount({ width: 375 });
    find('edge').dispatch('pointerenter', { pointerType: 'touch' });
    expect(opened(find('drawer'))).toBe(false);
    find('edge').click();
    expect(opened(find('drawer'))).toBe(true);
    expect(doc.activeElement).toBe(find('drawer').querySelector('h2'));
  });

  it('explicit dismissal cancels delayed hover close; a later hover begins a fresh lifecycle', () => {
    vi.useFakeTimers();
    const { ui, find, canvas } = mount();
    find('edge').dispatch('pointerenter', { pointerType: 'mouse' });
    find('edge').dispatch('pointerleave', { relatedTarget: canvas });
    expect(vi.getTimerCount()).toBe(1);
    expect(ui.dismissOverlay()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    find('edge').dispatch('pointerenter', { pointerType: 'mouse' });
    vi.advanceTimersByTime(500);
    expect(opened(find('drawer'))).toBe(true);
  });
});

describe('anchored task bubble: full details, visibility and geometry', () => {
  it('retains full host nodes and callbacks without moving focus on selection or updates', () => {
    const { ui, doc, canvas, find, node, onDismissTask } = mount();
    const details = node('details', '省略せずに残す原文・出典・確認時点・次の確認先');
    const link = node('a', 'タスクの記録を開く');
    const visit = vi.fn();
    link.addEventListener('click', visit);
    canvas.focus();
    ui.setTaskAnchor({ x: 600, y: 450, visible: true });
    ui.showTask([details, link]);
    expect(opened(find('task'))).toBe(true);
    expect(find('task-body').children).toEqual([details, link]);
    expect(doc.activeElement).toBe(canvas);
    link.click();
    expect(visit).toHaveBeenCalledTimes(1);
    ui.showTask([node('h2', '更新された同じタスク'), details, link]);
    expect(doc.activeElement).toBe(canvas);
    expect(onDismissTask).not.toHaveBeenCalled();
    ui.closeTask();
    expect(find('task').hidden).toBe(true);
    expect(onDismissTask).not.toHaveBeenCalled();
  });

  it.each([
    { width: 375, height: 640, x: 3, y: 95 },
    { width: 320, height: 420, x: 318, y: 415 },
    { width: 1440, height: 820, x: 1438, y: 818 },
    { width: 375, height: 230, x: 180, y: 115 },
  ])('keeps a long bubble within $width × $height and below the toolbar', ({ width, height, x, y }) => {
    const { ui, find, node } = mount({ width, height });
    const task = find('task');
    task.offsetHeight = 800;
    ui.setTaskAnchor({ x, y, visible: true });
    ui.showTask([node('p', 'actual full details '.repeat(200))]);
    const left = parseFloat(task.style.left);
    const top = parseFloat(task.style.top);
    const panelWidth = parseFloat(task.style.width);
    const panelHeight = parseFloat(task.style.maxHeight);
    expect(left).toBeGreaterThanOrEqual(10);
    expect(top).toBeGreaterThanOrEqual(width <= 460 ? 60 : 68);
    expect(left + panelWidth).toBeLessThanOrEqual(width - 10);
    expect(top + panelHeight).toBeLessThanOrEqual(height - 10);
    expect(collectText(find('task-body'))).toContain('actual full details '.repeat(200));
  });

  it('hides an offscreen or behind-camera anchor and reveals retained content on return', () => {
    const { ui, find, node, doc, canvas, onDismissTask } = mount();
    canvas.focus();
    const content = node('h2', '選択中の実タスク');
    ui.setTaskAnchor({ x: 400, y: 300, visible: true });
    ui.showTask([content]);
    for (const anchor of [{ x: -1, y: 20, visible: true }, { x: 20, y: 20, visible: false }, { x: 20, y: Number.NaN, visible: true }]) {
      ui.setTaskAnchor(anchor);
      expect(find('task').hidden).toBe(true);
      expect(ui.dismissOverlay()).toBe(false);
      expect(doc.activeElement).toBe(canvas);
    }
    ui.setTaskAnchor({ x: 400, y: 300, visible: true });
    expect(find('task').hidden).toBe(false);
    expect(find('task-body').children[0]).toBe(content);
    expect(onDismissTask).not.toHaveBeenCalled();
  });

  it('restores focus only when focused details are closed or hidden', () => {
    const { ui, find, node, canvas, doc, onDismissTask } = mount();
    ui.setTaskAnchor({ x: 400, y: 300, visible: true });
    const title = node('h2', '選択中');
    ui.showTask([title], { focus: true });
    expect(doc.activeElement).toBe(title);
    ui.setTaskAnchor({ x: 400, y: 300, visible: false });
    expect(doc.activeElement).toBe(canvas);
    ui.setTaskAnchor({ x: 400, y: 300, visible: true });
    ui.showTask([title], { focus: true });
    ui.closeTask();
    expect(doc.activeElement).toBe(canvas);
    expect(onDismissTask).not.toHaveBeenCalled();
    ui.showTask([title], { focus: true });
    find('task').querySelector('.bb-world-canvas-close').click();
    expect(doc.activeElement).toBe(canvas);
    expect(onDismissTask).toHaveBeenCalledTimes(1);
  });

  it('preserves equivalent control focus and scroll on a focused task refresh', () => {
    const { ui, find, node, doc } = mount();
    ui.setTaskAnchor({ x: 400, y: 400, visible: true });
    const originalLink = node('a', '確認先');
    originalLink.setAttribute('href', '/tasks/actual');
    ui.showTask([node('h2', '元の見出し'), originalLink]);
    originalLink.focus();
    find('task-body').scrollTop = 180;
    const nextLink = node('a', '確認先（更新）');
    nextLink.setAttribute('href', '/tasks/actual');
    ui.showTask([node('h2', '最新の見出し'), nextLink]);
    expect(doc.activeElement).toBe(nextLink);
    expect(find('task-body').scrollTop).toBe(180);
    const title = node('h2', '確認先がなくなった最新の詳細');
    ui.showTask([title]);
    expect(doc.activeElement).toBe(title);
    expect(find('task-body').scrollTop).toBe(180);
  });

  it('retains drawer focus and scroll when full source details refresh', () => {
    const { ui, find, node, doc } = mount();
    const original = node('button', '実際の要確認項目');
    ui.showRail([node('h2', '都市'), original]);
    find('edge').click();
    original.focus();
    find('rail-body').scrollTop = 90;
    const updated = node('button', '実際の要確認項目');
    ui.showRail([node('h2', '最新の都市'), updated]);
    expect(doc.activeElement).toBe(updated);
    expect(find('rail-body').scrollTop).toBe(90);
  });

  it('omits the object pointer only for an explicitly unanchored real record', () => {
    const { ui, find, node } = mount();
    ui.setTaskAnchor({ x: 500, y: 350, visible: true, unanchored: true });
    ui.showTask([node('p', 'この仕事は地図上に描いていません')]);
    expect(find('task').classList.contains('is-unanchored')).toBe(true);
    expect(find('task').hidden).toBe(false);
    ui.setTaskAnchor({ x: 500, y: 350, visible: true });
    expect(find('task').classList.contains('is-unanchored')).toBe(false);
  });

  it('repositions on stage resize and never places a panel at invalid coordinates', () => {
    const { ui, doc, stage, find, node } = mount();
    ui.setTaskAnchor({ x: 200, y: 300, visible: true });
    ui.showTask([node('p', '詳細')]);
    stage.setRect({ width: 320, height: 500 });
    find('toolbar').setRect({ left: 24, top: 12, width: 296, height: 36 });
    doc.defaultView.dispatch('resize');
    expect(parseFloat(find('task').style.width)).toBe(300);
    expect(parseFloat(find('task').style.left)).toBe(10);
    stage.setRect({ width: 0, height: 0 });
    doc.defaultView.dispatch('resize');
    expect(find('task').hidden).toBe(true);
  });
});

describe('warnings, help and one-overlay Escape ownership', () => {
  it('shows only explicit warning summaries as quests, keeping all long notes in help', () => {
    const { ui, find, node } = mount();
    const legend = node('section', '実線＝記録された関係・破線＝推定');
    ui.setHelp([legend]);
    ui.addNote({ label: '出典', text: '長い説明は確認のために全体を残します。'.repeat(100), tone: 'warning' });
    expect(find('quests').children).toHaveLength(0);
    ui.addNote({ label: '読み取り', text: '権限により読めなかった項目があります。0件ではありません。', tone: 'warning', summary: '仕事の一部を読めません' });
    ui.addNote({ summary: '出典を確認してください' });
    expect(find('quests').children).toHaveLength(2);
    expect(find('quests').querySelectorAll('button')).toHaveLength(0);
    expect(collectText(find('quests'))).not.toContain('長い説明');
    expect(collectText(find('notes'))).toContain('長い説明は確認のために全体を残します。'.repeat(100));
    expect(collectText(find('notes'))).toContain('出典を確認してください');
    find('help-button').click();
    expect(opened(find('help'))).toBe(true);
    expect(find('help-content').children[0]).toBe(legend);
    ui.clearNotes();
    expect(find('quests').children).toHaveLength(0);
    expect(find('notes').children).toHaveLength(0);
    expect(find('help-content').children[0]).toBe(legend);
  });

  it('dismisses only the uppermost open overlay without camera or selection callbacks', () => {
    const { ui, find, node, onReset, onCity, onDismissTask } = mount();
    find('edge').dispatch('pointerenter', { pointerType: 'mouse' });
    ui.setTaskAnchor({ x: 600, y: 400, visible: true });
    ui.showTask([node('h2', '実タスク')]);
    find('help-button').click();
    find('sky').click();
    expect(ui.dismissOverlay()).toBe(true);
    expect(find('sky-menu').hidden).toBe(true);
    expect(opened(find('help'))).toBe(true);
    expect(ui.dismissOverlay()).toBe(true);
    expect(opened(find('help'))).toBe(false);
    expect(opened(find('task'))).toBe(true);
    expect(ui.dismissOverlay()).toBe(true);
    expect(onDismissTask).toHaveBeenCalledTimes(1);
    expect(opened(find('drawer'))).toBe(true);
    expect(ui.dismissOverlay()).toBe(true);
    expect(opened(find('drawer'))).toBe(false);
    expect(ui.dismissOverlay()).toBe(false);
    expect(onCity).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
  });

  it('stops an internally handled Escape before a canvas bubbling handler can go up', () => {
    const { stage, find, ui } = mount();
    const goUp = vi.fn();
    stage.addEventListener('keydown', goUp);
    find('help-button').click();
    const event = find('help').dispatch('keydown', { key: 'Escape' });
    expect(event.defaultPrevented).toBe(true);
    expect(goUp).not.toHaveBeenCalled();
    expect(ui.dismissOverlay()).toBe(false);
  });

  it('is compatible with a host capture Escape handler and dismisses just once', () => {
    const { stage, find, ui } = mount();
    const goUp = vi.fn();
    stage.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!ui.dismissOverlay()) goUp();
    }, true);
    find('edge').dispatch('pointerenter', { pointerType: 'mouse' });
    find('help-button').click();
    find('help').dispatch('keydown', { key: 'Escape' });
    expect(opened(find('help'))).toBe(false);
    expect(opened(find('drawer'))).toBe(true);
    expect(goUp).not.toHaveBeenCalled();
  });

  it('reset closes overlays but leaves city selection to the host', () => {
    const { ui, find, node, onReset, onCity, onDismissTask } = mount();
    ui.setCities([{ code: 'actual', name: '都市' }], 'actual');
    ui.setTaskAnchor({ x: 500, y: 400, visible: true });
    ui.showTask([node('p', '実タスク')]);
    find('edge').dispatch('pointerenter', { pointerType: 'mouse' });
    find('help-button').click();
    find('reset').click();
    expect(ui.dismissOverlay()).toBe(false);
    expect(find('city').value).toBe('actual');
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onCity).not.toHaveBeenCalled();
    expect(onDismissTask).not.toHaveBeenCalled();
  });

  it('dispose removes all listeners and pending close timers without late callbacks', () => {
    vi.useFakeTimers();
    const { ui, stage, doc, find, onReset, onCity, onDismissTask, canvas } = mount();
    const edge = find('edge');
    const reset = find('reset');
    edge.dispatch('pointerenter', { pointerType: 'mouse' });
    edge.dispatch('pointerleave', { relatedTarget: canvas });
    expect(vi.getTimerCount()).toBe(1);
    ui.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(stage.querySelector('.bb-world-canvas-ui')).toBeNull();
    reset.click();
    edge.dispatch('pointerenter', { pointerType: 'mouse' });
    doc.defaultView.dispatch('resize');
    vi.advanceTimersByTime(1000);
    expect(onReset).not.toHaveBeenCalled();
    expect(onCity).not.toHaveBeenCalled();
    expect(onDismissTask).not.toHaveBeenCalled();
    expect(ui.dismissOverlay()).toBe(false);
    expect(() => ui.dispose()).not.toThrow();
  });
});

describe('scoped presentation contract', () => {
  const css = readFileSync(new URL('../../ui/world/world-canvas-ui.css', import.meta.url), 'utf8');
  it('limits full-height layout and scrollable fallback overrides to the opted-in canvas view', () => {
    expect(css).toContain('.bb-world.bb-world--canvas {');
    expect(css).toContain('.bb-world.bb-world--canvas > .bb-world-stage {');
    expect(css).toContain('.bb-world.bb-world--canvas .bb-world-fallback {');
    expect(css).toContain('height: 100%');
    expect(css).toContain('min-height: 0');
    expect(css).toContain('inset: 76px 24px 52px 16px');
  });
  it('shares toolbar/drawer left edge and desktop/mobile right insets with an 8px grid gap', () => {
    expect(css).toContain('--bb-world-panel-width: min(360px, calc(100% - 24px))');
    expect(css).toContain('--bb-world-right-inset: 16px');
    expect(css).toContain('--bb-world-right-inset: 10px');
    expect(css).toContain('width: calc(var(--bb-world-panel-width) - var(--bb-world-right-inset))');
    expect(css).toContain('padding-right: var(--bb-world-right-inset)');
    expect(css).toContain('gap: 8px');
    expect(css).not.toMatch(/(^|\n)(?:body|:root|#world-shell)\s*\{/u);
  });
  it('gives compact help, noninteractive single-line warnings and reduced-motion transitions', () => {
    const { stage } = mount({ reducedMotion: true });
    expect(stage.querySelector('.bb-world-canvas-ui').classList.contains('is-reduced-motion')).toBe(true);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('transition: none');
    expect(css).toContain('white-space: nowrap; text-overflow: ellipsis');
    expect(css).toContain('overscroll-behavior: contain');
    expect(css).toContain('.bb-world-canvas-help-content .bb-world-legend');
  });
});
