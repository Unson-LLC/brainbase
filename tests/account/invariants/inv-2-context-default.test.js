// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, personalAccountInput, actor } from '../_helpers.js';

describe('account INV-2: default is context-keyed, not service-global', () => {
    it('INV-2: same service, different purpose can have different defaults', async () => {
        const { service } = makeAccountService();
        const a1 = await service.create(personalAccountInput({ display_name: 'a1' }), actor());
        const a2 = await service.create(personalAccountInput({
            display_name: 'a2',
            external_account_id: 'X-2',
            credential_ref: { provider: 'infisical', path: '/x/a2', version: 'v1' }
        }), actor());

        await service.setDefault({
            subject_type: 'person', subject_id: 'sato_keigo',
            service: 'x', purpose: 'post', account_id: a1.id
        }, actor());
        await service.setDefault({
            subject_type: 'person', subject_id: 'sato_keigo',
            service: 'x', purpose: 'read', account_id: a2.id
        }, actor());

        const postDefault = await service.getDefault('person', 'sato_keigo', 'x', 'post');
        const readDefault = await service.getDefault('person', 'sato_keigo', 'x', 'read');
        expect(postDefault.id).toBe(a1.id);
        expect(readDefault.id).toBe(a2.id);
    });
});
