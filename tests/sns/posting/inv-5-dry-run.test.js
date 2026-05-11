// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';

describe('posting INV-5: dry_run does not call X API', () => {
    it('INV-5: dry_run returns dummy tweet_id, xClient not invoked', async () => {
        const stack = await makeStack();
        const r = await stack.posting.post(satoActor(), {
            account_id: stack.account.id, body: 'dryrun', dry_run: true
        });
        expect(r.posted).toBe(true);
        expect(r.dry_run).toBe(true);
        expect(r.tweet_id).toMatch(/^dryrun_/);
        expect(stack.xClient.calls.postTweet).toBe(0);
    });
});
