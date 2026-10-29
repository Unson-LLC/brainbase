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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function main(): Promise<number> {
  const raw = await readStdin();
  let payload: CliPayload;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.input)) throw new Error('payload must be { input, journalRoot?, effectiveAfter? }');
    payload = parsed as unknown as CliPayload;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: 'worker_judgment_cli_input_invalid', detail: (error as Error).message })}\n`);
    return 2;
  }

  const journalRoot = payload.journalRoot ?? process.env.BRAINBASE_WORKER_JUDGMENT_JOURNAL_DIR;
  const effectiveAfter = payload.effectiveAfter ?? process.env.BRAINBASE_WORKER_JUDGMENT_EFFECTIVE_AFTER;
  if (!journalRoot || !effectiveAfter) {
    process.stderr.write(`${JSON.stringify({ error: 'worker_judgment_cli_config_missing', detail: 'journalRoot and effectiveAfter are required (payload or env)' })}\n`);
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
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof WorkerJudgmentEmitterError ? error.code : 'worker_judgment_cli_error';
    process.stderr.write(`${JSON.stringify({ error: code, detail: (error as Error).message })}\n`);
    return 1;
  }
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  process.stderr.write(`${JSON.stringify({ error: 'worker_judgment_cli_error', detail: (error as Error).message })}\n`);
  process.exitCode = 1;
});
