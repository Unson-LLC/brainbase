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

    it('INV-2: waits for the candidate read before checking promotion status', async () => {
        const stack = await makeStack();
        stack.posting.candidateRepository = {
            async findById() {
                return {
                    id: 'candidate-promoted',
                    owner_person_id: 'sato_keigo',
                    actor_person_id: 'sato_keigo',
                    org_ids: ['unson'],
                    promotion_status: 'promoted_to_graph'
                };
            }
        };

        const result = await stack.posting.post(satoActor(), {
            account_id: stack.account.id,
            body: 'promoted source',
            source_candidate_id: 'candidate-promoted',
            dry_run: true
        });

        expect(result).toMatchObject({ posted: true, dry_run: true });
    });

    it('INV-2: rejects a promoted candidate owned by another person before provider use', async () => {
        const stack = await makeStack();
        stack.posting.candidateRepository = {
            async findById() {
                return {
                    id: 'candidate-other-owner',
                    owner_person_id: 'person_other',
                    actor_person_id: 'person_other',
                    org_ids: ['unson'],
                    promotion_status: 'promoted_to_graph'
                };
            }
        };

        const result = await stack.posting.post(satoActor(), {
            account_id: stack.account.id,
            body: 'must not post',
            source_candidate_id: 'candidate-other-owner'
        });

        expect(result).toEqual({ posted: false, reason: 'source-candidate-scope-mismatch' });
        expect(stack.xClient.calls.postTweet).toBe(0);
    });

    it('INV-2: rejects a promoted candidate from another organization before provider use', async () => {
        const stack = await makeStack();
        stack.posting.candidateRepository = {
            async findById() {
                return {
                    id: 'candidate-other-org',
                    owner_person_id: 'sato_keigo',
                    actor_person_id: 'sato_keigo',
                    org_ids: ['org_other'],
                    promotion_status: 'promoted_to_graph'
                };
            }
        };

        const result = await stack.posting.post(satoActor(), {
            account_id: stack.account.id,
            body: 'must not post',
            source_candidate_id: 'candidate-other-org'
        });

        expect(result).toEqual({ posted: false, reason: 'source-candidate-scope-mismatch' });
        expect(stack.xClient.calls.postTweet).toBe(0);
    });
});
