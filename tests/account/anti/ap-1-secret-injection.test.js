// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, personalAccountInput, actor } from '../_helpers.js';
import { CredentialSecretLeakError } from '../../../server/services/account/account-repository.js';

describe('account AP-1: secret injection into credential_ref rejected', () => {
    it.each(['access_token', 'refresh_token', 'password', 'secret', 'token'])('AP-1: forbidden key %s', async (key) => {
        const { service } = makeAccountService();
        await expect(service.create(personalAccountInput({
            credential_ref: { provider: 'infisical', path: '/x', [key]: 'xxx' }
        }), actor())).rejects.toThrow(CredentialSecretLeakError);
    });
});
