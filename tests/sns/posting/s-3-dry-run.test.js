// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';

describe('posting S-3: dry_run', () => {
    it('S-3: dry_run returns posted=true without xClient call', async () => {
        const stack = await makeStack();
        const r = await stack.posting.post(satoActor(), {
            account_id: stack.account.id, body: 'simulate', dry_run: true
        });
        expect(r.posted).toBe(true);
        expect(r.dry_run).toBe(true);
        expect(stack.xClient.calls.postTweet).toBe(0);
    });
});
