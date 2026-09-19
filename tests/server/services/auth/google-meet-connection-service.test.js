// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { InMemoryAccountRepository } from '../../../../server/services/account/account-repository.js';
import { GoogleMeetConnectionService } from '../../../../server/services/auth/google-meet-connection-service.js';
import { GOOGLE_MEET_READ_SCOPES } from '../../../../server/services/auth/providers/google-workspace-auth-provider.js';

function provider() {
    return {
        buildMeetAuthorizationUrl: vi.fn(() => 'https://accounts.google.test/authorize'),
        exchangeMeetCode: vi.fn(async () => ({ access_token: 'access-secret', refresh_token: 'refresh-secret' })),
        fetchUserInfo: vi.fn(async () => ({ email: 'woody@growin.jp', email_verified: true, hd: 'growin.jp' })),
        resolveIdentity: vi.fn((profile) => ({ subject: profile.email, email: profile.email, tenantId: profile.hd }))
    };
}

describe('GoogleMeetConnectionService', () => {
    it('stores token material only in the credential store and returns a sanitized account', async () => {
        const authProvider = provider();
        const credentialStore = {
            store: vi.fn(async () => ({ credential_ref: 'credref://growin/google-meet/woody' })),
            revoke: vi.fn()
        };
        const accountRepository = new InMemoryAccountRepository();
        const service = new GoogleMeetConnectionService({
            provider: authProvider, credentialStore, accountRepository, idFactory: () => 'fixed'
        });

        const result = await service.connect({
            code: 'code', personId: 'woody', organizationId: 'growin', idempotencyKey: 'state-digest'
        });

        expect(credentialStore.store).toHaveBeenCalledWith(expect.objectContaining({
            credential_material: 'access-secret', credential_refresh_material: 'refresh-secret'
        }));
        const account = accountRepository.findById(result.account_id);
        expect(account?.credential_ref).toEqual({
            provider: 'brainbase-credential-store', path: 'credref://growin/google-meet/woody'
        });
        expect(account?.capabilities).toEqual(GOOGLE_MEET_READ_SCOPES);
        expect(JSON.stringify({ result, account })).not.toContain('access-secret');
        expect(JSON.stringify({ result, account })).not.toContain('refresh-secret');
    });

    it('revokes an orphaned credential when account registration fails', async () => {
        const credentialStore = {
            store: vi.fn(async () => ({ credential_ref: 'credref://orphan' })),
            revoke: vi.fn(async () => ({ status: 'revoked' }))
        };
        const service = new GoogleMeetConnectionService({
            provider: provider(), credentialStore,
            accountRepository: { create: vi.fn(async () => { throw new Error('db failed'); }) },
            idFactory: () => 'fixed'
        });

        await expect(service.connect({
            code: 'code', personId: 'woody', organizationId: 'growin', idempotencyKey: 'state-digest'
        })).rejects.toThrow('db failed');
        expect(credentialStore.revoke).toHaveBeenCalledWith(expect.objectContaining({
            credential_ref: 'credref://orphan', reason: 'account_registration_failed'
        }));
    });
});
