#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
    chmodSync,
    closeSync,
    constants as fsConstants,
    linkSync,
    mkdirSync,
    openSync,
    readdirSync,
    readFileSync,
    realpathSync,
    statSync,
    unlinkSync,
    writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    sanitizeJudgmentAnswer,
    toKnowledgeEventFromJudgmentEpisode
} from '../../server/services/routine-runtime/judgment-event-adapter.js';
import {
    buildJudgmentValueProofProjection,
    extractJudgmentValueProofInput,
    judgmentValueProofDigest,
    latestJudgmentValueProofEvent,
    projectJudgmentValueProofCompanionAttention,
    renderJudgmentValueProofAttentionSurface,
    renderJudgmentValueProofSurface
} from '../../server/services/routine-runtime/judgment-value-proof-adapter.js';
import {
    enqueueJudgmentKnowledgeEvent,
    resolveJudgmentKnowledgeEventOutboxPath
} from '../../server/services/routine-runtime/judgment-event-outbox.js';
import {
    evaluateJudgmentAutonomy,
    extractHumanDecisionQuestion,
    renderJudgmentAutonomyContinuation
} from './judgment-autonomy.mjs';

let Database;
const builtInSqlite = process.getBuiltinModule?.('node:sqlite');
if (builtInSqlite) {
    const { DatabaseSync } = builtInSqlite;
    Database = class NodeSqliteDatabase {
        constructor(path, { timeout = 0 } = {}) {
            this.database = new DatabaseSync(path);
            this.database.exec(`PRAGMA busy_timeout = ${timeout}`);
        }

        pragma(statement) { this.database.exec(`PRAGMA ${statement}`); }
        exec(statement) { return this.database.exec(statement); }
        close() { return this.database.close(); }
    };
} else {
    Database = (await import('better-sqlite3')).default;
}

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), '../..');
const DEFAULT_HOST_URL = 'http://127.0.0.1:39002/host/judgment/resolve';
const TRANSIENT_REASONS = new Set([
    'brainbase_api_unavailable',
    'judgment_host_bridge_failed',
    'judgment_host_transport_failed'
]);
// A start transition may include three bounded 15-second Resolver attempts.
// Other lifecycle processes must wait through that authorized start budget.
const DEFAULT_LOCK_WAIT_ATTEMPTS = 5000;
const DEFAULT_LOCK_WAIT_MS = 10;
const NO_BRAINBASE_REFERENCE_LINE = '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓';
const AUTONOMY_CONTINUATION_PROGRESS_LINE = '🔁 確認不要と判定しました。回答を差し戻して処理を続けています';
const AUTONOMY_CONTINUATION_COMPLETE_LINE = '🔁 自律継続: 不要な確認を1回差し戻し → 継続完了 ✓';
const OUTCOME_CONTINUATION_PROGRESS_LINE = '🔁 未完了と判定しました。方針説明だけの回答を差し戻して作業を続けています';
const OUTCOME_CONTINUATION_COMPLETE_LINE = '🔁 実行継続: 方針説明での停止を1回差し戻し → 作業完了 ✓';
const STOP_REPAIR_COMPLETE_LINE = '🛠️ Stop修復: 最終回答を1回差し戻し → 修復完了 ✓';
const ORPHAN_AUDIT_WARNING = '⚠️ Brainbase監査未完了: この応答は完全監査できませんでした。作業は継続しており、新しいtaskの作成やHook操作は不要です。';
const ORPHAN_TOOL_EVENT_WARNING = '⚠️ Brainbase監査未完了: Brainbase tool eventを開始episodeへ結合できませんでした。';
const CAPABILITY_ACTION_CONTRACTS = Object.freeze({
    'knowledge.resolve': Object.freeze({
        capability: 'knowledge.resolve',
        exactTool: 'mcp__brainbase__brainbase_knowledge_resolve',
        actionDescription: '正本の所在と次の取得経路を選び、回答本文を取得しません',
        distinctFrom: 'Hostが確定したJudgment routeの再分類'
    })
});
const AUTONOMY_RUNTIME_ESCALATION_REASONS = Object.freeze([
    'irreversible_action',
    'missing_authority',
    'owner_value_choice',
    'required_input_unavailable',
    'evidenced_terminal_blocker'
]);
const AUTONOMY_REASON_CODES = new Set([
    'routine_in_scope', 'classification_missing', 'policy_conflict', 'risk_or_external'
]);
const AUTONOMY_MARKER_PATTERN = /^⚠️ 確認が必要\[([a-z_]+)\]:\s*\S/u;
const AUTONOMY_QUESTION_PATTERN = /^⚠️ 確認が必要\[([a-z_]+)\]:\s*(.+)$/u;
const STRUCTURED_STOP_STATE_PATTERN = /^<!-- brainbase-stop-state:(\{.*\}) -->$/u;
const JUDGMENT_STATE_TOOL_NAME = 'mcp__brainbase__brainbase_judgment_state_record';
const JUDGMENT_VALUE_PROOF_TOOL_NAME = 'mcp__brainbase__brainbase_judgment_value_proof_record';

function compareCodePoints(left, right) {
    const a = Array.from(left, (value) => value.codePointAt(0));
    const b = Array.from(right, (value) => value.codePointAt(0));
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        if (a[index] !== b[index]) return a[index] - b[index];
    }
    return a.length - b.length;
}

export function canonicalJson(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('canonical JSON only supports finite numbers');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort(compareCodePoints).map((key) => {
            if (value[key] === undefined) throw new TypeError('canonical JSON does not support undefined');
            return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
        }).join(',')}}`;
    }
    throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function contentText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map((item) => {
        if (typeof item === 'string') return item;
        const block = record(item);
        if (!block || !['input_text', 'output_text', 'text'].includes(String(block.type))) return '';
        return typeof block.text === 'string' ? block.text : '';
    }).filter(Boolean).join('\n');
}

function isInjectedHostEnvelope(text) {
    const trimmed = text.trimStart();
    return trimmed.startsWith('<recommended_plugins>')
        || /^<hook_prompt(?:\s|>)/u.test(trimmed)
        || /^# AGENTS\.md instructions(?:\s+for\b|(?:\r?\n|$))/u.test(trimmed)
        || trimmed.startsWith('<environment_context>')
        || trimmed.startsWith('<app-context>');
}

const TURN_RESOLUTION_TOOL_NAME = 'mcp__brainbase__brainbase_resolve_turn';
// Mirrors the brainbase_resolve_turn inputSchema; exec-mode models do not
// reliably read tool schemas, so the exact shape is stated in the context.
const MODEL_INTERPRETATION_SHAPE = 'model_interpretation must contain exactly these keys and nothing else: '
    + 'intent (one of answer|investigate|diagnose|design|implement|review|operate), '
    + 'domains (non-empty array from general|knowledge|personal_judgment|engineering|organization|operations), '
    + 'action_kind (none|read|write|external), risk (low|medium|high|critical), '
    + 'confidence (confirmed|inferred|unknown), '
    + 'signals (array, possibly empty, from cumulative_effect|complexity_growth|threshold_proposal|parallel_exploration|authority_boundary|problem_frame_uncertain|external_outcome).';
const TURN_RESOLUTION_UNAVAILABLE_PATTERN = new RegExp(
    `(?:${TURN_RESOLUTION_TOOL_NAME}\\b[^\\n]{0,40}\\bis not a function\\b`
    + `|(?:unknown tool|tool not found|no such tool)[^\\n]{0,80}${TURN_RESOLUTION_TOOL_NAME}\\b)`,
    'iu'
);

// A long-lived Codex thread keeps the MCP tool surface it started with. When
// that surface predates the model-first contract, the model cannot call
// brainbase_resolve_turn at all; the only deterministic evidence is the
// recorded tool failure in the raw transcript.
function turnResolutionAttempt(eventPayload) {
    if (eventPayload.name === TURN_RESOLUTION_TOOL_NAME) return 'direct';
    const script = [eventPayload.input, eventPayload.arguments].find((value) => typeof value === 'string') ?? '';
    return script.includes(`${TURN_RESOLUTION_TOOL_NAME}(`) ? 'wrapped' : null;
}

function turnResolutionSurfaceFromOutput(attempt, eventPayload) {
    const output = typeof eventPayload.output === 'string' ? eventPayload.output : contentText(eventPayload.output);
    const metadata = record(eventPayload.internal_chat_message_metadata_passthrough) ?? record(eventPayload.metadata);
    const evidence = {
        attempt,
        turn_id: typeof metadata?.turn_id === 'string' ? metadata.turn_id : null,
        call_ref: sha256(String(eventPayload.call_id ?? '')),
        output_digest: sha256(output)
    };
    if (TURN_RESOLUTION_UNAVAILABLE_PATTERN.test(output)) return { status: 'unavailable', evidence };
    return attempt === 'direct' ? { status: 'available', evidence } : null;
}

function pathInside(path, root) {
    const delta = relative(root, path);
    return delta === '' || (!delta.startsWith(`..${sep}`) && delta !== '..' && !isAbsolute(delta));
}

function transcriptRoots(env) {
    const configured = (env.BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS || '')
        .split(':').map((value) => value.trim()).filter(Boolean);
    return (configured.length > 0 ? configured : [join(homedir(), '.codex', 'sessions')])
        .map((path) => {
            try { return realpathSync(path); } catch { return null; }
        }).filter(Boolean);
}

function readCanonicalTranscript(payload, env) {
    const transcriptPath = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
    if (!transcriptPath) return { messages: [], delegations: [], complete: false };
    let canonicalPath;
    try {
        canonicalPath = realpathSync(transcriptPath);
        if (!statSync(canonicalPath).isFile()) return { messages: [], delegations: [], complete: false };
    } catch {
        return { messages: [], delegations: [], complete: false };
    }
    const roots = transcriptRoots(env);
    if (roots.length === 0 || !roots.some((root) => pathInside(canonicalPath, root))) {
        return { messages: [], delegations: [], complete: false };
    }
    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
    const messages = [];
    const delegations = [];
    const parsedEvents = [];
    const turnResolutionAttempts = new Map();
    const injectedUserTurns = new Set();
    let turnResolutionSurface = { status: 'unknown', evidence: null };
    const text = readFileSync(canonicalPath, 'utf8');
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { return { messages: [], delegations: [], complete: false }; }
        const envelope = record(event);
        const eventPayload = record(envelope?.payload);
        if (!envelope || !eventPayload) continue;
        parsedEvents.push({ envelope, eventPayload });
    }
    const sessionAliases = new Set(sessionId ? [sessionId] : []);
    const sessionMetas = parsedEvents
        .filter(({ envelope }) => envelope.type === 'session_meta')
        .map(({ eventPayload }) => [eventPayload.id, eventPayload.session_id]
            .filter((value) => typeof value === 'string'));
    let changed = true;
    while (changed) {
        changed = false;
        for (const ids of sessionMetas) {
            if (!ids.some((id) => sessionAliases.has(id))) continue;
            for (const id of ids) {
                if (sessionAliases.has(id)) continue;
                sessionAliases.add(id);
                changed = true;
            }
        }
    }
    const sessionMatched = Boolean(sessionId)
        && sessionMetas.some((ids) => ids.some((id) => sessionAliases.has(id)));
    const mixedSessionComponents = sessionMetas.some((ids) =>
        ids.length === 0 || ids.some((id) => !sessionAliases.has(id)));
    if (!sessionMatched || mixedSessionComponents) {
        return { messages: [], delegations: [], complete: false };
    }
    let activeSessionMatched = false;
    let sequence = 0;
    for (const { envelope, eventPayload } of parsedEvents) {
        if (envelope.type === 'session_meta') {
            const ids = [eventPayload.id, eventPayload.session_id].filter((value) => typeof value === 'string');
            activeSessionMatched = ids.some((id) => sessionAliases.has(id));
            continue;
        }
        if (envelope.type !== 'response_item') continue;
        if (!activeSessionMatched) continue;
        if (['function_call', 'custom_tool_call'].includes(eventPayload.type)) {
            const attempt = turnResolutionAttempt(eventPayload);
            if (attempt) turnResolutionAttempts.set(String(eventPayload.call_id ?? ''), attempt);
            continue;
        }
        if (['function_call_output', 'custom_tool_call_output'].includes(eventPayload.type)) {
            const attempt = turnResolutionAttempts.get(String(eventPayload.call_id ?? '')) ?? null;
            const surface = attempt ? turnResolutionSurfaceFromOutput(attempt, eventPayload) : null;
            if (surface) turnResolutionSurface = surface;
        }
        if (eventPayload.type === 'function_call_output') {
            const metadata = record(eventPayload.internal_chat_message_metadata_passthrough)
                ?? record(eventPayload.metadata);
            const turnId = typeof metadata?.turn_id === 'string' ? metadata.turn_id : null;
            const output = typeof eventPayload.output === 'string' ? eventPayload.output.trim() : '';
            const allowedName = ['create_thread', 'send_message_to_thread'].includes(eventPayload.name);
            const inputTagCount = (output.match(/<input>/gu) ?? []).length;
            const closingInputTagCount = (output.match(/<\/input>/gu) ?? []).length;
            const match = allowedName
                && eventPayload.namespace === 'codex_app'
                && inputTagCount === 1
                && closingInputTagCount === 1
                ? output.match(/^<codex_delegation>\s*<source_thread_id>[^<]+<\/source_thread_id>\s*<input>([\s\S]+)<\/input>\s*<\/codex_delegation>$/u)
                : null;
            const prompt = match?.[1]?.trim() ?? '';
            if (turnId && prompt) delegations.push({ turn_id: turnId, prompt, name: eventPayload.name });
            continue;
        }
        if (eventPayload.type !== 'message') continue;
        if (!['user', 'assistant'].includes(String(eventPayload.role))) continue;
        const body = contentText(eventPayload.content);
        const metadata = record(eventPayload.internal_chat_message_metadata_passthrough)
            ?? record(eventPayload.metadata);
        if (!body.trim() || isInjectedHostEnvelope(body)) {
            if (eventPayload.role === 'user' && body.trim() && typeof metadata?.turn_id === 'string') {
                injectedUserTurns.add(metadata.turn_id);
            }
            continue;
        }
        messages.push({
            sequence,
            turn_id: typeof metadata?.turn_id === 'string'
                ? metadata.turn_id
                : typeof eventPayload.turn_id === 'string' ? eventPayload.turn_id : null,
            role: eventPayload.role,
            phase: typeof metadata?.phase === 'string'
                ? metadata.phase
                : typeof eventPayload.phase === 'string' ? eventPayload.phase : null,
            text: body
        });
        sequence += 1;
    }
    return {
        messages,
        delegations,
        turn_resolution_surface: turnResolutionSurface,
        injected_user_turns: [...injectedUserTurns],
        complete: true
    };
}

function transcriptTurnResolutionSurface(payload, env) {
    const surface = readCanonicalTranscript(payload, env).turn_resolution_surface;
    return surface?.status === 'unavailable' ? surface : null;
}

function hostSurfaceForEpisode(payload, env) {
    const surface = transcriptTurnResolutionSurface(payload, env);
    if (!surface) return null;
    return {
        schema_version: 'brainbase-judgment-host-surface-v1',
        turn_resolution: 'unavailable',
        evidence: surface.evidence
    };
}

function verifyHostSurface(value) {
    if (value === undefined) return null;
    if (!record(value)
        || value.schema_version !== 'brainbase-judgment-host-surface-v1'
        || value.turn_resolution !== 'unavailable'
        || !record(value.evidence)) {
        throw new Error('judgment_episode_host_surface_invalid');
    }
    return value;
}

function turnResolutionUnavailable(episode) {
    return episode?.host_surface?.turn_resolution === 'unavailable';
}

function delegatedPromptForTurn(payload, env) {
    const identity = payloadIdentity(payload);
    if (!identity) return null;
    const transcript = readCanonicalTranscript(payload, env);
    if (!transcript.complete) return null;
    const exact = transcript.delegations.filter((delegation) => delegation.turn_id === identity.turnId);
    return exact.length === 1 ? exact[0].prompt : null;
}

function findRepoRoot(start) {
    let current = resolve(start || REPO_ROOT);
    for (;;) {
        try {
            statSync(join(current, '.git'));
            return current;
        } catch {
            const parent = dirname(current);
            if (parent === current) return null;
            current = parent;
        }
    }
}

function instructionBindings(cwd) {
    const root = findRepoRoot(cwd);
    if (!root) return [];
    const paths = [join(root, 'AGENTS.md')];
    if (resolve(cwd) !== root) paths.push(join(resolve(cwd), 'AGENTS.md'));
    const seen = new Set();
    return paths.flatMap((path) => {
        let canonical;
        try {
            canonical = realpathSync(path);
            if (seen.has(canonical) || !statSync(canonical).isFile()) return [];
        } catch { return []; }
        seen.add(canonical);
        return [{
            scope: canonical === join(root, 'AGENTS.md') ? 'repository' : 'directory',
            source_ref: relative(root, canonical).replaceAll(sep, '/') || 'AGENTS.md',
            digest: sha256(readFileSync(canonical))
        }];
    });
}

function journalRoot(env) {
    return env.BRAINBASE_JUDGMENT_JOURNAL_DIR
        ? resolve(env.BRAINBASE_JUDGMENT_JOURNAL_DIR)
        : join(homedir(), '.codex', 'var', 'judgment-resolver');
}

function journalPaths(sessionRef, turnId, env) {
    const directory = join(journalRoot(env), sessionRef);
    const turnRef = sha256(turnId);
    return {
        directory,
        turnRef,
        target: join(directory, `${turnRef}.json`),
        episode: join(directory, `${turnRef}.episode.json`),
        turnInput: join(directory, `${turnRef}.turn-input.json`),
        events: join(directory, `${turnRef}.events`),
        continuation: join(directory, `${turnRef}.continuation.json`),
        autonomy: join(directory, `${turnRef}.autonomy.json`),
        auditFailure: join(directory, `${turnRef}.audit-failure.json`),
        auditDegraded: join(directory, `${turnRef}.audit-degraded.json`),
        auditOrphanEvents: join(directory, `${turnRef}.audit-orphan-events`),
        final: join(directory, `${turnRef}.final.json`),
        valueProof: join(directory, `${turnRef}.value-proof.json`),
        valueProofAttention: join(directory, `${turnRef}.value-proof-attention.json`),
        transitionDatabase: join(directory, `${turnRef}.transition.sqlite`)
    };
}

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function createImmutableJson(target, value, conflictReason) {
    const directory = dirname(target);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temp = join(directory, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
    const descriptor = openSync(temp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    try { writeFileSync(descriptor, `${JSON.stringify(value)}\n`); } finally { closeSync(descriptor); }
    try {
        linkSync(temp, target);
        return value;
    } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const existing = readJson(target);
        if (canonicalJson(existing) !== canonicalJson(value)) throw new Error(conflictReason);
        return existing;
    } finally {
        try { unlinkSync(temp); } catch {}
    }
}

function lockTimeoutMs(env) {
    const positiveInteger = (value, fallback) => {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
    };
    const configured = positiveInteger(env.BRAINBASE_JUDGMENT_LOCK_TIMEOUT_MS, -1);
    if (configured >= 0) return configured;
    const attempts = Math.max(1, positiveInteger(
        env.BRAINBASE_JUDGMENT_LOCK_WAIT_ATTEMPTS,
        DEFAULT_LOCK_WAIT_ATTEMPTS
    ));
    const waitMs = positiveInteger(env.BRAINBASE_JUDGMENT_LOCK_WAIT_MS, DEFAULT_LOCK_WAIT_MS);
    return attempts * waitMs;
}

function withEpisodeTransitionLock(
    paths,
    callback,
    env,
    timeoutReason = 'judgment_episode_transition_timeout'
) {
    mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
    const timeout = lockTimeoutMs(env);
    const database = new Database(paths.transitionDatabase, { timeout });
    chmodSync(paths.transitionDatabase, 0o600);
    database.pragma(`busy_timeout = ${timeout}`);
    try {
        database.exec('BEGIN IMMEDIATE');
    } catch (error) {
        database.close();
        if (
            ['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(error?.code)
            || ['database is locked', 'database table is locked'].includes(error?.errstr)
            || /database(?: table)? is locked/u.test(String(error?.message ?? ''))
        ) {
            throw new Error(timeoutReason, { cause: error });
        }
        throw error;
    }
    let closed = false;
    const finish = (command) => {
        if (closed) return;
        try { database.exec(command); } finally {
            closed = true;
            database.close();
        }
    };
    let result;
    try {
        result = callback();
    } catch (error) {
        finish('ROLLBACK');
        throw error;
    }
    if (result && typeof result.then === 'function') {
        return result.then(
            (value) => { finish('COMMIT'); return value; },
            (error) => { finish('ROLLBACK'); throw error; }
        );
    }
    finish('COMMIT');
    return result;
}

function acceptedProjection(receipt) {
    if (!record(receipt) || !record(receipt.classification) || receipt.status !== 'resolved') return null;
    const fields = ['turn_id', 'resolution_id', 'request_digest', 'context_digest', 'plan_digest', 'classification', 'selected_dag_ids'];
    if (fields.some((field) => receipt[field] === undefined)) return null;
    return Object.fromEntries(fields.map((field) => [field, receipt[field]]));
}

function priorReceipts(sessionRef, currentTurnId, env) {
    const { directory, turnRef } = journalPaths(sessionRef, currentTurnId, env);
    let names;
    try { names = readdirSync(directory).filter((name) => name.endsWith('.json')); } catch { return []; }
    return names.filter((name) => !name.startsWith(`${turnRef}.`)).flatMap((name) => {
        try {
            const entry = readJson(join(directory, name));
            if (['brainbase-judgment-adoption-v1', 'brainbase-judgment-adoption-v2'].includes(entry.schema_version)) {
                const projection = acceptedProjection(entry.receipt);
                return projection ? [{ accepted_at: entry.accepted_at, projection }] : [];
            }
            if (!['brainbase-judgment-episode-final-v1', 'brainbase-judgment-episode-final-v2'].includes(entry.schema_version)
                || entry.completion_status !== 'complete') return [];
            const episodeName = name.replace(/\.final\.json$/u, '.episode.json');
            if (episodeName === name) return [];
            const episode = readJson(join(directory, episodeName));
            if (episode.schema_version !== 'brainbase-judgment-episode-v1') return [];
            if (entry.initial_route_receipt_digest !== episode.initial_route_receipt_digest) {
                throw new Error('judgment_episode_final_route_mismatch');
            }
            const projection = acceptedProjection(episode.initial_route_receipt);
            return projection ? [{ accepted_at: entry.finalized_at, projection }] : [];
        } catch (error) {
            if (String(error?.message ?? '').startsWith('judgment_episode_')) throw error;
            return [];
        }
    }).sort((left, right) => String(left.accepted_at).localeCompare(String(right.accepted_at)))
        .map((entry) => entry.projection);
}

export function buildJudgmentRequest(payload, { env = process.env } = {}) {
    const request = typeof payload.prompt === 'string' && payload.prompt.trim() ? payload.prompt : '';
    const turnId = typeof payload.turn_id === 'string' ? payload.turn_id.trim() : '';
    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
    if (!request || !turnId || !sessionId) throw new TypeError('UserPromptSubmit requires prompt, turn_id, and session_id');
    const sessionRef = sha256(sessionId);
    const transcript = readCanonicalTranscript(payload, env);
    // Stop-time delegation recovery runs after Codex has already emitted an
    // assistant message for this turn. The public resolver contract requires
    // the current turn to contain only the canonical user request, so rebuild
    // that turn instead of carrying post-generation output into the context.
    const messages = transcript.messages.filter((message) => message.turn_id !== turnId);
    messages.push({ sequence: messages.length, turn_id: turnId, role: 'user', phase: null, text: request });
    const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : REPO_ROOT;
    const repoRoot = findRepoRoot(cwd);
    const projectBinding = env.BRAINBASE_JUDGMENT_PROJECT_CODE
        || (repoRoot ? basename(repoRoot).replace(/\.git$/u, '') : null);
    const contextWithoutDigest = {
        schema_version: 'brainbase-conversation-context-v1',
        session_ref: sessionRef,
        messages: messages.map((message, sequence) => ({ ...message, sequence })),
        prior_receipts: priorReceipts(sessionRef, turnId, env),
        runtime: {
            host: 'codex',
            model: typeof payload.model === 'string' && payload.model ? payload.model : null,
            permission_mode: typeof payload.permission_mode === 'string' && payload.permission_mode ? payload.permission_mode : null,
            project_binding: projectBinding
        },
        instruction_bindings: instructionBindings(cwd),
        completeness: transcript.complete ? 'complete' : 'partial'
    };
    return {
        request,
        turn_id: turnId,
        ...(projectBinding ? { project_code: projectBinding } : {}),
        conversation_context: {
            ...contextWithoutDigest,
            source_digest: sha256(canonicalJson(contextWithoutDigest))
        }
    };
}

function verifyOwnerAudit(ownerAudit, receipt) {
    if (!record(ownerAudit) || ownerAudit.schema_version !== 'brainbase-owner-audit-v1') {
        throw new Error('judgment_owner_audit_missing');
    }
    if (ownerAudit.source_receipt_digest !== sha256(canonicalJson(receipt))) {
        throw new Error('judgment_owner_audit_receipt_mismatch');
    }
    if (typeof ownerAudit.display_line !== 'string' || ownerAudit.text_digest !== sha256(ownerAudit.display_line)) {
        throw new Error('judgment_owner_audit_digest_mismatch');
    }
    return ownerAudit;
}

function existingAdoptionEntry(args, env) {
    const sessionRef = args.conversation_context.session_ref;
    const { target } = journalPaths(sessionRef, args.turn_id, env);
    try {
        const entry = JSON.parse(readFileSync(target, 'utf8'));
        if (entry.request_text_digest !== sha256(args.request)) {
            throw new Error('judgment_turn_receipt_conflict');
        }
        const receipt = verifyReceipt(entry.receipt, args);
        if (entry.schema_version === 'brainbase-judgment-adoption-v2') {
            if (entry.receipt_digest !== sha256(canonicalJson(receipt))) {
                throw new Error('judgment_adoption_receipt_digest_mismatch');
            }
            return { ...entry, receipt, owner_audit: verifyOwnerAudit(entry.owner_audit, receipt) };
        }
        if (entry.schema_version === 'brainbase-judgment-adoption-v1') {
            return {
                ...entry,
                receipt,
                owner_audit: buildOwnerAudit(args, receipt, { historicalExact: false })
            };
        }
        throw new Error('judgment_adoption_schema_unsupported');
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

function verifyReceipt(receipt, args) {
    if (!record(receipt) || receipt.turn_id !== args.turn_id) throw new Error('judgment_receipt_turn_mismatch');
    if (receipt.request_digest !== sha256(canonicalJson(args))) throw new Error('judgment_receipt_request_mismatch');
    const contextDigest = sha256(canonicalJson(args.conversation_context));
    if (receipt.context_digest !== contextDigest) throw new Error('judgment_receipt_context_mismatch');
    if (!record(receipt.host_binding) || receipt.host_binding.status !== 'managed') throw new Error('judgment_receipt_binding_unmanaged');
    if (!Array.isArray(receipt.active_node_definitions)) throw new Error('judgment_receipt_active_nodes_missing');
    const runtimeMatch = String(receipt.runtime_version ?? '').match(/^judgment-runtime-(\d+)\.(\d+)\.(\d+)$/u);
    const autonomyRequired = runtimeMatch
        ? Number(runtimeMatch[1]) > 2 || (Number(runtimeMatch[1]) === 2 && Number(runtimeMatch[2]) >= 1)
        : false;
    verifyAutonomyContract(receipt, { required: autonomyRequired });
    return receipt;
}

function verifyAutonomyContract(receipt, { required = false } = {}) {
    const fieldsPresent = ['autonomy_decision', 'autonomy_reason_code', 'allowed_runtime_escalation_reasons']
        .some((field) => Object.hasOwn(receipt || {}, field));
    if (!fieldsPresent && !required) return null;
    if (!['continue', 'escalate'].includes(receipt?.autonomy_decision)
        || !AUTONOMY_REASON_CODES.has(receipt?.autonomy_reason_code)
        || !Array.isArray(receipt?.allowed_runtime_escalation_reasons)
        || new Set(receipt.allowed_runtime_escalation_reasons).size !== receipt.allowed_runtime_escalation_reasons.length) {
        throw new Error('judgment_receipt_autonomy_invalid');
    }
    const expectedReason = receipt.status === 'needs_classification'
        ? 'classification_missing'
        : receipt.status === 'needs_policy_resolution'
            ? 'policy_conflict'
            : ['high', 'critical'].includes(receipt?.classification?.risk)
                || receipt?.classification?.action_kind === 'external'
                ? 'risk_or_external'
                : 'routine_in_scope';
    const expectedDecision = expectedReason === 'routine_in_scope' ? 'continue' : 'escalate';
    const expectedRuntimeReasons = expectedDecision === 'continue'
        ? AUTONOMY_RUNTIME_ESCALATION_REASONS
        : [];
    if (receipt.autonomy_reason_code !== expectedReason
        || receipt.autonomy_decision !== expectedDecision
        || canonicalJson(receipt.allowed_runtime_escalation_reasons) !== canonicalJson(expectedRuntimeReasons)) {
        throw new Error('judgment_receipt_autonomy_mismatch');
    }
    return {
        decision: receipt.autonomy_decision,
        reasonCode: receipt.autonomy_reason_code,
        allowedRuntimeReasons: [...receipt.allowed_runtime_escalation_reasons]
    };
}

// An escalate contract asks the human once. When the previous finalized turn
// in this session already stopped for a human answer, the current user turn is
// that answer, so the same risk_or_external classification continues instead of
// re-asking forever.
function previousTurnEscalated(sessionRef, currentTurnId, env) {
    const { directory, turnRef } = journalPaths(sessionRef, currentTurnId, env);
    let names;
    try { names = readdirSync(directory).filter((name) => name.endsWith('.episode.json')); } catch { return null; }
    // The previous turn is the latest opened episode other than this one. An
    // escalated turn often never finalizes (the repaired answer omits the
    // confirmation marker), so the journal state events are consulted too.
    let latest = null;
    for (const name of names) {
        if (name.startsWith(`${turnRef}.`)) continue;
        let entry;
        try { entry = readJson(join(directory, name)); } catch { continue; }
        if (entry?.schema_version !== 'brainbase-judgment-episode-v1') continue;
        if (!latest || String(entry.started_at ?? '').localeCompare(String(latest.entry.started_at ?? '')) > 0) {
            latest = { name, entry };
        }
    }
    if (!latest) return null;
    const priorTurnRef = latest.name.replace(/\.episode\.json$/u, '');
    let final = null;
    try { final = readJson(join(directory, `${priorTurnRef}.final.json`)); } catch { /* not finalized */ }
    let stateEvents = [];
    try {
        stateEvents = readdirSync(join(directory, `${priorTurnRef}.events`))
            .filter((name) => name.endsWith('.json'))
            .map((name) => { try { return readJson(join(directory, `${priorTurnRef}.events`, name)); } catch { return null; } })
            .filter((event) => event?.event_kind === 'state' && event.success)
            .sort((left, right) => (left.event_sequence ?? 0) - (right.event_sequence ?? 0));
    } catch { /* no events */ }
    const lastState = stateEvents.at(-1)?.safe_metadata?.stop_state ?? null;
    const escalated = ['escalated', 'runtime_escalated'].includes(final?.autonomy_compliance_status)
        || final?.stop_state?.status === 'waiting_human'
        || lastState?.status === 'waiting_human';
    if (!escalated) return null;
    return {
        schema_version: 'brainbase-judgment-host-autonomy-v1',
        basis: 'prior_escalation_answered',
        prior_turn_ref: priorTurnRef,
        prior_reason_code: typeof (final?.stop_state?.runtime_reason_code ?? lastState?.runtime_reason_code) === 'string'
            ? (final?.stop_state?.runtime_reason_code ?? lastState?.runtime_reason_code)
            : null
    };
}

function verifyHostAutonomy(value) {
    if (value === undefined) return null;
    if (!record(value)
        || value.schema_version !== 'brainbase-judgment-host-autonomy-v1'
        || value.basis !== 'prior_escalation_answered'
        || typeof value.prior_turn_ref !== 'string') {
        throw new Error('judgment_episode_host_autonomy_invalid');
    }
    return value;
}

function escalationAnswered(hostAutonomy, receipt) {
    return hostAutonomy?.basis === 'prior_escalation_answered'
        && receipt?.autonomy_decision === 'escalate'
        && receipt?.autonomy_reason_code === 'risk_or_external';
}

function episodeAutonomyContract(episode, receipt = episode?.initial_route_receipt) {
    const contract = verifyAutonomyContract(receipt);
    if (!contract || !escalationAnswered(episode?.host_autonomy, receipt)) return contract;
    return {
        decision: 'continue',
        reasonCode: 'routine_in_scope',
        allowedRuntimeReasons: [...AUTONOMY_RUNTIME_ESCALATION_REASONS],
        answeredEscalation: true
    };
}

function adoptReceipt(args, receipt, env) {
    const sessionRef = args.conversation_context.session_ref;
    const { directory, target } = journalPaths(sessionRef, args.turn_id, env);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const ownerAudit = buildOwnerAudit(args, receipt);
    const entry = {
        schema_version: 'brainbase-judgment-adoption-v2',
        accepted_at: new Date().toISOString(),
        request_text_digest: sha256(args.request),
        receipt_digest: sha256(canonicalJson(receipt)),
        receipt,
        owner_audit: ownerAudit
    };
    const temp = join(directory, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
    const descriptor = openSync(temp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    try { writeFileSync(descriptor, `${JSON.stringify(entry)}\n`); } finally { closeSync(descriptor); }
    try {
        linkSync(temp, target);
        return entry;
    } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        return existingAdoptionEntry(args, env);
    } finally {
        try { unlinkSync(temp); } catch {}
    }
}

async function fetchAttempt(args, { env, fetchImpl }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(env.BRAINBASE_JUDGMENT_HOST_TIMEOUT_MS || 15000));
    try {
        let response;
        try {
            response = await fetchImpl(env.BRAINBASE_JUDGMENT_HOST_URL || DEFAULT_HOST_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(args),
                signal: controller.signal
            });
        } catch (cause) {
            const error = new Error('judgment_host_transport_failed', { cause });
            error.transient = true;
            throw error;
        }
        let payload;
        try { payload = await response.json(); } catch { throw new Error('judgment_host_transport_failed'); }
        if (response.ok && payload.management_status === 'managed') return payload.receipt;
        const error = new Error(typeof payload.reason === 'string' ? payload.reason : `judgment_host_http_${response.status}`);
        error.transient = [429, 502, 503, 504].includes(response.status) && TRANSIENT_REASONS.has(error.message);
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function resolveAndAdoptEntry(args, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
    const accepted = existingAdoptionEntry(args, env);
    if (accepted) return accepted;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const receipt = verifyReceipt(await fetchAttempt(args, { env, fetchImpl }), args);
            return adoptReceipt(args, receipt, env);
        } catch (error) {
            lastError = error;
            const transportFailure = error?.name === 'AbortError' || error?.cause?.code === 'ECONNRESET' || error?.cause?.code === 'ECONNREFUSED';
            if (attempt === 2 || (!transportFailure && error?.transient !== true)) throw error;
        }
    }
    throw lastError;
}

export async function resolveAndAdopt(args, dependencies = {}) {
    return (await resolveAndAdoptEntry(args, dependencies)).receipt;
}

function withJudgmentStage(reason, callback) {
    const wrap = (error) => {
        if (error instanceof Error && /^judgment_[a-z0-9_]{1,80}$/u.test(error.message)) throw error;
        throw new Error(reason, { cause: error });
    };
    try {
        const result = callback();
        return result && typeof result.then === 'function' ? result.catch(wrap) : result;
    } catch (error) {
        return wrap(error);
    }
}

function payloadIdentity(payload) {
    const sessionId = typeof payload?.session_id === 'string' ? payload.session_id : '';
    const turnId = typeof payload?.turn_id === 'string' ? payload.turn_id.trim() : '';
    if (!sessionId || !turnId) return null;
    return { sessionRef: sha256(sessionId), turnId };
}

function verifyEpisode(entry) {
    if (!record(entry) || entry.schema_version !== 'brainbase-judgment-episode-v1' || entry.state !== 'open') {
        throw new Error('judgment_episode_schema_invalid');
    }
    if (!record(entry.initial_route_receipt)) throw new Error('judgment_episode_route_missing');
    if (entry.initial_route_receipt_digest !== sha256(canonicalJson(entry.initial_route_receipt))) {
        throw new Error('judgment_episode_route_digest_mismatch');
    }
    const origin = entry.episode_origin;
    const application = entry.route_application;
    const legacyLifecycle = origin === undefined && application === undefined;
    const validLifecycle = (origin === 'user_prompt_submit' && application === 'pre_generation')
        || (origin === 'stop_delegation_recovery' && application === 'post_generation_recovery');
    if (!legacyLifecycle && !validLifecycle) throw new Error('judgment_episode_lifecycle_invalid');
    verifyOwnerAudit(entry.owner_audit, entry.initial_route_receipt);
    if (entry.turn_input !== undefined && sha256(canonicalJson(entry.turn_input)) !== entry.initial_route_receipt.request_digest) {
        throw new Error('judgment_episode_turn_input_mismatch');
    }
    if (entry.audit_contract !== undefined) verifyAuditContract(entry.audit_contract);
    verifyHostSurface(entry.host_surface);
    verifyHostAutonomy(entry.host_autonomy);
    return entry;
}

function existingEpisode(payload, env) {
    const identity = payloadIdentity(payload);
    if (!identity) return null;
    const { episode } = journalPaths(identity.sessionRef, identity.turnId, env);
    try {
        const entry = verifyEpisode(readJson(episode));
        if (typeof payload?.prompt === 'string' && payload.prompt.trim()
            && entry.request_text_digest !== sha256(payload.prompt)) {
            throw new Error('judgment_episode_start_conflict');
        }
        return entry;
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

async function resolveInitialRoute(args, { env, fetchImpl }) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return verifyReceipt(await fetchAttempt(args, { env, fetchImpl }), args);
        } catch (error) {
            lastError = error;
            const transportFailure = error?.name === 'AbortError'
                || error?.cause?.code === 'ECONNRESET'
                || error?.cause?.code === 'ECONNREFUSED';
            if (attempt === 2 || (!transportFailure && error?.transient !== true)) throw error;
        }
    }
    throw lastError;
}

export async function startEpisode(payload, {
    env = process.env,
    fetchImpl = globalThis.fetch,
    episodeOrigin = 'user_prompt_submit',
    routeApplication = 'pre_generation'
} = {}) {
    const identity = payloadIdentity(payload);
    if (!identity) throw new TypeError('UserPromptSubmit requires session_id and turn_id');
    const paths = journalPaths(identity.sessionRef, identity.turnId, env);
    return withJudgmentStage('judgment_episode_transition_failed', () => withEpisodeTransitionLock(paths, async () => {
        assertNoOrphanAuditBarrier(identity, paths, env);
        const afterLock = withJudgmentStage(
            'judgment_episode_existing_read_failed',
            () => existingEpisode(payload, env)
        );
        if (afterLock) return afterLock;
        const args = withJudgmentStage(
            'judgment_episode_request_build_failed',
            () => buildJudgmentRequest(payload, { env })
        );
        const initialRouteReceipt = await withJudgmentStage(
            'judgment_episode_route_resolve_failed',
            () => resolveInitialRoute(args, { env, fetchImpl })
        );
        const hostSurface = withJudgmentStage(
            'judgment_episode_surface_detect_failed',
            () => hostSurfaceForEpisode(payload, env)
        );
        const hostAutonomy = withJudgmentStage(
            'judgment_episode_autonomy_detect_failed',
            () => previousTurnEscalated(identity.sessionRef, identity.turnId, env)
        );
        const entry = withJudgmentStage('judgment_episode_audit_build_failed', () => ({
            schema_version: 'brainbase-judgment-episode-v1',
            state: 'open',
            episode_origin: episodeOrigin,
            route_application: routeApplication,
            started_at: new Date().toISOString(),
            request_text_digest: sha256(args.request),
            turn_input: args,
            initial_route_receipt_digest: sha256(canonicalJson(initialRouteReceipt)),
            initial_route_receipt: initialRouteReceipt,
            owner_audit: buildOwnerAudit(args, initialRouteReceipt, { hostSurface, hostAutonomy }),
            audit_contract: buildAuditContract(initialRouteReceipt),
            ...(hostSurface ? { host_surface: hostSurface } : {}),
            ...(hostAutonomy ? { host_autonomy: hostAutonomy } : {})
        }));
        return withJudgmentStage(
            'judgment_episode_persist_failed',
            () => verifyEpisode(createImmutableJson(paths.episode, entry, 'judgment_episode_start_conflict'))
        );
    }, env, 'judgment_episode_start_timeout'));
}

// Codex Desktop truncates long hook context, so turn_input is handed to the
// model as a Host-owned file instead of an inline JSON line.
function samePath(left, right) {
    const canonical = (path) => {
        try { return realpathSync(path); } catch { return resolve(path); }
    };
    return canonical(left) === canonical(right);
}

function persistTurnInput(payload, episode, env) {
    const identity = payloadIdentity(payload);
    if (!identity || !record(episode?.turn_input)) return null;
    const paths = journalPaths(identity.sessionRef, identity.turnId, env);
    mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
    createImmutableJson(paths.turnInput, episode.turn_input, 'judgment_turn_input_conflict');
    // The model carries only this "<sessionRef>/<turnRef>" pointer across the
    // Host↔server direct channel; it never sees the turn_input JSON or a path.
    return `${identity.sessionRef}/${paths.turnRef}`;
}

async function bootstrapDelegatedEpisodeAtStop(payload, dependencies) {
    const env = dependencies.env ?? process.env;
    if (existingEpisode(payload, env)) return null;
    const prompt = delegatedPromptForTurn(payload, env);
    if (!prompt) return null;
    const episode = await startEpisode({ ...payload, prompt }, {
        ...dependencies,
        episodeOrigin: 'stop_delegation_recovery',
        routeApplication: 'post_generation_recovery'
    });
    await dependencies.onEpisodeStarted?.(episode);
    return episode;
}

const TOOL_EXCERPT_LIMIT = 40;
const TOOL_SCOPE_LIMIT = 320;
const JUDGMENT_REASON_LABELS = Object.freeze({
    conversation_referent_missing: '会話上の継続対象を確認できない',
    knowledge_project_code_missing: '参照対象のprojectを確認できない',
    classification_inherited_from_prior_turn: '前の会話から判断分類を引き継いだ'
});
const KNOWLEDGE_SELECTION_REASON_LABELS = Object.freeze({
    team_document: 'チーム文書の正本',
    canonical_fact: '正規の事実・判断の正本',
    source_document: '原本・大容量アセットの保存先',
    personal_knowledge: '個人知識の正本',
    operational_state: '実行時状態の確認先'
});
const KNOWLEDGE_EXCLUSION_REASON_LABELS = Object.freeze({
    'Wiki is a migration compatibility surface, not a canonical destination.': '移行互換用で正本ではない',
    'Graph stores canonical entities, terms, and decisions rather than document bodies.': '文書本文の正本ではない',
    'Repository stores reviewed team documents, not raw source assets.': '生の素材アセットの正本ではない',
    'Drive stores source files and large assets, not reviewed team knowledge.': 'レビュー済みチーム文書の正本ではない',
    'Personal KG is only selected for personal cognitive knowledge.': '個人の認知知識以外の参照元にできない',
    'Personal KG is owner-only and cannot be the source of team knowledge.': 'チーム知識の参照元にできない',
    'Workspace home is for runtime state, not durable knowledge.': '永続知識の正本ではない'
});

function sanitizeToolExcerpt(value, limit = TOOL_EXCERPT_LIMIT) {
    const redacted = String(value ?? '')
        .replace(/\b(?:token|api[_-]?key|secret|password)\s*=\s*[^\s]+/giu, '[秘密情報]')
        .replace(/\b(?:sk-[a-z0-9_-]{8,}|ghp_[a-z0-9_]{8,}|github_pat_[a-z0-9_]{8,}|xox[a-z]-[a-z0-9-]{8,}|AIza[a-z0-9_-]{8,})\b/giu, '[秘密情報]')
        .replace(/[「」\u0000-\u001f\u007f]+/gu, ' ')
        .replaceAll('<', '＜')
        .replaceAll('>', '＞')
        .replace(/\s+/gu, ' ')
        .trim();
    const points = Array.from(redacted || '対象未指定');
    return points.length > limit
        ? `${points.slice(0, limit).join('')}…`
        : points.join('');
}

function toolQuery(input) {
    const args = record(input) ?? {};
    const keys = ['intent', 'query', 'topic', 'path', 'type', 'entity_id', 'id'];
    const value = keys.map((key) => args[key]).find((candidate) => typeof candidate === 'string' && candidate.trim());
    return sanitizeToolExcerpt(value);
}

function toolInputText(args, key) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return sanitizeToolExcerpt(value);
    return Number.isSafeInteger(value) ? String(value) : null;
}

function toolInputLimit(args) {
    return Number.isSafeInteger(args.limit) && args.limit > 0 ? `最大${args.limit}件` : null;
}

function toolCallScope(toolName, input) {
    const name = String(toolName).replace(/^mcp__brainbase__/u, '');
    const args = record(input) ?? {};
    const scope = (parts) => sanitizeToolExcerpt(parts.filter(Boolean).join('・'), TOOL_SCOPE_LIMIT);
    const labeled = (key, label = key) => {
        const value = toolInputText(args, key);
        return value ? `${label}=${value}` : null;
    };

    if (name === 'brainbase_projects') return 'プロジェクト一覧';
    if (name === 'brainbase_admin_read') {
        const view = toolInputText(args, 'view');
        return scope([
            view ? `管理ビュー ${view}` : '管理ビュー',
            labeled('project'), toolInputLimit(args)
        ]);
    }
    if (name === 'brainbase_run_receipt_inbox') {
        return scope([
            'Run Receipt Inbox', labeled('project_id'), labeled('source_type'),
            labeled('run_status'), labeled('evidence_state'), toolInputLimit(args)
        ]);
    }
    if (name === 'brainbase_run_receipt_history') {
        return scope([
            'Run Receipt履歴', labeled('project_id'), labeled('source_type'),
            labeled('source_identity'), toolInputLimit(args)
        ]);
    }
    if (/(?:create|update|transition)_task$/u.test(name)) {
        return scope([
            labeled('title'), labeled('task_id'), labeled('to_status'),
            labeled('expected_version'), labeled('project_code')
        ]);
    }

    const query = toolQuery(input);
    return query === '対象未指定' ? '入力なし' : query;
}

function nestedRecords(value, depth = 0, { parseContent = true } = {}) {
    if (depth > 5) return [];
    if (Array.isArray(value)) {
        return value.flatMap((entry) => nestedRecords(entry, depth + 1, { parseContent }));
    }
    if (typeof value === 'string' && value.trim().startsWith('{')) {
        try { return nestedRecords(JSON.parse(value), depth + 1, { parseContent }); } catch { return []; }
    }
    const item = record(value);
    if (!item) return [];
    const direct = [item];
    for (const key of ['Ok', 'Err', 'data', 'structuredContent', 'result', 'receipt']) {
        if (record(item[key])) direct.push(...nestedRecords(item[key], depth + 1, { parseContent }));
    }
    if (parseContent && Array.isArray(item.content)) {
        for (const block of item.content) {
            const text = record(block)?.text;
            if (typeof text !== 'string' || !text.trim().startsWith('{')) continue;
            try { direct.push(...nestedRecords(JSON.parse(text), depth + 1, { parseContent })); } catch {}
        }
    }
    if (parseContent && typeof item.text === 'string' && item.text.trim().startsWith('{')) {
        try { direct.push(...nestedRecords(JSON.parse(item.text), depth + 1, { parseContent })); } catch {}
    }
    return direct;
}

function validCallToolResultEnvelope(value) {
    const item = record(value);
    const content = Array.isArray(value) ? value : item?.content;
    if (!Array.isArray(content) || content.length === 0) return false;
    return content.every((block) => {
        const entry = record(block);
        if (!entry || typeof entry.type !== 'string') return false;
        if (entry.type === 'text') return typeof entry.text === 'string';
        if (entry.type === 'image' || entry.type === 'audio') return typeof entry.data === 'string' && typeof entry.mimeType === 'string';
        if (entry.type === 'resource') {
            const resource = record(entry.resource);
            return Boolean(resource && typeof resource.uri === 'string' && resource.uri.trim() && (typeof resource.text === 'string' || typeof resource.blob === 'string'));
        }
        if (entry.type === 'resource_link') return typeof entry.name === 'string' && entry.name.trim() && typeof entry.uri === 'string' && entry.uri.trim();
        return false;
    });
}

function responseSucceeded(response, {
    allowTransportSuccess = false,
    allowExplicitSuccess = true,
    allowImplicitSuccess = false,
    semanticSuccess = false
} = {}) {
    const items = nestedRecords(response);
    if (items.length === 0) {
        return allowImplicitSuccess && response !== null && response !== undefined;
    }
    const failed = items.some((item) => (
        Object.hasOwn(item, 'Err') || item.isError === true
        || item.is_error === true
        || item.ok === false
        || item.success === false
        || (Number.isSafeInteger(item.exit_code) && item.exit_code !== 0)
        || ['error', 'unavailable', 'failed', 'failure'].includes(String(item.status).toLowerCase())
        || (item.error !== undefined && item.error !== null && item.error !== false && item.status !== 'ok')
    ));
    if (failed) return false;
    const trustedEnvelopeItems = nestedRecords(response, 0, { parseContent: false });
    return semanticSuccess || trustedEnvelopeItems.some((item) => (
        (allowTransportSuccess && validCallToolResultEnvelope(item.Ok))
        || (allowTransportSuccess && validCallToolResultEnvelope(item))
        || (allowExplicitSuccess && (item.isError === false || item.is_error === false || item.ok === true || item.success === true || ['ok', 'success', 'completed'].includes(String(item.status).toLowerCase())))
        || (allowImplicitSuccess && response !== null && response !== undefined)
    )) || (allowTransportSuccess && validCallToolResultEnvelope(response));
}

function responseCount(response) {
    return nestedRecords(response)
        .map((item) => item.count)
        .find((count) => Number.isSafeInteger(count) && count >= 0) ?? null;
}

function retrievalAudit(response) {
    const candidates = [response, ...nestedRecords(response, 0, { parseContent: false })];
    for (const item of candidates) {
        const content = Array.isArray(item) ? item : record(item)?.content;
        const text = Array.isArray(content)
            ? record(content.at(-1))?.text
            : typeof item === 'string' ? item : null;
        if (typeof text !== 'string') continue;
        const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
        if (lines.length !== 3
            || lines[0] !== 'Brainbase retrieval audit: reproduce the next line exactly once in the next user-facing assistant message.'
            || lines[1] !== 'Do not merge it with the turn-level Judgment audit and do not repeat it without another tool call.') {
            continue;
        }
        const terminalLine = lines[2];
        const noResult = terminalLine.match(/^📚 Brainbase(検索|取得): [^\r\n]* → 該当なし（不在確定ではない）$/u);
        if (noResult) return { kind: noResult[1] === '検索' ? 'search' : 'retrieve', outcome: 'no_result' };
        const result = terminalLine.match(/^📚 Brainbase(検索|取得): [^\r\n]* → 結果を取得 ✓$/u);
        if (result) return { kind: result[1] === '検索' ? 'search' : 'retrieve', outcome: 'result' };
    }
    return null;
}

function knowledgeResolutionData(response) {
    return nestedRecords(response).find((item) => (
        typeof item.resolution_id === 'string'
        && ['resolved', 'unconfirmed'].includes(String(item.status))
    )) ?? null;
}

function taskResultData(response) {
    return nestedRecords(response).find((item) => item.status === 'ok' && record(item.task) && typeof item.task.id === 'string' && item.task.id.trim()) ?? null;
}

function validJudgmentStopState(value) {
    const state = record(value);
    const expectedKeys = ['pending_safe_work', 'runtime_reason_code', 'schema_version', 'status'];
    if (!state
        || Object.keys(state).sort().join(',') !== expectedKeys.sort().join(',')
        || state.schema_version !== 'brainbase-stop-state-v1'
        || !['completed', 'pending', 'waiting_human'].includes(state.status)
        || typeof state.pending_safe_work !== 'boolean'
        || !(state.runtime_reason_code === null || typeof state.runtime_reason_code === 'string')) return null;
    return state;
}

function judgmentStopStateData(response) {
    for (const item of nestedRecords(response)) {
        const state = validJudgmentStopState(item);
        if (state) return state;
    }
    return null;
}

function judgmentStopStateContract(state, receipt, episode = null) {
    const contract = episode ? episodeAutonomyContract(episode, receipt) : verifyAutonomyContract(receipt);
    if (!state || !contract) return { valid: Boolean(state), expectedReason: null };
    if (contract.decision === 'escalate' && state.status === 'completed') {
        return { valid: false, expectedReason: contract.reasonCode };
    }
    if (state.status === 'completed') {
        return { valid: state.pending_safe_work === false && state.runtime_reason_code === null, expectedReason: null };
    }
    if (state.status === 'pending') {
        return { valid: state.pending_safe_work === true && state.runtime_reason_code === null, expectedReason: null };
    }
    const expectedReason = contract.decision === 'escalate' ? contract.reasonCode : null;
    const reasonAllowed = expectedReason !== null
        ? state.runtime_reason_code === expectedReason
        : contract.allowedRuntimeReasons.includes(state.runtime_reason_code);
    return { valid: state.pending_safe_work === false && reasonAllowed, expectedReason };
}

function waitingHumanReasonAllowed(contract, reasonCode) {
    return contract.decision === 'escalate'
        ? reasonCode === contract.reasonCode
        : contract.allowedRuntimeReasons.includes(reasonCode);
}

function eventKind(toolName) {
    const exactToolName = String(toolName);
    if (exactToolName === 'mcp__brainbase__brainbase_resolve_turn') return 'turn_resolution';
    if (exactToolName === JUDGMENT_VALUE_PROOF_TOOL_NAME) return 'value_proof';
    if (exactToolName === CAPABILITY_ACTION_CONTRACTS['knowledge.resolve'].exactTool) return 'route';
    const name = exactToolName.replace(/^mcp__brainbase__/u, '');
    if (/(?:create|update|transition|delete|write|record|link|unlink)/iu.test(name)) return 'write';
    if (/search/iu.test(name)) return 'search';
    if (/(?:get|list|resolve|context|read)/iu.test(name)) return 'retrieve';
    return 'call';
}

function judgmentTurnResolutionData(response) {
    return nestedRecords(response).find((item) => (
        typeof item.resolution_id === 'string'
        && item.status === 'resolved'
        && record(item.classification)
        && Array.isArray(item.required_capabilities)
    )) ?? null;
}

function knowledgeCanonicalLocation(value) {
    const location = record(value);
    if (!location) return '所在未指定';
    const repository = typeof location.repository === 'string' && location.repository.trim()
        ? sanitizeToolExcerpt(location.repository, TOOL_SCOPE_LIMIT)
        : '';
    const path = typeof location.path === 'string' && location.path.trim()
        ? sanitizeToolExcerpt(location.path, TOOL_SCOPE_LIMIT)
        : '';
    if (repository || path) {
        if (!repository) return path;
        if (!path) return repository;
        return `${repository.replace(/\/+$/u, '')}/${path.replace(/^\/+/u, '')}`;
    }
    const fallbackKeys = ['scope', 'drive_scope', 'owner_scope', 'workspace_scope'];
    for (const key of fallbackKeys) {
        const entry = location[key];
        if (typeof entry === 'string' && entry.trim()) {
            return `${key}=${sanitizeToolExcerpt(entry, TOOL_SCOPE_LIMIT)}`;
        }
    }
    return '所在未指定';
}

function knowledgeExclusionDisplay(data) {
    if (!Array.isArray(data?.excluded_sources)) return '';
    return data.excluded_sources.flatMap((entry) => {
        const exclusion = record(entry);
        if (!exclusion || typeof exclusion.source_class !== 'string' || !exclusion.source_class.trim()) return [];
        const source = sanitizeToolExcerpt(exclusion.source_class);
        const rawReason = typeof exclusion.reason === 'string' && exclusion.reason.trim()
            ? exclusion.reason
            : '理由未指定';
        const reason = Object.hasOwn(KNOWLEDGE_EXCLUSION_REASON_LABELS, rawReason)
            ? KNOWLEDGE_EXCLUSION_REASON_LABELS[rawReason]
            : sanitizeToolExcerpt(rawReason, TOOL_SCOPE_LIMIT);
        return [`${source}（${reason}）`];
    }).join('、');
}

function routeDisplayLine(input, data, success) {
    const query = toolQuery(input);
    if (!data) return `⚠️ Brainbase参照先: 「${query}」→ 選択に失敗`;
    const exclusions = knowledgeExclusionDisplay(data);
    if (data.status === 'unconfirmed') {
        return `⚠️ Brainbase参照先: 「${query}」→ 参照先を確定できず${exclusions ? `／除外: ${exclusions}` : ''}`;
    }
    if (!success) return `⚠️ Brainbase参照先: 「${query}」→ 選択に失敗`;
    const source = sanitizeToolExcerpt(data.source_class ?? '参照先');
    const location = knowledgeCanonicalLocation(data.canonical_location);
    const contentType = record(input)?.content_type;
    const reason = Object.hasOwn(KNOWLEDGE_SELECTION_REASON_LABELS, contentType)
        ? KNOWLEDGE_SELECTION_REASON_LABELS[contentType]
        : '参照先の選定結果';
    return `📚 Brainbase参照先: 「${query}」→ 採用: ${source}（${location}・${reason}）${exclusions ? `／除外: ${exclusions}` : ''} ✓`;
}

export function recordBrainbaseToolUse(payload, { env = process.env } = {}) {
    const identity = payloadIdentity(payload);
    const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name : '';
    const toolUseId = typeof payload?.tool_use_id === 'string' ? payload.tool_use_id : '';
    const brainbaseTool = /^mcp__brainbase__/u.test(toolName);
    const judgmentStateTool = toolName === JUDGMENT_STATE_TOOL_NAME;
    const judgmentValueProofTool = toolName === JUDGMENT_VALUE_PROOF_TOOL_NAME;
    if (!toolName) return null;
    if (!identity) {
        if (brainbaseTool) throw new Error('judgment_episode_identity_missing');
        return null;
    }
    if (!toolUseId) {
        if (brainbaseTool) throw new Error('judgment_tool_use_id_missing');
        return null;
    }
    const paths = journalPaths(identity.sessionRef, identity.turnId, env);
    const inputValue = payload.tool_input === undefined ? null : payload.tool_input;
    const responseValue = payload.tool_response === undefined ? null : payload.tool_response;
    const inputDigest = sha256(canonicalJson(inputValue));
    const responseDigest = sha256(canonicalJson(responseValue));
    const fingerprint = sha256(canonicalJson({ tool_name: toolName, tool_use_id: toolUseId, input_digest: inputDigest, response_digest: responseDigest }));
    const callScope = brainbaseTool ? toolCallScope(toolName, inputValue) : 'tool execution';
    const resultCount = responseCount(responseValue);
    const fallbackKind = judgmentStateTool ? 'state' : judgmentValueProofTool ? 'value_proof' : brainbaseTool ? eventKind(toolName) : 'execution';
    const retrieval = ['search', 'retrieve'].includes(fallbackKind)
        ? retrievalAudit(responseValue)
        : null;
    const kind = retrieval?.kind ?? fallbackKind;
    const resolution = kind === 'route' ? knowledgeResolutionData(responseValue) : null;
    const turnResolution = kind === 'turn_resolution' ? judgmentTurnResolutionData(responseValue) : null;
    const taskResult = kind === 'write' ? taskResultData(responseValue) : null;
    const stopState = kind === 'state' ? judgmentStopStateData(responseValue) : null;
    const valueProofInput = kind === 'value_proof' ? extractJudgmentValueProofInput(responseValue) : null;
    const requestedStopState = kind === 'state' ? {
        schema_version: 'brainbase-stop-state-v1',
        status: record(inputValue)?.status,
        pending_safe_work: record(inputValue)?.pending_safe_work,
        runtime_reason_code: record(inputValue)?.runtime_reason_code
    } : null;
    const responseSuccess = responseSucceeded(responseValue, {
        allowTransportSuccess: ['search', 'retrieve'].includes(kind),
        allowExplicitSuccess: !['write', 'route'].includes(kind) || !brainbaseTool,
        allowImplicitSuccess: !brainbaseTool,
        semanticSuccess: kind === 'turn_resolution'
            ? Boolean(turnResolution)
            : ['search', 'retrieve'].includes(kind)
                ? Boolean(retrieval)
            : kind === 'value_proof'
            ? Boolean(valueProofInput)
            : kind === 'route'
                ? resolution?.status === 'resolved'
                : kind === 'state'
                    ? Boolean(stopState && canonicalJson(stopState) === canonicalJson(requestedStopState))
                    : Boolean(taskResult)
    });
    const satisfiesKnowledgeExecution = kind === 'route';
    const retrievalResult = responseSuccess && ['search', 'retrieve'].includes(kind)
        ? retrieval?.outcome ?? null
        : null;
    const patchText = toolName === 'apply_patch'
        ? typeof inputValue === 'string'
            ? inputValue
            : typeof record(inputValue)?.patch === 'string'
                ? inputValue.patch
                : ''
        : '';
    const executionArtifactRefs = patchText
        ? [...new Set([...patchText.matchAll(/^\*\*\* (?:Add|Update) File: (.+)$/gmu)]
            .map((match) => match[1].trim())
            .filter((value) => value && !value.includes('\0')))]
        : [];
    const safeMetadata = turnResolution ? { turn_contract: turnResolution } : valueProofInput ? { value_proof: valueProofInput } : stopState ? { stop_state: stopState } : resolution ? {
        resolution_id: resolution.resolution_id,
        status: resolution.status,
        source_class: resolution.source_class ?? null,
        canonical_ref: record(resolution.canonical_location) ? {
            repository: typeof resolution.canonical_location.repository === 'string' ? resolution.canonical_location.repository : null,
            path: typeof resolution.canonical_location.path === 'string' ? resolution.canonical_location.path : null
        } : null,
        retrieval_capability: typeof resolution.retrieval_capability === 'string' ? resolution.retrieval_capability : null
    } : ['search', 'retrieve'].includes(kind) ? {
        subject_ref: callScope,
        retrieval_outcome: retrievalResult
    } : kind === 'execution' && executionArtifactRefs.length > 0 ? {
        artifact_refs: executionArtifactRefs
    } : {};
    const operationLabel = kind === 'write'
        ? '書込'
        : kind === 'search'
            ? '検索'
            : kind === 'retrieve'
                ? '取得'
                : '呼出';
    const displayLine = !brainbaseTool || judgmentStateTool || judgmentValueProofTool || kind === 'turn_resolution'
        ? null
        : kind === 'route'
        ? routeDisplayLine(inputValue, resolution, responseSuccess)
        : `${responseSuccess ? '📚' : '⚠️'} Brainbase${operationLabel}: ${sanitizeToolExcerpt(toolName.replace(/^mcp__brainbase__/u, ''))}「${callScope}」→ ${responseSuccess
            ? retrievalResult === 'no_result'
                ? '該当なし（不在確定ではない）'
                : retrievalResult === 'result'
                    ? '結果を取得 ✓'
                    : `${resultCount === null ? '' : `${resultCount}件・`}正常応答を確認 ✓`
            : '失敗または結果不明'}`;
    return withEpisodeTransitionLock(paths, () => {
        const episode = existingEpisode(payload, env);
        if (!episode) {
            if (!brainbaseTool) return null;
            mkdirSync(paths.auditOrphanEvents, { recursive: true, mode: 0o700 });
            const target = join(paths.auditOrphanEvents, `${sha256(toolUseId)}.json`);
            const marker = {
                schema_version: 'brainbase-judgment-orphan-tool-event-v1',
                recorded_at: new Date().toISOString(),
                reason: 'judgment_episode_not_found',
                session_ref: identity.sessionRef,
                turn_ref: paths.turnRef,
                tool_name_digest: sha256(toolName),
                tool_use_ref: sha256(toolUseId),
                input_digest: inputDigest,
                response_digest: responseDigest,
                event_fingerprint: fingerprint
            };
            try {
                const existing = readJson(target);
                const replayProjection = { ...existing };
                delete replayProjection.recorded_at;
                const markerProjection = { ...marker };
                delete markerProjection.recorded_at;
                if (canonicalJson(replayProjection) === canonicalJson(markerProjection)
                    && validIsoTimestamp(existing.recorded_at)) return existing;
                throw new Error('judgment_orphan_tool_event_conflict');
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }
            return createImmutableJson(target, marker, 'judgment_orphan_tool_event_conflict');
        }
        if (judgmentValueProofTool && !valueProofRolloutEnabled(episode, env)) {
            throw new Error('judgment_value_proof_rollout_disabled');
        }
        if (kind === 'turn_resolution') {
            const turnToolInput = record(inputValue);
            const suppliedTurnInput = record(turnToolInput?.turn_input);
            const expectedTurnRef = `${identity.sessionRef}/${paths.turnRef}`;
            // A turn_ref pointer (top-level, or legacy nested in turn_input) or a
            // legacy file reference is bound to this turn's Host-saved turn_input.
            const suppliedTurnRef = typeof turnToolInput?.turn_ref === 'string'
                ? turnToolInput.turn_ref
                : (suppliedTurnInput
                    && Object.keys(suppliedTurnInput).join(',') === 'turn_ref'
                    && typeof suppliedTurnInput.turn_ref === 'string')
                    ? suppliedTurnInput.turn_ref
                    : null;
            const turnInput = suppliedTurnRef === expectedTurnRef
                ? episode.turn_input
                : (suppliedTurnInput
                    && Object.keys(suppliedTurnInput).join(',') === 'turn_input_path'
                    && typeof suppliedTurnInput.turn_input_path === 'string'
                    && samePath(suppliedTurnInput.turn_input_path, paths.turnInput))
                    ? episode.turn_input
                    : suppliedTurnInput;
            const interpretation = record(turnToolInput?.model_interpretation);
            if (!turnInput || !interpretation
                || canonicalJson(turnInput) !== canonicalJson(episode.turn_input)
                || turnResolution?.turn_id !== episode.initial_route_receipt.turn_id
                || turnResolution?.context_digest !== episode.initial_route_receipt.context_digest
                || turnResolution?.request_digest !== sha256(canonicalJson({ ...turnInput, model_interpretation: interpretation }))) {
                throw new Error('judgment_turn_resolution_binding_invalid');
            }
        }
        const turnResolutionMessage = kind === 'turn_resolution' && responseSuccess && turnResolution
            ? `🧠 判断契約を確定しました。最終回答の先頭行は次のHost生成行に置き換えてください:\n${buildOwnerAudit(episode.turn_input, turnResolution, { hostAutonomy: episode.host_autonomy ?? null }).display_line}`
            : null;
        mkdirSync(paths.events, { recursive: true, mode: 0o700 });
        const target = join(paths.events, `${sha256(toolUseId)}.json`);
        const finalized = existingFinal(paths, episode);
        if (finalized) {
            try {
                const existing = readJson(target);
                if (existing.event_fingerprint === fingerprint) return existing;
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }
            throw new Error('judgment_episode_already_finalized');
        }
        try {
            const existing = readJson(target);
            if (existing.event_fingerprint === fingerprint) return existing;
            throw new Error('judgment_tool_event_conflict');
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        const eventSequence = readdirSync(paths.events)
            .filter((name) => name.endsWith('.json'))
            .map((name) => {
                try { return readJson(join(paths.events, name)).event_sequence; } catch { return null; }
            })
            .filter(Number.isSafeInteger)
            .reduce((maximum, sequence) => Math.max(maximum, sequence), -1) + 1;
        const stateContract = judgmentStateTool
            ? judgmentStopStateContract(stopState, effectiveEpisode(episode, episodeEvents(paths)).initial_route_receipt, episode)
            : { valid: true, expectedReason: null };
        const success = responseSuccess && stateContract.valid;
        const systemMessage = judgmentStateTool && responseSuccess && !stateContract.valid
            ? stateContract.expectedReason
                ? `Brainbase状態を修正してください。status=waiting_humanではruntime_reason_code=${stateContract.expectedReason}をHost確定理由と一字一句一致させ、状態toolを最後にもう一度実行してください。`
                : 'Brainbase状態を修正してください。completedはpending_safe_work=false・runtime_reason_code=null、pendingはpending_safe_work=true・runtime_reason_code=null、waiting_humanは許可された理由コードを使ってください。'
            : null;
        const entry = {
            schema_version: 'brainbase-judgment-tool-event-v1',
            recorded_at: new Date().toISOString(),
            event_sequence: eventSequence,
            tool_name: toolName,
            tool_use_id: toolUseId,
            event_kind: kind,
            success,
            satisfies: kind === 'turn_resolution'
                ? ['judgment.resolve_turn']
                : satisfiesKnowledgeExecution ? ['knowledge.resolve'] : [],
            input_digest: inputDigest,
            response_digest: responseDigest,
            event_fingerprint: fingerprint,
            query_excerpt: callScope,
            safe_metadata: safeMetadata,
            display_line: displayLine,
            system_message: systemMessage ?? turnResolutionMessage
        };
        return createImmutableJson(target, entry, 'judgment_tool_event_conflict');
    }, env);
}

function episodeEvents(paths) {
    let names;
    try { names = readdirSync(paths.events).filter((name) => name.endsWith('.json')).sort(compareCodePoints); } catch { return []; }
    return names.map((name) => readJson(join(paths.events, name))).map((entry) => {
        if (entry.schema_version !== 'brainbase-judgment-tool-event-v1') throw new Error('judgment_tool_event_schema_invalid');
        return entry;
    }).sort((left, right) => {
        const leftSequence = Number.isSafeInteger(left.event_sequence) ? left.event_sequence : null;
        const rightSequence = Number.isSafeInteger(right.event_sequence) ? right.event_sequence : null;
        if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) {
            return leftSequence - rightSequence;
        }
        const recordedOrder = String(left.recorded_at).localeCompare(String(right.recorded_at));
        return recordedOrder || compareCodePoints(String(left.tool_use_id), String(right.tool_use_id));
    });
}

function effectiveEpisode(episode, events) {
    const resolved = [...events].reverse().find((event) => (
        event.success
        && event.satisfies.includes('judgment.resolve_turn')
        && record(event.safe_metadata?.turn_contract)
    ))?.safe_metadata.turn_contract;
    if (!resolved) return episode;
    const args = episode.turn_input;
    return {
        ...episode,
        initial_route_receipt: resolved,
        owner_audit: buildOwnerAudit(args, resolved, { hostAutonomy: episode.host_autonomy ?? null }),
        audit_contract: buildAuditContract(resolved)
    };
}

function turnResolutionRequired(episode) {
    const receipt = record(episode?.initial_route_receipt);
    return receipt?.status === 'needs_classification'
        && Array.isArray(receipt.reconciliation_reasons)
        && receipt.reconciliation_reasons.includes('model_interpretation_missing');
}

function buildAuditContract(receipt) {
    const zeroCallDisplayLine = requiredKnowledgeResolution(receipt)
        ? null
        : NO_BRAINBASE_REFERENCE_LINE;
    return {
        schema_version: 'brainbase-owner-audit-contract-v1',
        zero_call_display_line: zeroCallDisplayLine,
        zero_call_display_line_digest: zeroCallDisplayLine === null ? null : sha256(zeroCallDisplayLine),
        autonomy_continuation_progress_line: AUTONOMY_CONTINUATION_PROGRESS_LINE,
        autonomy_continuation_progress_line_digest: sha256(AUTONOMY_CONTINUATION_PROGRESS_LINE),
        autonomy_continuation_complete_line: AUTONOMY_CONTINUATION_COMPLETE_LINE,
        autonomy_continuation_complete_line_digest: sha256(AUTONOMY_CONTINUATION_COMPLETE_LINE),
        outcome_continuation_progress_line: OUTCOME_CONTINUATION_PROGRESS_LINE,
        outcome_continuation_progress_line_digest: sha256(OUTCOME_CONTINUATION_PROGRESS_LINE),
        outcome_continuation_complete_line: OUTCOME_CONTINUATION_COMPLETE_LINE,
        outcome_continuation_complete_line_digest: sha256(OUTCOME_CONTINUATION_COMPLETE_LINE),
        stop_repair_complete_line: STOP_REPAIR_COMPLETE_LINE,
        stop_repair_complete_line_digest: sha256(STOP_REPAIR_COMPLETE_LINE),
        repair_body_policy: 'preserve'
    };
}

function verifyAuditContract(value) {
    const contract = record(value);
    if (!contract || contract.schema_version !== 'brainbase-owner-audit-contract-v1') {
        throw new Error('judgment_owner_audit_contract_invalid');
    }
    const line = contract.zero_call_display_line;
    const digest = contract.zero_call_display_line_digest;
    if (!((line === null && digest === null)
        || (typeof line === 'string' && digest === sha256(line)))) {
        throw new Error('judgment_owner_audit_contract_digest_mismatch');
    }
    const continuationLinePairs = [
        ['autonomy_continuation_progress_line', 'autonomy_continuation_progress_line_digest'],
        ['autonomy_continuation_complete_line', 'autonomy_continuation_complete_line_digest'],
        ['outcome_continuation_progress_line', 'outcome_continuation_progress_line_digest'],
        ['outcome_continuation_complete_line', 'outcome_continuation_complete_line_digest'],
        ['stop_repair_complete_line', 'stop_repair_complete_line_digest']
    ];
    for (const [lineField, digestField] of continuationLinePairs) {
        const continuationLine = contract[lineField];
        const continuationDigest = contract[digestField];
        if (!((continuationLine === undefined && continuationDigest === undefined)
            || (typeof continuationLine === 'string' && continuationDigest === sha256(continuationLine)))) {
            throw new Error('judgment_owner_audit_contract_digest_mismatch');
        }
    }
    if (contract.repair_body_policy !== 'preserve') {
        throw new Error('judgment_owner_audit_repair_policy_invalid');
    }
    return contract;
}

function episodeAuditContract(episode) {
    return episode.audit_contract === undefined ? null : verifyAuditContract(episode.audit_contract);
}

function verifiedAutonomyContinuation(marker, auditContract) {
    const continuation = record(marker?.autonomy_continuation);
    if (!continuation) return null;
    const expectedCompleteLine = continuation.trigger_code === 'unfinished_safe_work'
        ? auditContract?.outcome_continuation_complete_line
        : auditContract?.autonomy_continuation_complete_line;
    if (continuation.count !== 1
        || !['unnecessary_user_question', 'unfinished_safe_work'].includes(continuation.trigger_code)
        || !AUTONOMY_REASON_CODES.has(continuation.reason_code)
        || continuation.status !== 'requested'
        || typeof expectedCompleteLine !== 'string') {
        throw new Error('judgment_autonomy_continuation_invalid');
    }
    return continuation;
}

function verifiedStopRepair(marker, auditContract) {
    const repair = record(marker?.stop_repair);
    if (!repair) return null;
    if (repair.count !== 1
        || repair.status !== 'requested'
        || typeof auditContract?.stop_repair_complete_line !== 'string') {
        throw new Error('judgment_stop_repair_invalid');
    }
    return repair;
}

function verifyFinalStopRepair(finalized, continuationMarker, auditContract) {
    if (finalized.schema_version !== 'brainbase-judgment-episode-final-v2') return;
    const requested = verifiedStopRepair(continuationMarker, auditContract);
    const completed = record(finalized.stop_repair);
    if (!requested && !completed) return;
    if (!requested
        || !completed
        || completed.count !== requested.count
        || completed.status !== 'completed') {
        throw new Error('judgment_episode_final_stop_repair_mismatch');
    }
}

function requiredAuditLines(episode, events, continuationMarker = null) {
    const auditContract = episodeAuditContract(episode);
    const brainbaseEvents = events.filter((event) => typeof event.display_line === 'string');
    const zeroCallLines = brainbaseEvents.length === 0 && typeof auditContract?.zero_call_display_line === 'string'
        ? [auditContract.zero_call_display_line]
        : [];
    const autonomyContinuation = verifiedAutonomyContinuation(continuationMarker, auditContract);
    const continuationLines = autonomyContinuation
        ? [autonomyContinuation.trigger_code === 'unfinished_safe_work'
            ? auditContract.outcome_continuation_complete_line
            : auditContract.autonomy_continuation_complete_line]
        : [];
    const stopRepair = verifiedStopRepair(continuationMarker, auditContract);
    const stopRepairLines = stopRepair
        ? [auditContract.stop_repair_complete_line]
        : [];
    return [
        episode.owner_audit.display_line,
        ...zeroCallLines,
        ...brainbaseEvents.map((event) => event.display_line),
        ...continuationLines,
        ...stopRepairLines
    ];
}

function orderedEventSetDigest(events) {
    const orderedBindings = events.map((entry, index) => {
        if (entry.event_sequence !== index || !/^[0-9a-f]{64}$/u.test(entry.event_fingerprint)) {
            throw new Error('judgment_tool_event_order_invalid');
        }
        return {
            event_sequence: entry.event_sequence,
            event_fingerprint: entry.event_fingerprint
        };
    });
    return sha256(canonicalJson(orderedBindings));
}

function answerContainsExactAuditPrefix(answer, expectedLines) {
    if (typeof answer !== 'string') return false;
    const lines = answer.replaceAll('\r\n', '\n').split('\n').map((line) => line.replace(/[ \t]+$/u, ''));
    const normalizedExpectedLines = expectedLines.map((line) => line.replace(/[ \t]+$/u, ''));
    if (!normalizedExpectedLines.every((expected, index) => lines[index] === expected)) return false;
    const expectedCounts = new Map(normalizedExpectedLines.map((line) => [
        line,
        normalizedExpectedLines.filter((candidate) => candidate === line).length
    ]));
    return [...expectedCounts].every(([expected, count]) => (
        lines.filter((line) => line === expected).length === count
    ));
}

function containsUnauthorizedContinuationAudit(answer, expectedLines) {
    if (typeof answer !== 'string') return false;
    const allowed = new Set(expectedLines);
    return answer.replaceAll('\r\n', '\n').split('\n')
        .map((line) => line.replace(/[ \t]+$/u, ''))
        .some((line) => /^🔁 /u.test(line) && !allowed.has(line));
}

function containsUnauthorizedStopRepairAudit(answer, expectedLines) {
    if (typeof answer !== 'string') return false;
    const allowed = new Set(expectedLines);
    return answer.replaceAll('\r\n', '\n').split('\n')
        .map((line) => line.replace(/[ \t]+$/u, ''))
        .some((line) => /^🛠️ /u.test(line) && !allowed.has(line));
}

function normalizedAnswerBody(answer, expectedLines) {
    if (typeof answer !== 'string') return null;
    const auditLines = new Set(expectedLines.map((line) => line.replace(/[ \t]+$/u, '')));
    const bodyLines = answer.replaceAll('\r\n', '\n').split('\n')
        .map((line) => line.replace(/[ \t]+$/u, ''))
        .filter((line) => !auditLines.has(line))
        .filter((line) => !STRUCTURED_STOP_STATE_PATTERN.test(line));
    while (bodyLines.length > 0 && (
        bodyLines[0] === ''
        || /^(?:🧠 判断参照:|📚 Brainbase|⚠️ Brainbase|🔁 |🛠️ )/u.test(bodyLines[0])
    )) bodyLines.shift();
    while (bodyLines.at(-1) === '') bodyLines.pop();
    return bodyLines.join('\n');
}

function waitingHumanQuestion(answer, expectedLines, stopState) {
    const marker = String(answer).replaceAll('\r\n', '\n').split('\n')
        .map((line) => line.trim())
        .map((line) => line.match(AUTONOMY_QUESTION_PATTERN))
        .find(Boolean);
    if (marker && marker[1] === stopState?.runtime_reason_code) return marker[2].trim();
    const body = normalizedAnswerBody(answer, expectedLines);
    return extractHumanDecisionQuestion(body);
}

function displayedQuestion(answerBody) {
    const extracted = extractHumanDecisionQuestion(answerBody);
    if (extracted) return extracted;
    return String(answerBody).split('\n')
        .map((line) => line.trim())
        .find((line) => /[?？]$/u.test(line)) ?? null;
}

function runtimeAtLeast(receipt, major, minor) {
    const match = String(receipt?.runtime_version ?? '').match(/^judgment-runtime-(\d+)\.(\d+)\.(\d+)$/u);
    if (!match) return false;
    const actualMajor = Number(match[1]);
    const actualMinor = Number(match[2]);
    return actualMajor > major || (actualMajor === major && actualMinor >= minor);
}

function structuredStopStateRequired(receipt) {
    const classification = record(receipt?.classification);
    return runtimeAtLeast(receipt, 2, 3)
        && !runtimeAtLeast(receipt, 2, 4)
        && ['implement', 'operate'].includes(classification?.intent)
        && ['write', 'external'].includes(classification?.action_kind);
}

function journalStopStateRequired(receipt) {
    const classification = record(receipt?.classification);
    return runtimeAtLeast(receipt, 2, 4)
        && ['implement', 'operate'].includes(classification?.intent)
        && ['write', 'external'].includes(classification?.action_kind);
}

function parseStructuredStopState(answer) {
    if (typeof answer !== 'string') return { state: null, error: 'missing' };
    const matches = answer.replaceAll('\r\n', '\n').split('\n')
        .map((line) => line.trim())
        .filter((line) => STRUCTURED_STOP_STATE_PATTERN.test(line));
    if (matches.length !== 1) return { state: null, error: matches.length === 0 ? 'missing' : 'duplicate' };
    let state;
    try {
        state = JSON.parse(matches[0].match(STRUCTURED_STOP_STATE_PATTERN)[1]);
    } catch {
        return { state: null, error: 'invalid_json' };
    }
    const validated = validJudgmentStopState(state);
    if (!validated) {
        return { state: null, error: 'invalid_schema' };
    }
    return { state: validated, error: null };
}

function requestsUserInput(body) {
    if (typeof body !== 'string' || !body.trim()) return false;
    const relevant = body.split('\n').map((line) => line.trim()).filter(Boolean)
        .filter((line) => !/^(?:必要なら|必要であれば|ご希望なら|希望があれば|必要に応じて)/u.test(line));
    return relevant.some((line) => (
        /(?:どちら|どれ|どうしますか|何を選びますか|よろしいですか|進めてもいいですか|進めてもよいですか)[^。]*[?？]?$/u.test(line)
        || /(?:か、|か，)[^?？]*か[?？]$/u.test(line)
        || /(?:(?:確認|調査|実行|修正|変更|更新|実装|対応|検証|取得|検索|付け替え)(?:しますか|しましょうか)|(?:進め|続け)ますか)[?？]?$/u.test(line)
        || /(?:登録|作成|確認|調査|実行|修正|変更|更新|実装|対応|検証|取得|検索|付け替え)して(?:も)?(?:よい|いい)ですか[?？]?$/u.test(line)
        || /(?:教えて|選んで|決めて|判断して|承認して|確認して|入力して|提示して|付与して)(?:ください|もらえますか|いただけますか)[。！!？?]?$/u.test(line)
    ));
}

function leavesRequestedWorkUnfinished(body, receipt) {
    const classification = record(receipt?.classification);
    if (!classification
        || !['implement', 'operate'].includes(classification.intent)
        || !['write', 'external'].includes(classification.action_kind)) return false;
    const completionEvidence = /(?:完了しました|実装しました|修正しました|変更しました|更新しました|削除しました|付け替えました|実行しました|デプロイしました|マージしました|変更不要|対応不要|すでに[^。\n]{0,80}(?:正しい|一致している|反映済み))/u;
    if (completionEvidence.test(body)) return false;
    return /(?:直す|修正する|変更する|更新する|実装する|調査する|対応する)対象は/u.test(body)
        || /(?:すれば|することで)[^。\n]{0,120}(?:解消|修正|改善|完了)できます/u.test(body)
        || /(?:修正|変更|実装|調査|対応)(?:方針|方法)は/u.test(body)
        || /(?:未実施|未完了|まだ[^。\n]{0,60}(?:していません|できていません)|作業が残っています)/u.test(body);
}

function autonomyAnswerCompliance(answer, expectedLines, receipt, events = [], episode = null) {
    const contract = episode ? episodeAutonomyContract(episode, receipt) : verifyAutonomyContract(receipt);
    if (!contract) return { status: 'legacy', violation: null };
    const body = normalizedAnswerBody(answer, expectedLines) ?? '';
    const bodyLines = body.split('\n').map((line) => line.trim()).filter(Boolean);
    const markerMatch = bodyLines[0]?.match(AUTONOMY_MARKER_PATTERN) ?? null;
    const markerReason = markerMatch?.[1] ?? null;
    const asks = requestsUserInput(body);
    const proposedHumanQuestion = asks ? displayedQuestion(body) : null;
    if (journalStopStateRequired(receipt)) {
        if (answer?.replaceAll('\r\n', '\n').split('\n').some((line) => STRUCTURED_STOP_STATE_PATTERN.test(line.trim()))) {
            return { status: null, violation: '回答本文からbrainbase-stop-stateのHTMLコメントを削除し、状態は専用toolだけで記録する' };
        }
        const stateEvents = events.filter((event) => event.event_kind === 'state');
        const latestStateEvent = stateEvents.at(-1) ?? null;
        const state = validJudgmentStopState(latestStateEvent?.safe_metadata?.stop_state);
        const exactTool = 'brainbase_judgment_state_record';
        if (!latestStateEvent || !latestStateEvent.success || !state) {
            if (contract.decision === 'escalate') {
                return {
                    status: null,
                    violation: `Host確定判断は人間確認必須です。最終回答を作る前の最後のtool callとして${exactTool}を正確に1回実行し、waiting_humanでruntime_reason_code=${contract.reasonCode}を記録する`,
                    question: proposedHumanQuestion
                };
            }
            return {
                status: null,
                violation: `最終回答を作る前の最後のtool callとして${exactTool}を正確に1回実行し、回答本文には状態を表示しない`,
                triggerCode: asks ? 'unnecessary_user_question' : 'unfinished_safe_work',
                question: proposedHumanQuestion
            };
        }
        if (events.at(-1) !== latestStateEvent) {
            return {
                status: null,
                violation: `${exactTool}をすべての作業・検証後の最後にもう一度実行し、最新の実行状態をjournalへ記録する`,
                triggerCode: 'unfinished_safe_work', stopState: state
            };
        }
        if (contract.decision === 'escalate' && state.status === 'completed') {
            return {
                status: null,
                violation: `Host確定判断は人間確認必須です。${exactTool}はwaiting_humanでruntime_reason_code=${contract.reasonCode}を記録するか、安全な作業が残る間はpendingを記録する`,
                stopState: state
            };
        }
        if (state.status === 'pending' || state.pending_safe_work) {
            return {
                status: null,
                violation: 'journal状態が未完了です。Hostが確定した境界を維持し、安全な範囲の実装・操作・検証まで継続する',
                triggerCode: 'unfinished_safe_work', stopState: state
            };
        }
        if (state.status === 'waiting_human') {
            if (!waitingHumanReasonAllowed(contract, state.runtime_reason_code)
                || markerReason !== state.runtime_reason_code) {
                return { status: null, violation: 'journalのwaiting_human状態と許可された実行時確認理由を正確な確認行で一致させる', stopState: state };
            }
            return { status: 'runtime_escalated', violation: null, stopState: state, stateSource: 'journal' };
        }
        const successfulEvidence = events.filter((event) => !['state', 'value_proof'].includes(event.event_kind) && event.success);
        if (state.runtime_reason_code !== null || successfulEvidence.length === 0) {
            return {
                status: null,
                violation: `${exactTool}のcompletedは同一episodeに成功したPostToolUse実行証跡があり、安全な作業が残っていない場合だけ使用する`,
                triggerCode: 'unfinished_safe_work', stopState: state
            };
        }
        return {
            status: 'continued', violation: null, stopState: state,
            evidenceEventCount: successfulEvidence.length, stateSource: 'journal'
        };
    }
    if (structuredStopStateRequired(receipt)) {
        const parsed = parseStructuredStopState(answer);
        const state = parsed.state;
        const stateInstruction = '最終回答の末尾にbrainbase-stop-state-v1の非表示状態を1件だけ置き、completed・pending・waiting_humanの実行状態を正確に示す';
        if (!state) {
            return {
                status: null,
                violation: `${stateInstruction}（形式: <!-- brainbase-stop-state:{"schema_version":"brainbase-stop-state-v1","status":"completed","pending_safe_work":false,"runtime_reason_code":null} -->）`,
                triggerCode: 'unfinished_safe_work',
                stopStateError: parsed.error
            };
        }
        if (contract.decision === 'escalate' && state.status === 'completed') {
            return {
                status: null,
                violation: `Host確定判断は人間確認必須です。構造化状態はwaiting_humanでruntime_reason_code=${contract.reasonCode}を記録するか、安全な作業が残る間はpendingを記録する`,
                stopState: state
            };
        }
        if (state.status === 'pending' || state.pending_safe_work) {
            return {
                status: null,
                violation: '構造化状態が未完了です。Hostが確定した境界を維持し、安全な範囲の実装・操作・検証まで継続する',
                triggerCode: 'unfinished_safe_work',
                stopState: state
            };
        }
        if (state.status === 'waiting_human') {
            if (!waitingHumanReasonAllowed(contract, state.runtime_reason_code)
                || markerReason !== state.runtime_reason_code) {
                return { status: null, violation: '構造化waiting_human状態と許可された実行時確認理由を正確な確認行で一致させる', stopState: state };
            }
            return { status: 'runtime_escalated', violation: null, stopState: state };
        }
        const successfulEvidence = events.filter((event) => !['state', 'value_proof'].includes(event.event_kind) && event.success);
        if (state.runtime_reason_code !== null || successfulEvidence.length === 0) {
            return {
                status: null,
                violation: `${stateInstruction}。completedは同一episodeに成功したPostToolUse実行証跡がある場合だけ使用する`,
                triggerCode: 'unfinished_safe_work',
                stopState: state
            };
        }
        return {
            status: 'continued',
            violation: null,
            stopState: state,
            evidenceEventCount: successfulEvidence.length
        };
    }
    const unfinishedSafeWork = leavesRequestedWorkUnfinished(body, receipt);

    if (contract.decision === 'continue') {
        if (markerReason) {
            if (!contract.allowedRuntimeReasons.includes(markerReason) || !asks) {
                return { status: null, violation: '許可された実行時確認理由と、必要な入力要求を正確な確認行で示す' };
            }
            return { status: 'runtime_escalated', violation: null };
        }
        if (asks) {
            return {
                status: null,
                violation: 'Brainbase自律判断はcontinueです。高リスク等の許可理由がないためユーザーへ判断を返さず、安全な範囲で作業を継続する',
                triggerCode: 'unnecessary_user_question',
                question: proposedHumanQuestion
            };
        }
        if (unfinishedSafeWork) {
            return {
                status: null,
                violation: 'Brainbase自律判断はcontinueです。修正方針の説明だけで終了せず、安全な範囲の実装・操作・検証まで継続する',
                triggerCode: 'unfinished_safe_work'
            };
        }
        return { status: 'continued', violation: null };
    }
    if (markerReason !== contract.reasonCode || !asks) {
        return {
            status: null,
            violation: `境界操作を実行せず、回答本文の先頭に「⚠️ 確認が必要[${contract.reasonCode}]:」を置いて必要な確認を一つだけ求める`
        };
    }
    return { status: 'escalated', violation: null };
}

function buildAnswerBodyBinding(answer, expectedLines) {
    const body = normalizedAnswerBody(answer, expectedLines);
    if (body === null) return null;
    return {
        schema_version: 'brainbase-answer-body-binding-v2',
        audit_lines_digest: sha256(canonicalJson(expectedLines)),
        body_digest: sha256(body),
        character_count: body.length
    };
}

function activeAnswerBodyBinding(marker, expectedLines) {
    if (marker?.schema_version !== 'brainbase-judgment-continuation-v2') return null;
    const binding = record(marker.answer_body_binding);
    if (!binding) return null;
    if (!['brainbase-answer-body-binding-v1', 'brainbase-answer-body-binding-v2'].includes(binding.schema_version)
        || !/^[0-9a-f]{64}$/u.test(String(binding.audit_lines_digest ?? ''))
        || !/^[0-9a-f]{64}$/u.test(String(binding.body_digest ?? ''))
        || !Number.isSafeInteger(binding.character_count)
        || binding.character_count < 0) {
        throw new Error('judgment_answer_body_binding_invalid');
    }
    return binding.audit_lines_digest === sha256(canonicalJson(expectedLines)) ? binding : null;
}

function answerBodyMatchesBinding(answer, expectedLines, binding) {
    if (!binding) return true;
    const body = normalizedAnswerBody(answer, expectedLines);
    return body !== null && body.length === binding.character_count && sha256(body) === binding.body_digest;
}

function existingFinal(paths, episode) {
    try {
        const entry = readJson(paths.final);
        if (!['brainbase-judgment-episode-final-v1', 'brainbase-judgment-episode-final-v2'].includes(entry.schema_version)) {
            throw new Error('judgment_episode_final_schema_invalid');
        }
        if (episode && entry.initial_route_receipt_digest !== episode.initial_route_receipt_digest) {
            throw new Error('judgment_episode_final_route_mismatch');
        }
        const episodeHasLifecycle = episode
            && (episode.episode_origin !== undefined || episode.route_application !== undefined);
        if (episodeHasLifecycle
            && (entry.episode_origin !== episode.episode_origin
                || entry.route_application !== episode.route_application)) {
            throw new Error('judgment_episode_final_lifecycle_mismatch');
        }
        return entry;
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

function existingJudgmentValueProof(paths, finalized = null) {
    if (!finalized?.value_proof_digest) return null;
    try {
        const proof = readJson(paths.valueProof);
        const digest = judgmentValueProofDigest(proof);
        if (finalized?.value_proof_digest && finalized.value_proof_digest !== digest) {
            throw new Error('judgment_value_proof_digest_mismatch');
        }
        return proof;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            if (finalized?.value_proof_digest) throw new Error('judgment_value_proof_missing');
            return null;
        }
        throw error;
    }
}

function verifyExistingJudgmentValueProofAttention(paths, finalized = null) {
    if (!finalized?.value_proof_attention_digest) return null;
    try {
        const attention = readJson(paths.valueProofAttention);
        if (sha256(canonicalJson(attention)) !== finalized.value_proof_attention_digest) {
            throw new Error('judgment_value_proof_attention_digest_mismatch');
        }
        return attention;
    } catch (error) {
        if (error?.code === 'ENOENT') throw new Error('judgment_value_proof_attention_missing');
        throw error;
    }
}

export function finalizeEpisode(payload, { env = process.env } = {}) {
    const identity = payloadIdentity(payload);
    if (!identity) throw new Error('judgment_episode_identity_missing');
    const paths = journalPaths(identity.sessionRef, identity.turnId, env);
    return withEpisodeTransitionLock(paths, () => {
        const episode = existingEpisode(payload, env);
        if (!episode) throw new Error('judgment_episode_not_found');
        return finalizeEpisodeLocked(payload, episode, paths, env);
    }, env);
}

function orphanEpisodeCandidateCount(paths) {
    try {
        return readdirSync(paths.directory).filter((name) => name.endsWith('.episode.json')).length;
    } catch (error) {
        if (error?.code === 'ENOENT') return 0;
        throw error;
    }
}

function orphanAnswerBodyBinding(answer) {
    return typeof answer === 'string' ? {
        schema_version: 'brainbase-orphan-answer-body-binding-v1',
        body_digest: sha256(answer),
        character_count: answer.length
    } : null;
}

function validSha256(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function validIsoTimestamp(value) {
    if (typeof value !== 'string') return false;
    const timestamp = Date.parse(value);
    return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}

function validateAuditFailure(entry, identity, paths, env) {
    const expectedKeys = [
        'answer_body_binding', 'episode_candidate_count', 'host_digest', 'journal_root_digest',
        'reason', 'recorded_at', 'repair_requested', 'schema_version', 'session_ref',
        'stop_hook_active', 'turn_ref', 'warning_line_digest'
    ];
    const binding = entry?.answer_body_binding;
    const bindingValid = binding === null || (
        record(binding)
        && Object.keys(binding).sort().join(',') === 'body_digest,character_count,schema_version'
        && binding.schema_version === 'brainbase-orphan-answer-body-binding-v1'
        && validSha256(binding.body_digest)
        && Number.isSafeInteger(binding.character_count)
        && binding.character_count >= 0
    );
    if (!record(entry)
        || Object.keys(entry).sort().join(',') !== expectedKeys.sort().join(',')
        || entry.schema_version !== 'brainbase-judgment-audit-failure-v1'
        || entry.reason !== 'judgment_episode_not_found'
        || entry.session_ref !== identity.sessionRef
        || entry.turn_ref !== paths.turnRef
        || entry.journal_root_digest !== sha256(journalRoot(env))
        || entry.host_digest !== sha256(readFileSync(SCRIPT_PATH))
        || entry.warning_line_digest !== sha256(ORPHAN_AUDIT_WARNING)
        || !Number.isSafeInteger(entry.episode_candidate_count)
        || entry.episode_candidate_count < 0
        || typeof entry.repair_requested !== 'boolean'
        || typeof entry.stop_hook_active !== 'boolean'
        || entry.repair_requested === entry.stop_hook_active
        || !validIsoTimestamp(entry.recorded_at)
        || !bindingValid) {
        throw new Error('judgment_audit_failure_integrity_invalid');
    }
    return entry;
}

function existingOrCreateAuditFailure(payload, identity, paths, env) {
    const answer = typeof payload.last_assistant_message === 'string'
        ? payload.last_assistant_message
        : null;
    try {
        const entry = readJson(paths.auditFailure);
        return { entry: validateAuditFailure(entry, identity, paths, env), created: false };
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    const entry = createImmutableJson(paths.auditFailure, {
        schema_version: 'brainbase-judgment-audit-failure-v1',
        recorded_at: new Date().toISOString(),
        reason: 'judgment_episode_not_found',
        session_ref: identity.sessionRef,
        turn_ref: paths.turnRef,
        journal_root_digest: sha256(journalRoot(env)),
        host_digest: sha256(readFileSync(SCRIPT_PATH)),
        episode_candidate_count: orphanEpisodeCandidateCount(paths),
        repair_requested: payload.stop_hook_active !== true,
        stop_hook_active: payload.stop_hook_active === true,
        warning_line_digest: sha256(ORPHAN_AUDIT_WARNING),
        answer_body_binding: orphanAnswerBodyBinding(answer)
    }, 'judgment_audit_failure_conflict');
    return { entry, created: true };
}

function strippedOrphanWarning(answer) {
    if (typeof answer !== 'string') return null;
    const prefix = `${ORPHAN_AUDIT_WARNING}\n`;
    return answer.startsWith(prefix) ? answer.slice(prefix.length) : null;
}

function createAuditDegraded(payload, paths, diagnostic) {
    const answer = typeof payload.last_assistant_message === 'string'
        ? payload.last_assistant_message
        : null;
    const body = strippedOrphanWarning(answer);
    const binding = record(diagnostic.answer_body_binding);
    const ownerWarningDisplayed = body !== null;
    const answerBodyPreserved = Boolean(binding)
        && body !== null
        && body.length === binding.character_count
        && sha256(body) === binding.body_digest;
    const projection = {
        schema_version: 'brainbase-judgment-audit-degraded-v1',
        completion_status: 'audit_degraded',
        reason: 'judgment_episode_not_found',
        session_ref: diagnostic.session_ref,
        turn_ref: diagnostic.turn_ref,
        diagnostic_digest: sha256(canonicalJson(diagnostic)),
        stop_hook_active: true,
        owner_warning_displayed: ownerWarningDisplayed,
        answer_body_preserved: answerBodyPreserved,
        answer_digest: answer === null ? null : sha256(answer)
    };
    try {
        const existing = readJson(paths.auditDegraded);
        const validated = validateAuditDegraded(existing, diagnostic);
        const existingProjection = { ...validated };
        delete existingProjection.finalized_at;
        if (canonicalJson(existingProjection) !== canonicalJson(projection)) {
            throw new Error('judgment_audit_degraded_conflict');
        }
        return validated;
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    return createImmutableJson(paths.auditDegraded, {
        ...projection,
        finalized_at: new Date().toISOString()
    }, 'judgment_audit_degraded_conflict');
}

function validateAuditDegraded(entry, diagnostic) {
    const expectedKeys = [
        'answer_body_preserved', 'answer_digest', 'completion_status', 'diagnostic_digest',
        'finalized_at', 'owner_warning_displayed', 'reason', 'schema_version', 'session_ref',
        'stop_hook_active', 'turn_ref'
    ];
    if (!record(entry)
        || Object.keys(entry).sort().join(',') !== expectedKeys.sort().join(',')
        || entry.schema_version !== 'brainbase-judgment-audit-degraded-v1'
        || entry.completion_status !== 'audit_degraded'
        || entry.reason !== 'judgment_episode_not_found'
        || entry.session_ref !== diagnostic.session_ref
        || entry.turn_ref !== diagnostic.turn_ref
        || entry.diagnostic_digest !== sha256(canonicalJson(diagnostic))
        || entry.stop_hook_active !== true
        || typeof entry.owner_warning_displayed !== 'boolean'
        || typeof entry.answer_body_preserved !== 'boolean'
        || !(entry.answer_digest === null || validSha256(entry.answer_digest))
        || !validIsoTimestamp(entry.finalized_at)) {
        throw new Error('judgment_audit_degraded_integrity_invalid');
    }
    return entry;
}

function assertNoOrphanAuditBarrier(identity, paths, env) {
    try {
        if (readdirSync(paths.auditOrphanEvents).some((name) => name.endsWith('.json'))) {
            throw new Error('judgment_orphan_tool_event_start_conflict');
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    let diagnostic;
    try {
        diagnostic = validateAuditFailure(readJson(paths.auditFailure), identity, paths, env);
    } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
    }
    let degraded;
    try {
        degraded = readJson(paths.auditDegraded);
    } catch (error) {
        if (error?.code === 'ENOENT') throw new Error('judgment_audit_failure_start_conflict');
        throw error;
    }
    validateAuditDegraded(degraded, diagnostic);
    throw new Error('judgment_audit_degraded_start_conflict');
}

// Multi-agent wake-up turns (a subagent report resuming the parent thread)
// carry only injected envelopes and no user request, so UserPromptSubmit never
// opened an episode. They are not judgment turns and must not be audited as
// orphans on every wake-up.
function agentContinuationTurn(payload, identity, env) {
    if (typeof payload.prompt === 'string' && payload.prompt.trim()) return false;
    const transcript = readCanonicalTranscript(payload, env);
    if (!transcript.complete) return false;
    const turnId = identity.turnId;
    return transcript.injected_user_turns.includes(turnId)
        && !transcript.messages.some((message) => message.role === 'user' && message.turn_id === turnId)
        && !transcript.delegations.some((delegation) => delegation.turn_id === turnId);
}

function handleOrphanStop(payload, { env = process.env } = {}) {
    const identity = payloadIdentity(payload);
    if (!identity) throw new Error('judgment_episode_identity_missing');
    const paths = journalPaths(identity.sessionRef, identity.turnId, env);
    return withEpisodeTransitionLock(paths, () => {
        const episode = existingEpisode(payload, env);
        if (episode) return finalizeEpisodeLocked(payload, episode, paths, env).output;
        if (agentContinuationTurn(payload, identity, env)) return {};
        const diagnosticState = existingOrCreateAuditFailure(payload, identity, paths, env);
        if (payload.stop_hook_active !== true && diagnosticState.created) {
            return {
                decision: 'block',
                reason: `judgment_episode_not_found。${ORPHAN_AUDIT_WARNING}\n最終回答の先頭に上の監査行をそのまま1回追加し、その後に元の回答本文を削除・要約・置換せずそのまま続けてください。`
            };
        }
        createAuditDegraded(payload, paths, diagnosticState.entry);
        return { systemMessage: ORPHAN_AUDIT_WARNING };
    }, env);
}


function autonomyRolloutEnabled(episode, env) {
    const mode = String(env.BRAINBASE_JUDGMENT_AUTONOMY_MODE || 'off').trim().toLowerCase();
    if (mode === 'enabled') return true;
    if (mode !== 'canary') return false;
    const projectCode = String(
        episode?.initial_route_receipt?.project_code
        || env.BRAINBASE_JUDGMENT_PROJECT_CODE
        || ''
    ).trim();
    const allowlist = new Set(String(env.BRAINBASE_JUDGMENT_AUTONOMY_CANARY_PROJECTS || '')
        .split(',').map((value) => value.trim()).filter(Boolean));
    return Boolean(projectCode) && allowlist.has(projectCode);
}

function valueProofRolloutEnabled(episode, env) {
    const mode = String(env.BRAINBASE_JUDGMENT_VALUE_PROOF_MODE || 'off').trim().toLowerCase();
    if (mode === 'enabled') return true;
    if (mode !== 'canary') return false;
    const projectCode = String(
        episode?.initial_route_receipt?.project_code
        || env.BRAINBASE_JUDGMENT_PROJECT_CODE
        || ''
    ).trim();
    const allowlist = new Set(String(env.BRAINBASE_JUDGMENT_VALUE_PROOF_CANARY_PROJECTS || '')
        .split(',').map((value) => value.trim()).filter(Boolean));
    return Boolean(projectCode) && allowlist.has(projectCode);
}

function autonomyRequestForTurn(payload, env, identity) {
    if (typeof payload.prompt === 'string' && payload.prompt.trim()) return payload.prompt;
    const transcript = readCanonicalTranscript(payload, env);
    const exact = [...transcript.messages].reverse().find((message) => (
        message.role === 'user' && message.turn_id === identity.turnId
    ));
    if (exact?.text) return exact.text;
    return [...transcript.messages].reverse().find((message) => message.role === 'user')?.text ?? '';
}

function existingAutonomyReceipt(paths, episode) {
    try {
        const receipt = readJson(paths.autonomy);
        if (receipt?.schema_version !== 'brainbase-judgment-autonomy-receipt-v1'
            || receipt.initial_route_receipt_digest !== episode.initial_route_receipt_digest
            || receipt.evaluation_digest !== sha256(canonicalJson(receipt.evaluation))
            || receipt.snapshot_digest !== sha256(canonicalJson(receipt.snapshot))) {
            throw new Error('judgment_autonomy_receipt_invalid');
        }
        return receipt;
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

function autonomySnapshot(episode, events) {
    return {
        initial_route_receipt_digest: episode.initial_route_receipt_digest,
        event_count: events.length,
        event_set_digest: orderedEventSetDigest(events)
    };
}

export async function evaluateAutonomyStop(payload, {
    env = process.env,
    autonomyResolver
} = {}) {
    const identity = payloadIdentity(payload);
    if (!identity) throw new Error('judgment_episode_identity_missing');
    const paths = journalPaths(identity.sessionRef, identity.turnId, env);
    const episode = existingEpisode(payload, env);
    const resolvedEpisode = episode ? effectiveEpisode(episode, episodeEvents(paths)) : null;
    // Runtime 2.1 receipts already contain a deterministic autonomy decision.
    // Keep the model evaluator only for in-flight legacy episodes during rollout.
    if (resolvedEpisode && verifyAutonomyContract(resolvedEpisode.initial_route_receipt)) return null;
    if (!episode || !autonomyRolloutEnabled(episode, env)) return null;
    const answer = typeof payload.last_assistant_message === 'string'
        ? payload.last_assistant_message
        : '';
    const before = autonomySnapshot(episode, episodeEvents(paths));
    const evaluation = await evaluateJudgmentAutonomy({
        turn_id: identity.turnId,
        request: autonomyRequestForTurn(payload, env, identity),
        final_answer: answer,
        project_code: episode.initial_route_receipt.project_code
            || env.BRAINBASE_JUDGMENT_PROJECT_CODE
            || undefined,
        selected_dag_ids: Array.isArray(episode.initial_route_receipt.selected_dag_ids)
            ? episode.initial_route_receipt.selected_dag_ids
            : []
    }, autonomyResolver);
    if (evaluation.verdict !== 'continue') return null;

    const existing = existingAutonomyReceipt(paths, episode);
    if (existing) throw new Error('judgment_autonomy_continuation_exhausted');

    const currentEpisode = existingEpisode(payload, env);
    if (!currentEpisode) throw new Error('judgment_episode_not_found');
    const after = autonomySnapshot(currentEpisode, episodeEvents(paths));
    if (canonicalJson(before) !== canonicalJson(after)) {
        throw new Error('judgment_autonomy_snapshot_changed');
    }
    const receipt = {
        schema_version: 'brainbase-judgment-autonomy-receipt-v1',
        recorded_at: new Date().toISOString(),
        initial_route_receipt_digest: currentEpisode.initial_route_receipt_digest,
        snapshot: after,
        snapshot_digest: sha256(canonicalJson(after)),
        evaluation,
        evaluation_digest: sha256(canonicalJson(evaluation))
    };
    createImmutableJson(paths.autonomy, receipt, 'judgment_autonomy_receipt_conflict');
    return {
        decision: 'block',
        reason: renderJudgmentAutonomyContinuation(evaluation)
    };
}

function finalizeEpisodeLocked(payload, episode, paths, env) {
    const events = episodeEvents(paths);
    const hasTurnResolution = events.some((event) => event.success && event.satisfies.includes('judgment.resolve_turn'));
    const bootstrapEpisode = episode;
    // The first degraded turn opens before the failure is visible, so the Stop
    // re-reads the transcript; later turns carry the surface in the episode.
    const surfaceUnavailable = turnResolutionUnavailable(bootstrapEpisode)
        || (turnResolutionRequired(bootstrapEpisode)
            && !hasTurnResolution
            && transcriptTurnResolutionSurface(payload, env) !== null);
    const requiresTurnResolution = turnResolutionRequired(bootstrapEpisode) && !surfaceUnavailable;
    episode = effectiveEpisode(episode, events);
    let existingContinuation = null;
    try { existingContinuation = readJson(paths.continuation); } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    const completedAuditOutput = (valueProof = null, valueProofAttention = null) => {
        const auditBlock = requiredAuditLines(episode, events, existingContinuation).join('\n');
        const valueSurface = renderJudgmentValueProofSurface(valueProof);
        const attentionSurface = renderJudgmentValueProofAttentionSurface(valueProofAttention);
        return { systemMessage: [auditBlock, valueSurface, attentionSurface].filter(Boolean).join('\n\n') };
    };
    // A resolved TurnContract replaces the bootstrap route for this execution,
    // while an already-persisted legacy final remains bound to the original route.
    const finalized = existingFinal(paths, bootstrapEpisode);
    if (finalized) {
        verifyFinalStopRepair(finalized, existingContinuation, episodeAuditContract(episode));
        const finalizedValueProof = existingJudgmentValueProof(paths, finalized);
        const finalizedValueProofAttention = verifyExistingJudgmentValueProofAttention(paths, finalized);
        const qualifyingCount = events.filter((entry) => entry.success && entry.satisfies.includes('knowledge.resolve')).length;
        const eventSetDigest = finalized.schema_version === 'brainbase-judgment-episode-final-v1'
            ? sha256(canonicalJson(events.map((entry) => entry.event_fingerprint).sort(compareCodePoints)))
            : orderedEventSetDigest(events);
        if (finalized.event_count !== events.length
            || finalized.qualifying_event_count !== qualifyingCount
            || finalized.event_set_digest !== eventSetDigest) {
            throw new Error('judgment_episode_final_event_set_mismatch');
        }
        enqueueFinalKnowledgeEvent(payload, finalized, env);
        return {
            output: completedAuditOutput(finalizedValueProof, finalizedValueProofAttention),
            final: finalized,
            auditRepairWasAlreadyActive: existingContinuation !== null
        };
    }
    const requiredKnowledge = requiredKnowledgeResolution(episode.initial_route_receipt);
    const knowledgeExecutionEvents = events.filter((entry) => entry.satisfies.includes('knowledge.resolve'));
    const qualifyingEvents = knowledgeExecutionEvents.filter((entry) => entry.success);
    const missingTurnResolution = requiresTurnResolution && !hasTurnResolution;
    const missingKnowledge = requiredKnowledge && knowledgeExecutionEvents.length === 0;
    const answer = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : null;
    const expectedAuditLines = requiredAuditLines(episode, events, existingContinuation);
    const unauthorizedContinuationAudit = containsUnauthorizedContinuationAudit(answer, expectedAuditLines);
    const unauthorizedStopRepairAudit = containsUnauthorizedStopRepairAudit(answer, expectedAuditLines);
    const missingOwnerAudit = !answerContainsExactAuditPrefix(answer, expectedAuditLines)
        || unauthorizedContinuationAudit
        || unauthorizedStopRepairAudit;
    const autonomyCompliance = surfaceUnavailable
        ? { status: 'turn_resolution_unavailable', violation: null }
        : autonomyAnswerCompliance(
            answer,
            expectedAuditLines,
            episode.initial_route_receipt,
            events,
            episode
        );
    const missingAutonomyCompliance = autonomyCompliance.violation !== null;
    const auditContract = episodeAuditContract(episode);
    const valueProofEvent = valueProofRolloutEnabled(episode, env)
        ? latestJudgmentValueProofEvent(events)
        : null;
    const valueProofRequired = valueProofRolloutEnabled(episode, env)
        && existingContinuation?.autonomy_continuation?.interruption_candidate?.resolution === 'continued_without_human';
    const missingValueProof = valueProofRequired && valueProofEvent === null;
    const autonomyContinuationRequested = ['unnecessary_user_question', 'unfinished_safe_work']
        .includes(autonomyCompliance.triggerCode)
        && typeof auditContract?.autonomy_continuation_progress_line === 'string'
        && typeof auditContract?.autonomy_continuation_complete_line === 'string'
        && (autonomyCompliance.triggerCode !== 'unfinished_safe_work'
            || (typeof auditContract?.outcome_continuation_progress_line === 'string'
                && typeof auditContract?.outcome_continuation_complete_line === 'string'));
    const answerBodyBinding = activeAnswerBodyBinding(existingContinuation, expectedAuditLines);
    const missingAnswerBody = !answerBodyMatchesBinding(answer, expectedAuditLines, answerBodyBinding);
    const hostCanCompleteOwnerAudit = missingOwnerAudit
        && journalStopStateRequired(episode.initial_route_receipt)
        && !missingKnowledge
        && !missingValueProof
        && !missingAnswerBody
        && !missingAutonomyCompliance
        && !unauthorizedContinuationAudit
        && !unauthorizedStopRepairAudit
        && existingContinuation === null;
    if (missingTurnResolution
        || missingKnowledge
        || missingValueProof
        || (missingOwnerAudit && !hostCanCompleteOwnerAudit)
        || missingAnswerBody
        || missingAutonomyCompliance) {
        const missingCapabilities = [
            ...(missingTurnResolution ? ['judgment.resolve_turn'] : []),
            ...(missingKnowledge ? ['knowledge.resolve'] : []),
            ...(missingValueProof ? ['judgment.value_proof.record'] : []),
            ...(missingOwnerAudit ? ['owner.audit.display'] : []),
            ...(missingAnswerBody ? ['answer.body.preservation'] : []),
            ...(missingAutonomyCompliance ? ['autonomy.continuation'] : [])
        ];
        let marker = existingContinuation;
        if (!marker) {
            const shouldBindAnswerBody = !missingKnowledge
                && missingOwnerAudit
                && !unauthorizedContinuationAudit
                && !unauthorizedStopRepairAudit
                && !missingAutonomyCompliance
                && episodeAuditContract(episode)?.repair_body_policy === 'preserve';
            const autonomyContract = episodeAutonomyContract(episode);
            const markerEntry = {
                schema_version: 'brainbase-judgment-continuation-v2',
                requested_at: new Date().toISOString(),
                missing_capabilities: missingCapabilities,
                ...(typeof auditContract?.stop_repair_complete_line === 'string' ? {
                    stop_repair: {
                        count: 1,
                        status: 'requested'
                    }
                } : {}),
                ...(autonomyContinuationRequested ? {
                    autonomy_continuation: {
                        count: 1,
                        trigger_code: autonomyCompliance.triggerCode,
                        reason_code: autonomyContract.reasonCode,
                        status: 'requested',
                        ...(autonomyCompliance.question ? {
                            interruption_candidate: {
                                resolution: 'continued_without_human',
                                question_display_text: autonomyCompliance.question,
                                question_digest: `sha256:${sha256(autonomyCompliance.question)}`,
                                reason_code: autonomyContract.reasonCode,
                                source: 'autonomy_continuation'
                            }
                        } : {})
                    }
                } : {})
            };
            if (shouldBindAnswerBody) {
                markerEntry.answer_body_binding = buildAnswerBodyBinding(
                    answer,
                    requiredAuditLines(episode, events, markerEntry)
                );
            }
            marker = createImmutableJson(
                paths.continuation,
                markerEntry,
                'judgment_episode_continuation_conflict'
            );
        }
        const repairExpectedAuditLines = requiredAuditLines(episode, events, marker);
        const reasons = [
            ...(missingTurnResolution ? [
                `mcp__brainbase__brainbase_resolve_turnをturn_ref="${basename(paths.directory)}/${paths.turnRef}"で実行し、Hookが保存したturn_inputとモデルの意味解釈からTurnContractを確定する（turn_inputはHostのjournalに保存済みでturn_refからserverが読み込む。turn_inputやpathを渡さない。確定後はPostToolUseが返す新しい判断行を先頭行にする）`
            ] : []),
            ...(missingKnowledge ? [capabilityActionInstruction(
                CAPABILITY_ACTION_CONTRACTS['knowledge.resolve'],
                { repair: true }
            )] : []),
            ...(missingValueProof ? [
                `mcp__brainbase__brainbase_judgment_value_proof_recordを1回実行する。interruption.resolutionはcontinued_without_human、question_display_textは「${existingContinuation.autonomy_continuation.interruption_candidate.question_display_text}」を一字一句そのまま使い、実際の判断・成果物・canonical readback証拠だけを記録する。その後にbrainbase_judgment_state_recordを最後のtool callとして実行する`
            ] : []),
            ...((missingOwnerAudit || missingAutonomyCompliance) ? [
                `最終回答の先頭に次の監査行をそのまま、この順番で各1回だけ表示する:\n${repairExpectedAuditLines.join('\n')}`
            ] : []),
            ...((missingKnowledge
                && !missingOwnerAudit
                && !missingAutonomyCompliance
                && typeof auditContract?.stop_repair_complete_line === 'string') ? [
                `Brainbase参照後の最終監査ブロック末尾に「${auditContract.stop_repair_complete_line}」を1回だけ表示する`
            ] : []),
            ...(unauthorizedContinuationAudit ? ['Hostが記録していない🔁監査行を削除する'] : []),
            ...(unauthorizedStopRepairAudit ? ['Hostが記録していない🛠️監査行を削除する'] : []),
            ...((missingAnswerBody || (!missingKnowledge && missingOwnerAudit && marker.answer_body_binding)) ? [
                '最初に差し戻された回答の監査行以外の本文を、削除・要約・置換せずそのまま残す'
            ] : []),
            ...((valueProofRolloutEnabled(episode, env)
                && marker?.autonomy_continuation?.interruption_candidate?.resolution === 'continued_without_human') ? [
                `安全な作業とcanonical readbackを完了した後、mcp__brainbase__brainbase_judgment_value_proof_recordを1回実行する。interruption.resolutionはcontinued_without_human、question_display_textは「${marker.autonomy_continuation.interruption_candidate.question_display_text}」を一字一句そのまま使い、実際の判断・成果物・readback証拠だけを記録する。その後にbrainbase_judgment_state_recordを最後のtool callとして実行する`
            ] : []),
            ...(missingAutonomyCompliance ? [autonomyCompliance.violation] : [])
        ];
        const reasonSequence = reasons.join('\nその後、');
        const completionInstruction = missingAutonomyCompliance
            ? '不要な確認質問を回答本文に残さず、安全な範囲の作業結果を続けてください。'
            : '監査行の後に、元の回答本文をそのまま続けてください。';
        const progressLine = autonomyContinuationRequested
            ? autonomyCompliance.triggerCode === 'unfinished_safe_work'
                ? auditContract.outcome_continuation_progress_line
                : auditContract.autonomy_continuation_progress_line
            : null;
        return {
            output: {
                decision: 'block',
                reason: `Brainbase judgment episodeを完了する前に${reasonSequence}\n${completionInstruction}`,
                ...(typeof progressLine === 'string' ? { systemMessage: progressLine } : {})
            },
            continuation: marker,
            final: null,
            auditRepairWasAlreadyActive: existingContinuation !== null
        };
    }
    const safeAnswer = sanitizeJudgmentAnswer(answer);
    const finalizedAt = new Date().toISOString();
    const waitingHumanQuestionText = autonomyCompliance.stopState?.status === 'waiting_human'
        ? waitingHumanQuestion(answer ?? '', expectedAuditLines, autonomyCompliance.stopState)
        : null;
    const interruptionCandidate = valueProofEvent?.safe_metadata?.value_proof?.interruption?.resolution === 'human_required'
        ? waitingHumanQuestionText ? {
            resolution: 'human_required',
            question_display_text: waitingHumanQuestionText,
            question_digest: `sha256:${sha256(waitingHumanQuestionText)}`,
            reason_code: autonomyCompliance.stopState?.runtime_reason_code ?? null,
            source: 'waiting_human_answer'
        } : null
        : existingContinuation?.autonomy_continuation?.interruption_candidate ?? null;
    const valueProof = buildJudgmentValueProofProjection({
        turnRef: paths.turnRef,
        valueProofEvent,
        events,
        stopState: autonomyCompliance.stopState ?? null,
        finalizedAt: valueProofEvent?.recorded_at ?? finalizedAt,
        interruptionCandidate
    });
    const valueProofDigest = valueProof ? judgmentValueProofDigest(valueProof) : null;
    const valueProofAttention = projectJudgmentValueProofCompanionAttention(valueProof);
    if (valueProof) {
        createImmutableJson(paths.valueProof, valueProof, 'judgment_value_proof_conflict');
    }
    if (valueProofAttention) {
        createImmutableJson(
            paths.valueProofAttention,
            valueProofAttention,
            'judgment_value_proof_attention_conflict'
        );
    }
    const entry = {
        schema_version: 'brainbase-judgment-episode-final-v2',
        finalized_at: finalizedAt,
        ...(surfaceUnavailable ? {
            completion_status: 'audit_degraded',
            degradation_reason: 'turn_resolution_unavailable',
            ...(bootstrapEpisode.host_surface ? { host_surface: bootstrapEpisode.host_surface } : {})
        } : { completion_status: 'complete' }),
        protocol_status: 'audit_protocol_complete',
        content_verification_status: 'not_evaluated',
        ...(episode.episode_origin !== undefined ? {
            episode_origin: episode.episode_origin,
            route_application: episode.route_application
        } : {}),
        initial_route_receipt_digest: episode.initial_route_receipt_digest,
        event_count: events.length,
        qualifying_event_count: qualifyingEvents.length,
        event_set_digest: orderedEventSetDigest(events),
        owner_audit_complete: !missingOwnerAudit || hostCanCompleteOwnerAudit,
        owner_audit_line_count: expectedAuditLines.length,
        owner_audit_source: hostCanCompleteOwnerAudit ? 'stop_hook_system_message' : 'assistant_answer',
        autonomy_compliance_status: autonomyCompliance.status,
        ...(autonomyCompliance.stopState ? {
            stop_state: {
                status: autonomyCompliance.stopState.status,
                evidence_event_count: autonomyCompliance.evidenceEventCount ?? 0,
                ...(autonomyCompliance.stateSource ? { source: autonomyCompliance.stateSource } : {})
            }
        } : {}),
        ...(verifiedAutonomyContinuation(existingContinuation, episodeAuditContract(episode)) ? {
            autonomy_continuation: {
                ...existingContinuation.autonomy_continuation,
                status: 'completed'
            }
        } : {}),
        ...(verifiedStopRepair(existingContinuation, episodeAuditContract(episode)) ? {
            stop_repair: {
                ...existingContinuation.stop_repair,
                status: 'completed'
            }
        } : {}),
        ...(valueProof ? {
            value_proof_digest: valueProofDigest,
            value_proof_state: valueProof.state
        } : {}),
        ...(valueProofAttention ? {
            value_proof_attention_digest: sha256(canonicalJson(valueProofAttention))
        } : {}),
        answer_digest: answer === null ? null : sha256(answer),
        ...(safeAnswer?.sensitive
            ? { redaction_status: 'needs_redaction' }
            : safeAnswer?.summary
                ? { final_summary: safeAnswer.summary }
                : {})
    };
    const final = createImmutableJson(paths.final, entry, 'judgment_episode_final_conflict');
    enqueueFinalKnowledgeEvent(payload, final, env);
    return {
        output: completedAuditOutput(valueProof, valueProofAttention),
        final,
        auditRepairWasAlreadyActive: existingContinuation !== null
    };
}

function enqueueFinalKnowledgeEvent(payload, final, env) {
    const event = toKnowledgeEventFromJudgmentEpisode({
        ...final,
        episode_id: `je_${sha256(`${payload.session_id}:${payload.turn_id}`)}`,
        session_id: payload.session_id,
        turn_id: payload.turn_id,
        organization_id: env.BRAINBASE_ORGANIZATION_ID
    });
    if (event) {
        enqueueJudgmentKnowledgeEvent(event, {
            directory: resolveJudgmentKnowledgeEventOutboxPath({
                env,
                repoDir: REPO_ROOT
            })
        });
    }
}

const OWNER_EXCERPT_LIMIT = 26;
const PRIOR_EVIDENCE_SOURCES = new Set(['prior_receipt', 'prior_message']);

function sanitizeOwnerExcerpt(value) {
    const redacted = String(value ?? '')
        .replace(/\b(token|api[_-]?key|secret|password)\s*=\s*[^\s]+/giu, '$1=[秘密情報]')
        .replace(/\b(?:sk-[a-z0-9_-]{8,}|ghp_[a-z0-9_]{8,}|github_pat_[a-z0-9_]{8,}|xox[a-z]-[a-z0-9-]{8,}|AIza[a-z0-9_-]{8,})\b/giu, '[秘密情報]')
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/[「」]/gu, ' ')
        .replaceAll('<', '＜')
        .replaceAll('>', '＞')
        .replace(/\s+/gu, ' ')
        .trim();
    const points = Array.from(redacted);
    return points.length > OWNER_EXCERPT_LIMIT
        ? `${points.slice(0, OWNER_EXCERPT_LIMIT).join('')}…`
        : redacted;
}

function ownerEvidenceSource(args, receipt) {
    const evidence = record(receipt?.classification_evidence) ?? {};
    const sourceTurnIds = Array.isArray(evidence.source_turn_ids)
        ? evidence.source_turn_ids.filter((turnId) => typeof turnId === 'string')
        : [];
    const inherited = Array.isArray(receipt?.reconciliation_reasons)
        && receipt.reconciliation_reasons.includes('classification_inherited_from_prior_turn');
    const prior = PRIOR_EVIDENCE_SOURCES.has(evidence.source) || inherited;
    if (!prior) return { sourceKind: 'current_request', text: args.request, sourceTurnIds };

    const messages = Array.isArray(args?.conversation_context?.messages)
        ? args.conversation_context.messages
        : [];
    const exact = [...messages].reverse().find((message) => (
        message?.role === 'user'
        && message.turn_id !== args.turn_id
        && sourceTurnIds.includes(message.turn_id)
    ));
    const fallback = sourceTurnIds.length === 0
        ? [...messages].reverse().find((message) => message?.role === 'user' && message.turn_id !== args.turn_id)
        : null;
    return {
        sourceKind: exact ? 'prior_turn' : fallback ? 'prior_turn_fallback' : 'prior_turn_unavailable',
        text: exact?.text ?? fallback?.text ?? '',
        sourceTurnIds
    };
}

function requiredCapabilityActionContracts(receipt) {
    if (!Array.isArray(receipt?.required_capabilities)) return [];
    return receipt.required_capabilities.map((entry) => {
        if (record(entry) && entry.status && entry.status !== 'required') return null;
        const capability = typeof entry === 'string' ? entry : entry?.capability;
        return CAPABILITY_ACTION_CONTRACTS[capability] ?? null;
    }).filter(Boolean);
}

function capabilityActionInstruction(contract, { repair = false } = {}) {
    const lead = repair
        ? `必須capability \`${contract.capability}\`が未完了です。許可されている正確なツール \`${contract.exactTool}\` を今実行してください。`
        : `必須capability \`${contract.capability}\`を実行してください。許可されている正確なツールは \`${contract.exactTool}\` です。`;
    return `${lead}このツールは${contract.actionDescription}。これは${contract.distinctFrom}ではありません。`;
}

function requiredKnowledgeResolution(receipt) {
    return requiredCapabilityActionContracts(receipt).some((contract) => (
        contract.capability === 'knowledge.resolve'
    ));
}

function ownerDecision(receipt, hostAutonomy = null) {
    if (escalationAnswered(hostAutonomy, receipt)) return '前turnの確認への回答として継続';
    if (receipt?.autonomy_decision === 'escalate') return '高リスク・外部作用または必須確認のため停止';
    if (requiredKnowledgeResolution(receipt)) return 'Brainbase参照先の判断が必要';
    const intent = receipt?.classification?.intent;
    const byIntent = {
        implement: '実装依頼として継続',
        investigate: '調査として確認',
        diagnose: '原因診断として確認',
        review: 'レビューとして確認',
        design: '設計として検討',
        answer: '質問として回答',
        explain: '説明として回答',
        operate: '運用依頼として対応'
    };
    if (byIntent[intent]) return byIntent[intent];
    return {
        read: '調査として確認',
        write: '変更依頼として継続',
        external: '外部操作として確認',
        none: '質問として回答'
    }[receipt?.classification?.action_kind] ?? '回答方針を確認';
}

export function buildOwnerAudit(args, receipt, { historicalExact = true, hostSurface = null, hostAutonomy = null } = {}) {
    const evidence = ownerEvidenceSource(args, receipt);
    const excerpt = sanitizeOwnerExcerpt(evidence.text);
    const dagIds = Array.isArray(receipt?.selected_dag_ids) ? receipt.selected_dag_ids : [];
    let decision = ownerDecision(receipt, hostAutonomy);
    let displayLine;

    if (hostSurface?.turn_resolution === 'unavailable') {
        decision = 'Resolver未接続のため判断縮退';
        displayLine = `⚠️ 判断参照: 「${excerpt || '現在の依頼'}」→ ${decision}（このCodexスレッドは${TURN_RESOLUTION_TOOL_NAME}を呼べない・新しいCodexタスクで復旧）`;
    } else if (receipt?.status === 'needs_classification' || dagIds.includes('clarification.v1')) {
        decision = '確認質問';
        const reasons = Array.isArray(receipt?.reconciliation_reasons)
            ? receipt.reconciliation_reasons.flatMap((reason) => {
                if (typeof reason !== 'string' || !reason.trim()) return [];
                return [Object.hasOwn(JUDGMENT_REASON_LABELS, reason)
                    ? JUDGMENT_REASON_LABELS[reason]
                    : sanitizeToolExcerpt(reason, TOOL_SCOPE_LIMIT)];
            })
            : [];
        const project = typeof receipt?.project_code === 'string' && receipt.project_code.trim()
            ? sanitizeToolExcerpt(receipt.project_code, TOOL_SCOPE_LIMIT)
            : null;
        const reasonDetails = reasons.length > 0 ? reasons.join('、') : '';
        const details = `${reasonDetails}${project ? `${reasonDetails ? '・' : ''}project=${project}` : ''}`;
        displayLine = `⚠️ 判断参照: 「${excerpt || '現在の依頼'}」の対象を特定できず${details ? `（理由: ${details}）` : ' '}→ ${decision}`;
    } else if (receipt?.status === 'needs_policy_resolution') {
        decision = '方針衝突を要確認';
        displayLine = `⚠️ 判断参照: 「${excerpt || '現在の依頼'}」を参照 → ${decision}`;
    } else if (receipt?.status && receipt.status !== 'resolved') {
        decision = '状態を要確認';
        displayLine = `⚠️ 判断参照: 「${excerpt || '現在の依頼'}」を参照 → ${decision}`;
    } else if (evidence.sourceKind === 'prior_turn_unavailable') {
        decision = '判断証跡を要確認';
        displayLine = `⚠️ 判断参照: 参照元の会話を確認できず → ${decision}`;
    } else {
        const prefix = evidence.sourceKind.startsWith('prior_turn') ? '直前の' : '';
        displayLine = `🧠 判断参照: ${prefix}「${excerpt || '現在の依頼'}」を参照 → ${decision} ✓`;
    }

    return {
        schema_version: 'brainbase-owner-audit-v1',
        renderer_version: '3',
        locale: 'ja-JP',
        historical_exact: historicalExact,
        source_receipt_digest: sha256(canonicalJson(receipt)),
        source_kind: evidence.sourceKind,
        source_turn_ids: evidence.sourceTurnIds ?? [],
        source_excerpt: excerpt,
        decision,
        display_line: displayLine,
        text_digest: sha256(displayLine)
    };
}

export function buildOwnerReferenceLine(args, receipt) {
    return buildOwnerAudit(args, receipt).display_line;
}

function mandatoryVibeProImplementationInstructions(receipt) {
    if (receipt?.classification?.intent !== 'implement'
        || !receipt?.classification?.domains?.includes('engineering')) return [];
    return [
        'This is an implementation request. Use the repository-local `vibepro-workflow` Skill even when the user did not mention VibePro.',
        'Before changing code, create or select one focused VibePro Story with explicit acceptance criteria and write the smallest testable Spec.',
        'Run debugging, TDD, and Git Skills inside the Story → Spec → implement → affected tests → one review wave → GitHub PR → CI → merge loop; they do not replace it.',
        'Brainbase remains the authority for organization judgment, knowledge, permissions, merge approval, deployment authorization, external actions, and secret boundaries. Do not restore retired managed-worktree or general Gate DAG contracts.'
    ];
}

export function successOutput(
    args,
    receipt,
    ownerAudit = buildOwnerAudit(args, receipt),
    auditContract = buildAuditContract(receipt),
    env = process.env,
    hostSurface = null,
    turnRef = null,
    hostAutonomy = null
) {
    const ownerReferenceLine = ownerAudit.display_line;
    const surfaceDegraded = hostSurface?.turn_resolution === 'unavailable';
    const requiredCapabilityInstructions = requiredCapabilityActionContracts(receipt)
        .map((contract) => capabilityActionInstruction(contract));
    const implementationWorkflowInstructions = mandatoryVibeProImplementationInstructions(receipt);
    const autonomy = verifyAutonomyContract(receipt);
    const autonomyInstructions = surfaceDegraded
        ? [
            'Autonomy decision: continue (turn-resolution surface unavailable).',
            '安全なスコープ内の読解、調査、テスト、可逆な実装はそのまま完了まで続ける。分類確認や再送依頼のためだけに停止しない。',
            `実行中に確認が必須になった場合だけ、許可された理由コードの確認行「⚠️ 確認が必要[reason_code]:」を回答本文の先頭に置く。許可コード: ${AUTONOMY_RUNTIME_ESCALATION_REASONS.join(', ')}。`,
            'この自律判断は通常の権限・承認を置き換えません。'
        ]
        : autonomy?.decision === 'continue'
        ? [
            'Autonomy decision: continue.',
            '安全なスコープ内の読解、調査、テスト、可逆な実装はそのまま完了まで続ける。複雑さ、好みの確認、念のための確認だけを理由に停止しない。',
            `実行中に確認が必須になった場合だけ、許可された理由コードの確認行「⚠️ 確認が必要[reason_code]:」を回答本文の先頭に置く。許可コード: ${autonomy.allowedRuntimeReasons.join(', ')}。例: ⚠️ 確認が必要[missing_authority]:`,
            'この自律判断は通常の権限・承認を置き換えません。'
        ]
        : autonomy?.decision === 'escalate'
            ? [
                'Autonomy decision: escalate.',
                `境界操作を実行せず、回答本文の先頭に「⚠️ 確認が必要[${autonomy.reasonCode}]:」を置き、必要な確認を一つだけ求める。`,
                'この自律判断は通常の権限・承認を置き換えません。'
            ]
            : [];
    const internalJournalToolNames = valueProofRolloutEnabled({ initial_route_receipt: receipt }, env)
        ? 'brainbase_judgment_state_recordとbrainbase_judgment_value_proof_record'
        : 'brainbase_judgment_state_record';
    const context = [
        'Brainbase Judgment Resolver Host opened one unresolved judgment episode before model generation. This bootstrap receipt is not a semantic classification or the final episode receipt.',
        ...(surfaceDegraded ? [
            `This Codex thread cannot call ${TURN_RESOLUTION_TOOL_NAME}: its MCP tool surface predates the current Brainbase contract, and the Host recorded that tool failure from the transcript. Do not retry it, do not ask the user a classification question, and do not ask the user to restart; the Host-generated judgment line already reports the degraded state and that a new Codex task restores full judgment routing.`,
            'Continue the user request autonomously under ordinary permissions with the repository workflow and Skills. The bootstrap clarification receipt is superseded by this degraded surface.'
        ] : [
            typeof turnRef === 'string'
                ? `Before answering or using any other tool, call ${TURN_RESOLUTION_TOOL_NAME} exactly once with turn_ref set to ${JSON.stringify(turnRef)} and model_interpretation containing your semantic classification of the user request. The Host saved turn_input in its journal under that reference and the server loads it itself; do not read, print, rebuild, or inline any file, and do not pass turn_input. ${MODEL_INTERPRETATION_SHAPE}`
                : `Before answering or using any other tool, call ${TURN_RESOLUTION_TOOL_NAME} exactly once. Pass turn_input unchanged as ${canonicalJson(args)} and add model_interpretation containing your semantic classification of the user request. ${MODEL_INTERPRETATION_SHAPE}`,
            'Use the returned TurnContract as the immutable route and capability contract for this episode. UserPromptSubmit does not decide whether Brainbase is needed. Keyword signals are safety floors only: they may add obligations or risk, but their absence never removes requirements inferred by the model.',
            'After that call succeeds, the PostToolUse system message names the new Host-generated judgment line; it replaces the bootstrap judgment line below as the first line of the final response.'
        ]),
        ...autonomyInstructions,
        ...(hostAutonomy?.basis === 'prior_escalation_answered' ? [
            '前turnのHost確認に人間が回答済みです。resolve後の判断がrisk_or_externalでも再度確認せず、通常の権限・承認の範囲で要求された操作を実行し、状態はcompletedまたはpendingで記録する。'
        ] : []),
        ...implementationWorkflowInstructions,
        ...requiredCapabilityInstructions,
        ...(journalStopStateRequired(receipt) && valueProofRolloutEnabled({ initial_route_receipt: receipt }, env) ? [
            'Brainbaseが本当に人間判断を必要とした場合、またはHostが直前のStopで不要な確認質問を差し戻した場合だけ、全作業と検証の後にmcp__brainbase__brainbase_judgment_value_proof_recordを1回実行する。continued_without_humanでは、差し戻された質問文を一字一句同じquestion_display_textとして使う。canonical_readbackのsubject_refは実行成果物のrefと実際の取得入力に完全一致させ、結果ありの取得だけを指定する。先行する中断候補がない単なる代理判断ではvalue proofを記録しない。raw tool response、秘密情報、内部監査ログは入れない。',
            'value proofを記録した場合も、その後にmcp__brainbase__brainbase_judgment_state_recordを実行し、状態toolを必ず最後のtool callにする。'
        ] : []),
        ...(journalStopStateRequired(receipt) ? [
            `実装・操作turnの状態は回答本文へ書かない。全作業と検証の完了後、最終回答を作る直前の最後のtool callとしてmcp__brainbase__brainbase_judgment_state_recordを正確に1回実行する。安全な作業が残る間はstatus=pending・pending_safe_work=true、人間確認が必須ならstatus=waiting_human${autonomy?.decision === 'escalate' ? `・runtime_reason_code=${autonomy.reasonCode}としてHost確定理由と一字一句一致させる` : '・runtime_reason_codeを許可された理由コードと一致させる'}、完了時はstatus=completed・pending_safe_work=false・runtime_reason_code=nullを渡す。HTMLコメントや自然文へ状態をコピーしない。`
        ] : []),
        ...(structuredStopStateRequired(receipt) ? [
            '実装・操作turnの実行状態は自然文から推測しません。最終回答の末尾に次の非表示状態を正確に1件だけ置く: <!-- brainbase-stop-state:{"schema_version":"brainbase-stop-state-v1","status":"completed","pending_safe_work":false,"runtime_reason_code":null} -->。安全な作業が残る間はstatusをpending、pending_safe_workをtrueにする。人間確認が必須ならstatusをwaiting_humanにし、runtime_reason_codeを許可された確認理由と一致させる。completedは同一episodeに成功したPostToolUse実行証跡があり、安全な作業が残っていない場合だけ使う。'
        ] : []),
        'Use Brainbase knowledge and retrieval tools repeatedly when later evidence makes another lookup useful; there is no one-call-per-turn limit.',
        ...(surfaceDegraded ? [] : [
            'Use only active_node_definitions in active_edges order. A clarification receipt means ask the clarification selected by the receipt.'
        ]),
        'Normal platform permissions and executor authorization remain in force; the Host does not add a second action-authorization layer.',
        `The final user-facing response for this turn must start with exactly this Host-generated line, before any other text:\n${ownerReferenceLine}`,
        ...(typeof auditContract?.zero_call_display_line === 'string' ? [
            `If this episode records zero actual Brainbase knowledge, retrieval, or business-action calls, add this exact line immediately after the judgment line:\n${auditContract.zero_call_display_line}\n${internalJournalToolNames}は内部journal toolであり、実Brainbase呼び出しとして数えない。これらだけを実行した場合も実呼び出し0回の行を残す。If an actual Brainbase knowledge, retrieval, or business-action call is recorded, omit that zero-call line and use the Host-generated PostToolUse audit lines instead.`
        ] : []),
        'Intermediate commentary may omit the owner-visible audit block. Put the complete audit block only at the start of the final response, after all Brainbase tool calls are known.',
        'Do not alter, translate, summarize, omit, invent, or duplicate an owner-visible audit line. Include every Host-generated PostToolUse audit line after the judgment line in journal commit order and with recorded multiplicity.',
        'It reports a turn-level judgment, not a Brainbase retrieval, action authorization, or completed knowledge retrieval. Actual successful retrievals have separate tool-generated 📚 Brainbase検索 or 📚 Brainbase取得 lines.',
        'PostToolUse records each actual Brainbase call, and Stop finalizes exactly one episode receipt after the tool loop.',
        `The full route receipt stays in the per-session judgment journal and is never printed into model context.`
    ].join('\n');
    return {
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context }
    };
}

function blockedOutput(reason) {
    return {
        continue: false,
        suppressOutput: false,
        stopReason: `Judgment Resolver Host pre-turn failed (${reason}); no model response was generated without judgment.`
    };
}

function stopFailureMessage(reason) {
    if (reason === 'judgment_episode_not_found') {
        return `${ORPHAN_AUDIT_WARNING}（詳細: ${reason}）`;
    }
    return `⚠️ Brainbase監査を確定できませんでした。新しいCodex taskで同じ依頼を再送してください。再発する場合は、Settings → HooksでBrainbaseのユーザーHookを信頼し直してください。（詳細: ${reason}）`;
}

export async function processHookPayload(payload, dependencies = {}) {
    const eventName = payload?.hook_event_name || payload?.hookEventName;
    if (eventName === 'UserPromptSubmit') {
        const episode = await startEpisode(payload, dependencies);
        await dependencies.onEpisodeStarted?.(episode);
        const env = dependencies.env ?? process.env;
        const turnRef = withJudgmentStage('judgment_turn_input_persist_failed', () => persistTurnInput(payload, episode, env));
        return successOutput(
            episode.turn_input, episode.initial_route_receipt, episode.owner_audit, episodeAuditContract(episode),
            env, episode.host_surface ?? null, turnRef, episode.host_autonomy ?? null
        );
    }
    if (eventName === 'PostToolUse') {
        const event = recordBrainbaseToolUse(payload, dependencies);
        if (event?.schema_version === 'brainbase-judgment-orphan-tool-event-v1') {
            return { systemMessage: ORPHAN_TOOL_EVENT_WARNING };
        }
        return typeof event?.system_message === 'string'
            ? { systemMessage: event.system_message }
            : typeof event?.display_line === 'string'
                ? { systemMessage: event.display_line }
                : {};
    }
    if (eventName === 'Stop') {
        await bootstrapDelegatedEpisodeAtStop(payload, dependencies);
        const autonomyOutput = await evaluateAutonomyStop(payload, dependencies);
        if (autonomyOutput) return autonomyOutput;

        let result;
        try {
            result = finalizeEpisode(payload, dependencies);
        } catch (error) {
            if (error?.message !== 'judgment_episode_not_found') throw error;
            return handleOrphanStop(payload, dependencies);
        }
        if (payload.stop_hook_active === true
            && result.output?.decision === 'block'
            && result.auditRepairWasAlreadyActive) {
            throw new Error('judgment_stop_repair_exhausted');
        }
        return result.output;
    }
    return {};
}

async function main() {
    const input = readFileSync(0, 'utf8');
    let payload;
    try { payload = JSON.parse(input || '{}'); } catch { process.stdout.write(`${JSON.stringify(blockedOutput('hook_payload_invalid'))}\n`); return; }
    const eventName = payload.hook_event_name || payload.hookEventName;
    try {
        process.stdout.write(`${JSON.stringify(await processHookPayload(payload))}\n`);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (eventName === 'UserPromptSubmit') {
            process.stdout.write(`${JSON.stringify(blockedOutput(reason))}\n`);
        } else if (eventName === 'PostToolUse') {
            process.stderr.write(`⚠️ Brainbase監査記録に失敗: ${reason}\n`);
            process.exitCode = 1;
        } else if (eventName === 'Stop') {
            const message = stopFailureMessage(reason);
            if (payload.stop_hook_active === true) {
                process.stderr.write(`${message}\n`);
                process.exitCode = 1;
            } else {
                process.stdout.write(`${JSON.stringify({ decision: 'block', reason: message })}\n`);
            }
        } else {
            process.stdout.write('{}\n');
        }
    }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(SCRIPT_PATH)) await main();
