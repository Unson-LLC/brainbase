import { describe, expect, it, vi } from 'vitest';
import { createMinutesPage, minutesListState, minutesDay, minutesDateCell } from '../../ui/meeting-minutes-page.js';

const documentRecord = (id, extra = {}) => ({ minutes_id: id, current_version_id: `${id}-current`, ...extra });
const currentState = (id, status) => ({ minutes_id: id, version_id: `${id}-current`, status });
const receipt = { actor_id: 'fixture-reviewer', confirmed_at: '2026-11-12T00:00:00Z' };
const doc = { createElement: tag => ({ tagName: tag.toUpperCase(), children: [], attributes: {},
  append(...nodes) { this.children.push(...nodes); }, setAttribute(key, value) { this.attributes[key] = value; } }) };

describe('meeting page confirmation state', () => {
  it('prioritizes any pending current document and ignores withdrawn documents', () => {
    const entry = { minutes: [documentRecord('a'), documentRecord('b')],
      current_version_states: [currentState('a', 'confirmed'), currentState('b', 'pending')] };
    expect(minutesListState(entry)).toEqual({ code: 'pending', label: '確認待ち' });
    expect(minutesListState({ ...entry, minutes: [...entry.minutes].reverse() })?.code).toBe('pending');
    expect(minutesListState({ ...entry, minutes: [documentRecord('a'), documentRecord('b', { withdrawal: {} })] })?.code).toBe('confirmed');
    expect(minutesListState({ minutes: [documentRecord('a', { withdrawal: {} })] })).toBeNull();
    expect(minutesListState({ minutes: [] })).toBeNull();
  });

  it('never labels a missing, unknown, or mismatched current state as confirmed', () => {
    const entry = { minutes: [documentRecord('a'), documentRecord('b')] };
    for (const states of [[currentState('a', 'confirmed')], [currentState('a', 'confirmed'), currentState('b', 'unknown')],
      [currentState('a', 'confirmed'), { ...currentState('b', 'confirmed'), version_id: 'b-old' }], []]) {
      expect(minutesListState({ ...entry, current_version_states: states })).toBeNull();
    }
    expect(minutesListState({ ...entry, current_version_states: [currentState('a', 'pending'), currentState('b', 'unknown')] })?.code).toBe('pending');
    // Explicit summary absence is authoritative; historical full versions cannot override it.
    expect(minutesListState({ minutes: [documentRecord('a')], current_version_states: [],
      versions: [{ version_id: 'a-current', confirmation: receipt }] })).toBeNull();
  });

  it('supports old APIs with top-level or document versions and checks the current ID', () => {
    const entry = { minutes: [documentRecord('a')], versions: [
      { version_id: 'a-old', confirmation: receipt }, { version_id: 'a-current' },
    ] };
    expect(minutesListState(entry)?.code).toBe('pending');
    expect(minutesListState({ minutes: [documentRecord('a', { versions: [{ version_id: 'a-current', confirmation: receipt }] })] })?.code).toBe('confirmed');
    expect(minutesListState({ ...entry, versions: [{ version_id: 'a-old', confirmation: receipt }] })).toBeNull();
    expect(minutesListState({ ...entry, versions: [{ version_id: 'a-current', confirmation: {} }] })).toBeNull();
  });
});

describe('meeting page Tokyo dates', () => {
  it('uses Tokyo midnight across UTC day and year boundaries', () => {
    expect(minutesDay('2026-11-11T14:59:59Z')).toBe('2026-11-11');
    expect(minutesDay('2026-11-11T15:00:00Z')).toBe('2026-11-12');
    expect(minutesDay('2026-12-31T15:00:00Z')).toBe('2027-01-01');
    for (const value of [undefined, null, '', 'invalid-date']) expect(minutesDay(value)).toBe('');
  });

  it('shows two-digit month/day, Tokyo weekday, and today across the UTC boundary', () => {
    const cell = minutesDateCell(doc, { scheduled_at: '2026-01-03T15:00:00Z' }, '2026-01-04T02:00:00Z');
    expect(cell.children.map(node => node.textContent)).toEqual(['01/04', '日']);
    expect(cell.className).toContain('is-today');
    expect(cell.title).toBe('今日');
    const otherDay = minutesDateCell(doc, { scheduled_at: '2026-01-03T14:59:59Z' }, '2026-01-04T02:00:00Z');
    expect(otherDay.children.map(node => node.textContent)).toEqual(['01/03', '土']);
    expect(otherDay.className).not.toContain('is-today');
    expect(otherDay.title).toBeUndefined();
  });

  it('keeps missing and invalid dates explicit', () => {
    for (const scheduled_at of [undefined, 'invalid-date']) {
      const cell = minutesDateCell(doc, { scheduled_at }, '2026-11-12T00:00:00Z');
      expect(cell.className).toBe('mp-nodate');
      expect(cell.textContent).toBe('日時なし');
      expect(cell.children).toHaveLength(0);
    }
  });
});

// Exercise the page's filter orchestration independently of layout/animation.
const controls = vi.hoisted(() => ({ boxes: [], buttons: [] }));
vi.mock('../../ui/workspace-kit.js?capability=search-band-v1', () => {
  const make = (doc, tag, { className = '', text = '', attrs = {} } = {}) => {
    const node = doc.createElement(tag); node.className = className; node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  return {
    makeWorkspaceElement: make,
    workspaceButton: (doc, options) => { const node = make(doc, 'button', options); node.click = options.onClick; controls.buttons.push(node); return node; },
    workspaceTopbar: doc => make(doc, 'header'), workspaceActionIcon: doc => make(doc, 'i'),
    workspaceTabStrip: () => ({ update() {}, destroy() {} }),
    workspaceConditionChips: (doc, options) => { const node = make(doc, 'div'); node.items = options.items; return node; },
    workspaceControlRow: (doc, options) => { const node = make(doc, 'div'); node.append(options.control); return node; },
    workspaceCombobox: (doc, options) => {
      const ctl = { root: make(doc, 'div'), ...options, update(next) { Object.assign(this, next); }, destroy() {} };
      controls.boxes.push(ctl); return ctl;
    },
    workspaceFilterPopover: (doc, options) => ({ root: options.content, panel: make(doc, 'div'), setOpen() {}, destroy() {} }),
    workspaceCardRow: doc => make(doc, 'div'), workspaceRowMotion: () => ({ play() {}, capture() {} }),
  };
});

function pageHarness(selected = []) {
  controls.boxes.length = 0; controls.buttons.length = 0;
  const createElement = tag => ({ tagName: tag.toUpperCase(), children: [], attributes: {}, classList: { add() {}, toggle() {} },
    append(...nodes) { this.children.push(...nodes); }, prepend(...nodes) { this.children.unshift(...nodes); },
    before() {}, replaceWith() {}, replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    querySelector(tag) { return this.children.find(child => child.tagName === tag.toUpperCase()); },
  });
  const doc = { createElement };
  const record = (id, project, participants, status = 'pending') => ({ meeting: { meeting_id: id, title: id, project_codes: [project], participant_ids: participants },
    minutes: [documentRecord(id)], current_version_states: [currentState(id, status)] });
  const entries = [record('a', 'alpha', ['self']), record('b', 'beta', ['self'], 'confirmed'), record('c', 'gamma', ['other'], 'confirmed')];
  const filter = { id: 'project', label: 'プロジェクト', multiple: true, values: selected,
    options: [{ value: '', label: 'すべて' }, ...['alpha', 'beta', 'gamma'].map(value => ({ value, label: value }))],
    matches: (entry, values) => !values.length || values.includes(entry.meeting.project_codes[0]),
    onChange(values) { if (h.blocked) h.deferred = () => { filter.values = values; h.render(); }; else filter.values = values; },
  };
  const state = { filters: { query: '', from: '', to: '', participant: '', status: '' } };
  const h = { filter, entries, state, render() { h.visible = page.render(h.entries); }, box() { return controls.boxes.find(box => box.label === 'プロジェクト'); },
    choose(value) { const box = h.box(); const option = box.options.find(option => option.value === value); box.onChange(value ? [...box.values.filter(v => v !== value), ...(box.values.includes(value) ? [] : [value])] : [], option); },
    recommend() { controls.buttons.find(button => button.textContent === 'おすすめ').click(); },
  };
  const page = createMinutesPage({ doc, state, toolbar: createElement('div'), listPane: createElement('div'), keyword: createElement('input'),
    clock: () => '2026-11-12T00:00:00Z', hostFilters: () => [filter], principalIds: () => ['self'],
    sortMeetings: entries => entries, matchesFilters: () => true, listState: minutesListState, versionNumber: () => 1,
    onRender: () => h.render(), canCreate: () => true,
  });
  h.render(); return h;
}

describe('meeting page project selection', () => {
  it('shows the same own projects in the picker and recommendation, including confirmed minutes', () => {
    const h = pageHarness();
    expect(h.box().values).toEqual(['alpha', 'beta']);
    expect(h.box().selectionLabel).toBe('自分の2つ');
    expect(h.visible.map(entry => entry.meeting.meeting_id)).toEqual(['a', 'b']);
    expect(h.filter.values).toEqual([]);
  });

  it('preserves explicit scope without a second hidden own-project condition', () => {
    const h = pageHarness(['gamma']);
    expect(h.box().values).toEqual(['gamma']);
    expect(h.box().selectionLabel).toBe('');
    expect(h.visible.map(entry => entry.meeting.meeting_id)).toEqual(['c']);
  });

  it('replaces mine with manual project checks and restores mine through its option or recommendation', () => {
    const h = pageHarness();
    h.choose('gamma');
    expect(h.filter.values).toEqual(['alpha', 'beta', 'gamma']);
    expect(h.box().selectionLabel).toBe('');
    expect(h.visible).toHaveLength(3);
    h.choose('__minutes_mine_projects__');
    expect(h.filter.values).toEqual([]);
    expect(h.box().values).toEqual(['alpha', 'beta']);
    h.choose('gamma'); h.recommend();
    expect(h.filter.values).toEqual([]);
    expect(h.box().selectionLabel).toBe('自分の2つ');
    expect(h.visible).toHaveLength(2);
  });

  it('keeps the accepted preset and checks while the host edit guard defers scope changes', () => {
    const h = pageHarness(); h.blocked = true;
    h.choose('gamma');
    expect(h.box().values).toEqual(['alpha', 'beta']);
    expect(h.box().selectionLabel).toBe('自分の2つ');
    expect(h.visible).toHaveLength(2);
    h.deferred();
    expect(h.box().values).toEqual(['alpha', 'beta', 'gamma']);
    expect(h.box().selectionLabel).toBe('');
    expect(h.visible).toHaveLength(3);
    h.recommend();
    expect(h.box().selectionLabel).toBe('');
    expect(h.filter.values).toEqual(['alpha', 'beta', 'gamma']);
    h.deferred();
    expect(h.box().selectionLabel).toBe('自分の2つ');
    expect(h.visible).toHaveLength(2);
  });

  it('recomputes own projects from the current snapshot after explicit scope is cleared', () => {
    const h = pageHarness(['alpha']); const all = h.entries;
    h.entries = [all[0]]; h.render();
    h.choose('__minutes_mine_projects__');
    expect(h.box().values).toEqual(['alpha']);
    h.entries = all; h.render();
    expect(h.box().values).toEqual(['alpha', 'beta']);
    expect(h.box().selectionLabel).toBe('自分の2つ');
  });
});
