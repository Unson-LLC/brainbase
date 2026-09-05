import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadRuntimeEnv } from '../../lib/load-runtime-env.js';
import expectationManifest from '../../server/config/routine-expectations.json' with { type: 'json' };
import { parseRoutineExpectations } from '../../server/services/routine-runtime/expectation-parser.js';
import {
    loadCompanyAuthorityResponse,
    resolvePersonalKgCliAuthority
} from '../lib/personal-kg-cli-authority.js';

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
const DEFAULT_LOCAL_API_URL = 'http://127.0.0.1:31013';

function isLoopbackUrl(value) {
    try {
        const hostname = new URL(value).hostname;
        return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
    } catch {
        return false;
    }
}

function resolveRoutineApiUrl(env) {
    if (env.BRAINBASE_ROUTINE_API_URL) {
        return String(env.BRAINBASE_ROUTINE_API_URL).replace(/\/$/, '');
    }
    if (env.INTERNAL_API_SECRET) return DEFAULT_LOCAL_API_URL;
    return env.BRAINBASE_API_URL ? String(env.BRAINBASE_API_URL).replace(/\/$/, '') : '';
}

function resolveRoutineExecutionAuth({ env, endpoint }) {
    if (env.BRAINBASE_ROUTINE_SERVICE_TOKEN) {
        return { serviceToken: env.BRAINBASE_ROUTINE_SERVICE_TOKEN, internalApiKey: null };
    }
    if (env.INTERNAL_API_SECRET && isLoopbackUrl(endpoint)) {
        return { serviceToken: null, internalApiKey: env.INTERNAL_API_SECRET };
    }
    return { serviceToken: null, internalApiKey: null };
}

function resolveReceiptAuth({ env, endpoint }) {
    if (env.INTERNAL_API_SECRET && isLoopbackUrl(endpoint)) {
        return { serviceToken: null, internalApiKey: env.INTERNAL_API_SECRET };
    }
    if (env.BRAINBASE_RUN_RECEIPT_SERVICE_TOKEN) {
        return { serviceToken: env.BRAINBASE_RUN_RECEIPT_SERVICE_TOKEN, internalApiKey: null };
    }
    return { serviceToken: null, internalApiKey: null };
}

function routineAuthHeaders(auth) {
    if (auth.serviceToken) return { Authorization: `Bearer ${auth.serviceToken}` };
    if (auth.internalApiKey) return { 'x-internal-api-key': auth.internalApiKey };
    return {};
}

export function exitCodeForRoutineStatus(status) {
    if (status === 'completed') return 0;
    if (status === 'partial' || status === 'waiting_human') return 2;
    return 1;
}

export function serializeRoutineCliResult(result) {
    const output = { status: result?.status };
    if (result?.cycle_status) output.cycle_status = result.cycle_status;
    if (result?.coverage) output.coverage = result.coverage;
    if (result?.morning_output) {
        output.morning_output = {
            exceptions: (Array.isArray(result.morning_output.exceptions) ? result.morning_output.exceptions : [])
                .slice(0, 3)
                .map((item) => ({
                    ...(typeof item?.code === 'string' ? { code: item.code } : {}),
                    ...(typeof item?.summary === 'string' ? { summary: item.summary.slice(0, 2000) } : {})
                })),
            memories: (Array.isArray(result.morning_output.memories) ? result.morning_output.memories : [])
                .slice(0, 3)
                .map((item) => ({ summary: String(item?.summary || '').slice(0, 2000) }))
                .filter((item) => item.summary)
        };
    }
    if (result?.routine_output && typeof result.routine_output === 'object') {
        const safeRoutineOutput = {};
        if (typeof result.routine_output.headline === 'string') {
            safeRoutineOutput.headline = result.routine_output.headline.slice(0, 2000);
        }
        const reviewKeys = new Set([
            'personal_kg_registration_candidates',
            'personal_kg_registration_reviews',
            'graph_promotion_reviews'
        ]);
        for (const key of [
            'today_focus', 'immediate_decisions', 'warnings', 'carryovers', 'references',
            'tomorrow_focus', 'closed', 'personal_kg_registration_candidates',
            'system_changes', 'repeated_patterns', 'personal_kg_registration_reviews', 'graph_promotion_reviews'
        ]) {
            if (!Array.isArray(result.routine_output[key])) continue;
            safeRoutineOutput[key] = result.routine_output[key].slice(0, 10).map((item) => ({
                ...(reviewKeys.has(key) && typeof item?.id === 'string' ? { id: item.id.slice(0, 200) } : {}),
                ...(reviewKeys.has(key) && typeof item?.status === 'string' ? { status: item.status.slice(0, 100) } : {}),
                ...(key === 'references' && typeof item?.source === 'string' ? { source: item.source.slice(0, 100) } : {}),
                ...(typeof item?.summary === 'string' ? { summary: item.summary.slice(0, 2000) } : {}),
                ...(item?.applies_changes === false ? { applies_changes: false } : {})
            })).filter((item) => item.summary);
        }
        output.routine_output = safeRoutineOutput;
    }
    return JSON.stringify(output);
}

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

function persistRoutineSummary({ routine, routineSummary, varDir }) {
    if (!routineSummary || typeof routineSummary !== 'object' || !varDir) return null;
    const serializedSummary = JSON.stringify(routineSummary);
    const contentSha256 = createHash('sha256').update(serializedSummary).digest('hex');
    const relativePath = path.posix.join('routine-artifacts', routine, `${contentSha256}.json`);
    const target = path.join(varDir, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(target)) {
        const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(temporary, `${JSON.stringify({
            schema_version: 'routine_summary.v2',
            content_sha256: contentSha256,
            routine_summary: routineSummary
        }, null, 2)}\n`, { mode: 0o600 });
        fs.renameSync(temporary, target);
    }
    const discoverableTarget = path.join(varDir, 'routine-artifacts', `${routine}-${contentSha256}.json`);
    if (!fs.existsSync(discoverableTarget)) fs.linkSync(target, discoverableTarget);
    return { kind: 'artifact_ref', ref: relativePath, label: 'routine_summary' };
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
        run_id: threadId ? `${threadId}:${finishedAt}` : undefined,
        observation_id: threadId ? undefined : `routine:${normalizedRoutine}:${finishedAt}`,
        status: input.status,
        ...(input.blocker_reason ? { blocker_reason: input.blocker_reason } : {}),
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
    now = () => new Date(),
    executeCycle = null
}) {
    const cycleExecutor = executeCycle || ((cycleInput) => executeRoutineOverHttp({
        ...cycleInput,
        env,
        fetchImpl
    }));
    let cycleResult;
    try {
        cycleResult = await cycleExecutor({ routine, input });
    } catch {
        cycleResult = {
            status: 'failed',
            anomalies: [{ code: 'routine_execution_failed' }],
            routine_summary: { routine, status: 'failed', anomaly_count: 1 },
            evidence_refs: []
        };
    }
    if (cycleResult?.status === 'completed' && !cycleResult?.routine_summary) {
        cycleResult = {
            ...cycleResult,
            status: 'failed',
            anomalies: [
                ...(Array.isArray(cycleResult.anomalies) ? cycleResult.anomalies : []),
                { code: 'required_artifact_missing', artifact: 'routine_summary' }
            ],
            routine_summary: { routine, status: 'failed', anomaly_count: 1 }
        };
    }
    const summaryRef = persistRoutineSummary({
        routine,
        routineSummary: cycleResult?.routine_summary,
        varDir: env.BRAINBASE_VAR_DIR || resolveRoutineReceiptPaths({ repoDir, env }).varDir
    });
    const evidenceRefs = Array.isArray(cycleResult?.evidence_refs)
        ? cycleResult.evidence_refs.filter((ref) => !summaryRef || ref?.label !== 'routine_summary')
        : [];
    if (summaryRef) evidenceRefs.push(summaryRef);
    const receiptInput = {
        ...cycleResult,
        status: cycleResult?.status === 'partial' ? 'waiting_human' : cycleResult?.status,
        finished_at: cycleResult?.finished_at || input.finished_at,
        started_at: cycleResult?.started_at || input.started_at,
        evidence_refs: evidenceRefs,
        ...(cycleResult?.anomalies?.some((entry) => entry.code === 'required_artifact_missing')
            ? { blocker_reason: 'required_artifact_missing: routine_summary' }
            : {})
    };
    const receipt = buildRoutineRunReceipt({ routine, env, input: receiptInput, now });
    if (receipt.kind === 'pending') return receipt;

    const { outboxDir, deadLetterDir } = resolveRoutineReceiptPaths({ repoDir, env });
    const queued = enqueueCodexAutomationReceipt(receipt, { outboxDir });
    const baseUrl = resolveRoutineApiUrl(env);
    const receiptEndpoint = env.BRAINBASE_RUN_RECEIPT_INGEST_URL
        || (baseUrl ? `${baseUrl}/api/run-receipts/ingest` : undefined);
    const receiptAuth = resolveReceiptAuth({ env, endpoint: receiptEndpoint });
    const delivery = await deliverCodexAutomationOutbox({
        outboxDir,
        deadLetterDir,
        endpoint: receiptEndpoint,
        serviceToken: receiptAuth.serviceToken,
        internalApiKey: receiptAuth.internalApiKey,
        fetchImpl,
        maxAttempts,
        now
    });
    return {
        ...cycleResult,
        status: cycleResult.status,
        cycle_status: cycleResult.status,
        queued: queued.status,
        delivery
    };
}

export async function executeRoutineOverHttp({ routine, input = {}, env = process.env, fetchImpl = globalThis.fetch }) {
    const baseUrl = resolveRoutineApiUrl(env);
    if (!baseUrl) throw new Error('BRAINBASE_ROUTINE_API_URL or local control plane is required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
    const auth = resolveRoutineExecutionAuth({ env, endpoint: baseUrl });
    if (!auth.serviceToken && !auth.internalApiKey) {
        throw new Error('routine authentication is required');
    }
    const useRetroServiceAuthority = ['oyasumi', 'retro'].includes(routine) && Boolean(auth.serviceToken);
    let companyAuthorityResponse;
    if (!useRetroServiceAuthority) {
        resolvePersonalKgCliAuthority({ desiredEffect: 'read', env });
        companyAuthorityResponse = loadCompanyAuthorityResponse(env);
    }
    const headers = {
        'Content-Type': 'application/json',
        ...routineAuthHeaders(auth)
    };
    const response = await fetchImpl(`${baseUrl}/api/routines/${routine}/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            ...(env.CODEX_THREAD_ID ? { thread_id: env.CODEX_THREAD_ID } : {}),
            ...(companyAuthorityResponse ? { company_authority_response: companyAuthorityResponse } : {}),
            input
        })
    });
    if (!response?.ok) throw new Error(`routine API failed (${response?.status || 'unknown'})`);
    return response.json();
}

async function main() {
    loadRuntimeEnv({ cwd: DEFAULT_REPO_DIR });
    const routine = process.argv[2];
    const input = await readStdin();
    const result = await runRoutine({ routine, input });
    process.stdout.write(`${serializeRoutineCliResult(result)}\n`);
    process.exitCode = exitCodeForRoutineStatus(result.status);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    main().catch((error) => {
        process.stderr.write(`[brainbase-routine] ${error.message}\n`);
        process.exitCode = 1;
    });
}
