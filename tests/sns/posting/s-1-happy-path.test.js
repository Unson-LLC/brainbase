// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';

describe('posting S-1: happy path', () => {
    it('S-1: post returns tweet_id + event_id', async () => {
        const stack = await makeStack();
        const r = await stack.posting.post(satoActor(), { account_id: stack.account.id, body: 'hello world' });
        expect(r.posted).toBe(true);
        expect(r.tweet_id).toMatch(/^tw_/);
        expect(r.event_id).toMatch(/^evt_/);
    });
});
