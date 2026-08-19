import { describe, expect, it } from 'vitest';

import {
    resolveConversationPersonalKgIdentity,
    scopeConversationExtraction
} from '../../../scripts/oyasumi-conversation-personal-kg-v2.js';

describe('oyasumi conversation Personal KG v2 identity boundary', () => {
    it('requires explicit owner, actor, organization, and project identity', () => {
        expect(() => resolveConversationPersonalKgIdentity([], {}))
            .toThrow('personal_kg_owner_person_id_required');
        expect(() => resolveConversationPersonalKgIdentity(['--owner=person_a'], {}))
            .toThrow('personal_kg_actor_person_id_required');
    });

    it('canonicalizes a per-person alias without falling back to Sato', () => {
        const access = resolveConversationPersonalKgIdentity([], {
            BRAINBASE_PERSONAL_KG_OWNER_ALIASES_JSON: JSON.stringify({
                per_graph_sato: 'sato_keigo',
                per_graph_umeda: 'umeda_ryo'
            }),
            BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID: 'per_graph_umeda',
            BRAINBASE_PERSONAL_KG_ACTOR_PERSON_ID: 'per_graph_umeda',
            BRAINBASE_PERSONAL_KG_ORGANIZATION_ID: 'unson',
            BRAINBASE_PERSONAL_KG_PROJECT_CODE: 'back-office'
        });

        expect(access).toMatchObject({
            personId: 'umeda_ryo',
            actorPersonId: 'per_graph_umeda',
            organizationId: 'unson',
            projectCode: 'back-office'
        });
    });

    it('rewrites every extracted candidate to the authenticated scope and partitions IDs by owner', () => {
        const extracted = {
            date: '2026-08-19',
            adopted: [{
                id: 'oyasumi_20260819_conversation_personal_kg_core_rule',
                owner_person_id: 'sato_keigo',
                actor_person_id: 'sato_keigo',
                project_code: 'brainbase',
                org_ids: ['unson'],
                project_ids: ['brainbase'],
                permission_snapshot: {},
                body: 'Reusable decision'
            }],
            counts: {}
        };
        const umeda = scopeConversationExtraction(extracted, {
            personId: 'umeda_ryo', actorPersonId: 'per_graph_umeda',
            organizationId: 'unson', projectCode: 'back-office'
        });
        const sato = scopeConversationExtraction(extracted, {
            personId: 'sato_keigo', actorPersonId: 'per_graph_sato',
            organizationId: 'unson', projectCode: 'brainbase'
        });

        expect(umeda.adopted[0]).toMatchObject({
            owner_person_id: 'umeda_ryo',
            actor_person_id: 'per_graph_umeda',
            organization_id: 'unson',
            project_code: 'back-office',
            org_ids: ['unson'],
            project_ids: ['back-office'],
            recommended_owner_person_id: 'umeda_ryo'
        });
        expect(umeda.adopted[0].id).not.toBe(sato.adopted[0].id);
        expect(umeda.adopted[0].owner_person_id).not.toBe('sato_keigo');
    });
});