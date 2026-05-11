// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, orgAccountInput, actor } from '../_helpers.js';

describe('account S-6: org account by role=member deny', () => {
    it('S-6: org member with role=member cannot use org account for post', async () => {
        const { service } = makeAccountService();
        const acc = await service.create(orgAccountInput(), actor('sato_keigo'));
        const result = await service.canUseForPost(acc.id, actor('umeda', { sub: 'umeda', role: 'member' }));
        expect(result.allow).toBe(false);
        expect(result.reason).toBe('role-too-low-for-org-post');
    });

    it('S-6: same org member with role=gm can use org account', async () => {
        const { service } = makeAccountService();
        const acc = await service.create(orgAccountInput(), actor('sato_keigo'));
        const result = await service.canUseForPost(acc.id, actor('yamamoto', { sub: 'yamamoto', role: 'gm' }));
        expect(result.allow).toBe(true);
    });
});
