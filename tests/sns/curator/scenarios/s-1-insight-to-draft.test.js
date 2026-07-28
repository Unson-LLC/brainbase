// @ts-check
import { describe, it, expect } from 'vitest';
import { makeCurator, sourceInsight, sourceDecision, viewer } from '../_helpers.js';

describe('sns-curator S-1: recent insight → draft recommendation', () => {
    it('S-1: returns drafts with scores, sorted desc', async () => {
        const { curator } = makeCurator({
            entities: [
                sourceInsight('i1'),
                sourceDecision('d1')
            ]
        });
        const drafts = await curator.generateDrafts(viewer(), { limit: 5 });
        expect(drafts.length).toBeGreaterThan(0);
        expect(drafts[0].score).toBe(1);
        for (let i = 1; i < drafts.length; i += 1) {
            expect(drafts[i - 1].score).toBeGreaterThanOrEqual(drafts[i].score);
        }
    });
});
