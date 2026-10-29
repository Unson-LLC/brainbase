import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { workspaceTabStrip } from '../../ui/workspace-kit.js';

class FakeStyle {
  constructor() { this.values = {}; }
  setProperty(name, value) { this.values[name] = value; }
  removeProperty(name) { delete this.values[name]; }
}

class FakeElement {
  constructor(doc, tagName) {
    this.ownerDocument = doc;
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parent = null;
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.style = new FakeStyle();
    this.offsetLeft = 0;
    this.offsetWidth = 0;
    this.scrolled = 0;
  }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parent?.isConnected); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); }
  removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter((item) => item !== callback)); }
  dispatch(name, event) { for (const callback of this.listeners.get(name) ?? []) callback(event); }
  focus() { this.ownerDocument.activeElement = this; }
  click() { this.dispatch('click', { target: this }); }
  scrollIntoView() { this.scrolled += 1; }
}

class FakeDocument {
  constructor() { this.body = new FakeElement(this, 'body'); this.activeElement = this.body; }
  createElement(tagName) { return new FakeElement(this, tagName); }
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

function press(target, key, extra = {}) {
  let prevented = false;
  const event = { key, target, preventDefault() { prevented = true; }, ...extra };
  // The listener sits on the strip; the event bubbles from the tab.
  let node = target;
  while (node) { node.dispatch('keydown', event); node = node.parent; }
  return prevented;
}

/**
 * A host like the inbox: each selection redraws the strip as new nodes and
 * puts them in place of the old strip.
 */
function redrawingHost(doc, { labels = ['対応待ち', 'お知らせ', '片付けた'], memoryKey = 'test-inbox', hidden = [] } = {}) {
  const host = { selected: 0, strip: null, clicks: [] };
  const draw = () => {
    const strip = doc.createElement('div');
    strip.setAttribute('role', 'tablist');
    workspaceTabStrip(strip, { memoryKey });
    labels.forEach((label, index) => {
      const tab = doc.createElement('button');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', index === host.selected ? 'true' : 'false');
      tab.hidden = hidden.includes(index);
      tab.offsetLeft = index * 100;
      tab.offsetWidth = 80 + index * 10;
      tab.label = label;
      tab.addEventListener('click', () => { host.clicks.push(label); host.selected = index; draw(); });
      strip.append(tab);
    });
    if (host.strip) host.strip.remove();
    doc.body.append(strip);
    host.strip = strip;
  };
  draw();
  host.tab = (index) => host.strip.children[index];
  return host;
}

describe('workspaceTabStrip', () => {
  it('keeps workspaceTabList appearance and returns the same controller for the same root', () => {
    const doc = new FakeDocument();
    const strip = doc.createElement('div');
    strip.className = 'existing';
    const first = workspaceTabStrip(strip);
    expect(workspaceTabStrip(strip)).toBe(first);
    expect(strip.className.split(' ')).toEqual(['existing', 'bb-ws-tabs']);
    expect(strip.listeners.get('keydown')).toHaveLength(1);
  });

  it('moves with the arrow keys through the host click handler, wrapping at both ends', async () => {
    const doc = new FakeDocument();
    const host = redrawingHost(doc);
    await flush();
    expect(press(host.tab(0), 'ArrowRight')).toBe(true);
    expect(host.clicks).toEqual(['お知らせ']);
    press(host.tab(1), 'ArrowRight');
    press(host.tab(2), 'ArrowRight');
    expect(host.clicks).toEqual(['お知らせ', '片付けた', '対応待ち']);
    press(host.tab(0), 'ArrowLeft');
    expect(host.clicks.at(-1)).toBe('片付けた');
    press(host.tab(2), 'Home');
    expect(host.clicks.at(-1)).toBe('対応待ち');
    press(host.tab(0), 'End');
    expect(host.clicks.at(-1)).toBe('片付けた');
  });

  it('skips hidden and disabled tabs and ignores modified keys and other keys', async () => {
    const doc = new FakeDocument();
    const host = redrawingHost(doc, { labels: ['a', 'b', 'c', 'd'], hidden: [1] });
    host.tab(2).disabled = true;
    await flush();
    press(host.tab(0), 'ArrowRight');
    expect(host.clicks).toEqual(['d']);
    expect(press(host.tab(3), 'ArrowLeft', { metaKey: true })).toBe(false);
    expect(press(host.tab(3), 'ArrowLeft', { shiftKey: true })).toBe(false);
    expect(press(host.tab(3), 'Enter')).toBe(false);
    expect(host.clicks).toEqual(['d']);
  });

  it('puts only the selected tab in the Tab order', async () => {
    const doc = new FakeDocument();
    const host = redrawingHost(doc);
    await flush();
    expect(host.strip.children.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    press(host.tab(0), 'End');
    await flush();
    expect(host.strip.children.map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
  });

  it('brings focus back to the selected tab after the host redraws the strip, and scrolls it into view', async () => {
    const doc = new FakeDocument();
    const host = redrawingHost(doc);
    await flush();
    host.tab(0).focus();
    press(host.tab(0), 'ArrowRight');
    await flush();
    expect(doc.activeElement).toBe(host.tab(1));
    expect(host.tab(1).scrolled).toBe(1);
  });

  it('does not take focus back when the viewer moved it elsewhere', async () => {
    const doc = new FakeDocument();
    const host = redrawingHost(doc, { memoryKey: 'test-elsewhere' });
    const search = doc.createElement('input');
    doc.body.append(search);
    await flush();
    host.tab(0).focus();
    press(host.tab(0), 'ArrowRight');
    search.focus();
    await flush();
    expect(doc.activeElement).toBe(search);
  });

  it('slides a redrawn strip from where the strip with the same key left the bar', async () => {
    const doc = new FakeDocument();
    const host = redrawingHost(doc, { memoryKey: 'test-slide' });
    await flush();
    expect(host.strip.className).toContain('is-indicator-ready');
    expect(host.strip.style.values).toEqual({ '--bb-tab-indicator-x': '0px', '--bb-tab-indicator-width': '80px' });
    const seen = [];
    const original = FakeStyle.prototype.setProperty;
    FakeStyle.prototype.setProperty = function setProperty(name, value) { if (name === '--bb-tab-indicator-x') seen.push(value); original.call(this, name, value); };
    try {
      press(host.tab(0), 'End');
      await flush();
    } finally {
      FakeStyle.prototype.setProperty = original;
    }
    // The new strip is first placed at the old tab without a transition, then moved to the new tab.
    expect(seen).toEqual(['0px', '200px']);
    expect(host.strip.className).not.toContain('is-indicator-instant');
    expect(host.strip.style.values['--bb-tab-indicator-width']).toBe('100px');
  });

  it('measures the bar from the strip itself, including its horizontal scroll', async () => {
    const doc = new FakeDocument();
    const strip = doc.createElement('div');
    const tab = doc.createElement('button');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'true');
    // offsetLeft counts from an outer box until the strip is positioned; it must not be used.
    tab.offsetLeft = 316;
    tab.offsetWidth = 70;
    tab.getBoundingClientRect = () => ({ left: 140, width: 70.5 });
    strip.getBoundingClientRect = () => ({ left: 16, width: 240 });
    strip.scrollLeft = 120;
    strip.append(tab);
    doc.body.append(strip);
    workspaceTabStrip(strip);
    await flush();
    expect(strip.style.values).toEqual({ '--bb-tab-indicator-x': '244px', '--bb-tab-indicator-width': '70.5px' });
  });

  it('keeps the per-tab underline when the selected tab cannot be measured', async () => {
    const doc = new FakeDocument();
    const strip = doc.createElement('div');
    const tab = doc.createElement('button');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'true');
    strip.append(tab);
    doc.body.append(strip);
    const controller = workspaceTabStrip(strip);
    await flush();
    expect(strip.className).not.toContain('is-indicator-ready');
    tab.offsetWidth = 64;
    controller.update();
    expect(strip.className).toContain('is-indicator-ready');
    controller.destroy();
    expect(strip.className).not.toContain('is-indicator-ready');
    expect(strip.style.values).toEqual({});
    expect(strip.listeners.get('keydown')).toEqual([]);
  });

  it('draws one sliding bar only after opt-in and turns the slide off for reduced motion', () => {
    const css = readFileSync(new URL('../../ui/workspace-kit.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.bb-ws-tabs\.is-indicator-ready::after\s*\{[^}]*transform:\s*translateX\(var\(--bb-tab-indicator-x/);
    expect(css).toMatch(/\.bb-ws-tabs\.is-indicator-ready > [^{]*\{\s*box-shadow:\s*none/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.bb-ws-tabs\.is-indicator-ready::after\s*\{\s*transition:\s*none/);
    expect(css).not.toMatch(/(^|\n)\[role="?tablist"?\]/);
  });
});
