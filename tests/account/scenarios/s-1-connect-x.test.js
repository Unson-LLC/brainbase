// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, personalAccountInput, actor } from '../_helpers.js';

describe('account S-1: connect new X account', () => {
    it('S-1: scope_type=personal X account creates row + CONNECTED audit', async () => {
        const { service } = makeAccountService();
        const acc = await service.create(personalAccountInput(), actor());
        expect(acc.service).toBe('x');
        expect(acc.scope_type).toBe('personal');
        expect(acc.owner_person_id).toBe('sato_keigo');
        expect(acc.status).toBe('connected');
        const audit = await service.listAudit(acc.id);
        expect(audit[0].action).toBe('CONNECTED');
    });
});
