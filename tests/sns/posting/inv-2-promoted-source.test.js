// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';
import { InMemoryCandidateRepository } from '../../../server/services/candidate-store/candidate-repository.js';

describe('posting INV-2: source_candidate must be promoted_to_graph', () => {
    it('INV-2: non-promoted candidate source → reject', async () => {
        const stack = await makeStack();
        const candidateRepo = new InMemoryCandidateRepository();
        const candidate = candidateRepo.create({
            cognitive_type: 'claim', owner_person_id: 'sato_keigo', actor_person_id: 'sato_keigo',
            source_system: 'curator', source_event_ids: ['c1'],
            org_ids: ['unson'], visibility: 'owner', sensitivity: 'internal',
            body: 'todo body'
        });
        stack.posting.candidateRepository = candidateRepo;
        const r = await stack.posting.post(satoActor(), {
            account_id: stack.account.id, body: 'x', source_candidate_id: candidate.id
        });
        expect(r.posted).toBe(false);
        expect(r.reason).toBe('source-candidate-not-promoted');
    });
});
