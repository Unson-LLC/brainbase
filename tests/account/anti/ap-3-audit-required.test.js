// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, personalAccountInput, actor } from '../_helpers.js';

describe('account AP-3: every state-changing API records audit', () => {
    it('AP-3: create / setDefault / revoke / recordPost / reauthorize each have audit', async () => {
        const { service } = makeAccountService();
        const acc = await service.create(personalAccountInput(), actor());
        const after1 = (await service.listAudit(acc.id)).length;
        await service.setDefault({
            subject_type: 'person', subject_id: 'sato_keigo',
            service: 'x', purpose: 'post', account_id: acc.id
        }, actor());
        await service.recordPost(acc.id, actor());
        await service.revoke(acc.id, actor());
        await service.reauthorize(acc.id, actor());
        const final = await service.listAudit(acc.id);
        expect(final.length).toBeGreaterThan(after1);
        expect(final.map((a) => a.action)).toEqual(
            expect.arrayContaining(['CONNECTED', 'DEFAULT_CHANGED', 'USED_FOR_POST', 'REVOKED', 'REAUTHORIZED'])
        );
    });
});
