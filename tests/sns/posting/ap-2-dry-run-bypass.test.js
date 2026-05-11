// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';

describe('posting AP-2: dry_run does not call X API', () => {
    it('AP-2: dry_run=true even with valid account, no postTweet call', async () => {
        const stack = await makeStack();
        const r = await stack.posting.post(satoActor(), {
            account_id: stack.account.id, body: 'no fire', dry_run: true
        });
        expect(r.posted).toBe(true);
        expect(stack.xClient.calls.postTweet).toBe(0);
    });
});
