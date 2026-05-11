// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, personalAccountInput, actor } from '../_helpers.js';

describe('account S-2: setDefault overwrites existing default per context', () => {
    it('S-2: setDefault(corp) then setDefault(personal) → default is personal', async () => {
        const { service } = makeAccountService();
        const corp = await service.create(personalAccountInput({
            display_name: 'corp',
            external_account_id: 'X-corp',
            credential_ref: { provider: 'infisical', path: '/x/corp', version: 'v1' }
        }), actor());
        const personal = await service.create(personalAccountInput({
            display_name: 'personal',
            external_account_id: 'X-personal',
            credential_ref: { provider: 'infisical', path: '/x/personal', version: 'v1' }
        }), actor());
        await service.setDefault({
            subject_type: 'person', subject_id: 'sato_keigo',
            service: 'x', purpose: 'post', account_id: corp.id
        }, actor());
        await service.setDefault({
            subject_type: 'person', subject_id: 'sato_keigo',
            service: 'x', purpose: 'post', account_id: personal.id
        }, actor());
        const d = await service.getDefault('person', 'sato_keigo', 'x', 'post');
        expect(d.id).toBe(personal.id);
    });
});
