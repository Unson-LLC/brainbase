// @ts-check
import { describe, expect, it, vi } from 'vitest';

import { InMemoryAccountRepository } from '../../../../server/services/account/account-repository.js';
import { GoogleServiceConnectionService } from '../../../../server/services/auth/google-service-connection-service.js';
import {
    GOOGLE_MEET_READ_SCOPES,
    GOOGLE_SERVICE_SCOPES
} from '../../../../server/services/auth/providers/google-workspace-auth-provider.js';

function provider() {
    return {
        exchangeGoogleServiceCode: vi.fn(async (service) => ({
            access_token: `${service}-access`,
            // Incremental Google authorization may omit refresh_token.
        })),
        fetchUserInfo: vi.fn(async () => ({
            email: 'woody@growin.jp',
            email_verified: true,
            hd: 'growin.jp'
        })),
        resolveIdentity: vi.fn((profile) => ({
            subject: profile.email,
            email: profile.email,
            tenantId: profile.hd
        }))
    };
}

describe('GoogleServiceConnectionService', () => {
    it('keeps one shared Google account while recording service-specific capabilities', async () => {
        const authProvider = provider();
        const credentialStore = {
            store: vi.fn(async (input) => ({ credential_ref: `credref://${input.connection_id}` })),
            revoke: vi.fn()
        };
        const accountRepository = new InMemoryAccountRepository();
        const service = new GoogleServiceConnectionService({
            provider: authProvider,
            credentialStore,
            accountRepository,
            idFactory: () => 'fixed'
        });

        const gmail = await service.connect({
            service: 'gmail', code: 'gmail-code', req: {},
            personId: 'per_woody', organizationId: 'growin', idempotencyKey: 'gmail-state'
        });
        const calendar = await service.connect({
            service: 'google-calendar', code: 'calendar-code', req: {},
            personId: 'per_woody', organizationId: 'growin', idempotencyKey: 'calendar-state'
        });

        const accounts = await accountRepository.list({ service: 'google' });
        expect(accounts).toHaveLength(1);
        expect(calendar.account_id).toBe(gmail.account_id);
        expect(accounts[0].capabilities).toEqual(expect.arrayContaining([
            ...GOOGLE_SERVICE_SCOPES.gmail,
            ...GOOGLE_SERVICE_SCOPES['google-calendar']
        ]));
        expect(accounts[0].metadata.google_services).toEqual(expect.objectContaining({
            gmail: expect.objectContaining({ scopes: [...GOOGLE_SERVICE_SCOPES.gmail] }),
            'google-calendar': expect.objectContaining({ scopes: [...GOOGLE_SERVICE_SCOPES['google-calendar']] })
        }));
        expect(credentialStore.store).toHaveBeenNthCalledWith(1, expect.not.objectContaining({
            credential_refresh_material: expect.anything()
        }));
        // The second incremental grant did not return a refresh token, so the
        // existing opaque credential binding remains the single source of
        // long-lived credential material.
        expect(credentialStore.store).toHaveBeenCalledTimes(1);
        expect(JSON.stringify({ gmail, calendar, accounts })).not.toContain('-access');
        expect(JSON.stringify({ gmail, calendar, accounts })).not.toContain('refresh');
    });

    it('does not clear the existing refresh material during incremental authorization', async () => {
        const authProvider = provider();
        const credentialStore = {
            store: vi.fn()
                .mockResolvedValueOnce({ credential_ref: 'credref://shared/1' })
                .mockResolvedValueOnce({ credential_ref: 'credref://shared/2' }),
            revoke: vi.fn()
        };
        const accountRepository = new InMemoryAccountRepository();
        const service = new GoogleServiceConnectionService({
            provider: authProvider,
            credentialStore,
            accountRepository,
            idFactory: () => 'fixed'
        });

        await service.connect({
            service: 'gmail', code: 'first-code', req: {},
            personId: 'per_woody', organizationId: 'growin', idempotencyKey: 'first-state'
        });
        authProvider.exchangeGoogleServiceCode.mockResolvedValueOnce({
            access_token: 'calendar-access', refresh_token: 'new-refresh'
        });
        await service.connect({
            service: 'google-calendar', code: 'second-code', req: {},
            personId: 'per_woody', organizationId: 'growin', idempotencyKey: 'second-state'
        });

        expect(credentialStore.store).toHaveBeenNthCalledWith(1, expect.not.objectContaining({
            credential_refresh_material: expect.anything()
        }));
        expect(credentialStore.store).toHaveBeenNthCalledWith(2, expect.objectContaining({
            credential_refresh_material: 'new-refresh'
        }));
    });

    it('returns tenant-scoped status without exposing credential material', async () => {
        const accountRepository = new InMemoryAccountRepository();
        const service = new GoogleServiceConnectionService({
            provider: provider(),
            credentialStore: {
                store: vi.fn(async () => ({ credential_ref: 'credref://drive' })),
                revoke: vi.fn()
            },
            accountRepository,
            idFactory: () => 'fixed'
        });
        await service.connect({
            service: 'google-drive', code: 'drive-code', req: {},
            personId: 'per_woody', organizationId: 'growin', idempotencyKey: 'drive-state'
        });

        const status = await service.status({
            service: 'google-drive', personId: 'per_woody', organizationId: 'growin'
        });
        expect(status).toMatchObject({
            service: 'google-drive',
            connected: true,
            status: 'connected',
            account: {
                account_id: expect.any(String),
                status: 'connected',
                required_capabilities: [...GOOGLE_SERVICE_SCOPES['google-drive']]
            }
        });
        expect(JSON.stringify(status)).not.toContain('access');
        await expect(service.status({
            service: 'google-drive', personId: 'other-person', organizationId: 'growin'
        })).resolves.toMatchObject({
            connected: false,
            status: 'not_connected',
            account: null
        });
    });

    it('migrates an existing Meet account row into the shared Google account', async () => {
        const authProvider = provider();
        const credentialStore = {
            store: vi.fn(async () => ({ credential_ref: 'credref://should-not-be-called' })),
            revoke: vi.fn()
        };
        const accountRepository = new InMemoryAccountRepository();
        const legacy = accountRepository.create({
            id: 'acc_google_meet_legacy',
            service: 'google-meet',
            scope_type: 'personal',
            owner_person_id: 'per_woody',
            org_id: 'growin',
            display_name: 'woody@growin.jp Google Meet',
            external_account_id: 'woody@growin.jp',
            external_handle: 'woody@growin.jp',
            credential_ref: {
                provider: 'brainbase-credential-store',
                path: 'credref://legacy-google'
            },
            oauth_client_ref: { provider: 'google-workspace', mode: 'shared-client' },
            capabilities: [...GOOGLE_MEET_READ_SCOPES],
            metadata: {
                connection_id: 'google-meet-legacy',
                connection_revision: '1'
            },
            created_by_person_id: 'per_woody'
        });
        const service = new GoogleServiceConnectionService({
            provider: authProvider,
            credentialStore,
            accountRepository,
            idFactory: () => 'new'
        });

        const result = await service.connect({
            service: 'gmail', code: 'gmail-code', req: {},
            personId: 'per_woody', organizationId: 'growin', idempotencyKey: 'gmail-migration-state'
        });

        expect(result.account_id).toBe(legacy.id);
        expect(credentialStore.store).not.toHaveBeenCalled();
        const canonical = await accountRepository.list({ service: 'google' });
        const meetRows = await accountRepository.list({ service: 'google-meet' });
        expect(canonical).toHaveLength(1);
        expect(meetRows).toHaveLength(0);
        expect(canonical[0]).toMatchObject({
            id: legacy.id,
            credential_ref: {
                provider: 'brainbase-credential-store',
                path: 'credref://legacy-google'
            },
            metadata: {
                connection_id: 'google-meet-legacy',
                connection_revision: '1',
                google_services: {
                    gmail: { scopes: [...GOOGLE_SERVICE_SCOPES.gmail] }
                }
            }
        });
    });
});
