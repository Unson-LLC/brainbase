// @ts-check
import { describe, it, expect } from 'vitest';
import { makeCurator, sourceInsight, viewer } from '../_helpers.js';

describe('sns-curator INV-6: daily rate limit', () => {
    it('INV-6: overflow drafts are skipped, not saved', async () => {
        const entities = Array.from({ length: 5 }, (_, i) =>
            sourceInsight(`ent_${i}`, { body: `body ${i} codex` })
        );
        const { curator } = makeCurator({ entities, dailyLimit: 2 });
        const drafts = await curator.generateDrafts(viewer(), { limit: 5 });
        const saved = await curator.saveDraftsToCandidateStore(drafts, viewer());
        expect(saved.length).toBe(2);
    });
});
