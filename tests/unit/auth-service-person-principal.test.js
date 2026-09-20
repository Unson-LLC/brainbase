import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../server/services/auth-service.js';

describe('AuthService canonical person resolution', () => {
    it('旧Slack sessionの署名済みsubjectを既存のcanonical personへ解決する', async () => {
        const authService = Object.create(AuthService.prototype);
        authService.findUserByExternalIdentity = vi.fn(async () => ({ person_id: 'per_sato' }));

        const personId = await authService.resolvePersonIdForAuthenticatedAccess({
            personId: 'U07LNUP582X',
            slackUserId: 'U07LNUP582X',
            slackWorkspaceId: 'T_UNSON',
            organizationId: 'unson'
        });

        expect(authService.findUserByExternalIdentity).toHaveBeenCalledWith({
            provider: 'slack',
            subject: 'U07LNUP582X',
            tenantId: 'T_UNSON'
        }, 'unson');
        expect(personId).toBe('per_sato');
    });

    it('既存identityがcanonical personを返さない場合は未解決のままにする', async () => {
        const authService = Object.create(AuthService.prototype);
        authService.findUserByExternalIdentity = vi.fn(async () => ({ person_id: 'U07LNUP582X' }));

        await expect(authService.resolvePersonIdForAuthenticatedAccess({
            personId: 'U07LNUP582X',
            authProvider: 'slack',
            providerSubject: 'U07LNUP582X'
        })).resolves.toBeNull();
    });

    it('旧sessionのworkspace claimが古くても署名済みorganization内のgrantだけで本人を解決する', async () => {
        const authService = Object.create(AuthService.prototype);
        authService.findUserByExternalIdentity = vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ person_id: 'per_sato' });

        await expect(authService.resolvePersonIdForAuthenticatedAccess({
            personId: 'U07LNUP582X',
            slackUserId: 'U07LNUP582X',
            slackWorkspaceId: 'T_OLD',
            organizationId: 'techknight'
        })).resolves.toBe('per_sato');

        expect(authService.findUserByExternalIdentity).toHaveBeenNthCalledWith(1, {
            provider: 'slack',
            subject: 'U07LNUP582X',
            tenantId: 'T_OLD'
        }, 'techknight');
        expect(authService.findUserByExternalIdentity).toHaveBeenNthCalledWith(2, {
            provider: 'slack',
            subject: 'U07LNUP582X',
            tenantId: null
        }, 'techknight');
    });

    it('organization claimがない旧sessionではworkspace不一致を緩和しない', async () => {
        const authService = Object.create(AuthService.prototype);
        authService.findUserByExternalIdentity = vi.fn().mockResolvedValue(null);

        await expect(authService.resolvePersonIdForAuthenticatedAccess({
            personId: 'U07LNUP582X',
            slackUserId: 'U07LNUP582X',
            slackWorkspaceId: 'T_OLD'
        })).resolves.toBeNull();

        expect(authService.findUserByExternalIdentity).toHaveBeenCalledTimes(1);
    });
});
