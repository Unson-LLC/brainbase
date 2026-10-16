import { describe, expect, it } from 'vitest';
import { createAreaMemory, createAreaNav, resolveAreaTarget } from '../../ui/area-nav.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.hidden = false;
  }

  append(...children) { for (const child of children) if (child) this.children.push(child); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  click() { this.listeners.get('click')?.({ preventDefault() {} }); }
}

const doc = { createElement: (tag) => new FakeElement(tag) };
const text = (node) => `${node.textContent}${node.children.map(text).join('')}`;

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

// The organization edition's areas (ledger D10), used as a realistic example.
const AREAS = [
  { id: 'world', label: null, screenIds: ['world'] },
  { id: 'work', label: '仕事', defaultScreen: 'tasks', screenIds: ['projects', 'tasks', 'calendar', 'meeting-minutes', 'meeting-triage', 'knowledge'] },
  { id: 'outcomes', label: '成果', screenIds: ['value-proofs'] },
  { id: 'settings', label: '設定', defaultScreen: 'connections', screenIds: ['connections', 'members', 'settings', 'atlas', 'developer-health'] },
];
const SCREENS = [
  { id: 'world', label: '世界' },
  { id: 'projects', label: 'プロジェクト' },
  { id: 'tasks', label: 'タスク' },
  { id: 'calendar', label: '予定' },
  { id: 'meeting-minutes', label: '議事録' },
  { id: 'meeting-triage', label: '会議の振り分け' },
  { id: 'knowledge', label: '知識' },
  { id: 'value-proofs', label: '判断の履歴' },
  { id: 'connections', label: 'アプリ' },
  { id: 'members', label: 'メンバーと権限' },
  { id: 'settings', label: '組織の設定' },
  { id: 'atlas', label: 'アーキテクチャ地図', href: '/atlas', external: true, hidden: true },
  { id: 'developer-health', label: '健康状態', hidden: true },
];

function build(options = {}) {
  const selected = [];
  const storage = options.storage ?? new MemoryStorage();
  const nav = createAreaNav({
    document: doc,
    areas: AREAS,
    screens: SCREENS,
    memory: createAreaMemory(storage),
    hrefFor: (id) => `?screen=${id}`,
    onSelect: (id) => selected.push(id),
    ...options,
  });
  const areaLink = (id) => nav.nav.children.find((link) => link.attributes['data-area'] === id);
  const tabIds = () => nav.tabs.children.map((tab) => tab.attributes['data-screen-tab']);
  return { nav, selected, storage, areaLink, tabIds };
}

describe('area navigation (ledger D10, stage 2)', () => {
  it('lists only the areas on the left, each a link to a screen address', () => {
    const { nav, areaLink } = build();
    expect(nav.nav.children.map((link) => text(link))).toEqual(['世界', '仕事', '成果', '設定']);
    expect(areaLink('work').attributes.href).toBe('?screen=tasks');
    expect(areaLink('settings').attributes.href).toBe('?screen=connections');
  });

  it('shows the tabs of the current area, and none for an area with one screen', () => {
    const { nav, tabIds } = build();
    nav.show('meeting-minutes');
    expect(nav.tabs.hidden).toBe(false);
    expect(nav.tabs.attributes['aria-label']).toBe('仕事の画面');
    expect(tabIds()).toEqual(['projects', 'tasks', 'calendar', 'meeting-minutes', 'meeting-triage', 'knowledge']);
    const current = nav.tabs.children.filter((tab) => tab.attributes['aria-current'] === 'page');
    expect(current.map((tab) => tab.attributes.href)).toEqual(['?screen=meeting-minutes']);
    nav.show('value-proofs');
    expect(nav.tabs.hidden).toBe(true);
    expect(nav.tabs.children).toEqual([]);
  });

  it('marks the area of the shown screen as current', () => {
    const { nav, areaLink } = build();
    nav.show('calendar');
    expect(areaLink('work').attributes['aria-current']).toBe('page');
    expect(areaLink('world').attributes['aria-current']).toBeUndefined();
  });

  it('opens the screen last used in an area, remembered in the browser storage', () => {
    const storage = new MemoryStorage();
    const first = build({ storage });
    first.nav.show('meeting-minutes');
    expect(first.areaLink('work').attributes.href).toBe('?screen=meeting-minutes');
    first.areaLink('work').click();
    expect(first.selected).toEqual(['meeting-minutes']);
    // A later page load reads the same memory.
    const second = build({ storage });
    expect(second.areaLink('work').attributes.href).toBe('?screen=meeting-minutes');
    expect(second.nav.targetFor('work')).toBe('meeting-minutes');
  });

  it('falls back to the default screen when the storage cannot be read or written', () => {
    const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    const { nav, areaLink } = build({ storage: broken });
    expect(() => nav.show('calendar')).not.toThrow();
    expect(areaLink('work').attributes.href).toBe('?screen=tasks');
    const garbage = new MemoryStorage();
    garbage.setItem('brainbase.area-nav.last-screen.v1', '{not json');
    expect(build({ storage: garbage }).nav.targetFor('work')).toBe('tasks');
  });

  it('ignores a remembered screen that is no longer shown', () => {
    const storage = new MemoryStorage();
    storage.setItem('brainbase.area-nav.last-screen.v1', JSON.stringify({ settings: 'developer-health', work: 'gone' }));
    const { nav } = build({ storage });
    expect(nav.targetFor('settings')).toBe('connections');
    expect(nav.targetFor('work')).toBe('tasks');
  });

  it('keeps hidden screens out of the tabs and the targets, and hides an area with none shown', () => {
    const { nav, tabIds } = build();
    nav.show('connections');
    expect(tabIds()).toEqual(['connections', 'members', 'settings']);
    nav.setHidden('atlas', false).setHidden('developer-health', false);
    expect(tabIds()).toEqual(['connections', 'members', 'settings', 'atlas', 'developer-health']);
    const atlas = nav.tabs.children.find((tab) => tab.attributes['data-screen-tab'] === 'atlas');
    expect([atlas.attributes.href, atlas.attributes.target, atlas.attributes.rel]).toEqual(['/atlas', '_blank', 'noopener']);
    const only = createAreaNav({
      document: doc,
      areas: [{ id: 'dev', label: '開発者', screenIds: ['developer-health'] }],
      screens: [{ id: 'developer-health', label: '健康状態', hidden: true }],
    });
    expect(only.nav.children[0].hidden).toBe(true);
    only.setHidden('developer-health', false);
    expect(only.nav.children[0].hidden).toBe(false);
  });

  it('never opens or remembers an external link', () => {
    const area = { id: 'settings', defaultScreen: 'atlas', screens: [{ id: 'atlas', external: true }, { id: 'members' }] };
    expect(resolveAreaTarget(area, { remembered: 'atlas' })).toBe('members');
    const storage = new MemoryStorage();
    const { nav } = build({ storage });
    nav.setHidden('atlas', false).show('atlas');
    expect(storage.getItem('brainbase.area-nav.last-screen.v1')).toBeNull();
  });

  it('puts counts on tabs, and adds only waiting counts to the area link', () => {
    const { nav, areaLink } = build();
    nav.show('tasks');
    nav.setCount('tasks', 42).setCount('meeting-triage', 3, { waiting: true });
    const tab = (id) => nav.tabs.children.find((entry) => entry.attributes['data-screen-tab'] === id);
    expect(text(tab('tasks'))).toBe('タスク42');
    expect(text(tab('meeting-triage'))).toBe('会議の振り分け3');
    expect(text(areaLink('work'))).toBe('仕事3');
    const badge = areaLink('work').children.find((child) => child.className === 'bb-area-count');
    expect(badge.attributes['aria-label']).toBe('待っているもの3件');
    nav.setCount('meeting-triage', 0, { waiting: true });
    expect(text(areaLink('work'))).toBe('仕事');
    nav.setCount('tasks', null);
    expect(text(tab('tasks'))).toBe('タスク');
  });

  it('selects a screen from its tab', () => {
    const { nav, selected } = build();
    nav.show('projects');
    nav.tabs.children.find((tab) => tab.attributes['data-screen-tab'] === 'knowledge').click();
    expect(selected).toEqual(['knowledge']);
  });
});
