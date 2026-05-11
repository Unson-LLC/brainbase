// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';

describe('posting S-2: disabled account → deny', () => {
    it('S-2: revoked account → posted=false reason=status-revoked', async () => {
        const stack = await makeStack();
        await stack.accountService.revoke(stack.account.id, { actor_person_id: 'sato_keigo' });
        const r = await stack.posting.post(satoActor(), { account_id: stack.account.id, body: 'x' });
        expect(r.posted).toBe(false);
        expect(r.reason).toBe('status-revoked');
    });
});
