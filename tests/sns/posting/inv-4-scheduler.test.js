// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';

describe('posting INV-4: scheduler tick fires due jobs', () => {
    it('INV-4: schedule + tick at run_at posts the tweet', async () => {
        const stack = await makeStack();
        const future = new Date(Date.now() + 1000);
        const { job_id } = await stack.posting.schedule(satoActor(), {
            account_id: stack.account.id,
            body: 'scheduled hi',
            post_at: future
        });
        expect(job_id).toMatch(/^job_/);
        const before = await stack.posting.tick(new Date(future.getTime() - 100));
        expect(before.fired).toBe(0);
        const after = await stack.posting.tick(new Date(future.getTime() + 100));
        expect(after.fired).toBe(1);
        expect(stack.xClient.calls.postTweet).toBe(1);
    });
});
