// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft } from '../_helpers.js';
import { DuplicateCandidateError } from '../../../server/services/candidate-store/candidate-repository.js';

describe('candidate-store AP-3: duplicate source_event candidate rejected', () => {
    it('AP-3: second createCandidate with same source_event_ids/owner/source_system throws', async () => {
        const { service } = makeService();
        await service.createCandidate(baseDraft({ source_event_ids: ['session:dupe:1'] }));
        await expect(service.createCandidate(baseDraft({ source_event_ids: ['session:dupe:1'] })))
            .rejects.toThrow(DuplicateCandidateError);
    });

    it('AP-3: existing primary id is rejected before a different source key can overwrite it', async () => {
        const { repository } = makeService();
        const original = repository.create(baseDraft({
            id: 'candidate-stable-id',
            source_event_ids: ['session:original']
        }));

        expect(() => repository.create(baseDraft({
            id: 'candidate-stable-id',
            source_event_ids: ['session:conflicting'],
            body: 'must not overwrite original'
        }))).toThrow(DuplicateCandidateError);
        expect(repository.findById('candidate-stable-id')).toEqual(original);
    });
});
