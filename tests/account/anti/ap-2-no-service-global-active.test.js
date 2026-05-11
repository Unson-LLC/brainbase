// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, personalAccountInput, actor } from '../_helpers.js';

describe('account AP-2: no service-global active concept', () => {
    it('AP-2: account record has no "active" boolean column', async () => {
        const { service } = makeAccountService();
        const acc = await service.create(personalAccountInput(), actor());
        // status field exists; "active" boolean does not exist on record (would be code smell)
        expect(acc).not.toHaveProperty('active');
        // status: connected/disabled/revoked/reauth_required は許容、global active 1 個ではない
        expect(['connected', 'disabled', 'revoked', 'reauth_required']).toContain(acc.status);
    });
});
