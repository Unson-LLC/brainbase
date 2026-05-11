// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';

describe('posting INV-1: canUseForPost gate', () => {
    it('INV-1: post calls accountService.canUseForPost before postTweet', async () => {
        const { posting, accountService, account, xClient } = await makeStack();
        const spy = vi.spyOn(accountService, 'canUseForPost');
        await posting.post(satoActor(), { account_id: account.id, body: 'hi' });
        expect(spy).toHaveBeenCalled();
        expect(xClient.calls.postTweet).toBe(1);
    });

    it('INV-1: when canUseForPost deny → no postTweet call', async () => {
        const { posting, accountService, account, xClient } = await makeStack();
        accountService.canUseForPost = vi.fn().mockResolvedValue({ allow: false, reason: 'forbidden' });
        const result = await posting.post(satoActor(), { account_id: account.id, body: 'x' });
        expect(result.posted).toBe(false);
        expect(xClient.calls.postTweet).toBe(0);
    });
});
