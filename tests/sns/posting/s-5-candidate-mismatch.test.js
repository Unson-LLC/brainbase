// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';
import { InMemoryCandidateRepository } from '../../../server/services/candidate-store/candidate-repository.js';

describe('posting S-5: candidate not promoted → reject', () => {
    it('S-5: source_candidate_id with status=candidate → reject', async () => {
        const stack = await makeStack();
        const repo = new InMemoryCandidateRepository();
        const c = repo.create({
            cognitive_type: 'observation', owner_person_id: 'sato_keigo',
            actor_person_id: 'sato_keigo', source_system: 'brainbase',
            source_event_ids: ['s1'], org_ids: ['unson'],
            visibility: 'owner', sensitivity: 'internal', body: 'b'
        });
        stack.posting.candidateRepository = repo;
        const r = await stack.posting.post(satoActor(), {
            account_id: stack.account.id, body: 'attempt', source_candidate_id: c.id
        });
        expect(r.posted).toBe(false);
        expect(r.reason).toBe('source-candidate-not-promoted');
    });
});
