// @ts-check
import { describe, it, expect } from 'vitest';
import { makeCurator, sourceInsight, viewer } from '../_helpers.js';

describe('sns-curator INV-2: drafts saved as candidate-store entries (visibility=owner, type=claim)', () => {
    it('INV-2: saveDraftsToCandidateStore creates candidate with proper shape', async () => {
        const { curator, candidateService } = makeCurator({ entities: [sourceInsight()] });
        const drafts = await curator.generateDrafts(viewer(), { limit: 5 });
        const saved = await curator.saveDraftsToCandidateStore(drafts, viewer());
        expect(saved.length).toBeGreaterThan(0);
        const list = candidateService.listCandidates({}, null);
        expect(list[0].cognitive_type).toBe('claim');
        expect(list[0].visibility).toBe('owner');
        expect(list[0].owner_person_id).toBe('sato_keigo');
    });
});
