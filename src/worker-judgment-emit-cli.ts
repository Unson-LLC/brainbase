#!/usr/bin/env node
/**
 * RQ-119 S1 CLI. A Worker adapter (Claude Code hook, opencode plugin) invokes
 * this as a built node script — `node dist/worker-judgment-emit-cli.js` — never
 * `npx tsx` (§3.2: Claude hooks that call `npx tsx` fail in runner/worktree).
 *
 * It reads one JSON turn descriptor from stdin, writes the receipt to the local
 * outbox through the common port, and prints a safe summary. The OSS build
 * injects no transport, so the judgment is only written locally. The judgment
 * body, prompt, response, and any credential never appear on argv, in the
 * output, or in a skip marker.
 */
import { emitWorkerJudgment, WorkerJudgmentEmitterError, type WorkerJudgmentInput } from './worker-judgment-emitter.js';

interface CliPayload {
  readonly input: WorkerJudgmentInput;
  readonly journalRoot?: string;
  readonly effectiveAfter?: string;
}

/**
 * Fixed, input-free Japanese details keyed by the emitter's stable error codes.
 * The underlying exception message is never echoed: a corrupt-outbox or
 * conflict error carries the outbox path (which embeds `journalRoot`, possibly a
 * secret), so only a short constant string may reach the log.
 */
const CLI_ERROR_DETAIL: Record<string, string> = {
  worker_judgment_input_invalid: '入力が不正です',
  worker_judgment_entrypoint_invalid: 'entrypoint が不正です',
  worker_judgment_effective_after_invalid: '有効化境界の時刻が不正です',
  worker_judgment_journal_root_required: 'outbox の保存先が指定されていません',
  worker_judgment_receipt_conflict: '同じ判断に別の内容が既に保存されています',
  worker_judgment_outbox_corrupt: '保存済みの outbox が壊れています',
  worker_judgment_transport_error: '送信に失敗しました'
};

/** The pair of write sinks the CLI uses, injectable so a test never touches real process streams. */
export interface WorkerJudgmentEmitCliIo {
  readonly stdout: { write(chunk: string): unknown };
  readonly stderr: { write(chunk: string): unknown };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Run one emission from an already-read stdin string. Pure over its inputs: it
 * writes only to the injected io and returns the exit code, so it is tested
 * without spawning a process or reading real streams. Error reports are
 * input-free on purpose — a rejected turn descriptor may still carry a
 * credential, so the raw input and parser messages are never echoed.
 */
export async function runWorkerJudgmentEmitCli(
  raw: string,
  io: WorkerJudgmentEmitCliIo,
  env: Record<string, string | undefined> = process.env
): Promise<number> {
  let payload: CliPayload;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.input)) throw new Error('payload shape');
    payload = parsed as unknown as CliPayload;
  } catch {
    io.stderr.write(`${JSON.stringify({ error: 'worker_judgment_cli_input_invalid', detail: 'stdin は { input, journalRoot?, effectiveAfter? } の JSON オブジェクトである必要があります' })}\n`);
    return 2;
  }

  const journalRoot = payload.journalRoot ?? env.BRAINBASE_WORKER_JUDGMENT_JOURNAL_DIR;
  const effectiveAfter = payload.effectiveAfter ?? env.BRAINBASE_WORKER_JUDGMENT_EFFECTIVE_AFTER;
  if (!journalRoot || !effectiveAfter) {
    io.stderr.write(`${JSON.stringify({ error: 'worker_judgment_cli_config_missing', detail: 'journalRoot と effectiveAfter が必要です（payload か env で指定）' })}\n`);
    return 2;
  }

  try {
    const result = await emitWorkerJudgment(payload.input, { journalRoot, effectiveAfter });
    // Print only hashed identifiers and status — never the public frame, and
    // never the absolute outbox path (it embeds the possibly-secret journalRoot).
    // The outbox is addressed by its resolution_id alone.
    const summary = result.outcome === 'skipped'
      ? { outcome: result.outcome, reason_code: result.reason_code }
      : {
          outcome: result.outcome,
          status: result.status,
          resolution_id: result.receipt.resolution_id,
          turn_ref: result.receipt.turn_ref,
          deduped: result.deduped
        };
    io.stdout.write(`${JSON.stringify(summary)}\n`);
    return 0;
  } catch (error) {
    // Report only a stable error code and a fixed Japanese detail. The exception
    // message is never echoed — it can carry the outbox path (and journalRoot).
    const code = error instanceof WorkerJudgmentEmitterError ? error.code : 'worker_judgment_cli_error';
    const detail = CLI_ERROR_DETAIL[code] ?? 'ターンを emit できませんでした';
    io.stderr.write(`${JSON.stringify({ error: code, detail })}\n`);
    return 1;
  }
}

async function main(): Promise<number> {
  return runWorkerJudgmentEmitCli(await readStdin(), { stdout: process.stdout, stderr: process.stderr }, process.env);
}

// Only run when invoked as the process entrypoint, not when imported by a test.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().then((code) => { process.exitCode = code; }).catch(() => {
    process.stderr.write(`${JSON.stringify({ error: 'worker_judgment_cli_error', detail: 'the turn could not be emitted' })}\n`);
    process.exitCode = 1;
  });
}
