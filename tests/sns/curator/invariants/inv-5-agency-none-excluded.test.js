// @ts-check
import { describe, it, expect } from 'vitest';
import { makeCurator, sourceInsight, viewer } from '../_helpers.js';

describe('sns-curator INV-5: agency_level=none entities excluded', () => {
    it('INV-5: agency=none source is not listed and no draft generated', async () => {
        const { curator } = makeCurator({
            entities: [
                sourceInsight('ent_synth', { body: '気づいた: codex委譲は集中力を保ちやすい' }),
                sourceInsight('ent_locked', { body: '気づいた: agencyを切る', agency_level: 'none' })
            ]
        });
        const sources = await curator.listSourceEntities(viewer());
        expect(sources.map((e) => e.id)).toEqual(['ent_synth']);
        const drafts = await curator.generateDrafts(viewer());
        expect(drafts.every((d) => d.source_entity_id !== 'ent_locked')).toBe(true);
    });
});
