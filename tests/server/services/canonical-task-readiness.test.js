import { describe, expect, it, vi } from 'vitest';

import { CanonicalTaskReadiness } from '../../../server/services/companion/canonical-task-readiness.js';

function repository(initialRow) {
    let row = initialRow;
    return {
        writerToken: 'writer-1',
        claimWriter: vi.fn(async () => ({ writer_token: 'writer-1' })),
        reconcileReadiness: vi.fn(async () => row),
        setRow(nextRow) { row = nextRow; }
    };
}

describe('CanonicalTaskReadiness', () => {
    it('starts closed and opens only when all persisted authorities match', async () => {
        const operations = repository({ ready: false, reason: 'not_initialized' });
        const verifiedRow = {
            ready: true,
            writer_token: 'writer-1',
            manifest_hash: 'manifest-1',
            schema_version: '1.0.0',
            source_head: 'head-1',
            evidence_hash: 'evidence-1',
            evidence_path: 'before-enable.json',
            updated_at: '2026-07-14T00:00:00.000Z'
        };
        const readiness = new CanonicalTaskReadiness({
            operationRepository: operations,
            manifestHash: 'manifest-1',
            schemaVersion: '1.0.0',
            sourceHead: 'head-1'
        });

        await expect(readiness.assertMutationReady()).rejects.toMatchObject({ code: 'canonical_task_mutation_not_ready' });
        operations.setRow(verifiedRow);
        await expect(readiness.initialize()).resolves.toMatchObject({ ready: true });
        await expect(readiness.assertMutationReady()).resolves.toBeUndefined();
        expect(operations.reconcileReadiness).toHaveBeenLastCalledWith(expect.objectContaining({ allowWriterRebind: false }));
    });

    it('opens a running process after an external enable writes matching evidence', async () => {
        const operations = repository({ ready: false, reason: 'not_enabled' });
        const readiness = new CanonicalTaskReadiness({
            operationRepository: operations,
            manifestHash: 'manifest-1',
            schemaVersion: '1.0.0',
            sourceHead: 'head-1'
        });

        await expect(readiness.initialize()).resolves.toMatchObject({ ready: false });
        operations.setRow({
            ready: true,
            writer_token: 'writer-1',
            manifest_hash: 'manifest-1',
            schema_version: '1.0.0',
            source_head: 'head-1',
            evidence_hash: 'evidence-1'
        });

        await expect(readiness.assertMutationReady()).resolves.toBeUndefined();
    });

    it('keeps the verified release open across a clean writer restart and observes disable', async () => {
        const coordination = { writerToken: null, row: { ready: false, reason: 'not_enabled' } };
        const repositoryFor = (writerToken) => ({
            writerToken,
            claimWriter: vi.fn(async () => { coordination.writerToken = writerToken; }),
            reconcileReadiness: vi.fn(async ({ manifestHash, schemaVersion, sourceHead, allowWriterRebind }) => {
                if (coordination.writerToken !== writerToken) {
                    throw Object.assign(new Error('writer unavailable'), { code: 'canonical_task_writer_unavailable' });
                }
                const releaseMatches = coordination.row.ready
                    && coordination.row.manifest_hash === manifestHash
                    && coordination.row.schema_version === schemaVersion
                    && coordination.row.source_head === sourceHead
                    && coordination.row.evidence_hash;
                if (allowWriterRebind && releaseMatches) coordination.row.writer_token = writerToken;
                return { ...coordination.row };
            })
        });
        const options = { manifestHash: 'manifest-1', schemaVersion: '1.0.0', sourceHead: 'head-1' };
        const first = new CanonicalTaskReadiness({ operationRepository: repositoryFor('writer-1'), ...options });

        await expect(first.initialize()).resolves.toMatchObject({ ready: false });
        coordination.row = {
            ready: true,
            writer_token: 'writer-1',
            manifest_hash: 'manifest-1',
            schema_version: '1.0.0',
            source_head: 'head-1',
            evidence_hash: 'evidence-1'
        };
        await expect(first.assertMutationReady()).resolves.toBeUndefined();

        coordination.writerToken = null;
        const restarted = new CanonicalTaskReadiness({ operationRepository: repositoryFor('writer-2'), ...options });
        await expect(restarted.initialize()).resolves.toMatchObject({ ready: true });
        expect(coordination.row.writer_token).toBe('writer-2');
        await expect(restarted.assertMutationReady()).resolves.toBeUndefined();

        coordination.row = { ...coordination.row, ready: false, reason: 'operator_disabled' };
        await expect(restarted.assertMutationReady()).rejects.toMatchObject({
            code: 'canonical_task_mutation_not_ready',
            details: { reason: 'operator_disabled' }
        });
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
        await expect(readiness.assertMutationReady()).rejects.toMatchObject({
            code: 'canonical_task_mutation_not_ready',
            details: { reason: 'persisted_readiness_mismatch' }
        });
    });

    it('keeps reads available by reporting a closed gate when coordination fails', async () => {
        const operations = repository(null);
        operations.claimWriter.mockRejectedValue(Object.assign(new Error('database down'), { code: 'coordination_down' }));
        const readiness = new CanonicalTaskReadiness({ operationRepository: operations });

        await expect(readiness.initialize()).resolves.toMatchObject({ ready: false, reason: 'coordination_down' });
    });
});
