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
    io.stderr.write(`${JSON.stringify({ error: 'worker_judgment_cli_input_invalid', detail: 'stdin must be a JSON object { input, journalRoot?, effectiveAfter? }' })}\n`);
    return 2;
  }

  const journalRoot = payload.journalRoot ?? env.BRAINBASE_WORKER_JUDGMENT_JOURNAL_DIR;
  const effectiveAfter = payload.effectiveAfter ?? env.BRAINBASE_WORKER_JUDGMENT_EFFECTIVE_AFTER;
  if (!journalRoot || !effectiveAfter) {
    io.stderr.write(`${JSON.stringify({ error: 'worker_judgment_cli_config_missing', detail: 'journalRoot and effectiveAfter are required (payload or env)' })}\n`);
    return 2;
  }

  try {
    const result = await emitWorkerJudgment(payload.input, { journalRoot, effectiveAfter });
    // Print only hashed identifiers and status. Never echo the public frame.
    const summary = result.outcome === 'skipped'
      ? { outcome: result.outcome, reason_code: result.reason_code, path: result.path }
      : {
          outcome: result.outcome,
          status: result.status,
          resolution_id: result.receipt.resolution_id,
          turn_ref: result.receipt.turn_ref,
          deduped: result.deduped,
          path: result.path
        };
    io.stdout.write(`${JSON.stringify(summary)}\n`);
    return 0;
  } catch (error) {
    // Only the emitter's own code/message is controlled and input-free; any other
    // failure reports a fixed reason so a stray value can never reach the log.
    const report = error instanceof WorkerJudgmentEmitterError
      ? { error: error.code, detail: error.message }
      : { error: 'worker_judgment_cli_error', detail: 'the turn could not be emitted' };
    io.stderr.write(`${JSON.stringify(report)}\n`);
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
