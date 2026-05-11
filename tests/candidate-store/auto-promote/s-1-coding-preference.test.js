// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { makeService, preferenceDraft } from '../_helpers.js';

describe('auto-promote S-1: my own coding preference auto-promote', () => {
    it('S-1: preference owner==actor → auto promote to person entity', async () => {
        const writer = { createEntity: vi.fn().mockResolvedValue({ id: 'graph_person_sato' }) };
        const { service } = makeService({ withPolicy: true, graphWriter: writer });
        const result = await service.createCandidate(preferenceDraft({
            body: '圧縮品質は0.7派'
        }));
        expect(result.auto).toBe(true);
        expect(result.candidate.promotion_status).toBe('promoted_to_graph');
        expect(result.graphEntity.id).toBe('graph_person_sato');
        expect(writer.createEntity).toHaveBeenCalledTimes(1);
        const [payload] = writer.createEntity.mock.calls[0];
        expect(payload.payload.type).toBe('person');
        expect(payload.payload.preference_attachment.body).toBe('圧縮品質は0.7派');
    });
});
