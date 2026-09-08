// @ts-check
import { describe, it, expect } from 'vitest';
import { makeCurator, sourceInsight, viewer } from '../_helpers.js';

describe('sns-curator INV-2: lifelog drafts saved as owner-visible observations', () => {
    it('INV-2: writes owner, actor, and organization from explicit Personal KG identity', async () => {
        const { curator, candidateService } = makeCurator({ entities: [sourceInsight()] });
        const drafts = await curator.generateDrafts(viewer(), { limit: 5 });
        const saved = await curator.saveDraftsToCandidateStore(drafts, viewer());
        expect(saved.length).toBeGreaterThan(0);
        const list = candidateService.listCandidates({}, null);
        expect(list[0].cognitive_type).toBe('observation');
        expect(list[0].visibility).toBe('owner');
        expect(list[0].owner_person_id).toBe('sato_keigo');
        expect(list[0].actor_person_id).toBe('sato_keigo');
        expect(list[0].organization_id).toBe('unson');
        expect(list[0].permission_snapshot.personal_kg_identity).toEqual({
            owner_person_id: 'sato_keigo',
            actor_person_id: 'sato_keigo',
            organization_id: 'unson'
        });
    });
});
