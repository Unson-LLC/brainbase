// @ts-check
import { describe, expect, it } from 'vitest';

import {
    parseArgs,
    viewer
} from '../../../scripts/generate-personal-kg-sns-weekly-pack.js';

describe('generate personal KG SNS weekly pack CLI', () => {
    it('accepts explicit identity flags in equals form', () => {
        expect(parseArgs([
            '--owner-person-id=sato_keigo',
            '--actor-person-id=sato_keigo',
            '--organization-id=unson',
            '--start-date=2026-09-07',
            '--lookback-days=30'
        ])).toMatchObject({
            ownerPersonId: 'sato_keigo',
            actorPersonId: 'sato_keigo',
            organizationId: 'unson',
            startDate: '2026-09-07',
            lookbackDays: 30
        });
    });

    it('resolves an explicit same-person Personal KG identity', () => {
        expect(viewer({
            ownerPersonId: 'sato_keigo',
            actorPersonId: 'sato_keigo',
            organizationId: 'unson'
        }, {})).toMatchObject({
            sub: 'sato_keigo',
            owner_person_id: 'sato_keigo',
            actor_person_id: 'sato_keigo',
            organization_id: 'unson',
            org_ids: ['unson']
        });
    });

    it('fails closed when owner, actor, or organization is omitted', () => {
        expect(() => viewer({}, {})).toThrow('personal_kg_owner_person_id_required');
        expect(() => viewer({ ownerPersonId: 'sato_keigo' }, {}))
            .toThrow('personal_kg_actor_person_id_required');
        expect(() => viewer({ ownerPersonId: 'sato_keigo', actorPersonId: 'sato_keigo' }, {}))
            .toThrow('personal_kg_organization_id_required');
    });
});
