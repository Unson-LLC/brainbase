// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, personalAccountInput, actor } from '../_helpers.js';

describe('account S-5: personal account by non-owner deny', () => {
    it('S-5: umeda cannot use sato\'s personal account', async () => {
        const { service } = makeAccountService();
        const acc = await service.create(personalAccountInput(), actor('sato_keigo'));
        const r = await service.canUseForPost(acc.id, actor('umeda', { sub: 'umeda' }));
        expect(r.allow).toBe(false);
        expect(r.reason).toBe('personal-owner-mismatch');
    });
});
