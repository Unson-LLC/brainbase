// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, actor } from '../_helpers.js';
import { AccountValidationError } from '../../../server/services/account/account-repository.js';

describe('account AP-4: scope_type=personal without owner_person_id rejected', () => {
    it('AP-4: missing owner_person_id with scope_type=personal → AccountValidationError', async () => {
        const { service } = makeAccountService();
        await expect(service.create({
            service: 'x',
            scope_type: 'personal',
            display_name: 'no-owner',
            credential_ref: { provider: 'infisical', path: '/x/no-owner' }
        }, actor())).rejects.toThrow(AccountValidationError);
    });
});
