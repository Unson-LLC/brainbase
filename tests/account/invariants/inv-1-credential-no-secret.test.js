// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, personalAccountInput, actor } from '../_helpers.js';
import { CredentialSecretLeakError } from '../../../server/services/account/account-repository.js';

describe('account INV-1: credential_ref must not contain secret keys', () => {
    it('INV-1: access_token in credential_ref → CredentialSecretLeakError', async () => {
        const { service } = makeAccountService();
        const input = personalAccountInput({
            credential_ref: { provider: 'infisical', path: '/x', access_token: 'xxx' }
        });
        await expect(service.create(input, actor())).rejects.toThrow(CredentialSecretLeakError);
    });

    it('INV-1: api_key in credential_ref → CredentialSecretLeakError', async () => {
        const { service } = makeAccountService();
        await expect(service.create(personalAccountInput({
            credential_ref: { provider: 'infisical', path: '/x', api_key: 'k' }
        }), actor())).rejects.toThrow(CredentialSecretLeakError);
    });
});
