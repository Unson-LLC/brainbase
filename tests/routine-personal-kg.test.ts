import { describe, expect, it } from 'vitest';

import { extractRoutinePersonalKgCandidates } from '../src/routines.js';

describe('routine Personal KG extraction boundary', () => {
  it('collects common result buckets and applies host dedupe', () => {
    const calls: Array<{ meeting: string; index: number }> = [];
    const result = extractRoutinePersonalKgCandidates({
      date: '2026-10-20',
      sourceSystem: 'test-meeting-source',
      meetings: [{ id: 'm1' }, { id: 'm2' }],
      extract: ({ meeting, index }) => {
        calls.push({ meeting: meeting.id, index });
        return {
          adopted: [{ id: meeting.id }, { id: 'shared' }],
          rejected: [{ id: `${meeting.id}:rejected` }],
          needs_review: [{ id: `${meeting.id}:review` }]
        };
      },
      dedupe: (candidates) => candidates.filter((candidate, index, all) => (
        all.findIndex((item) => item.id === candidate.id) === index
      ))
    });

    expect(calls).toEqual([{ meeting: 'm1', index: 0 }, { meeting: 'm2', index: 1 }]);
    expect(result).toEqual({
      date: '2026-10-20',
      source_system: 'test-meeting-source',
      counts: { adopted: 3, rejected: 2, needs_review: 2 },
      adopted: [{ id: 'm1' }, { id: 'shared' }, { id: 'm2' }],
      rejected: [{ id: 'm1:rejected' }, { id: 'm2:rejected' }],
      needs_review: [{ id: 'm1:review' }, { id: 'm2:review' }]
    });
  });

  it('treats missing meetings as an empty batch but validates the boundary', () => {
    expect(extractRoutinePersonalKgCandidates({
      date: '2026-10-20',
      sourceSystem: 'test-meeting-source',
      extract: () => ({})
    })).toEqual({
      date: '2026-10-20',
      source_system: 'test-meeting-source',
      counts: { adopted: 0, rejected: 0, needs_review: 0 },
      adopted: [],
      rejected: [],
      needs_review: []
    });

    expect(() => extractRoutinePersonalKgCandidates({
      date: '',
      sourceSystem: 'test-meeting-source',
      extract: () => ({})
    })).toThrow('routine Personal KG extraction date is required');
    expect(() => extractRoutinePersonalKgCandidates({
      date: '2026-10-20',
      sourceSystem: 'test-meeting-source',
      extract: null as never
    })).toThrow('routine Personal KG extraction callback is required');
  });

  it('propagates host extraction failures for explicit retry or review handling', () => {
    expect(() => extractRoutinePersonalKgCandidates({
      date: '2026-10-20',
      sourceSystem: 'test-meeting-source',
      meetings: [{ id: 'broken' }],
      extract: () => { throw new Error('host extraction failed'); }
    })).toThrow('host extraction failed');
  });
});
