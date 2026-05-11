// @ts-check
import { describe, it, expect } from 'vitest';
import { canRetrieve } from '../../access-contracts/helpers/rls-runner.js';

describe('candidate-store AP-2: candidate must NOT be readable via Graph SSOT retrieval', () => {
    it('AP-2: rls-runner rejects entity with storage=candidate-store as candidate-store-isolated', () => {
        const candidateAsGraphEntity = {
            id: 'cand_abc',
            storage: 'candidate-store',
            visibility: 'owner',
            org_ids: ['unson'],
            project_ids: ['brainbase'],
            team_id: null,
            owner_person_id: 'sato_keigo',
            sensitivity: 'internal',
            role_min: 'member',
            agency_level: 'synthesize'
        };
        const jwt = {
            sub: 'sato_keigo',
            role: 'ceo',
            level: 4,
            clearance: ['internal', 'restricted', 'confidential', 'top-secret'],
            projectCodes: ['brainbase', 'unson']
        };
        const result = canRetrieve(jwt, candidateAsGraphEntity);
        expect(result.allow).toBe(false);
        expect(result.reason).toBe('candidate-store-isolated');
    });
});
