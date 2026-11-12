import { describe, expect, it } from 'vitest';
import { minutesListState, minutesDay, minutesDateCell } from '../../ui/meeting-minutes-page.js';

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
