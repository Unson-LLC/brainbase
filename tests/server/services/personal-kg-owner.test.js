import { describe, expect, it } from 'vitest';
import {
    canonicalPersonalKgAccess,
    canonicalPersonalKgOwner,
    personalKgOwnerConfig
} from '../../../server/services/personal-kg-owner.js';

describe('Personal KG owner canonicalization', () => {
    const env = {
        BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID: 'sato_keigo',
        BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS: ' per_active_graph_id, per_merged_graph_id '
    };

    it('parses configured aliases and keeps the canonical owner', () => {
        const config = personalKgOwnerConfig(env);

        expect(config.ownerPersonId).toBe('sato_keigo');
        expect(config.aliasIds).toEqual(new Set(['per_active_graph_id', 'per_merged_graph_id']));
        expect(canonicalPersonalKgOwner('sato_keigo', env)).toBe('sato_keigo');
    });

    it('maps every configured alias to the canonical owner', () => {
        expect(canonicalPersonalKgOwner('per_active_graph_id', env)).toBe('sato_keigo');
        expect(canonicalPersonalKgOwner('per_merged_graph_id', env)).toBe('sato_keigo');
    });

    it('leaves an unrelated authenticated owner unchanged', () => {
        const access = {
            personId: 'person_other',
            organizationId: 'org_other'
        };

        expect(canonicalPersonalKgAccess(access, env)).toBe(access);
        expect(canonicalPersonalKgOwner('person_other', env)).toBe('person_other');
    });
});
