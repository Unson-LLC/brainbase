// @ts-check
import { describe, it, expect } from 'vitest';
import { scoreDraftCandidate } from '../../../../server/services/sns/curator-scoring.js';
import { sourceInsight, viewer } from '../_helpers.js';

describe('sns-curator S-4: scoring deterministic over repeat', () => {
    it('S-4: same input yields identical score across 5 calls', () => {
        const src = sourceInsight();
        const v = viewer();
        const results = Array.from({ length: 5 }, () => scoreDraftCandidate(src, v, []));
        for (let i = 1; i < results.length; i += 1) {
            expect(results[i]).toEqual(results[0]);
        }
    });
});
