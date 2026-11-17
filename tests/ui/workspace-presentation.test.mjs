import { knowledgeDirectoryToolbar } from '../../ui/knowledge-directory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceCompactToolbar, workspaceCombobox, workspaceDetailDrawer, workspaceTopbar, workspaceSearchControl, workspaceApplyDrawer, workspaceCloseDrawer, workspaceDialog, workspaceFilterPopover, workspaceLoadingCard, workspaceDismissNotification, workspaceAnchoredPopover, workspaceSelectionRow, workspaceSwitch, workspaceHelp, workspaceActionIcon, workspaceButton } from '../../ui/workspace-kit.js';

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
    super(); this.ownerDocument = doc; this.tagName = tagName.toUpperCase(); this.children = []; this.attributes = {}; this.style = { values: new Map(), setProperty(name, value) { this.values.set(name, value); } }; this.className = ''; this.hidden = false; this.open = false;
    this.classList = {
      add: name => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), name])].join(' '); },
      remove: name => { this.className = this.className.split(' ').filter(item => item !== name).join(' '); },
      contains: name => this.className.split(' ').includes(name),
      toggle: name => { const active = !this.classList.contains(name); if (active) this.classList.add(name); else this.classList.remove(name); return active; },
    };
  }
  click() { this.dispatch('click'); }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentNode?.isConnected); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(selector === '.bb-ws-help' && child.classList.contains('bb-ws-help') ? [child] : []), ...child.querySelectorAll(selector)]); }
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
  it('leaves backdrop dismissal to native closedby where the browser supports it', () => {
    vi.useFakeTimers(); const doc = new Document(); doc.defaultView.HTMLDialogElement = { prototype: { closedBy: '' } };
    const drawer = workspaceDialog(doc, { presentation: 'drawer' }); expect(drawer.getAttribute('closedby')).toBe('any');
    drawer.dispatch('click', { clientX: 0, clientY: 0 }); expect(drawer.classList.contains('is-closing')).toBe(false); expect(drawer.open).toBe(true);
    drawer.dispatch('cancel'); expect(drawer.classList.contains('is-closing')).toBe(true); vi.runAllTimers(); expect(drawer.open).toBe(false);
    const inspector = workspaceDetailDrawer(doc); expect(inspector.dialog.getAttribute('closedby')).toBe('any'); expect(inspector.dialog.count('click')).toBe(0);
  });
  it('keeps the pointer fallback and still marks closedby where the browser lacks it', () => {
    const doc = new Document(); const inspector = workspaceDetailDrawer(doc);
    expect(inspector.dialog.getAttribute('closedby')).toBe('any'); expect(inspector.dialog.count('click')).toBe(1);
  });
});

describe('shared anchored filters', () => {
  it('focuses fields, closes outside or with Escape, restores trigger focus and disposes document listeners', () => {
    vi.useFakeTimers(); const doc = new Document(); const field = doc.createElement('input'); const toggles = [];
    const popover = workspaceFilterPopover(doc, { content: field, onToggle: open => toggles.push(open) }); doc.body.append(popover.root);
    expect(popover.panel.hidden).toBe(true); expect(doc.count('keydown')).toBe(0);
    popover.control.dispatch('click'); expect(doc.activeElement).toBe(field); expect(popover.panel.hidden).toBe(false);
    doc.dispatch('pointerdown', { target: field }); expect(popover.panel.hidden).toBe(false);
    doc.dispatch('keydown', { key: 'Escape' }); expect(popover.isOpen).toBe(false); expect(popover.panel.inert).toBe(true); vi.runAllTimers(); expect(popover.panel.hidden).toBe(true); expect(doc.activeElement).toBe(popover.control);
    popover.control.dispatch('click'); doc.dispatch('pointerdown', { target: doc.body }); expect(popover.isOpen).toBe(false); vi.runAllTimers(); expect(popover.panel.hidden).toBe(true);
    popover.control.dispatch('click'); popover.destroy(); expect(doc.count('keydown')).toBe(0); expect(doc.count('pointerdown')).toBe(0);
    expect(popover.panel.hidden).toBe(true); expect(toggles).toEqual([false, true, false, true, false, true]);
  });
  it('cancels exit on reopen, ignores child animation events and clears its fallback on destroy', () => {
    vi.useFakeTimers(); const doc = new Document(); const field = doc.createElement('input');
    const popover = workspaceFilterPopover(doc, { content: field, appearance: 'icon' }); doc.body.append(popover.root);
    popover.setOpen(true, true); popover.setOpen(false);
    expect(popover.control.getAttribute('aria-expanded')).toBe('false'); expect(popover.panel.hidden).toBe(false);
    expect(popover.panel.inert).toBe(true); expect(popover.panel.getAttribute('aria-hidden')).toBe('true');
    popover.panel.dispatch('animationend', { target: field, animationName: 'bb-ws-filter-exit' }); expect(popover.panel.hidden).toBe(false);
    popover.control.click(); vi.runAllTimers(); expect(popover.isOpen).toBe(true); expect(popover.panel.hidden).toBe(false);
    expect(popover.panel.inert).toBe(false); expect(popover.panel.getAttribute('aria-hidden')).toBe(null);
    popover.setOpen(false); popover.panel.dispatch('animationend', { animationName: 'bb-ws-filter-exit' });
    expect(popover.panel.hidden).toBe(true); expect(vi.getTimerCount()).toBe(0);
    popover.setOpen(true); popover.setOpen(false); popover.destroy(); vi.runAllTimers();
    expect(popover.panel.hidden).toBe(true); expect(popover.panel.count('animationend')).toBe(0); expect(vi.getTimerCount()).toBe(0);
    expect(doc.count('keydown')).toBe(0); expect(doc.count('pointerdown')).toBe(0);
  });
  it('closes synchronously for reduced motion without adding an exit timer', () => {
    vi.useFakeTimers(); const doc = new Document(true); const popover = workspaceFilterPopover(doc); doc.body.append(popover.root);
    popover.setOpen(true); popover.setOpen(false); expect(popover.panel.hidden).toBe(true); expect(vi.getTimerCount()).toBe(0); popover.destroy();
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
  it('keeps a caller-owned search input and can remove or replace it without changing the title', () => {
    const doc = new Document(); const input = doc.createElement('input'); input.value = 'needle'; input.setAttribute('aria-label', '検索');
    const changed = vi.fn(); input.addEventListener('input', changed);
    const header = workspaceTopbar(doc, { title: '一覧', query: input });
    expect(header.children[0].tagName).toBe('H1'); expect(header.children[1].className).toBe('bb-ws-search-control');
    expect(header.children[1].children[1]).toBe(input); expect(input.value).toBe('needle');
    input.dispatch('input'); expect(changed).toHaveBeenCalledTimes(1);
    const wrapper = header.children[1]; header.setQuery(input); expect(header.children[1]).toBe(wrapper);
    header.setQuery(null); expect(header.children).toHaveLength(1); expect(header.children[0].textContent).toBe('一覧');
    const other = doc.createElement('input'); header.setQuery(other); expect(header.children[1].children[1]).toBe(other);
    expect(workspaceSearchControl(doc, { input }).children[1]).toBe(input);
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

describe('compact list controls', () => {
  it('uses one caret trigger, clears with focus restoration, and excludes filter on keyboard sort opening', () => {
    vi.useFakeTimers(); const doc = new Document(); const root = doc.createElement('div'); doc.body.append(root);
    const query = doc.createElement('input'); const filters = doc.createElement('div'); filters.append(doc.createElement('input'));
    const reset = doc.createElement('button'); const clear = vi.fn(); reset.addEventListener('click', clear);
    const sort = workspaceCombobox(doc, { label: '並べ替え', options: [{ value: 'new', label: '新しい順' }, { value: 'old', label: '古い順' }], value: 'new' });
    const toolbar = workspaceCompactToolbar(doc, { root, query, filters, sort, reset });
    expect(toolbar.filter.control.children.at(-1).tagName).toBe('SPAN');
    toolbar.filter.control.click(); expect(toolbar.filter.panel.hidden).toBe(false);
    sort.trigger.dispatch('keydown', { key: 'ArrowDown' });
    expect(sort.popup.hidden).toBe(false); expect(toolbar.filter.isOpen).toBe(false); expect(toolbar.filter.panel.inert).toBe(true);
    toolbar.filter.control.click();
    expect(sort.popup.hidden).toBe(true); expect(toolbar.filter.panel.hidden).toBe(false);
    toolbar.setFiltered(true); reset.click();
    expect(clear).toHaveBeenCalledTimes(1); expect(toolbar.filter.isOpen).toBe(false); expect(doc.activeElement).toBe(toolbar.filter.control);
    toolbar.destroy(); sort.destroy();
    expect(doc.count('pointerdown')).toBe(0); expect(doc.count('keydown')).toBe(0);
  });
});


describe('knowledge directory Japanese search input', () => {
  it('waits for compositionend, ignores composing Enter, and cleans up the existing input', () => {
    const doc = new Document(); const changes = [];
    const toolbar = knowledgeDirectoryToolbar(doc, { filters: { q: '', scope: 'all', status: 'active' }, onChange: value => changes.push(value), onProject() {}, onRegister() {} });
    doc.body.append(toolbar.root);
    const query = toolbar.query;
    query.dispatch('compositionstart'); query.value = '日本語';
    query.dispatch('input', { isComposing: true });
    query.dispatch('keydown', { key: 'Enter', isComposing: true });
    expect(toolbar.isComposing).toBe(true); expect(changes).toEqual([]);
    query.dispatch('compositionend');
    expect(changes).toEqual([{ q: '日本語', scope: 'all', status: 'active' }]);
    toolbar.destroy(); query.value = '後着'; query.dispatch('input');
    expect(changes).toHaveLength(1);
    const next = knowledgeDirectoryToolbar(doc, { queryInput: query, filters: { q: '日本語', scope: 'all', status: 'active' }, onChange() {}, onProject() {}, onRegister() {} });
    expect(next.query).toBe(query); next.destroy();
  });
});

describe('composable page header and panel', () => {
  it('keeps the accessible title first while replacing caller-owned tabs, tools and query', () => {
    const doc = new Document(); const query = doc.createElement('input'); query.value = 'example';
    const changed = vi.fn(); query.addEventListener('input', changed);
    const tabs = doc.createElement('nav'); const action = doc.createElement('button');
    const clicked = vi.fn(); action.addEventListener('click', clicked);
    const header = workspaceTopbar(doc, { title: '一覧', tabs, query, tools: action });
    expect(header.classList.contains('bb-ws-topbar--content-aligned')).toBe(false);
    expect(header.children.map(node => node.className || node.tagName)).toEqual(['H1', 'bb-ws-topbar-tabs', 'bb-ws-search-control', 'bb-ws-topbar-tools']);
    expect(header.classList.contains('has-tabs')).toBe(true);
    expect(header.children[0].textContent).toBe('一覧');
    expect(header.children[0].getAttribute('aria-hidden')).toBeNull();
    const search = header.children[2]; const nextTabs = doc.createElement('nav');
    header.setTabs(nextTabs); header.setQuery(query);
    expect(header.children[1].children[0]).toBe(nextTabs); expect(header.children[2]).toBe(search);
    expect(search.children[1]).toBe(query); expect(query.value).toBe('example');
    query.dispatch('input'); action.click(); expect(changed).toHaveBeenCalledTimes(1); expect(clicked).toHaveBeenCalledTimes(1);
    header.setTabs(null); expect(header.classList.contains('has-tabs')).toBe(false);
    expect(header.children[0].tagName).toBe('H1'); expect(header.children[1]).toBe(search);
    header.setQuery(null); header.setTools(null); expect(header.children).toHaveLength(1);
    expect(header.classList.contains('has-tools')).toBe(false);
  });
  it('opts into desktop content alignment without changing the topbar structure and can reset it', () => {
    const doc = new Document(); const tabs = doc.createElement('nav');
    const header = workspaceTopbar(doc, { title: '振り分け待ち', tabs, alignment: 'content' });
    expect(header.classList.contains('bb-ws-topbar--content-aligned')).toBe(true);
    expect(header.children.map(node => node.className || node.tagName)).toEqual(['H1', 'bb-ws-topbar-tabs']);
    expect(header.setAlignment(null)).toBe(header);
    expect(header.classList.contains('bb-ws-topbar--content-aligned')).toBe(false);
    header.setAlignment('content');
    expect(header.classList.contains('bb-ws-topbar--content-aligned')).toBe(true);
  });
  it('opts into compact search without replacing its input', () => {
    const doc = new Document(); const input = doc.createElement('input');
    const compact = workspaceSearchControl(doc, { input, appearance: 'compact' });
    expect(compact.classList.contains('bb-ws-search-control--compact')).toBe(true);
    expect(compact.children[1]).toBe(input);
    expect(workspaceSearchControl(doc, { input }).classList.contains('bb-ws-search-control--compact')).toBe(false);
  });
  it('keeps panel Escape focus, inert exit, reopen cancellation and outside dismissal', () => {
    vi.useFakeTimers(); const doc = new Document(); const input = doc.createElement('input');
    const panel = workspaceFilterPopover(doc, { content: input, appearance: 'panel', initialFocus: input }); doc.body.append(panel.root);
    expect(panel.panel.classList.contains('bb-ws-filter-popover--panel')).toBe(true);
    panel.control.click(); expect(doc.activeElement).toBe(input);
    doc.dispatch('keydown', { key: 'Escape' }); expect(doc.activeElement).toBe(panel.control);
    expect(panel.panel.inert).toBe(true); expect(panel.panel.hidden).toBe(false);
    vi.advanceTimersByTime(209); expect(panel.panel.hidden).toBe(false);
    vi.advanceTimersByTime(1); expect(panel.panel.hidden).toBe(true);
    panel.setOpen(true); panel.setOpen(false); panel.setOpen(true); vi.runAllTimers();
    expect(panel.panel.hidden).toBe(false); expect(panel.panel.inert).toBe(false);
    doc.dispatch('pointerdown', { target: doc.body }); expect(panel.isOpen).toBe(false);
    panel.panel.dispatch('animationend', { animationName: 'bb-ws-filter-exit' }); expect(panel.panel.hidden).toBe(true);
    panel.destroy(); expect(doc.count('keydown')).toBe(0); expect(doc.count('pointerdown')).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('immediately closes panels when reduced motion is requested', () => {
    vi.useFakeTimers(); const doc = new Document(true);
    const panel = workspaceFilterPopover(doc, { appearance: 'panel' }); doc.body.append(panel.root);
    panel.setOpen(true); panel.setOpen(false); expect(panel.panel.hidden).toBe(true); expect(vi.getTimerCount()).toBe(0); panel.destroy();
  });
});

describe('opt-in anchored surfaces and controls', () => {
  it('clamps at viewport edges, follows scroll and releases document listeners and focus', () => {
    const doc = new Document(); doc.defaultView.innerWidth = 400; doc.defaultView.innerHeight = 300;
    const anchor = doc.createElement('button'); doc.body.append(anchor);
    anchor.getBoundingClientRect = () => ({ left: 370, right: 400, top: 270, bottom: 294, width: 30 });
    const input = doc.createElement('input'); const closed = vi.fn();
    const pop = workspaceAnchoredPopover(doc, { anchor, content: input, label: 'Synthetic details', width: 276, onClose: closed });
    pop.element.getBoundingClientRect = () => ({ width: 276, height: 180 });
    expect(pop.element.hidden).toBe(true); expect(doc.count('scroll')).toBe(0);
    pop.open(); expect(doc.activeElement).toBe(input);
    expect(pop.element.style.values.get('left')).toBe('116px'); expect(pop.element.style.values.get('top')).toBe('112px');
    anchor.getBoundingClientRect = () => ({ left: 10, right: 40, top: 10, bottom: 34, width: 30 });
    doc.dispatch('scroll'); expect(pop.element.style.values.get('top')).toBe('38px');
    doc.dispatch('pointerdown', { target: input }); expect(pop.isOpen).toBe(true);
    doc.dispatch('keydown', { key: 'Escape' }); expect(pop.isOpen).toBe(false); expect(doc.activeElement).toBe(anchor);
    expect(closed).toHaveBeenCalledOnce(); expect(doc.count('scroll')).toBe(0); expect(doc.count('keydown')).toBe(0);
    pop.destroy(); expect(pop.element.isConnected).toBe(false); expect(anchor.getAttribute('aria-controls')).toBe(null);
  });
  it('does not reopen on late content or steal outside focus and cannot revive after destroy', async () => {
    const doc = new Document(true); const anchor = doc.createElement('button'); doc.body.append(anchor);
    const pop = workspaceAnchoredPopover(doc, { anchor, surface: 'muted' });
    const outside = doc.createElement('input'); doc.body.append(outside); outside.focus();
    pop.open({ focus: false }); doc.dispatch('pointerdown', { target: outside });
    pop.setContent(await Promise.resolve(doc.createElement('button')));
    expect(pop.isOpen).toBe(false); expect(pop.element.hidden).toBe(true); expect(doc.activeElement).toBe(outside);
    expect(pop.element.classList.contains('bb-ws-anchored-popover--muted')).toBe(true);
    pop.open(); anchor.remove(); pop.reposition(); expect(pop.isOpen).toBe(false);
    doc.body.append(anchor); pop.open(); pop.destroy(); pop.setContent(doc.createElement('input')); pop.open();
    expect(pop.isOpen).toBe(false); expect(pop.element.isConnected).toBe(false); expect(doc.count('pointerdown')).toBe(0);
  });
  it('uses the native modal top layer and refuses a disabled opener', () => {
    const doc = new Document(); const dialog = workspaceDialog(doc, { appearance: 'compact', headerTools: doc.createElement('span') });
    const anchor = doc.createElement('button'); dialog.children[1].append(anchor); anchor.closest = () => dialog;
    const pop = workspaceAnchoredPopover(doc, { anchor }); anchor.disabled = true; pop.open(); expect(pop.isOpen).toBe(false);
    anchor.disabled = false; pop.open(); expect(pop.element.parentNode).toBe(dialog);
    expect(dialog.classList.contains('bb-ws-dialog--compact')).toBe(true); expect(dialog.children[0].children[1].className).toBe('bb-ws-dialog-tools');
    dialog.close(); expect(pop.isOpen).toBe(false); expect(doc.count('keydown')).toBe(0); pop.destroy();
  });
  it('keeps retry actions outside the checkbox and respects disabled and destroyed state', () => {
    const doc = new Document(); const retry = doc.createElement('button'); const retryClick = vi.fn(); retry.addEventListener('click', retryClick);
    const change = vi.fn(); const row = workspaceSelectionRow(doc, { label: 'Synthetic choice', trailing: retry, color: 'var(--bb-color-action)', onChange: change });
    expect(row.control.contains(retry)).toBe(false); expect(row.root.contains(retry)).toBe(true);
    row.control.click(); expect(change).toHaveBeenLastCalledWith(true); expect(row.control.getAttribute('aria-checked')).toBe('true');
    row.update({ disabled: true }); row.control.click(); retry.click(); expect(change).toHaveBeenCalledTimes(1); expect(retryClick).toHaveBeenCalledOnce();
    row.update({ checked: false, disabled: false }); row.destroy(); row.control.click(); expect(change).toHaveBeenCalledTimes(1);
    const toggle = workspaceSwitch(doc, { label: 'Synthetic preview', disabled: true, onChange: change });
    expect(toggle.control.getAttribute('role')).toBe('switch'); toggle.control.click(); expect(change).toHaveBeenCalledTimes(1);
    toggle.update({ disabled: false }); toggle.control.click(); expect(change).toHaveBeenLastCalledWith(true);
    toggle.update({ checked: false }); expect(toggle.control.getAttribute('aria-checked')).toBe('false'); toggle.destroy(); toggle.control.click(); expect(change).toHaveBeenCalledTimes(2);
  });
  it('adds dropdown presentation only on request and retains the shared chevron and selection', () => {
    const doc = new Document(); const box = workspaceCombobox(doc, { appearance: 'compact', boxed: true, matchTriggerWidth: true, triggerHeight: 32, popupWidth: 104, active: true, searchable: false, showCount: false, options: [{ value: 'a', label: 'Alpha' }] });
    expect(box.root.classList.contains('bb-ws-combobox--stable-box')).toBe(true); expect(box.root.classList.contains('bb-ws-combobox--match-width')).toBe(true);
    const chevron = box.trigger.children[1]; box.open(); box.update({ value: 'a', active: false }); box.close();
    expect(box.trigger.children[1]).toBe(chevron); expect(box.root.classList.contains('is-active')).toBe(false);
    const plain = workspaceCombobox(doc); expect(plain.root.classList.contains('bb-ws-combobox--stable-box')).toBe(false);
    box.destroy(); plain.destroy();
  });
  it('accepts structured help as nodes', () => {
    const doc = new Document(); const content = doc.createElement('dl');
    const help = workspaceHelp(doc, { label: 'Synthetic help', content, icon: '?', placement: 'bottom-end' });
    expect(help.children[0].textContent).toBe('?'); expect(help.children[1].children[0]).toBe(content);
    expect(help.classList.contains('bb-ws-help--bottom-end')).toBe(true);
  });
});

describe('anchored control review regressions', () => {
  it('consumes only the first Escape that dismisses visible help', () => {
    const doc = new Document(); const help = workspaceHelp(doc, { label: 'Synthetic help', placement: 'bottom-end' });
    help.classList.add('is-open'); const key = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    help.children[0].dispatch('keydown', key);
    expect(key.preventDefault).toHaveBeenCalledOnce(); expect(help.classList.contains('is-dismissed')).toBe(true);
    const next = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() }; help.children[0].dispatch('keydown', next);
    expect(next.preventDefault).not.toHaveBeenCalled(); expect(next.stopPropagation).not.toHaveBeenCalled();
  });
  it('positions using layout dimensions rather than the animated bounding box', () => {
    const doc = new Document(); doc.defaultView.innerWidth = 400; doc.defaultView.innerHeight = 300;
    const anchor = doc.createElement('button'); doc.body.append(anchor);
    anchor.getBoundingClientRect = () => ({ left: 370, right: 400, top: 270, bottom: 294, width: 30 });
    const pop = workspaceAnchoredPopover(doc, { anchor });
    pop.element.offsetWidth = 276; pop.element.offsetHeight = 182;
    pop.element.getBoundingClientRect = () => ({ width: 259.44, height: 171.08 });
    pop.open(); expect(pop.element.style.values.get('left')).toBe('116px'); expect(pop.element.style.values.get('top')).toBe('110px'); pop.destroy();
  });
  it.each([false, true])('replaces same-anchor bindings without reviving stale ARIA (original attributes: %s)', original => {
    const doc = new Document(); const anchor = doc.createElement('button'); doc.body.append(anchor);
    if (original) { anchor.setAttribute('aria-controls', 'synthetic-original'); anchor.setAttribute('aria-expanded', 'true'); anchor.setAttribute('aria-haspopup', 'menu'); }
    for (const newerFirst of [false, true]) {
      const first = workspaceAnchoredPopover(doc, { anchor }); first.open();
      const second = workspaceAnchoredPopover(doc, { anchor }); second.open();
      expect(first.isOpen).toBe(false); const current = second.element.getAttribute('id');
      first.open(); expect(first.isOpen).toBe(false);
      if (newerFirst) { second.destroy(); first.destroy(); }
      else { first.destroy(); expect(second.isOpen).toBe(true); expect(anchor.getAttribute('aria-expanded')).toBe('true'); expect(anchor.getAttribute('aria-controls')).toBe(current); second.destroy(); }
      expect(anchor.getAttribute('aria-controls')).toBe(original ? 'synthetic-original' : null);
      expect(anchor.getAttribute('aria-expanded')).toBe(original ? 'true' : null);
      expect(anchor.getAttribute('aria-haspopup')).toBe(original ? 'menu' : null);
      expect(doc.count('keydown')).toBe(0);
    }
  });
  it('only opts out of the compact minimum for an explicit popup width', () => {
    const doc = new Document(); const fixed = workspaceCombobox(doc, { appearance: 'compact', popupWidth: 104 }); const plain = workspaceCombobox(doc, { appearance: 'compact' });
    expect(fixed.root.classList.contains('bb-ws-combobox--fixed-width')).toBe(true);
    expect(plain.root.classList.contains('bb-ws-combobox--fixed-width')).toBe(false); fixed.destroy(); plain.destroy();
  });
});

it('uses the shared symbols for neutral date, person and folder controls', () => {
  const doc = new Document(); const fallback = workspaceActionIcon(doc, 'filter').children[0].getAttribute('d');
  for (const name of ['clock', 'users', 'calendar', 'share', 'folder']) {
    const icon = workspaceActionIcon(doc, name);
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.children[0].getAttribute('d')).not.toBe(fallback);
  }
});

describe('native help interaction ownership', () => {
  it('keeps an explicit dismissal while focus remains after the pointer leaves', () => {
    const doc = new Document(); const help = workspaceHelp(doc, { label: 'Synthetic help' }); doc.body.append(help);
    const control = help.children[0]; let hovering = true;
    help.matches = () => hovering || help.contains(doc.activeElement);
    help.dispatch('mouseenter'); control.focus(); control.click();
    control.dispatch('keydown', { key: 'Escape' }); expect(help.classList.contains('is-dismissed')).toBe(true);
    hovering = false; help.dispatch('mouseleave'); expect(help.classList.contains('is-dismissed')).toBe(true);
    hovering = true; help.dispatch('mouseenter'); expect(help.classList.contains('is-dismissed')).toBe(true);
    control.click(); expect(help.classList.contains('is-dismissed')).toBe(false); expect(help.classList.contains('is-open')).toBe(true);
    control.dispatch('keydown', { key: 'Escape' }); hovering = false; help.dispatch('mouseleave');
    const outside = doc.createElement('input'); doc.body.append(outside); outside.focus(); help.dispatch('focusout', { relatedTarget: outside });
    expect(help.classList.contains('is-dismissed')).toBe(false);
  });
  it('routes hover-only Escape before native cancel and releases capture on modal disposal', () => {
    const doc = new Document(); const help = workspaceHelp(doc, { label: 'Synthetic help' }); help.matches = () => false; help.dispatch('mouseenter');
    const modal = workspaceDialog(doc, { headerTools: help });
    expect(doc.activeElement.getAttribute('aria-label')).toBe('閉じる');
    const first = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() }; modal.dispatch('keydown', first);
    expect(first.preventDefault).toHaveBeenCalledOnce(); expect(first.stopImmediatePropagation).toHaveBeenCalledOnce(); expect(modal.open).toBe(true);
    const second = { key: 'Escape', preventDefault: vi.fn() }; modal.dispatch('keydown', second); expect(second.preventDefault).not.toHaveBeenCalled();
    help.dispatch('mouseleave'); help.remove(); modal.dispatch('keydown', second); expect(second.preventDefault).not.toHaveBeenCalled();
    modal.dispose(); expect(modal.count('keydown')).toBe(0); expect(doc.count('keydown')).toBe(0);
  });
});

it('uses actual focus containment even if selector matching does not report focus-within', () => {
  const doc = new Document(); const help = workspaceHelp(doc, { label: 'Synthetic focus help' }); help.matches = () => false;
  const modal = workspaceDialog(doc, { headerTools: help }); help.children[0].focus();
  const event = { key: 'Escape', preventDefault: vi.fn() }; modal.dispatch('keydown', event);
  expect(event.preventDefault).toHaveBeenCalledOnce(); expect(modal.open).toBe(true); modal.dispose();
});

it('makes a flush anchored surface explicit while preserving default and muted padding classes', () => {
  const doc = new Document(); const anchor = doc.createElement('button'); doc.body.append(anchor);
  const normal = workspaceAnchoredPopover(doc, { anchor }); expect(normal.element.classList.contains('bb-ws-anchored-popover--flush')).toBe(false); normal.destroy();
  const muted = workspaceAnchoredPopover(doc, { anchor, surface: 'muted' }); expect(muted.element.classList.contains('bb-ws-anchored-popover--flush')).toBe(false); muted.destroy();
  const flush = workspaceAnchoredPopover(doc, { anchor, padding: 'none' }); expect(flush.element.classList.contains('bb-ws-anchored-popover--flush')).toBe(true); flush.destroy();
});

it('positions against a separate cell while leaving control semantics and focus on the original trigger', () => {
  const doc = new Document(); doc.defaultView.innerWidth = 800; doc.defaultView.innerHeight = 600;
  const trigger = doc.createElement('button'), cell = doc.createElement('div'); doc.body.append(cell); cell.append(trigger);
  trigger.getBoundingClientRect = () => ({ left: 310, right: 340, top: 330, bottom: 352, width: 30 });
  cell.getBoundingClientRect = () => ({ left: 300, right: 500, top: 220, bottom: 360, width: 200 });
  const pop = workspaceAnchoredPopover(doc, { anchor: trigger, positionAnchor: cell, align: 'center', placement: 'overlap' });
  pop.element.offsetWidth = 276; pop.element.offsetHeight = 182; pop.open();
  expect(pop.element.style.values.get('left')).toBe('262px'); expect(pop.element.style.values.get('top')).toBe('210px');
  expect(trigger.getAttribute('aria-controls')).toBe(pop.element.getAttribute('id')); expect(cell.getAttribute('aria-controls')).toBe(null);
  pop.close(); expect(doc.activeElement).toBe(trigger);
  pop.open(); doc.body.append(trigger); cell.remove(); pop.reposition(); expect(pop.isOpen).toBe(false); pop.open(); expect(pop.isOpen).toBe(false);
  doc.body.append(cell); pop.open(); expect(pop.isOpen).toBe(true); trigger.remove(); pop.reposition(); expect(pop.isOpen).toBe(false); pop.destroy();
});

it('opts into an icon button without removing its accessible name or activation handler', () => {
  const doc = new Document(); const activate = vi.fn();
  const button = workspaceButton(doc, { variant: 'icon', attrs: { 'aria-label': 'Synthetic settings' }, onClick: activate });
  button.append(workspaceActionIcon(doc, 'share')); button.click();
  expect(button.classList.contains('is-icon')).toBe(true); expect(button.getAttribute('aria-label')).toBe('Synthetic settings'); expect(activate).toHaveBeenCalledOnce();
  expect(workspaceButton(doc).classList.contains('is-icon')).toBe(false);
});
