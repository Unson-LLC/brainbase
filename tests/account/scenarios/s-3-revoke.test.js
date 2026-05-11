// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, personalAccountInput, actor } from '../_helpers.js';

describe('account S-3: revoke', () => {
    it('S-3: revoke sets status=revoked and writes REVOKED audit', async () => {
        const { service } = makeAccountService();
        const acc = await service.create(personalAccountInput(), actor());
        const r = await service.revoke(acc.id, actor());
        expect(r.status).toBe('revoked');
        const audit = await service.listAudit(acc.id);
        expect(audit.at(-1).action).toBe('REVOKED');
    });

    it('S-3: revoked account canUseForPost → deny status-revoked', async () => {
        const { service } = makeAccountService();
        const acc = await service.create(personalAccountInput(), actor());
        await service.revoke(acc.id, actor());
        const result = await service.canUseForPost(acc.id, actor());
        expect(result.allow).toBe(false);
        expect(result.reason).toBe('status-revoked');
    });
});
