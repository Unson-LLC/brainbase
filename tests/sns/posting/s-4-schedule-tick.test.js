// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';

describe('posting S-4: schedule + tick', () => {
    it('S-4: schedule + tick fires only when due', async () => {
        const stack = await makeStack();
        const t = new Date(Date.now() + 500);
        await stack.posting.schedule(satoActor(), {
            account_id: stack.account.id, body: 'later', post_at: t
        });
        const r1 = await stack.posting.tick(new Date(t.getTime() - 100));
        expect(r1.fired).toBe(0);
        const r2 = await stack.posting.tick(new Date(t.getTime() + 100));
        expect(r2.fired).toBe(1);
    });
});
