import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildRoutineRunReceipt, runRoutine } from '../../scripts/routines/run.mjs';
import { resolveRoutineReceiptPaths } from '../../scripts/routines/runtime-paths.mjs';
import { listRoutineDeadLetters } from '../../server/services/routine-runtime/dead-letter-reader.js';

const finishedAt = '2026-08-13T00:01:00.000Z';
const temporaryDirectories = [];

function createTemporaryDirectory(prefix) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('Brainbase Routine Runner', () => {
    it('CODEX_THREAD_IDをexternal run identityへ写像しproject_idをbrainbaseへ固定する', () => {
        const receipt = buildRoutineRunReceipt({
            routine: 'ohayo',
            env: { CODEX_THREAD_ID: 'thread-123' },
            input: {
                project_id: 'wrong-project-must-be-ignored',
                status: 'completed',
                started_at: '2026-08-13T00:00:00.000Z',
                finished_at: finishedAt,
                evidence_refs: [{ kind: 'artifact_ref', ref: 'brainbase:routine/ohayo', label: 'routine summary' }]
            }
        });

        expect(receipt.source).toEqual({
            type: 'codex_automations',
            workflow_id: 'brainbase-ohayo',
            name: 'brainbase-ohayo'
        });
        expect(receipt.run.project_id).toBe('brainbase');
        expect(receipt.run.external_run_id).toBe('brainbase-ohayo:thread-123');
        expect(receipt.run.status).toBe('success');
        expect(receipt.run.observation_kind).not.toBe('connector_observation');
    });

    it('CODEX_THREAD_ID欠落時はsource successを作らずconnector observationにする', () => {
        const receipt = buildRoutineRunReceipt({
            routine: 'oyasumi',
            env: {},
            now: () => new Date(finishedAt),
            input: {
                status: 'completed',
                finished_at: finishedAt,
                evidence_refs: [{ kind: 'artifact_ref', ref: 'brainbase:routine/oyasumi', label: 'routine summary' }]
            }
        });

        expect(receipt.source).toEqual({
            type: 'codex_automations',
            workflow_id: '__connector_observation__',
            name: 'brainbase-oyasumi'
        });
        expect(receipt.run.project_id).toBe('brainbase');
        expect(receipt.run.status).toBe('blocked');
        expect(receipt.run.evidence_state).toBe('no_data');
        expect(receipt.run.observation_kind).toBe('connector_observation');
        expect(receipt.run.external_run_id).toMatch(/^brainbase-oyasumi:observation:routine:oyasumi:/);
    });

    it('cwd外からの実行でも正規varDirへDead Letterを書き監視が同じファイルを読む', async () => {
        const temporaryRoot = createTemporaryDirectory('brainbase-routine-runtime-');
        const canonicalVarDir = path.join(temporaryRoot, 'canonical-var');
        const foreignCwd = path.join(temporaryRoot, 'foreign-cwd');
        fs.mkdirSync(foreignCwd, { recursive: true });
        const env = {
            BRAINBASE_VAR_DIR: canonicalVarDir,
            BRAINBASE_RUN_RECEIPT_INGEST_URL: 'http://127.0.0.1:31989/api/run-receipts/ingest',
            BRAINBASE_RUN_RECEIPT_SERVICE_TOKEN: 'bbsvc_public_fake_value',
            CODEX_THREAD_ID: 'thread-dead-letter'
        };
        const originalCwd = process.cwd();
        let result;
        try {
            process.chdir(foreignCwd);
            result = await runRoutine({
                routine: 'ohayo',
                repoDir: '/Users/ksato/workspace/code/brainbase',
                env,
                input: {
                    status: 'completed',
                    started_at: '2026-08-13T00:00:00.000Z',
                    finished_at: finishedAt,
                    evidence_refs: [{
                        kind: 'artifact_ref',
                        ref: 'brainbase:routine/summary',
                        label: 'routine summary'
                    }]
                },
                fetchImpl: vi.fn(async () => ({ ok: false, status: 503 })),
                maxAttempts: 1,
                now: () => new Date(finishedAt)
            });
        } finally {
            process.chdir(originalCwd);
        }

        expect(result.delivery).toMatchObject({
            delivered: 0,
            retryable: 0,
            dead_lettered: 1
        });
        const receiptPaths = resolveRoutineReceiptPaths({
            repoDir: '/Users/ksato/workspace/code/brainbase',
            env
        });
        const deadLetters = await listRoutineDeadLetters({ directory: receiptPaths.deadLetterDir });
        expect(deadLetters).toHaveLength(1);
        expect(deadLetters[0]).toMatchObject({
            automation_id: 'brainbase-ohayo',
            path: expect.stringMatching(/^rr1_[a-f0-9]{64}\.json$/)
        });
        expect(path.isAbsolute(deadLetters[0].path)).toBe(false);
        expect(fs.existsSync(path.join(foreignCwd, 'var'))).toBe(false);
    });
});
