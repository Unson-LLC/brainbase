// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft } from '../_helpers.js';

describe('candidate-store S-6: PII secret blocks candidate creation', () => {
    it('S-6: terminal output containing OPENAI_API_KEY=sk-xxx → block, no candidate, scan log entry', async () => {
        const { service, repository } = makeService();
        const result = await service.createCandidate(baseDraft({
            body: 'context: OPENAI_API_KEY=sk-abcdef1234567890abcdef'
        }));
        expect(result.blocked).toBe(true);
        expect(result.findings.some((f) => f.kind === 'block')).toBe(true);
        expect(repository.list()).toHaveLength(0);
        const blocks = repository.listScanBlocks();
        expect(blocks).toHaveLength(1);
        expect(blocks[0].source_event_id).toBe('session:abc:1');
    });
});
