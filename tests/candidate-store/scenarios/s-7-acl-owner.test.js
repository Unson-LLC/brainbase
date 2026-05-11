// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft } from '../_helpers.js';

describe('candidate-store S-7: visibility=owner is hidden from other actors', () => {
    it('S-7: umeda cannot see sato\'s owner-private candidate', async () => {
        const { service } = makeService();
        await service.createCandidate(baseDraft({ owner_person_id: 'sato_keigo', actor_person_id: 'sato_keigo' }));
        const umedaView = service.listCandidates({}, {
            sub: 'umeda',
            org_ids: ['unson'],
            project_ids: ['brainbase'],
            team_ids: []
        });
        expect(umedaView).toHaveLength(0);

        const satoView = service.listCandidates({}, {
            sub: 'sato_keigo',
            org_ids: ['unson'],
            project_ids: ['brainbase'],
            team_ids: []
        });
        expect(satoView).toHaveLength(1);
    });
});
