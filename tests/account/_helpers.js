// @ts-check
import { InMemoryAccountRepository } from '../../server/services/account/account-repository.js';
import { AccountService } from '../../server/services/account/account-service.js';

export function makeAccountService() {
    const repository = new InMemoryAccountRepository();
    const service = new AccountService({ repository });
    return { repository, service };
}

export function personalAccountInput(overrides = {}) {
    return {
        service: 'x',
        scope_type: 'personal',
        owner_person_id: 'sato_keigo',
        display_name: 'sato @ X corp',
        external_account_id: 'X-123',
        credential_ref: { provider: 'infisical', path: '/integrations/x/sato-corp', version: 'v1' },
        capabilities: ['post', 'read'],
        ...overrides
    };
}

export function orgAccountInput(overrides = {}) {
    return {
        service: 'x',
        scope_type: 'org',
        org_id: 'unson',
        display_name: 'Unson Official @ X',
        credential_ref: { provider: 'infisical', path: '/integrations/x/unson-official', version: 'v1' },
        capabilities: ['post', 'read'],
        ...overrides
    };
}

export function actor(sub = 'sato_keigo', overrides = {}) {
    return {
        sub,
        actor_person_id: sub,
        role: 'ceo',
        org_ids: ['unson', 'salestailor', 'techknight', 'baao'],
        projectCodes: ['brainbase', 'salestailor', 'techknight', 'baao', 'unson'],
        ...overrides
    };
}
