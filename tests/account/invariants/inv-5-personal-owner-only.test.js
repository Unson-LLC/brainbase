// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, personalAccountInput, actor } from '../_helpers.js';

describe('account INV-5: personal scope_type is usable only by owner', () => {
    it('INV-5: non-owner canUseForPost on personal account → deny', async () => {
        const { service } = makeAccountService();
        const acc = await service.create(personalAccountInput(), actor('sato_keigo'));
        const result = await service.canUseForPost(acc.id, actor('umeda', { sub: 'umeda' }));
        expect(result.allow).toBe(false);
        expect(result.reason).toBe('personal-owner-mismatch');
    });
});
