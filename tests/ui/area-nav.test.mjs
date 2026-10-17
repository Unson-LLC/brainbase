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

// The organization edition's destinations after the 2026-10-17 revision of
// ledger D10 (story-shell-nav-destinations-v1): every line is a destination,
// grouped under small headings, with 設定 at the bottom.
const DESTINATION_SECTIONS = [
  { id: 'meetings', label: '会議' },
  { id: 'project', label: 'プロジェクト', screenId: 'projects' },
  { id: 'explore', label: '調べる' },
  { id: 'bottom', label: null, placement: 'footer' },
];
const one = (id, section) => ({ id, label: null, screenIds: [id], ...(section ? { section } : {}) });
const DESTINATION_AREAS = [
  one('inbox'), one('world'), one('tasks'), one('connections'),
  one('calendar', 'meetings'), one('meeting-minutes', 'meetings'), one('meeting-triage', 'meetings'),
  one('company-os', 'project'),
  one('knowledge', 'explore'), one('value-proofs', 'explore'), one('graph', 'explore'),
  { id: 'settings', label: '設定', section: 'bottom', defaultScreen: 'settings', screenIds: ['settings', 'members', 'ontology', 'developer-health'] },
];
const DESTINATION_SCREENS = [
  { id: 'inbox', label: '受信箱' }, { id: 'world', label: '世界' }, { id: 'tasks', label: 'タスク' }, { id: 'connections', label: 'アプリ' },
  { id: 'calendar', label: '予定' }, { id: 'meeting-minutes', label: '議事録' }, { id: 'meeting-triage', label: '振り分け待ち' },
  { id: 'projects', label: 'プロジェクト' }, { id: 'company-os', label: '目的と現状' },
  { id: 'knowledge', label: '知識' }, { id: 'value-proofs', label: '判断の履歴' }, { id: 'graph', label: '情報と関係' },
  { id: 'settings', label: '組織の設定' }, { id: 'members', label: 'メンバーと権限' }, { id: 'ontology', label: '情報の種類とつながり方' },
  { id: 'developer-health', label: '健康状態', hidden: true },
];

function buildDestinations(options = {}) {
  const selected = [];
  const linkSelections = [];
  const nav = createAreaNav({
    document: doc,
    sections: DESTINATION_SECTIONS,
    areas: DESTINATION_AREAS,
    screens: DESTINATION_SCREENS,
    memory: createAreaMemory(new MemoryStorage()),
    hrefFor: (id) => `?screen=${id}`,
    onSelect: (id) => selected.push(id),
    onSelectLink: (id) => linkSelections.push(id),
    ...options,
  });
  const groups = () => nav.nav.children;
  const group = (id) => groups().find((entry) => entry.attributes['data-section'] === id);
  const all = (node, predicate, found = []) => {
    if (predicate(node)) found.push(node);
    for (const child of node.children) all(child, predicate, found);
    return found;
  };
  // Links that show now (a heading that does not open a screen is a hidden link).
  const linksIn = (node) => all(node, (entry) => entry.tagName === 'A' && !entry.hidden);
  // The heading shown now: a link to its screen, or plain text.
  const heading = (id) => group(id).children.slice(0, 2).find((entry) => !entry.hidden);
  const shape = () => groups().filter((entry) => !entry.hidden).map((entry) => [
    entry.attributes['data-section'] ?? null,
    entry.attributes['data-placement'] ?? 'main',
    linksIn(entry).filter((link) => !link.hidden).map((link) => [text(link), link.attributes.href ?? null]),
  ]);
  return { nav, selected, linkSelections, group, heading, linksIn, shape };
}

describe('destination navigation (ledger D10, 2026-10-17 revision)', () => {
  it('lists the destinations themselves on the left, grouped under small headings, with 設定 at the bottom (AC-01, AC-02)', () => {
    const { shape } = buildDestinations();
    expect(shape()).toEqual([
      [null, 'main', [['受信箱', '?screen=inbox'], ['世界', '?screen=world'], ['タスク', '?screen=tasks'], ['アプリ', '?screen=connections']]],
      ['meetings', 'main', [['予定', '?screen=calendar'], ['議事録', '?screen=meeting-minutes'], ['振り分け待ち', '?screen=meeting-triage']]],
      // The heading of プロジェクト opens the list of all projects.
      ['project', 'main', [['プロジェクト', '?screen=projects'], ['目的と現状', '?screen=company-os']]],
      ['explore', 'main', [['知識', '?screen=knowledge'], ['判断の履歴', '?screen=value-proofs'], ['情報と関係', '?screen=graph']]],
      ['bottom', 'footer', [['設定', '?screen=settings']]],
    ]);
  });

  it('labels each section with its heading, and none for the top one (AC-01)', () => {
    const { group, heading } = buildDestinations();
    expect(group('meetings').attributes['aria-label']).toBe('会議');
    expect(text(heading('meetings'))).toBe('会議');
    expect(heading('bottom')).toBeUndefined();
    expect(group('bottom').attributes['aria-label']).toBeUndefined();
  });

  it('opens the heading screen from the heading and marks it current while it is shown (AC-02)', () => {
    const { nav, heading, selected } = buildDestinations();
    expect(heading('project').tagName).toBe('A');
    heading('project').click();
    expect(selected).toEqual(['projects']);
    nav.show('projects');
    expect(heading('project').attributes['aria-current']).toBe('page');
    expect(nav.tabs.hidden).toBe(true);
    nav.show('company-os');
    expect(heading('project').attributes['aria-current']).toBeUndefined();
  });

  it('shows the heading as plain text when its screen is hidden (AC-02)', () => {
    const { nav, heading } = buildDestinations();
    nav.setHidden('projects', true);
    expect(heading('project').tagName).not.toBe('A');
    expect(text(heading('project'))).toBe('プロジェクト');
  });

  it('puts the caller\'s links at the top of a section, and removes them again (AC-03)', () => {
    const { nav, group, linksIn, linkSelections } = buildDestinations();
    nav.setLinks('project', [
      { id: 'brainbase', label: 'Brainbase', href: '?screen=projects&project=brainbase' },
      { id: 'zeims', label: 'Zeims', href: '?screen=projects&project=zeims', count: 2, current: true },
    ]);
    const names = () => linksIn(group('project')).map((link) => [text(link), link.attributes.href, link.attributes['aria-current'] ?? null]);
    expect(names()).toEqual([
      ['プロジェクト', '?screen=projects', null],
      ['Brainbase', '?screen=projects&project=brainbase', null],
      ['Zeims2', '?screen=projects&project=zeims', 'page'],
      ['目的と現状', '?screen=company-os', null],
    ]);
    const zeims = linksIn(group('project')).find((link) => link.attributes['data-link'] === 'zeims');
    expect(zeims.children.find((child) => child.className === 'bb-area-count').attributes['aria-label']).toBe('待っているもの2件');
    zeims.click();
    expect(linkSelections).toEqual(['zeims']);
    nav.setLinks('project', []);
    expect(names().map(([label]) => label)).toEqual(['プロジェクト', '目的と現状']);
  });

  it('hides a section whose destinations are all hidden, heading and all (AC-04)', () => {
    const { nav, group, shape } = buildDestinations();
    for (const id of ['calendar', 'meeting-minutes', 'meeting-triage']) nav.setHidden(id, true);
    expect(group('meetings').hidden).toBe(true);
    expect(shape().map(([id]) => id)).toEqual([null, 'project', 'explore', 'bottom']);
    nav.setHidden('meeting-minutes', false);
    expect(group('meetings').hidden).toBe(false);
    // A section of only links shows while it has one.
    const linksOnly = createAreaNav({
      document: doc,
      sections: [{ id: 'starred', label: '星付き' }],
      areas: [],
      screens: [],
    });
    const starred = linksOnly.nav.children[0];
    expect(starred.hidden).toBe(true);
    linksOnly.setLinks('starred', [{ id: 'a', label: 'A', href: '#a' }]);
    expect(starred.hidden).toBe(false);
  });

  it('shows tabs only for the destination with more than one screen (AC-05)', () => {
    const { nav } = buildDestinations();
    nav.show('meeting-minutes');
    expect(nav.tabs.hidden).toBe(true);
    nav.show('members');
    expect(nav.tabs.hidden).toBe(false);
    expect(nav.tabs.attributes['aria-label']).toBe('設定の画面');
    expect(nav.tabs.children.map((tab) => tab.attributes['data-screen-tab'])).toEqual(['settings', 'members', 'ontology']);
  });

  it('adds waiting counts to the destination itself (AC-01)', () => {
    const { nav, group, linksIn } = buildDestinations();
    nav.setCount('inbox', 5, { waiting: true }).setCount('meeting-triage', 3, { waiting: true }).setCount('tasks', 40);
    const top = linksIn(nav.nav.children[0]).map((link) => text(link));
    expect(top).toEqual(['受信箱5', '世界', 'タスク', 'アプリ']);
    expect(linksIn(group('meetings')).map((link) => text(link))).toEqual(['予定', '議事録', '振り分け待ち3']);
  });
});
