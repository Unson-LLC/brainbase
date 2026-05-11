// @ts-check
import { describe, it, expect } from 'vitest';
import { makeCurator, sourceInsight, viewer } from '../_helpers.js';

describe('sns-curator S-2: saveDraftsToCandidateStore creates candidate', () => {
    it('S-2: each saved entry returns { candidate, scoreBreakdown, score }', async () => {
        const { curator, candidateService } = makeCurator({ entities: [sourceInsight()] });
        const drafts = await curator.generateDrafts(viewer());
        const saved = await curator.saveDraftsToCandidateStore(drafts, viewer());
        expect(saved[0].candidate.cognitive_type).toBe('claim');
        expect(saved[0].scoreBreakdown).toBeTruthy();
        expect(typeof saved[0].score).toBe('number');
        expect(candidateService.listCandidates({}, null)).toHaveLength(1);
    });
});
