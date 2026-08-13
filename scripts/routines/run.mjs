import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import expectationManifest from '../../server/config/routine-expectations.json' with { type: 'json' };
import { parseRoutineExpectations } from '../../server/services/routine-runtime/expectation-parser.js';

import {
    buildCodexAutomationReceipt,
    deliverCodexAutomationOutbox,
    enqueueCodexAutomationReceipt
} from '../run-receipt/codex-automations-reporter.mjs';
import { resolveRoutineReceiptPaths } from './runtime-paths.mjs';

const ROUTINE_NAMES = Object.freeze(['ohayo', 'oyasumi', 'retro']);
const routineExpectations = parseRoutineExpectations(expectationManifest);
const EXPECTATION_BY_ROUTINE = new Map(routineExpectations.map((expectation) => [
    expectation.routine,
    expectation
]));
const DEFAULT_REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function requireRoutine(routine) {
    if (!ROUTINE_NAMES.includes(routine) || !EXPECTATION_BY_ROUTINE.has(routine)) {
        throw new Error('routine must be one of: ohayo, oyasumi, retro');
    }
    return EXPECTATION_BY_ROUTINE.get(routine);
}

function toIso(value, fieldName) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`${fieldName} must be a valid date`);
    return date.toISOString();
}

export function buildRoutineRunReceipt({
    routine,
    env = process.env,
    input = {},
    now = () => new Date()
}) {
    const expectation = requireRoutine(routine);
    const normalizedRoutine = expectation.routine;
    const automationId = expectation.automation_id;
    const finishedAt = toIso(input.finished_at || now(), 'finished_at');
    const startedAt = input.started_at ? toIso(input.started_at, 'started_at') : undefined;
    const threadId = typeof env.CODEX_THREAD_ID === 'string' && env.CODEX_THREAD_ID.trim()
        ? env.CODEX_THREAD_ID.trim()
        : undefined;

    return buildCodexAutomationReceipt({
        automation_id: automationId,
        project_id: 'brainbase',
        run_id: threadId,
        observation_id: threadId ? undefined : `routine:${normalizedRoutine}:${finishedAt}`,
        status: input.status,
        ...(startedAt ? { started_at: startedAt } : {}),
        finished_at: finishedAt,
        evidence_refs: input.evidence_refs
    });
}

async function readStdin() {
    if (process.stdin.isTTY) return {};
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    return raw ? JSON.parse(raw) : {};
}

export async function runRoutine({
    routine,
    repoDir = DEFAULT_REPO_DIR,
    env = process.env,
    input = {},
    fetchImpl = globalThis.fetch,
    maxAttempts = 5,
    now = () => new Date()
}) {
    const receipt = buildRoutineRunReceipt({ routine, env, input, now });
    if (receipt.kind === 'pending') return receipt;

    const { outboxDir, deadLetterDir } = resolveRoutineReceiptPaths({ repoDir, env });
    const queued = enqueueCodexAutomationReceipt(receipt, { outboxDir });
    const delivery = await deliverCodexAutomationOutbox({
        outboxDir,
        deadLetterDir,
        endpoint: env.BRAINBASE_RUN_RECEIPT_INGEST_URL,
        serviceToken: env.BRAINBASE_RUN_RECEIPT_SERVICE_TOKEN,
        fetchImpl,
        maxAttempts,
        now
    });
    return { queued: queued.status, delivery };
}

async function main() {
    const routine = process.argv[2];
    const input = await readStdin();
    const result = await runRoutine({ routine, input });
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    main().catch((error) => {
        process.stderr.write(`[brainbase-routine] ${error.message}\n`);
        process.exitCode = 1;
    });
}
