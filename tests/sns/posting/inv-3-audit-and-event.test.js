// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';

describe('posting INV-3: USED_FOR_POST audit + graph event', () => {
    it('INV-3: successful post writes USED_FOR_POST audit and graph event', async () => {
        const stack = await makeStack();
        const r = await stack.posting.post(satoActor(), { account_id: stack.account.id, body: 'hi' });
        expect(r.posted).toBe(true);
        const audit = await stack.accountService.listAudit(stack.account.id);
        expect(audit.some((a) => a.action === 'USED_FOR_POST')).toBe(true);
        expect(stack.graphEvents.some((e) => e.kind === 'sns_post')).toBe(true);
    });
});
