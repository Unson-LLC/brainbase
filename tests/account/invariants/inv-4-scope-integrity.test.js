// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, actor } from '../_helpers.js';
import { AccountValidationError } from '../../../server/services/account/account-repository.js';

describe('account INV-4: scope_type integrity with owner/org/project', () => {
    it('INV-4: scope_type=personal without owner_person_id → AccountValidationError', async () => {
        const { service } = makeAccountService();
        await expect(service.create({
            service: 'x', scope_type: 'personal',
            display_name: 'x', credential_ref: { provider: 'infisical', path: '/x' }
        }, actor())).rejects.toThrow(AccountValidationError);
    });

    it('INV-4: scope_type=org without org_id → AccountValidationError', async () => {
        const { service } = makeAccountService();
        await expect(service.create({
            service: 'x', scope_type: 'org',
            display_name: 'x', credential_ref: { provider: 'infisical', path: '/x' }
        }, actor())).rejects.toThrow(AccountValidationError);
    });

    it('INV-4: scope_type=project without project_id → AccountValidationError', async () => {
        const { service } = makeAccountService();
        await expect(service.create({
            service: 'x', scope_type: 'project',
            display_name: 'x', credential_ref: { provider: 'infisical', path: '/x' }
        }, actor())).rejects.toThrow(AccountValidationError);
    });
});
