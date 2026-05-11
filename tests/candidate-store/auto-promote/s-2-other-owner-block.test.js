// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { makeService, preferenceDraft } from '../_helpers.js';

describe('auto-promote S-2: other-owned preference is not auto-promoted', () => {
    it('S-2: actor=sato writing umeda preference → pending_approval, not auto', async () => {
        const writer = { createEntity: vi.fn() };
        const { service } = makeService({ withPolicy: true, graphWriter: writer });
        const r = await service.createCandidate(preferenceDraft({
            owner_person_id: 'umeda',
            actor_person_id: 'sato_keigo',
            body: 'umeda likes coffee'
        }));
        expect(r.auto).toBeFalsy();
        expect(r.candidate.promotion_status).toBe('candidate');
        expect(writer.createEntity).not.toHaveBeenCalled();
    });
});
