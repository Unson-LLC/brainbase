// @ts-check
import { describe, expect, it } from 'vitest';

import {
    assertSnsRecordAuthority,
    requireSnsAuthority,
    snsAuthorityFromRequest
} from '../../../server/services/sns/sns-authority.js';

describe('SNS authority', () => {
    it('derives owner, actor, and organization only from authenticated access', () => {
        expect(snsAuthorityFromRequest({
            access: {
                personId: 'per_owner',
                organizationId: 'org_unson',
                role: 'ceo',
                projectCodes: ['brainbase']
            }
        })).toMatchObject({
            owner_person_id: 'per_owner',
            actor_person_id: 'per_owner',
            organization_id: 'org_unson',
            sub: 'per_owner',
            org_ids: ['org_unson']
        });
    });

    it('fails closed when person or organization is missing', () => {
        expect(() => requireSnsAuthority({ organization_id: 'org_unson' })).toThrow('owner_person_id is required');
        expect(() => requireSnsAuthority({ person_id: 'per_owner' })).toThrow('organization_id is required');
    });

    it('rejects an unverified delegated actor', () => {
        expect(() => requireSnsAuthority({
            owner_person_id: 'per_owner',
            actor_person_id: 'per_other',
            organization_id: 'org_unson'
        })).toThrow('delegated SNS authority is not configured');
    });

    it('rejects cross-person and cross-organization records', () => {
        const authority = requireSnsAuthority({
            person_id: 'per_owner',
            organization_id: 'org_unson'
        });
        expect(() => assertSnsRecordAuthority({
            owner_person_id: 'per_other',
            organization_id: 'org_unson'
        }, authority)).toThrow('outside the authenticated authority scope');
        expect(() => assertSnsRecordAuthority({
            owner_person_id: 'per_owner',
            organization_id: 'org_other'
        }, authority)).toThrow('outside the authenticated authority scope');
    });
});
