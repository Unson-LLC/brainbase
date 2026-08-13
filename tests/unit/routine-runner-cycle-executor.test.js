import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as routineRunner from '../../scripts/routines/run.mjs';

const { runRoutine } = routineRunner;

const temporaryDirectories = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('Routine Runner cycle execution', () => {
    it('標準CLIは正規runtime envを読み、ローカルAPIとReceiptを内部APIキーで認証する', async () => {
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-routine-local-auth-'));
        temporaryDirectories.push(repoDir);
        const calls = [];
        const fetchImpl = vi.fn(async (url, options) => {
            calls.push({ url, options, body: JSON.parse(options.body) });
            if (url === 'http://127.0.0.1:31013/api/routines/ohayo/execute') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        status: 'completed',
                        routine_summary: { routine: 'ohayo', status: 'completed', anomaly_count: 0 },
                        evidence_refs: []
                    })
                };
            }
            return { ok: true, status: 201 };
        });

        const result = await runRoutine({
            routine: 'ohayo',
            repoDir,
            env: {
                CODEX_THREAD_ID: 'thread-local-auth',
                INTERNAL_API_SECRET: 'local-internal-key',
                BRAINBASE_VAR_DIR: path.join(repoDir, 'canonical-var')
            },
            fetchImpl,
            now: () => new Date('2026-08-13T00:01:00.000Z')
        });

        expect(calls).toHaveLength(2);
        expect(calls.map((call) => call.url)).toEqual([
            'http://127.0.0.1:31013/api/routines/ohayo/execute',
            'http://127.0.0.1:31013/api/run-receipts/ingest'
        ]);
        for (const call of calls) {
            expect(call.options.headers).toMatchObject({
                'x-internal-api-key': 'local-internal-key'
            });
            expect(call.options.headers).not.toHaveProperty('Authorization');
        }
        expect(result).toMatchObject({ status: 'completed', delivery: { delivered: 1 } });

        const runnerSource = fs.readFileSync(path.join(process.cwd(), 'scripts/routines/run.mjs'), 'utf8');
        expect(runnerSource).toContain('loadRuntimeEnv');
        expect(runnerSource).toMatch(/loadRuntimeEnv\(\{[\s\S]*cwd:\s*DEFAULT_REPO_DIR/);
    });

    it('CLI終了コードはcompletedだけ0、partialは2、failedとblockedは非zeroにする', () => {
        expect(typeof routineRunner.exitCodeForRoutineStatus).toBe('function');
        if (typeof routineRunner.exitCodeForRoutineStatus !== 'function') return;
        expect(routineRunner.exitCodeForRoutineStatus('completed')).toBe(0);
        expect(routineRunner.exitCodeForRoutineStatus('partial')).toBe(2);
        expect(routineRunner.exitCodeForRoutineStatus('waiting_human')).toBe(2);
        expect(routineRunner.exitCodeForRoutineStatus('failed')).not.toBe(0);
        expect(routineRunner.exitCodeForRoutineStatus('blocked')).not.toBe(0);

        const runnerSource = fs.readFileSync(path.join(process.cwd(), 'scripts/routines/run.mjs'), 'utf8');
        expect(runnerSource).toMatch(/process\.exitCode\s*=\s*exitCodeForRoutineStatus\(/);
    });

    it('completedでもroutine_summary欠落ならrequired_artifact_missingのfailed Receiptを残す', async () => {
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-routine-missing-summary-'));
        temporaryDirectories.push(repoDir);
        const canonicalVarDir = path.join(repoDir, 'canonical-var');

        const result = await runRoutine({
            routine: 'ohayo',
            repoDir,
            env: {
                CODEX_THREAD_ID: 'thread-missing-summary',
                BRAINBASE_VAR_DIR: canonicalVarDir
            },
            executeCycle: vi.fn(async () => ({
                status: 'completed',
                artifacts: {},
                evidence_refs: []
            })),
            now: () => new Date('2026-08-13T00:00:00.000Z')
        });

        const outboxDir = path.join(canonicalVarDir, 'run-receipt-outbox', 'codex-automations');
        const receiptFile = fs.readdirSync(outboxDir).find((name) => name.endsWith('.json'));
        const receipt = JSON.parse(fs.readFileSync(path.join(outboxDir, receiptFile), 'utf8'));
        expect(receipt.run).toMatchObject({
            status: 'failed',
            blocker_reason: expect.stringContaining('required_artifact_missing')
        });
        expect(result).toMatchObject({
            status: 'failed',
            cycle_status: 'failed',
            anomalies: expect.arrayContaining([
                expect.objectContaining({ code: 'required_artifact_missing', artifact: 'routine_summary' })
            ])
        });
    });

    it('標準実行は認証付きでroutine APIへCODEX_THREAD_IDを渡し、その実行結果をReceiptにする', async () => {
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-routine-http-cycle-'));
        temporaryDirectories.push(repoDir);
        const calls = [];
        const fetchImpl = vi.fn(async (url, options) => {
            calls.push({ url, options, body: JSON.parse(options.body) });
            if (url === 'https://brainbase.example/api/routines/ohayo/execute') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        status: 'completed',
                        routine_summary: { routine: 'ohayo', status: 'completed', anomaly_count: 0 },
                        evidence_refs: [{ kind: 'artifact_ref', ref: 'routine_summary:ohayo', label: 'routine_summary' }]
                    })
                };
            }
            return { ok: true, status: 201 };
        });

        const result = await runRoutine({
            routine: 'ohayo',
            repoDir,
            env: {
                CODEX_THREAD_ID: 'thread-http-1',
                BRAINBASE_API_URL: 'https://brainbase.example',
                BRAINBASE_RUN_RECEIPT_INGEST_URL: 'https://brainbase.example/api/run-receipts/ingest',
                BRAINBASE_RUN_RECEIPT_SERVICE_TOKEN: 'service-token'
            },
            input: { requested_at: '2026-08-13T00:00:00.000Z' },
            fetchImpl,
            now: () => new Date('2026-08-13T00:01:00.000Z')
        });

        expect(calls[0]).toMatchObject({
            url: 'https://brainbase.example/api/routines/ohayo/execute',
            options: {
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'Bearer service-token',
                    'Content-Type': 'application/json'
                })
            },
            body: {
                thread_id: 'thread-http-1',
                input: { requested_at: '2026-08-13T00:00:00.000Z' }
            }
        });
        expect(calls[1].url).toBe('https://brainbase.example/api/run-receipts/ingest');
        expect(calls[1].body.run).toMatchObject({ status: 'success', external_run_id: 'brainbase-ohayo:thread-http-1' });
        expect(result).toMatchObject({ delivery: { delivered: 1 } });
    });

    it('executeCycleの結果を唯一の実行結果として既存Run Receiptへ渡す', async () => {
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-routine-cycle-'));
        temporaryDirectories.push(repoDir);
        const executeCycle = vi.fn(async () => ({
            status: 'completed',
            routine_summary: { routine: 'ohayo', status: 'completed', anomaly_count: 0 },
            evidence_refs: [{ kind: 'artifact_ref', ref: 'routine_summary:ohayo', label: 'routine_summary' }]
        }));
        const postedReceipts = [];
        const fetchImpl = vi.fn(async (_url, options) => {
            postedReceipts.push(JSON.parse(options.body));
            return { ok: true, status: 201 };
        });

        const result = await runRoutine({
            routine: 'ohayo',
            repoDir,
            env: {
                CODEX_THREAD_ID: 'thread-cycle-1',
                BRAINBASE_RUN_RECEIPT_INGEST_URL: 'https://brainbase.example/api/run-receipts/ingest',
                BRAINBASE_RUN_RECEIPT_SERVICE_TOKEN: 'service-token'
            },
            input: { status: 'failed' },
            executeCycle,
            fetchImpl,
            now: () => new Date('2026-08-13T00:00:00.000Z')
        });

        expect(executeCycle).toHaveBeenCalledOnce();
        expect(executeCycle).toHaveBeenCalledWith({ routine: 'ohayo', input: { status: 'failed' } });
        expect(postedReceipts).toHaveLength(1);
        expect(postedReceipts[0].run).toMatchObject({ status: 'success', evidence_state: 'confirmed' });
        expect(postedReceipts[0].run.evidence_refs).toEqual([
            expect.objectContaining({ label: 'routine_summary' })
        ]);
        expect(result).toMatchObject({ delivery: { delivered: 1 } });
    });

    it('ohayo Runner公開結果が最大3例外とgenerator選択記憶の人間向け出力を保持する', async () => {
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-routine-ohayo-output-'));
        temporaryDirectories.push(repoDir);
        const morningOutput = {
            exceptions: [{ code: 'one' }, { code: 'two' }, { code: 'three' }],
            memories: [{ summary: '判断1' }, { summary: '判断2' }, { summary: '判断3' }]
        };

        const result = await runRoutine({
            routine: 'ohayo',
            repoDir,
            env: {
                CODEX_THREAD_ID: 'thread-ohayo-output',
                BRAINBASE_VAR_DIR: path.join(repoDir, 'canonical-var')
            },
            executeCycle: vi.fn(async () => ({
                status: 'completed',
                routine_summary: { routine: 'ohayo', status: 'completed', anomaly_count: 0 },
                morning_output: morningOutput,
                evidence_refs: []
            })),
            now: () => new Date('2026-08-13T00:00:00.000Z')
        });

        expect(result).toMatchObject({
            status: 'completed',
            cycle_status: 'completed',
            morning_output: morningOutput
        });
        expect(result.morning_output.exceptions).toHaveLength(3);
        expect(result.morning_output.memories).toHaveLength(3);
    });

    it('CLI stdoutは表示最大3件の安全なsummaryだけを直列化し内部recall/generatedを漏らさない', () => {
        expect(typeof routineRunner.serializeRoutineCliResult).toBe('function');
        if (typeof routineRunner.serializeRoutineCliResult !== 'function') return;
        const serialized = routineRunner.serializeRoutineCliResult({
            status: 'completed',
            recalled: { graph: [{ id: 'graph-raw', payload: { secret: 'raw-recall-secret' } }] },
            generated: { graph_memories: [{ body: 'raw-generated-secret' }] },
            morning_output: {
                exceptions: [
                    { code: 'one', summary: '例外1', path: '/absolute/secret.json' },
                    { code: 'two', summary: '例外2' },
                    { code: 'three', summary: '例外3' },
                    { code: 'four', summary: '例外4' }
                ],
                memories: [
                    { id: 'graph-1', summary: '判断1', body: 'raw-memory-secret' },
                    { summary: '判断2' },
                    { summary: '判断3' },
                    { summary: '判断4' }
                ]
            }
        });
        const output = JSON.parse(serialized);

        expect(output.morning_output).toEqual({
            exceptions: [
                { code: 'one', summary: '例外1' },
                { code: 'two', summary: '例外2' },
                { code: 'three', summary: '例外3' }
            ],
            memories: [{ summary: '判断1' }, { summary: '判断2' }, { summary: '判断3' }]
        });
        expect(serialized).not.toContain('raw-recall-secret');
        expect(serialized).not.toContain('raw-generated-secret');
        expect(serialized).not.toContain('raw-memory-secret');
        expect(serialized).not.toContain('/absolute/secret.json');
        expect(serialized).not.toContain('判断4');

        const runnerSource = fs.readFileSync(path.join(process.cwd(), 'scripts/routines/run.mjs'), 'utf8');
        expect(runnerSource).toMatch(/process\.stdout\.write\([^\n]*serializeRoutineCliResult\(result\)/);
    });

    it('executorがthrowしてもfailed Receiptを正規Outboxへ永続化する', async () => {
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-routine-throw-'));
        temporaryDirectories.push(repoDir);
        const canonicalVarDir = path.join(repoDir, 'canonical-var');

        const result = await runRoutine({
            routine: 'oyasumi',
            repoDir,
            env: {
                CODEX_THREAD_ID: 'thread-throw-1',
                BRAINBASE_VAR_DIR: canonicalVarDir
            },
            executeCycle: vi.fn(async () => { throw new Error('executor crashed'); }),
            now: () => new Date('2026-08-13T00:02:00.000Z')
        });

        expect(result).toMatchObject({
            status: 'failed',
            cycle_status: 'failed',
            queued: 'queued',
            delivery: { status: 'unavailable', reason: 'missing_endpoint', pending: 1 }
        });
        const outboxDir = path.join(canonicalVarDir, 'run-receipt-outbox', 'codex-automations');
        const files = fs.readdirSync(outboxDir).filter((name) => name.endsWith('.json'));
        expect(files).toHaveLength(1);
        const receipt = JSON.parse(fs.readFileSync(path.join(outboxDir, files[0]), 'utf8'));
        expect(receipt.run).toMatchObject({
            status: 'failed',
            external_run_id: 'brainbase-oyasumi:thread-throw-1',
            blocker_reason: expect.stringContaining('failed')
        });
    });

    it('Receiptがroutine_summaryの実成果物をcanonical var配下の読取可能な参照で示す', async () => {
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-routine-artifact-'));
        temporaryDirectories.push(repoDir);
        const canonicalVarDir = path.join(repoDir, 'canonical-var');

        await runRoutine({
            routine: 'ohayo',
            repoDir,
            env: {
                CODEX_THREAD_ID: 'thread-artifact-1',
                BRAINBASE_VAR_DIR: canonicalVarDir
            },
            executeCycle: vi.fn(async () => ({
                status: 'completed',
                routine_summary: { routine: 'ohayo', status: 'completed', anomaly_count: 0 },
                evidence_refs: [{
                    kind: 'artifact_ref',
                    ref: 'routine_summary:ohayo',
                    label: 'routine_summary'
                }]
            })),
            now: () => new Date('2026-08-13T00:03:00.000Z')
        });

        const outboxDir = path.join(canonicalVarDir, 'run-receipt-outbox', 'codex-automations');
        const receiptFile = fs.readdirSync(outboxDir).find((name) => name.endsWith('.json'));
        const receipt = JSON.parse(fs.readFileSync(path.join(outboxDir, receiptFile), 'utf8'));
        const summaryRef = receipt.run.evidence_refs.find((ref) => ref.label === 'routine_summary');

        expect(summaryRef.ref).toMatch(/^routine-artifacts\//);
        expect(path.isAbsolute(summaryRef.ref)).toBe(false);
        const summaryPath = path.join(canonicalVarDir, summaryRef.ref);
        expect(fs.existsSync(summaryPath)).toBe(true);
        expect(JSON.parse(fs.readFileSync(summaryPath, 'utf8'))).toMatchObject({
            routine_summary: { routine: 'ohayo', status: 'completed', anomaly_count: 0 }
        });
    });

    it('BRAINBASE_VAR_DIR未設定でもrepo由来canonical varへroutine_summaryを永続化する', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-routine-canonical-var-'));
        temporaryDirectories.push(root);
        const repoDir = path.join(root, 'workspace', 'code', 'brainbase');
        fs.mkdirSync(repoDir, { recursive: true });

        await runRoutine({
            routine: 'ohayo',
            repoDir,
            env: { CODEX_THREAD_ID: 'thread-canonical-artifact' },
            executeCycle: vi.fn(async () => ({
                status: 'completed',
                routine_summary: { routine: 'ohayo', status: 'completed', anomaly_count: 0 },
                evidence_refs: []
            })),
            now: () => new Date('2026-08-13T00:03:00.000Z')
        });

        const canonicalVarDir = path.join(root, 'workspace', 'var');
        const outboxDir = path.join(canonicalVarDir, 'run-receipt-outbox', 'codex-automations');
        const receiptFile = fs.readdirSync(outboxDir).find((name) => name.endsWith('.json'));
        const receipt = JSON.parse(fs.readFileSync(path.join(outboxDir, receiptFile), 'utf8'));
        const summaryRef = receipt.run.evidence_refs.find((ref) => ref.label === 'routine_summary');

        expect(summaryRef.ref).toMatch(/^routine-artifacts\/ohayo\/[a-f0-9]{64}\.json$/);
        expect(path.isAbsolute(summaryRef.ref)).toBe(false);
        expect(fs.existsSync(path.join(canonicalVarDir, summaryRef.ref))).toBe(true);
        expect(fs.existsSync(path.join(repoDir, 'var'))).toBe(false);
    });
});
