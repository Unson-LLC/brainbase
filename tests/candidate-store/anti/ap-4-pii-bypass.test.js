// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft } from '../_helpers.js';

describe('candidate-store AP-4: PII scanner bypass blocked', () => {
    it('AP-4: default createCandidate runs scan; skipScan only available in service-internal API for replay', async () => {
        const { service, repository } = makeService();
        const result = await service.createCandidate(baseDraft({
            body: 'leak: ghp_abcdefghijklmnopqrstuvwxyz12345678'
        }));
        expect(result.blocked).toBe(true);
        expect(repository.list()).toHaveLength(0);
    });

    it('AP-4: blocked record visible in scan_blocks log (auditable)', async () => {
        const { service, repository } = makeService();
        await service.createCandidate(baseDraft({
            body: 'private key:\n-----BEGIN PRIVATE KEY-----\nfoo'
        }));
        const blocks = repository.listScanBlocks();
        expect(blocks).toHaveLength(1);
        expect(blocks[0].findings.some((f) => f.kind === 'block')).toBe(true);
    });
});
