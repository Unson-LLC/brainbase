import { describe, expect, it } from 'vitest';

import {
    canonicalPersonalKgAccess,
    canonicalPersonalKgOwner,
    isConfiguredPersonalKgOwner,
    personalKgOwnerConfig
} from '../../../server/services/personal-kg-owner.js';

describe('Personal KG owner canonicalization', () => {
    it('has no implicit owner and leaves an authenticated canonical person unchanged', () => {
        const config = personalKgOwnerConfig({});

        expect(config.ownerPersonId).toBeNull();
        expect(config.aliasToPersonId.size).toBe(0);
        expect(canonicalPersonalKgOwner('person_a', {})).toBe('person_a');
        expect(canonicalPersonalKgOwner(null, {})).toBeNull();
    });

    it('maps aliases independently for multiple canonical people', () => {
        const env = {
            BRAINBASE_PERSONAL_KG_OWNER_ALIASES_JSON: JSON.stringify({
                per_graph_sato: 'sato_keigo',
                slack_sato: 'sato_keigo',
                per_graph_umeda: 'umeda_ryo',
                slack_umeda: 'umeda_ryo'
            })
        };

        expect(canonicalPersonalKgOwner('per_graph_sato', env)).toBe('sato_keigo');
        expect(canonicalPersonalKgOwner('slack_umeda', env)).toBe('umeda_ryo');
        expect(isConfiguredPersonalKgOwner('sato_keigo', env)).toBe(true);
        expect(isConfiguredPersonalKgOwner('per_graph_umeda', env)).toBe(true);
        expect(isConfiguredPersonalKgOwner('unmapped_person', env)).toBe(false);
    });

    it('supports canonical-person keyed alias arrays', () => {
        const env = {
            BRAINBASE_PERSONAL_KG_OWNER_ALIASES_JSON: JSON.stringify({
                sato_keigo: ['per_graph_sato', 'slack_sato'],
                umeda_ryo: ['per_graph_umeda']
            })
        };

        expect(canonicalPersonalKgOwner('slack_sato', env)).toBe('sato_keigo');
        expect(canonicalPersonalKgOwner('per_graph_umeda', env)).toBe('umeda_ryo');
    });

    it('keeps explicit legacy configuration only as a migration input without adding a default', () => {
        const env = {
            BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID: 'sato_keigo',
            BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS: 'per_graph_sato,slack_sato'
        };
        const config = personalKgOwnerConfig(env);

        expect(config.ownerPersonId).toBe('sato_keigo');
        expect(config.aliasIds).toEqual(new Set(['per_graph_sato', 'slack_sato']));
        expect(canonicalPersonalKgOwner('per_graph_sato', env)).toBe('sato_keigo');
    });

    it('rejects conflicting and incomplete alias configuration', () => {
        expect(() => personalKgOwnerConfig({
            BRAINBASE_PERSONAL_KG_OWNER_ALIASES_JSON: JSON.stringify([
                { canonical_person_id: 'person_a', aliases: ['same_alias'] },
                { canonical_person_id: 'person_b', aliases: ['same_alias'] }
            ])
        })).toThrow('personal_kg_owner_alias_conflict:same_alias');

        expect(() => personalKgOwnerConfig({
            BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS: 'orphan_alias'
        })).toThrow('personal_kg_legacy_owner_required_for_aliases');
    });

    it('canonicalizes the owner while preserving the authenticated actor', () => {
        const env = {
            BRAINBASE_PERSONAL_KG_OWNER_ALIASES_JSON: JSON.stringify({ per_graph_sato: 'sato_keigo' })
        };
        const access = canonicalPersonalKgAccess({
            personId: 'per_graph_sato',
            organizationId: 'unson',
            actorPersonId: 'per_graph_sato'
        }, env);

        expect(access).toEqual({
            personId: 'sato_keigo',
            organizationId: 'unson',
            actorPersonId: 'per_graph_sato'
        });
    });
});