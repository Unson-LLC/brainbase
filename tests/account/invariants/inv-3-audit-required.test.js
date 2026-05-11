// @ts-check
import { describe, it, expect } from 'vitest';
import { makeAccountService, personalAccountInput, actor } from '../_helpers.js';

describe('account INV-3: every action is audited', () => {
    it('INV-3: create, setDefault, revoke, recordPost all leave audit', async () => {
        const { service } = makeAccountService();
        const acc = await service.create(personalAccountInput(), actor());
        await service.setDefault({
            subject_type: 'person', subject_id: 'sato_keigo',
            service: 'x', purpose: 'post', account_id: acc.id
        }, actor());
        await service.recordPost(acc.id, actor());
        await service.revoke(acc.id, actor());
        const audit = await service.listAudit(acc.id);
        const actions = audit.map((e) => e.action);
        expect(actions).toEqual(['CONNECTED', 'DEFAULT_CHANGED', 'USED_FOR_POST', 'REVOKED']);
    });
});
