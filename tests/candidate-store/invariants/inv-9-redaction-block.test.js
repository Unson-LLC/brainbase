// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft, approver } from '../_helpers.js';

describe('candidate-store INV-9: needs_redaction blocks promote', () => {
    it('INV-9: PII review hits set redaction_status=needs_redaction; auto-promote is skipped', async () => {
        const { service, repository } = makeService({ withPolicy: true });
        const result = await service.createCandidate({
            ...baseDraft({
                cognitive_type: 'preference',
                body: '電話 090-1234-5678 をよく使う',
                recommended_subject_type: 'person',
                requires_approval: false
            })
        });
        expect(result.blocked).toBeFalsy();
        const stored = repository.list()[0];
        expect(stored.redaction_status).toBe('needs_redaction');
        expect(stored.promotion_status).toBe('candidate');
        expect(result.auto).toBeFalsy();
    });

    it('INV-9: needs_redaction候補は手動承認でもGraphへ書かない', async () => {
        const graphWrites = [];
        const { service } = makeService({
            graphWriter: {
                async createEntity(payload) {
                    graphWrites.push(payload);
                    return { id: 'graph_pii_leak' };
                }
            }
        });
        const result = await service.createCandidate(baseDraft({
            body: '連絡先は 090-1234-5678',
            recommended_subject_type: 'person'
        }));

        await expect(service.approveCandidate(result.candidate.id, approver()))
            .rejects.toMatchObject({ code: 'candidate_redaction_required', statusCode: 409 });
        expect(graphWrites).toHaveLength(0);
    });
});
