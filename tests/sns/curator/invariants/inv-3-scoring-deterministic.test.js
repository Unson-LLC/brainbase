// @ts-check
import { describe, it, expect } from 'vitest';
import { scoreDraftCandidate } from '../../../../server/services/sns/curator-scoring.js';
import { sourceInsight, viewer } from '../_helpers.js';

describe('sns-curator INV-3: scoring is deterministic', () => {
    it('INV-3: same input produces identical score and breakdown', () => {
        const src = sourceInsight();
        const v = viewer();
        const r1 = scoreDraftCandidate(src, v, []);
        const r2 = scoreDraftCandidate(src, v, []);
        expect(r1).toEqual(r2);
    });
});
