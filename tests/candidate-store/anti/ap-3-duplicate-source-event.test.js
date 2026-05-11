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
});
