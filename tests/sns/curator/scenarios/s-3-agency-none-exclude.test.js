// @ts-check
import { describe, it, expect } from 'vitest';
import { makeCurator, sourceInsight, viewer } from '../_helpers.js';

describe('sns-curator S-3: agency_level=none excluded from source', () => {
    it('S-3: locked agency entities never reach drafts', async () => {
        const { curator } = makeCurator({
            entities: [
                sourceInsight('open', { agency_level: 'synthesize' }),
                sourceInsight('locked', { agency_level: 'none' })
            ]
        });
        const drafts = await curator.generateDrafts(viewer());
        for (const d of drafts) {
            expect(d.source_entity_id).not.toBe('locked');
        }
    });
});
