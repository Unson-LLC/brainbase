import { describe, expect, it, vi } from 'vitest';
vi.mock('../../workspace-kit.js', () => import('../../ui/workspace-kit.js'));
import { projectWorldWork } from '../../src/world-extension.js';
import { workCanvasNotes } from '../../ui/world/world-canvas-notes.js';

const business = { id: 'example', code: 'example', name: 'Example' };
const complete = { state: 'complete', items: [] };
const projected = (tasks = complete, extra = {}) => projectWorldWork({ business, tasks, persons: complete, decisions: complete, relations: complete, ...extra }, { now: new Date('2026-10-09T06:00:00Z') });

describe('canvas notices preserve the canonical read-state boundary', () => {
  it('does not fabricate a warning for an actual complete zero', () => {
    expect(workCanvasNotes(projected()).filter((note) => note.summary)).toEqual([]);
  });
  it.each(['failed', 'forbidden', 'not_connected'])('never converts %s task data to zero', (state) => {
    const notes = workCanvasNotes(projected({ state, reason: 'upstream_timeout' }));
    expect(notes.some((note) => note.summary?.startsWith('仕事：'))).toBe(true);
    expect(notes.some((note) => note.label === '記録の確認')).toBe(false);
    expect(notes.map((note) => note.text).join('')).toContain('0件とは限りません');
  });
  it('keeps partial data separate from task record gaps', () => {
    const notes = workCanvasNotes(projected({ state: 'partial', reason: 'codes_not_permitted', items: [{ id: 't1', title: 'A', status: 'waiting', project_codes: ['example'] }] }));
    expect(notes.find((note) => note.label === '区画の仕事').summary).toBe('仕事：一部だけ読めた');
    const gaps = notes.find((note) => note.label === '記録の確認');
    expect(gaps.summary).toBe('記録の要確認 1件');
    expect(gaps.text).toContain('止まっているという意味ではありません');
  });
  it('surfaces unavailable secondary sources without declaring task failure', () => {
    const notes = workCanvasNotes(projected(complete, { decisions: { state: 'failed' }, persons: { state: 'forbidden' } }));
    expect(notes.map((note) => note.summary).filter(Boolean)).toEqual(['人物：権限がなく読めない', '方針の決定：読込失敗']);
  });
  it('keeps unavailable responses and missing timestamps explicit', () => {
    expect(workCanvasNotes({ status: 'unavailable', reason: 'HTTP 502' })[0]).toMatchObject({ summary: '仕事：読めない（0件ではありません）' });
    expect(workCanvasNotes(projected()).at(-1).text).toContain('時点不明');
  });
});
