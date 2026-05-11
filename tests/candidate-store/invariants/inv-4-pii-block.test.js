// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft } from '../_helpers.js';

describe('candidate-store INV-4: PII/secret blocks candidate creation', () => {
    it('INV-4: blocked draft is not created, scan_blocks log entry exists', async () => {
        const { service, repository } = makeService();
        const result = await service.createCandidate(baseDraft({
            body: '俺の好み: OPENAI_API_KEY=sk-1234567890abcdefghij'
        }));
        expect(result.blocked).toBe(true);
        expect(repository.list()).toHaveLength(0);
        expect(repository.listScanBlocks()).toHaveLength(1);
    });
});
