import { describe, expect, it, vi } from 'vitest';

import { CanonicalTaskReadiness } from '../../../server/services/companion/canonical-task-readiness.js';

function repository(row) {
    return {
        writerToken: 'writer-1',
        claimWriter: vi.fn(async () => ({ writer_token: 'writer-1' })),
        readReadiness: vi.fn(async () => row)
    };
}

describe('CanonicalTaskReadiness', () => {
    it('starts closed and opens only when all persisted authorities match', async () => {
        const operations = repository({
            ready: true,
            writer_token: 'writer-1',
            manifest_hash: 'manifest-1',
            schema_version: '1.0.0',
            source_head: 'head-1',
            evidence_hash: 'evidence-1',
            evidence_path: 'before-enable.json',
            updated_at: '2026-07-14T00:00:00.000Z'
        });
        const readiness = new CanonicalTaskReadiness({
            operationRepository: operations,
            manifestHash: 'manifest-1',
            schemaVersion: '1.0.0',
            sourceHead: 'head-1'
        });

        expect(() => readiness.assertMutationReady()).toThrowError(expect.objectContaining({ code: 'canonical_task_mutation_not_ready' }));
        await expect(readiness.initialize()).resolves.toMatchObject({ ready: true });
        expect(() => readiness.assertMutationReady()).not.toThrow();
    });

    it('stays closed when writer, evidence, manifest, schema, or HEAD do not match', async () => {
        const operations = repository({
            ready: true,
            writer_token: 'writer-old',
            manifest_hash: 'manifest-1',
            schema_version: '1.0.0',
            source_head: 'head-1',
            evidence_hash: 'evidence-1'
        });
        const readiness = new CanonicalTaskReadiness({
            operationRepository: operations,
            manifestHash: 'manifest-1',
            schemaVersion: '1.0.0',
            sourceHead: 'head-1'
        });

        await expect(readiness.initialize()).resolves.toEqual({ ready: false, reason: 'persisted_readiness_mismatch' });
        expect(() => readiness.assertMutationReady()).toThrowError(expect.objectContaining({
            details: { reason: 'persisted_readiness_mismatch' }
        }));
    });

    it('keeps reads available by reporting a closed gate when coordination fails', async () => {
        const operations = repository(null);
        operations.claimWriter.mockRejectedValue(Object.assign(new Error('database down'), { code: 'coordination_down' }));
        const readiness = new CanonicalTaskReadiness({ operationRepository: operations });

        await expect(readiness.initialize()).resolves.toMatchObject({ ready: false, reason: 'coordination_down' });
    });
});
