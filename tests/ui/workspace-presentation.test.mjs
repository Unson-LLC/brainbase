import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceDetailDrawer, workspaceTopbar, workspaceApplyDrawer, workspaceCloseDrawer, workspaceDialog, workspaceFilterPopover, workspaceLoadingCard, workspaceDismissNotification } from '../../ui/workspace-kit.js';

// A native-dialog lifecycle model: focus remains inside until close dispatches.
class Events {
  listeners = new Map();
  addEventListener(name, callback, options) {
    const entries = this.listeners.get(name) || [];
    this.listeners.set(name, [...entries, { callback, once: options?.once }]);
  }
  removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item.callback !== callback)); }
  dispatch(name, values = {}) {
    const event = { target: this, preventDefault() {}, stopPropagation() {}, ...values };
    for (const item of [...this.listeners.get(name) || []]) {
      if (item.once) this.removeEventListener(name, item.callback);
      item.callback(event);
    }
  }
  count(name) { return (this.listeners.get(name) || []).length; }
}
class Element extends Events {
  constructor(doc, tagName) {
    super(); this.ownerDocument = doc; this.tagName = tagName.toUpperCase(); this.children = []; this.attributes = {}; this.className = ''; this.hidden = false; this.open = false;
    this.classList = {
      add: name => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), name])].join(' '); },
      remove: name => { this.className = this.className.split(' ').filter(item => item !== name).join(' '); },
      contains: name => this.className.split(' ').includes(name),
    };
  }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentNode?.isConnected); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  querySelector() { return this.children.find(child => ['BUTTON', 'INPUT', 'SELECT'].includes(child.tagName)) || this.children.map(child => child.querySelector()).find(Boolean); }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close(value) { this.open = false; this.returnValue = value; this.dispatch('close'); }
  getBoundingClientRect() { return { left: 10, top: 10, right: 100, bottom: 100 }; }
}
class Document extends Events {
  constructor(reduced = false) { super(); this.defaultView = { matchMedia: () => ({ matches: reduced }) }; this.body = this.createElement('body'); }
  createElement(tagName) { return new Element(this, tagName); }
}
afterEach(() => vi.useRealTimers());

describe('shared drawer lifecycle', () => {
  it('keeps modal focus until its own exit ends, then restores the current opener once', () => {
    vi.useFakeTimers(); const doc = new Document(); const oldOpener = doc.createElement('button'); doc.body.append(oldOpener);
    let opener = oldOpener; const closed = vi.fn();
    const dialog = workspaceDialog(doc, { title: '詳細', content: '内容', opener: () => opener, presentation: 'drawer', onClose: closed });
    const closeButton = dialog.children[0].children[1];
    expect(doc.activeElement).toBe(closeButton);
    dialog.close('done'); dialog.close('duplicate');
    expect(dialog.open).toBe(true); expect(closed).not.toHaveBeenCalled(); expect(doc.activeElement).toBe(closeButton);
    dialog.dispatch('animationend', { target: closeButton, animationName: 'bb-ws-drawer-out' });
    expect(dialog.open).toBe(true);
    opener = doc.createElement('button'); doc.body.append(opener); oldOpener.remove();
    dialog.dispatch('animationend', { animationName: 'bb-ws-drawer-out' });
    expect(dialog.open).toBe(false); expect(dialog.isConnected).toBe(false); expect(dialog.returnValue).toBe('done');
    expect(closed).toHaveBeenCalledTimes(1); expect(doc.activeElement).toBe(opener); expect(vi.getTimerCount()).toBe(0);
    dialog.dispatch('animationend', { animationName: 'bb-ws-drawer-out' }); expect(closed).toHaveBeenCalledTimes(1);
  });
  it('supports native Escape and a bounded fallback when animationend is absent', () => {
    vi.useFakeTimers(); const doc = new Document(); const dialog = workspaceDialog(doc, { title: '詳細', presentation: 'drawer' });
    const prevented = vi.fn(); dialog.dispatch('cancel', { preventDefault: prevented });
    expect(prevented).toHaveBeenCalled(); expect(dialog.open).toBe(true);
    vi.advanceTimersByTime(360); expect(dialog.open).toBe(false); expect(dialog.count('animationend')).toBe(0);
  });
  it('disposes during exit without leaving a timer or double close callback', () => {
    vi.useFakeTimers(); const doc = new Document(); const closed = vi.fn(); const dialog = workspaceDialog(doc, { presentation: 'drawer', onClose: closed });
    dialog.close(); dialog.dispose(); vi.runAllTimers(); dialog.dispose();
    expect(closed).toHaveBeenCalledTimes(1); expect(dialog.isConnected).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it('closes immediately with reduced motion and supports host-owned dialogs', () => {
    vi.useFakeTimers(); const doc = new Document(true); const dialog = workspaceApplyDrawer(doc.createElement('dialog')); dialog.showModal();
    const finish = vi.fn(() => dialog.close()); workspaceCloseDrawer(dialog, finish);
    expect(dialog.classList.contains('bb-ws-drawer')).toBe(true); expect(finish).toHaveBeenCalledTimes(1); expect(dialog.open).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a host-owned pending exit when the host closes immediately', () => {
    vi.useFakeTimers(); const doc = new Document(); const dialog = workspaceApplyDrawer(doc.createElement('dialog')); dialog.showModal();
    const finish = vi.fn(); workspaceCloseDrawer(dialog, finish); dialog.close(); vi.runAllTimers();
    expect(finish).not.toHaveBeenCalled(); expect(dialog.count('animationend')).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps center dialogs immediate and closes drawers from the backdrop', () => {
    vi.useFakeTimers(); const doc = new Document(); const center = workspaceDialog(doc); center.close(); expect(center.open).toBe(false);
    const drawer = workspaceDialog(doc, { presentation: 'drawer' }); drawer.dispatch('click', { clientX: 0, clientY: 0 });
    expect(drawer.classList.contains('is-closing')).toBe(true); vi.runAllTimers(); expect(drawer.open).toBe(false);
  });
});

describe('shared anchored filters', () => {
  it('focuses fields, closes outside or with Escape, restores trigger focus and disposes document listeners', () => {
    const doc = new Document(); const field = doc.createElement('input'); const toggles = [];
    const popover = workspaceFilterPopover(doc, { content: field, onToggle: open => toggles.push(open) }); doc.body.append(popover.root);
    expect(popover.panel.hidden).toBe(true); expect(doc.count('keydown')).toBe(0);
    popover.control.dispatch('click'); expect(doc.activeElement).toBe(field); expect(popover.panel.hidden).toBe(false);
    doc.dispatch('pointerdown', { target: field }); expect(popover.panel.hidden).toBe(false);
    doc.dispatch('keydown', { key: 'Escape' }); expect(popover.panel.hidden).toBe(true); expect(doc.activeElement).toBe(popover.control);
    popover.control.dispatch('click'); doc.dispatch('pointerdown', { target: doc.body }); expect(popover.panel.hidden).toBe(true);
    popover.control.dispatch('click'); popover.destroy(); expect(doc.count('keydown')).toBe(0); expect(doc.count('pointerdown')).toBe(0);
    expect(popover.panel.hidden).toBe(true); expect(toggles).toEqual([false, true, false, true, false, true]);
  });
  it('adapts existing task trigger and panel without recreating controls', () => {
    const doc = new Document(); const trigger = doc.createElement('button'); const panel = doc.createElement('div'); const field = doc.createElement('select'); panel.append(field);
    const popover = workspaceFilterPopover(doc, { trigger, panel, initialFocus: () => field });
    expect(popover.control).toBe(trigger); expect(popover.panel).toBe(panel); trigger.dispatch('click'); expect(doc.activeElement).toBe(field); popover.destroy();
  });
});

describe('loading notification lifecycle', () => {
  it('removes after rightward exit and can cancel/reuse the same card', () => {
    vi.useFakeTimers(); const doc = new Document(); const card = workspaceLoadingCard(doc); doc.body.append(card);
    const removed = vi.fn(); const cancel = workspaceDismissNotification(card, removed); expect(workspaceDismissNotification(card)).toBe(cancel);
    cancel(); vi.runAllTimers(); expect(removed).not.toHaveBeenCalled(); expect(card.isConnected).toBe(true); expect(card.classList.contains('is-dismissing')).toBe(false);
    workspaceDismissNotification(card, removed); card.dispatch('animationend', { animationName: 'bb-ws-spinner' }); expect(card.isConnected).toBe(true);
    card.dispatch('animationend', { animationName: 'bb-ws-notification-out' }); expect(card.isConnected).toBe(false); expect(removed).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('removes immediately for minimal non-browser adapters without animation APIs', () => {
    const card = {}; const parent = { children: [card], replaceChildren(...children) { this.children = children; } }; card.parentNode = parent;
    const removed = vi.fn(); workspaceDismissNotification(card, removed);
    expect(parent.children).toEqual([]); expect(removed).toHaveBeenCalledTimes(1);
  });
  it('has a bounded timer fallback and no motion delay when reduced motion is selected', () => {
    vi.useFakeTimers(); const doc = new Document(); const card = workspaceLoadingCard(doc); doc.body.append(card);
    workspaceDismissNotification(card); vi.advanceTimersByTime(500); expect(card.isConnected).toBe(false); expect(card.count('animationend')).toBe(0);
    const reduced = new Document(true); const second = workspaceLoadingCard(reduced); reduced.body.append(second); workspaceDismissNotification(second);
    expect(second.isConnected).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
});


describe('shared page chrome and persistent inspectors', () => {
  it('renders only a title in the common top bar', () => {
    const doc = new Document(); const header = workspaceTopbar(doc, { title: '一覧' });
    expect(header.children).toHaveLength(1);
    expect(header.children[0].tagName).toBe('H1');
    expect(header.children[0].textContent).toBe('一覧');
  });
  it('updates content without reopening a dismissed drawer and restores a replaced row', () => {
    vi.useFakeTimers(); const doc = new Document(); let opener = doc.createElement('button'); doc.body.append(opener);
    const closed = vi.fn(); const inspector = workspaceDetailDrawer(doc, { opener: () => opener, onClose: closed });
    inspector.setContent(doc.createElement('section')); expect(inspector.dialog.open).toBe(false);
    inspector.open(); inspector.close(); inspector.close();
    expect(closed).toHaveBeenCalledTimes(1); expect(inspector.dialog.open).toBe(true);
    opener.remove(); opener = doc.createElement('button'); doc.body.append(opener);
    vi.runAllTimers(); expect(inspector.dialog.open).toBe(false); expect(doc.activeElement).toBe(opener);
    inspector.setContent(doc.createElement('section')); expect(inspector.dialog.open).toBe(false);
    inspector.open(); inspector.dispose(); vi.runAllTimers();
    expect(inspector.dialog.isConnected).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it('can reopen during exit without an old timer closing the new request', () => {
    vi.useFakeTimers(); const doc = new Document(); const inspector = workspaceDetailDrawer(doc);
    inspector.open(); inspector.close(); inspector.open(); vi.runAllTimers();
    expect(inspector.dialog.open).toBe(true); inspector.dispose();
  });
});
