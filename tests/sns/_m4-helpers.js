// @ts-check
import { InMemoryAccountRepository } from '../../server/services/account/account-repository.js';
import { AccountService } from '../../server/services/account/account-service.js';
import { ProviderRegistry } from '../../server/services/account/provider-registry.js';
import { InMemoryXClient } from '../../server/services/sns/providers/x-client.js';
import { buildXProvider } from '../../server/services/sns/providers/x-provider.js';
import { PostingService } from '../../server/services/sns/posting-service.js';
import { FeedbackService } from '../../server/services/sns/feedback-service.js';

export async function makeStack({ withAccount = true } = {}) {
    const accountRepo = new InMemoryAccountRepository();
    const accountService = new AccountService({ repository: accountRepo });
    const xClient = new InMemoryXClient();
    const providerRegistry = new ProviderRegistry();
    const xProvider = buildXProvider({ xClient, oauthSecret: 'test-secret' });
    providerRegistry.register(xProvider);

    let createdAccount = null;
    if (withAccount) {
        createdAccount = await accountService.create({
            service: 'x',
            scope_type: 'personal',
            owner_person_id: 'sato_keigo',
            display_name: 'sato @X',
            credential_ref: { provider: 'infisical', path: '/integrations/x/sato', version: 'v1' },
            capabilities: ['post', 'read']
        }, { actor_person_id: 'sato_keigo' });
    }

    const graphEvents = [];
    const graphWriter = {
        async createEvent(e) { const id = `evt_${graphEvents.length + 1}`; graphEvents.push({ id, ...e }); return { id }; },
        async appendEvent(e) { const id = `evt_${graphEvents.length + 1}`; graphEvents.push({ id, ...e }); return { id }; },
        events: graphEvents
    };

    const posting = new PostingService({ accountService, providerRegistry, graphWriter });
    const feedback = new FeedbackService({ xClient, graphWriter });

    return { accountRepo, accountService, xClient, providerRegistry, xProvider, posting, feedback, graphWriter, graphEvents, account: createdAccount };
}

export function satoActor(overrides = {}) {
    return {
        sub: 'sato_keigo',
        actor_person_id: 'sato_keigo',
        role: 'ceo',
        org_ids: ['unson'],
        projectCodes: ['brainbase'],
        ...overrides
    };
}
