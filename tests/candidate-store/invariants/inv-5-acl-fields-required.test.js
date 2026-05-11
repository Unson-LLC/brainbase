// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft } from '../_helpers.js';
import { ACLFieldMissingError } from '../../../server/services/candidate-store/candidate-repository.js';

describe('candidate-store INV-5: ACL fields required', () => {
    it('INV-5: missing visibility throws ACLFieldMissingError', async () => {
        const { service } = makeService();
        const draft = baseDraft();
        delete draft.visibility;
        await expect(service.createCandidate(draft)).rejects.toThrow(ACLFieldMissingError);
    });

    it('INV-5: missing owner_person_id throws ACLFieldMissingError', async () => {
        const { service } = makeService();
        const draft = baseDraft();
        delete draft.owner_person_id;
        await expect(service.createCandidate(draft)).rejects.toThrow(ACLFieldMissingError);
    });

    it('INV-5: missing org_ids throws ACLFieldMissingError', async () => {
        const { service } = makeService();
        const draft = baseDraft();
        delete draft.org_ids;
        await expect(service.createCandidate(draft)).rejects.toThrow(ACLFieldMissingError);
    });
});
