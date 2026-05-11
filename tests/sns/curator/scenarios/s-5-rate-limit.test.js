// @ts-check
import { describe, it, expect } from 'vitest';
import { makeCurator, sourceInsight, viewer } from '../_helpers.js';

describe('sns-curator S-5: rate limit', () => {
    it('S-5: saveDraftsToCandidateStore stops at dailyLimit', async () => {
        const entities = Array.from({ length: 10 }, (_, i) =>
            sourceInsight(`e${i}`, { body: `entry ${i} codex` })
        );
        const { curator } = makeCurator({ entities, dailyLimit: 3 });
        const drafts = await curator.generateDrafts(viewer(), { limit: 10 });
        const saved = await curator.saveDraftsToCandidateStore(drafts, viewer());
        expect(saved.length).toBe(3);
    });
});
