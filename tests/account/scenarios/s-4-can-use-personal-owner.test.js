// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, personalAccountInput, actor } from '../_helpers.js';

describe('account S-4: canUseForPost personal owner allow', () => {
    it('S-4: owner can use own personal account', async () => {
        const { service } = makeAccountService();
        const acc = await service.create(personalAccountInput(), actor());
        const result = await service.canUseForPost(acc.id, actor());
        expect(result.allow).toBe(true);
    });
});
