import { describe, expect, it } from 'vitest';

import {
    assertPersonalKgCandidateScope,
    isPersonalKgCandidateInScope,
    requirePersonalKgIdentity
} from '../../../server/services/sns/personal-kg-identity.js';

const ACCESS = {
    owner_person_id: 'person_a',
    actor_person_id: 'person_a',
    organization_id: 'org_a'
};

describe('Personal KG identity boundary', () => {
    it('requires explicit owner, actor, and organization', () => {
        expect(() => requirePersonalKgIdentity(null)).toThrow('personal_kg_access_context_required');
        expect(() => requirePersonalKgIdentity({ actor_person_id: 'person_a', organization_id: 'org_a' }))
            .toThrow('personal_kg_owner_person_id_required');
        expect(() => requirePersonalKgIdentity({ owner_person_id: 'person_a', organization_id: 'org_a' }))
            .toThrow('personal_kg_actor_person_id_required');
        expect(() => requirePersonalKgIdentity({ owner_person_id: 'person_a', actor_person_id: 'person_a' }))
            .toThrow('personal_kg_organization_id_required');
    });

    it('canonicalizes explicit aliases and rejects undelegated actor mismatch', () => {
        expect(requirePersonalKgIdentity({
            owner_person_id: 'per_a',
            actor_person_id: 'per_a',
            organization_id: 'org_a'
        }, {
            BRAINBASE_PERSONAL_KG_OWNER_ALIASES_JSON: JSON.stringify({ per_a: 'person_a' })
        })).toMatchObject({
            owner_person_id: 'person_a',
            actor_person_id: 'person_a',
            organization_id: 'org_a'
        });
        expect(() => requirePersonalKgIdentity({
            owner_person_id: 'person_a',
            actor_person_id: 'person_b',
            organization_id: 'org_a'
        })).toThrow('personal_kg_verified_delegation_required');
        expect(() => requirePersonalKgIdentity({
            owner_person_id: 'person_a',
            actor_person_id: 'person_b',
            organization_id: 'org_a',
            delegation_receipt_id: 'forged'
        })).toThrow('personal_kg_verified_delegation_required');
    });

    it('scopes reads by owner and tenant while allowing a delegated creation actor', () => {
        const candidate = {
            owner_person_id: 'person_a',
            actor_person_id: 'person_a',
            organization_id: 'org_a'
        };
        expect(assertPersonalKgCandidateScope(candidate, ACCESS)).toBe(candidate);
        expect(isPersonalKgCandidateInScope({ ...candidate, owner_person_id: 'person_b' }, ACCESS)).toBe(false);
        expect(isPersonalKgCandidateInScope({ ...candidate, actor_person_id: 'person_b' }, ACCESS)).toBe(true);
        expect(isPersonalKgCandidateInScope({ ...candidate, organization_id: 'org_b' }, ACCESS)).toBe(false);
        expect(isPersonalKgCandidateInScope({
            owner_person_id: 'person_a',
            actor_person_id: 'person_a',
            org_ids: ['org_a', 'org_b']
        }, ACCESS)).toBe(false);
    });

    it('can require the candidate actor to match at the write boundary', () => {
        expect(() => assertPersonalKgCandidateScope({
            owner_person_id: 'person_a',
            actor_person_id: 'person_b',
            organization_id: 'org_a'
        }, ACCESS, {}, { requireActorMatch: true })).toThrow('personal_kg_candidate_actor_mismatch');
    });
});
