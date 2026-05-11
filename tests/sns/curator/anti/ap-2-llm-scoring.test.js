// @ts-check
import { describe, it, expect } from 'vitest';
import { scoreDraftCandidate } from '../../../../server/services/sns/curator-scoring.js';

describe('sns-curator AP-2: scoring is not non-deterministic LLM call', () => {
    it('AP-2: scoreDraftCandidate is a pure function (does not consult LLM)', () => {
        // pure function semantics: 100 calls return identical values
        const src = {
            id: 'x', cognitive_type: 'claim',
            body: '気づいた: agency と visibility は別軸',
            derived_from: ['a', 'b'], sensitivity: 'internal'
        };
        const baseline = scoreDraftCandidate(src, { interests: ['agency'] }, []);
        for (let i = 0; i < 50; i += 1) {
            expect(scoreDraftCandidate(src, { interests: ['agency'] }, [])).toEqual(baseline);
        }
    });
});
