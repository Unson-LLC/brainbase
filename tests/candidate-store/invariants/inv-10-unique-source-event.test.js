// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft } from '../_helpers.js';
import { DuplicateCandidateError } from '../../../server/services/candidate-store/candidate-repository.js';

describe('candidate-store INV-10: duplicate (source_system, owner, source_event_ids) rejected', () => {
    it('INV-10: same source_event_ids twice throws DuplicateCandidateError', async () => {
        const { service } = makeService();
        await service.createCandidate(baseDraft({ source_event_ids: ['session:dup:1'] }));
        await expect(service.createCandidate(baseDraft({ source_event_ids: ['session:dup:1'] })))
            .rejects.toThrow(DuplicateCandidateError);
    });

    it('INV-10: same event for different owners is allowed', async () => {
        const { service } = makeService();
        await service.createCandidate(baseDraft({ source_event_ids: ['session:multi:1'] }));
        const result = await service.createCandidate(baseDraft({
            source_event_ids: ['session:multi:1'],
            owner_person_id: 'umeda',
            actor_person_id: 'umeda'
        }));
        expect(result.blocked).toBeFalsy();
        expect(result.candidate.owner_person_id).toBe('umeda');
    });
});
