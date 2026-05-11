// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft } from '../_helpers.js';

describe('candidate-store INV-1: graph SSOT isolation', () => {
    it('INV-1: candidate-store records are not visible to Graph SSOT retrievers', async () => {
        const { service, repository } = makeService();
        await service.createCandidate(baseDraft());
        // listCandidates with no viewer returns full set (admin view)
        const admin = repository.list();
        expect(admin).toHaveLength(1);
        // listCandidates filtered by an outsider should NOT leak
        const outsiderView = service.listCandidates({}, {
            sub: 'umeda',
            org_ids: ['unson'],
            team_ids: [],
            project_ids: []
        });
        expect(outsiderView).toHaveLength(0);
    });
});
