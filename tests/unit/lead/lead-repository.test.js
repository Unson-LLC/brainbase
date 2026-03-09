import { describe, expect, it } from 'vitest';

import { LeadRepository } from '../../../public/modules/domain/lead/lead-repository.js';

describe('LeadRepository', () => {
    it('createSnapshot呼び出し時_v0のseed fixtureを返す', () => {
        const repository = new LeadRepository();

        const snapshot = repository.createSnapshot();

        expect(snapshot.district.id).toBe('district-retention-improvement');
        expect(snapshot.initiatives).toHaveLength(4);
        expect(snapshot.actors).toHaveLength(6);
        expect(snapshot.decisionItems.map(item => item.id)).toContain('decision-setup-simplification');
    });

    it('createSnapshot呼び出しごと_独立したcloneを返す', () => {
        const repository = new LeadRepository();

        const first = repository.createSnapshot();
        const second = repository.createSnapshot();

        first.initiatives[0].scope = '変更済み';

        expect(second.initiatives[0].scope).not.toBe('変更済み');
    });
});
