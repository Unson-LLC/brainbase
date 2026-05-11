// @ts-check
import { describe, it, expect } from 'vitest';
import { makeCurator, sourceInsight, viewer } from '../_helpers.js';

describe('sns-curator INV-4: draft has derived_from reference to source entity', () => {
    it('INV-4: draft.derived_from points to source entity id', async () => {
        const { curator } = makeCurator({ entities: [sourceInsight('ent_x')] });
        const drafts = await curator.generateDrafts(viewer());
        expect(drafts[0].derived_from).toEqual(['ent_x']);
        expect(drafts[0].source_entity_id).toBe('ent_x');
    });
});
