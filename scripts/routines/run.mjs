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
import { buildDailyOpsReportHtml, normalizeDailyOpsReport } from '../daily-ops-report.mjs';

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
    if (env.INTERNAL_API_SECRET && isLoopbackUrl(endpoint)) {
        return { serviceToken: null, internalApiKey: env.INTERNAL_API_SECRET };
    }
    if (env.BRAINBASE_ROUTINE_SERVICE_TOKEN) {
        return { serviceToken: env.BRAINBASE_ROUTINE_SERVICE_TOKEN, internalApiKey: null };
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
        if (['deep', 'shallow', 'unconfirmed'].includes(result.routine_output.sleep_state)) {
            safeRoutineOutput.sleep_state = result.routine_output.sleep_state;
        }
        const reviewKeys = new Set([
            'personal_kg_registration_candidates',
            'personal_kg_registration_reviews',
            'graph_promotion_reviews'
        ]);
        const feedbackKeys = new Set(['consolidated_memories', 'feedback_targets']);
        for (const key of [
            'today_focus', 'ai_actions', 'immediate_decisions', 'warnings', 'carryovers', 'source_coverage', 'references',
            'sleep_causes', 'consolidated_memories', 'associations', 'feedback_targets', 'unresolved_items',
            'tomorrow_focus', 'closed', 'personal_kg_registration_candidates',
            'system_changes', 'repeated_patterns', 'personal_kg_registration_reviews', 'graph_promotion_reviews',
            'outcomes', 'decision_replays', 'changed_judgments', 'mistaken_assumptions'
        ]) {
            if (!Array.isArray(result.routine_output[key])) continue;
            safeRoutineOutput[key] = result.routine_output[key].slice(0, 10).map((item) => ({
                ...(reviewKeys.has(key) && typeof item?.id === 'string' ? { id: item.id.slice(0, 200) } : {}),
                ...(feedbackKeys.has(key) && typeof item?.id === 'string' ? { id: item.id.slice(0, 200) } : {}),
                ...(reviewKeys.has(key) && typeof item?.status === 'string' ? { status: item.status.slice(0, 100) } : {}),
                ...((key === 'references' || key === 'source_coverage' || feedbackKeys.has(key)) && typeof item?.source === 'string'
                    ? { source: item.source.slice(0, 100) } : {}),
                ...(key === 'source_coverage' && typeof item?.status === 'string'
                    ? { status: item.status.slice(0, 100) } : {}),
                ...(key === 'sleep_causes' && typeof item?.code === 'string' ? { code: item.code.slice(0, 100) } : {}),
                ...(key === 'sleep_causes' && Number.isFinite(item?.count) ? { count: item.count } : {}),
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

function persistOhayoDayView({ input, routineOutput, varDir }) {
    const dayView = input?.day_view;
    if (!dayView || typeof dayView !== 'object' || !varDir) return null;
    const date = typeof dayView.date === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(dayView.date)
        ? dayView.date : new Date().toISOString().slice(0, 10);
    const sourceCoverage = Array.isArray(routineOutput?.source_coverage)
        ? routineOutput.source_coverage
        : (Array.isArray(dayView.source_coverage) ? dayView.source_coverage : []);
    const coverageEvidence = sourceCoverage
        .map((item) => ({
            label: `${String(item?.source || 'source')}: ${String(item?.status || 'unavailable')}`,
            ref: String(item?.summary || '確認範囲を取得できませんでした')
        }));
    const priorityItems = (items, status) => (Array.isArray(items) ? items : []).map((item) => ({
        ...item,
        meta: { ...(item?.meta || {}), status }
    }));
    const report = normalizeDailyOpsReport({
        mode: 'ohayo',
        date,
        title: '今日の見通し',
        summary: [routineOutput?.headline, dayView.summary].filter(Boolean).join('。'),
        calendar: dayView.calendar,
        mail: dayView.mail,
        slack: dayView.slack,
        priorityTasks: [
            ...priorityItems(dayView.today_focus, '今日の到達点'),
            ...priorityItems(dayView.ai_actions, 'AIが進める'),
            ...priorityItems(dayView.human_decisions, '要判断'),
            ...priorityItems(dayView.carryovers, '持ち越し'),
            ...(Array.isArray(dayView.priority_tasks) ? dayView.priority_tasks : [])
        ],
        evidence: [...coverageEvidence, ...(Array.isArray(dayView.evidence) ? dayView.evidence : [])]
    });
    const relativePath = path.posix.join('daily-ops-reports', `ohayo-${date}.html`);
    const target = path.join(varDir, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, buildDailyOpsReportHtml(report), { mode: 0o600 });
    fs.writeFileSync(target.replace(/\.html$/u, '.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    return { kind: 'artifact_ref', ref: `ohayo-day-view:${relativePath}`, label: 'ohayo_day_view' };
}

function persistRetroWeekView({ input, routineOutput, varDir }) {
    const weekView = input?.week_view;
    if (!weekView || typeof weekView !== 'object' || !varDir) return null;
    const until = typeof weekView.until === 'string' ? weekView.until.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const item = (value, status) => (Array.isArray(value) ? value : []).map((entry) => ({
        ...entry,
        meta: { ...(entry?.meta || {}), status }
    }));
    const report = normalizeDailyOpsReport({
        mode: 'retro',
        date: until,
        title: '週次レトロ',
        summary: routineOutput?.headline || weekView.summary || '',
        outcomes: item(routineOutput?.outcomes, '確認済みOutcome'),
        decisionReplays: item(routineOutput?.decision_replays, 'Replay'),
        changedJudgments: item(routineOutput?.changed_judgments, '判断差分'),
        mistakenAssumptions: item(routineOutput?.mistaken_assumptions, '要修正'),
        repeatedPatterns: item(routineOutput?.repeated_patterns, '反復'),
        systemChanges: item(routineOutput?.system_changes, '候補・未適用'),
        personalKgReviews: item(routineOutput?.personal_kg_registration_reviews, '要レビュー'),
        graphPromotionReviews: item(routineOutput?.graph_promotion_reviews, '要レビュー'),
        sourceCoverage: item(routineOutput?.source_coverage, '確認範囲'),
        evidence: Array.isArray(weekView.evidence) ? weekView.evidence : []
    });
    const relativePath = path.posix.join('daily-ops-reports', `retro-${until}.html`);
    const target = path.join(varDir, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, buildDailyOpsReportHtml(report), { mode: 0o600 });
    fs.writeFileSync(target.replace(/\.html$/u, '.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    return { kind: 'artifact_ref', ref: `retro-week-view:${relativePath}`, label: 'retro_week_view' };
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
    const varDir = env.BRAINBASE_VAR_DIR || resolveRoutineReceiptPaths({ repoDir, env }).varDir;
    let dayViewRef = null;
    if (routine === 'ohayo' && input?.day_view) {
        try {
            dayViewRef = persistOhayoDayView({
                input,
                routineOutput: cycleResult?.routine_output || cycleResult?.routine_summary?.routine_output,
                varDir
            });
        } catch {
            const anomalies = [
                ...(Array.isArray(cycleResult?.anomalies) ? cycleResult.anomalies : []),
                { code: 'ohayo_day_view_persistence_failed' }
            ];
            cycleResult = {
                ...cycleResult,
                status: cycleResult?.status === 'failed' ? 'failed' : 'partial',
                coverage: 'partial',
                anomalies,
                routine_summary: {
                    ...(cycleResult?.routine_summary || {}),
                    routine,
                    status: cycleResult?.status === 'failed' ? 'failed' : 'partial',
                    coverage: 'partial',
                    anomaly_count: anomalies.length
                }
            };
        }
    }
    let weekViewRef = null;
    if (routine === 'retro' && input?.week_view) {
        try {
            weekViewRef = persistRetroWeekView({
                input,
                routineOutput: cycleResult?.routine_output || cycleResult?.routine_summary?.routine_output,
                varDir
            });
        } catch {
            const anomalies = [
                ...(Array.isArray(cycleResult?.anomalies) ? cycleResult.anomalies : []),
                { code: 'retro_week_view_persistence_failed' }
            ];
            cycleResult = {
                ...cycleResult,
                status: cycleResult?.status === 'failed' ? 'failed' : 'partial',
                coverage: 'partial',
                anomalies
            };
        }
    }
    const summaryRef = persistRoutineSummary({
        routine,
        routineSummary: cycleResult?.routine_summary,
        varDir
    });
    const evidenceRefs = Array.isArray(cycleResult?.evidence_refs)
        ? cycleResult.evidence_refs.filter((ref) => !summaryRef || ref?.label !== 'routine_summary')
        : [];
    if (summaryRef) evidenceRefs.push(summaryRef);
    if (dayViewRef) evidenceRefs.push(dayViewRef);
    if (weekViewRef) evidenceRefs.push(weekViewRef);
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
        evidence_refs: evidenceRefs,
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
    const useServerResolvedAuthority = Boolean(auth.internalApiKey);
    const useRoutineServiceAuthority = ['oyasumi', 'retro'].includes(routine) && Boolean(auth.serviceToken);
    let companyAuthorityResponse;
    if (!useServerResolvedAuthority && !useRoutineServiceAuthority) {
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
