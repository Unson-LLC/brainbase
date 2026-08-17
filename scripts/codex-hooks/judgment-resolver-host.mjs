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
    enqueueJudgmentKnowledgeEvent,
    resolveJudgmentKnowledgeEventOutboxPath
} from '../../server/services/routine-runtime/judgment-event-outbox.js';

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
const DEFAULT_LOCK_WAIT_ATTEMPTS = 300;
const DEFAULT_LOCK_WAIT_MS = 10;
const NO_BRAINBASE_REFERENCE_LINE = '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓';
const CAPABILITY_ACTION_CONTRACTS = Object.freeze({
    'knowledge.resolve': Object.freeze({
        capability: 'knowledge.resolve',
        exactTool: 'mcp__brainbase__brainbase_knowledge_resolve',
        actionDescription: '正本の所在と次の取得経路を選び、回答本文を取得しません',
        distinctFrom: 'Hostが確定したJudgment routeの再分類'
    })
});

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
    if (!transcriptPath) return { messages: [], complete: false };
    let canonicalPath;
    try {
        canonicalPath = realpathSync(transcriptPath);
        if (!statSync(canonicalPath).isFile()) return { messages: [], complete: false };
    } catch {
        return { messages: [], complete: false };
    }
    const roots = transcriptRoots(env);
    if (roots.length === 0 || !roots.some((root) => pathInside(canonicalPath, root))) {
        return { messages: [], complete: false };
    }
    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
    const messages = [];
    let sessionMatched = false;
    let sequence = 0;
    const text = readFileSync(canonicalPath, 'utf8');
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { return { messages: [], complete: false }; }
        const envelope = record(event);
        const eventPayload = record(envelope?.payload);
        if (!envelope || !eventPayload) continue;
        if (envelope.type === 'session_meta') {
            const ids = [eventPayload.id, eventPayload.session_id].filter((value) => typeof value === 'string');
            sessionMatched = sessionMatched || !sessionId || ids.includes(sessionId);
            continue;
        }
        if (envelope.type !== 'response_item' || eventPayload.type !== 'message') continue;
        if (!['user', 'assistant'].includes(String(eventPayload.role))) continue;
        const body = contentText(eventPayload.content);
        if (!body.trim() || isInjectedHostEnvelope(body)) continue;
        const metadata = record(eventPayload.internal_chat_message_metadata_passthrough)
            ?? record(eventPayload.metadata);
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
    return { messages: sessionMatched ? messages : [], complete: sessionMatched };
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
        events: join(directory, `${turnRef}.events`),
        continuation: join(directory, `${turnRef}.continuation.json`),
        final: join(directory, `${turnRef}.final.json`),
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
    const messages = transcript.messages.filter((message) => !(
        message.role === 'user' && message.turn_id === turnId && message.text === request
    ));
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
    return receipt;
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
    verifyOwnerAudit(entry.owner_audit, entry.initial_route_receipt);
    if (entry.audit_contract !== undefined) verifyAuditContract(entry.audit_contract);
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

export async function startEpisode(payload, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
    const identity = payloadIdentity(payload);
    if (!identity) throw new TypeError('UserPromptSubmit requires session_id and turn_id');
    const existing = withJudgmentStage(
        'judgment_episode_existing_read_failed',
        () => existingEpisode(payload, env)
    );
    if (existing) return existing;
    const paths = journalPaths(identity.sessionRef, identity.turnId, env);
    return withJudgmentStage('judgment_episode_transition_failed', () => withEpisodeTransitionLock(paths, async () => {
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
        const entry = withJudgmentStage('judgment_episode_audit_build_failed', () => ({
            schema_version: 'brainbase-judgment-episode-v1',
            state: 'open',
            started_at: new Date().toISOString(),
            request_text_digest: sha256(args.request),
            initial_route_receipt_digest: sha256(canonicalJson(initialRouteReceipt)),
            initial_route_receipt: initialRouteReceipt,
            owner_audit: buildOwnerAudit(args, initialRouteReceipt),
            audit_contract: buildAuditContract(initialRouteReceipt)
        }));
        return withJudgmentStage(
            'judgment_episode_persist_failed',
            () => verifyEpisode(createImmutableJson(paths.episode, entry, 'judgment_episode_start_conflict'))
        );
    }, env, 'judgment_episode_start_timeout'));
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
    return direct;
}

function validCallToolResultEnvelope(value) {
    const item = record(value);
    if (!item || !Array.isArray(item.content) || item.content.length === 0) return false;
    return item.content.every((block) => {
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

function responseSucceeded(response, { allowTransportSuccess = false, allowExplicitSuccess = true, semanticSuccess = false } = {}) {
    const items = nestedRecords(response);
    if (items.length === 0) return false;
    const failed = items.some((item) => (
        Object.hasOwn(item, 'Err') || item.isError === true
        || item.is_error === true
        || item.ok === false
        || item.success === false
        || ['error', 'unavailable', 'failed', 'failure'].includes(String(item.status).toLowerCase())
        || (item.error !== undefined && item.error !== null && item.error !== false && item.status !== 'ok')
    ));
    if (failed) return false;
    const trustedEnvelopeItems = nestedRecords(response, 0, { parseContent: false });
    return semanticSuccess || trustedEnvelopeItems.some((item) => (
        (allowTransportSuccess && validCallToolResultEnvelope(item.Ok))
        || (allowTransportSuccess && validCallToolResultEnvelope(item))
        || (allowExplicitSuccess && (item.isError === false || item.is_error === false || item.ok === true || item.success === true || ['ok', 'success', 'completed'].includes(String(item.status).toLowerCase())))
    ));
}

function responseCount(response) {
    return nestedRecords(response)
        .map((item) => item.count)
        .find((count) => Number.isSafeInteger(count) && count >= 0) ?? null;
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

function eventKind(toolName) {
    const exactToolName = String(toolName);
    if (exactToolName === CAPABILITY_ACTION_CONTRACTS['knowledge.resolve'].exactTool) return 'route';
    const name = exactToolName.replace(/^mcp__brainbase__/u, '');
    if (/(?:create|update|transition|delete|write|record|link|unlink)/iu.test(name)) return 'write';
    if (/search/iu.test(name)) return 'search';
    if (/(?:get|list|resolve|context|read)/iu.test(name)) return 'retrieve';
    return 'call';
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
    if (!success || !data) return `⚠️ Brainbase参照先: 「${query}」→ 選択に失敗`;
    const exclusions = knowledgeExclusionDisplay(data);
    if (data.status === 'unconfirmed') {
        return `⚠️ Brainbase参照先: 「${query}」→ 参照先を確定できず${exclusions ? `／除外: ${exclusions}` : ''}`;
    }
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
    if (!identity || !toolUseId || !/^mcp__brainbase__/u.test(toolName)) return null;
    if (!existingEpisode(payload, env)) return null;
    const paths = journalPaths(identity.sessionRef, identity.turnId, env);
    const inputValue = payload.tool_input === undefined ? null : payload.tool_input;
    const responseValue = payload.tool_response === undefined ? null : payload.tool_response;
    const inputDigest = sha256(canonicalJson(inputValue));
    const responseDigest = sha256(canonicalJson(responseValue));
    const fingerprint = sha256(canonicalJson({ tool_name: toolName, tool_use_id: toolUseId, input_digest: inputDigest, response_digest: responseDigest }));
    const callScope = toolCallScope(toolName, inputValue);
    const resultCount = responseCount(responseValue);
    const kind = eventKind(toolName);
    const resolution = kind === 'route' ? knowledgeResolutionData(responseValue) : null;
    const taskResult = kind === 'write' ? taskResultData(responseValue) : null;
    const success = responseSucceeded(responseValue, {
        allowTransportSuccess: ['search', 'retrieve'].includes(kind),
        allowExplicitSuccess: !['write', 'route'].includes(kind),
        semanticSuccess: Boolean(resolution || taskResult)
    });
    const qualifies = kind === 'route' && success && Boolean(resolution);
    const safeMetadata = resolution ? {
        resolution_id: resolution.resolution_id,
        status: resolution.status,
        source_class: resolution.source_class ?? null,
        canonical_ref: record(resolution.canonical_location) ? {
            repository: typeof resolution.canonical_location.repository === 'string' ? resolution.canonical_location.repository : null,
            path: typeof resolution.canonical_location.path === 'string' ? resolution.canonical_location.path : null
        } : null,
        retrieval_capability: typeof resolution.retrieval_capability === 'string' ? resolution.retrieval_capability : null
    } : {};
    const operationLabel = kind === 'write'
        ? '書込'
        : kind === 'search'
            ? '検索'
            : kind === 'retrieve'
                ? '取得'
                : '呼出';
    const displayLine = kind === 'route'
        ? routeDisplayLine(inputValue, resolution, success)
        : `${success ? '📚' : '⚠️'} Brainbase${operationLabel}: ${sanitizeToolExcerpt(toolName.replace(/^mcp__brainbase__/u, ''))}「${callScope}」→ ${success ? `${resultCount === null ? '' : `${resultCount}件・`}正常応答を確認 ✓` : '失敗または結果不明'}`;
    return withEpisodeTransitionLock(paths, () => {
        const episode = existingEpisode(payload, env);
        if (!episode) return null;
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
        const entry = {
            schema_version: 'brainbase-judgment-tool-event-v1',
            recorded_at: new Date().toISOString(),
            event_sequence: eventSequence,
            tool_name: toolName,
            tool_use_id: toolUseId,
            event_kind: kind,
            success,
            satisfies: qualifies ? ['knowledge.resolve'] : [],
            input_digest: inputDigest,
            response_digest: responseDigest,
            event_fingerprint: fingerprint,
            query_excerpt: callScope,
            safe_metadata: safeMetadata,
            display_line: displayLine
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

function buildAuditContract(receipt) {
    const zeroCallDisplayLine = requiredKnowledgeResolution(receipt)
        ? null
        : NO_BRAINBASE_REFERENCE_LINE;
    return {
        schema_version: 'brainbase-owner-audit-contract-v1',
        zero_call_display_line: zeroCallDisplayLine,
        zero_call_display_line_digest: zeroCallDisplayLine === null ? null : sha256(zeroCallDisplayLine),
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
    if (contract.repair_body_policy !== 'preserve') {
        throw new Error('judgment_owner_audit_repair_policy_invalid');
    }
    return contract;
}

function episodeAuditContract(episode) {
    return episode.audit_contract === undefined ? null : verifyAuditContract(episode.audit_contract);
}

function requiredAuditLines(episode, events) {
    const auditContract = episodeAuditContract(episode);
    const zeroCallLines = events.length === 0 && typeof auditContract?.zero_call_display_line === 'string'
        ? [auditContract.zero_call_display_line]
        : [];
    return [episode.owner_audit.display_line, ...zeroCallLines, ...events.map((event) => event.display_line)];
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

function normalizedAnswerBody(answer, expectedLines) {
    if (typeof answer !== 'string') return null;
    const auditLines = new Set(expectedLines.map((line) => line.replace(/[ \t]+$/u, '')));
    const bodyLines = answer.replaceAll('\r\n', '\n').split('\n')
        .map((line) => line.replace(/[ \t]+$/u, ''))
        .filter((line) => !auditLines.has(line));
    while (bodyLines.length > 0 && (
        bodyLines[0] === ''
        || /^(?:🧠 判断参照:|📚 Brainbase|⚠️ Brainbase)/u.test(bodyLines[0])
    )) bodyLines.shift();
    while (bodyLines.at(-1) === '') bodyLines.pop();
    return bodyLines.join('\n');
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
        return entry;
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

export function finalizeEpisode(payload, { env = process.env } = {}) {
    const identity = payloadIdentity(payload);
    if (!identity) throw new Error('judgment_episode_identity_missing');
    const episode = existingEpisode(payload, env);
    if (!episode) throw new Error('judgment_episode_not_found');
    const paths = journalPaths(identity.sessionRef, identity.turnId, env);
    return withEpisodeTransitionLock(paths, () => finalizeEpisodeLocked(payload, episode, paths, env), env);
}

function finalizeEpisodeLocked(payload, episode, paths, env) {
    const events = episodeEvents(paths);
    const completedAuditOutput = () => ({
        systemMessage: requiredAuditLines(episode, events).join('\n')
    });
    const finalized = existingFinal(paths, episode);
    if (finalized) {
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
        return { output: completedAuditOutput(), final: finalized };
    }
    const requiredKnowledge = requiredKnowledgeResolution(episode.initial_route_receipt);
    const qualifyingEvents = events.filter((entry) => entry.success && entry.satisfies.includes('knowledge.resolve'));
    const missingKnowledge = requiredKnowledge && qualifyingEvents.length === 0;
    const answer = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : null;
    const expectedAuditLines = requiredAuditLines(episode, events);
    const missingOwnerAudit = !answerContainsExactAuditPrefix(answer, expectedAuditLines);
    let existingContinuation = null;
    try { existingContinuation = readJson(paths.continuation); } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    const answerBodyBinding = activeAnswerBodyBinding(existingContinuation, expectedAuditLines);
    const missingAnswerBody = !answerBodyMatchesBinding(answer, expectedAuditLines, answerBodyBinding);
    if (missingKnowledge || missingOwnerAudit || missingAnswerBody) {
        const missingCapabilities = [
            ...(missingKnowledge ? ['knowledge.resolve'] : []),
            ...(missingOwnerAudit ? ['owner.audit.display'] : []),
            ...(missingAnswerBody ? ['answer.body.preservation'] : [])
        ];
        let marker = existingContinuation;
        if (!marker) {
            const shouldBindAnswerBody = !missingKnowledge
                && missingOwnerAudit
                && episodeAuditContract(episode)?.repair_body_policy === 'preserve';
            marker = createImmutableJson(paths.continuation, {
                schema_version: 'brainbase-judgment-continuation-v2',
                requested_at: new Date().toISOString(),
                missing_capabilities: missingCapabilities,
                ...(shouldBindAnswerBody ? {
                    answer_body_binding: buildAnswerBodyBinding(answer, expectedAuditLines)
                } : {})
            }, 'judgment_episode_continuation_conflict');
        }
        const reasons = [
            ...(missingKnowledge ? [capabilityActionInstruction(
                CAPABILITY_ACTION_CONTRACTS['knowledge.resolve'],
                { repair: true }
            )] : []),
            ...(missingOwnerAudit ? [
                `最終回答の先頭に次の監査行をそのまま、この順番で各1回だけ表示する:\n${expectedAuditLines.join('\n')}`
            ] : []),
            ...((missingAnswerBody || (!missingKnowledge && missingOwnerAudit && marker.answer_body_binding)) ? [
                '最初に差し戻された回答の監査行以外の本文を、削除・要約・置換せずそのまま残す'
            ] : [])
        ];
        const reasonSequence = reasons
            .map((reason) => reason.replace(/。$/u, ''))
            .join('。その後');
        return {
            output: {
                decision: 'block',
                reason: `Brainbase judgment episodeを完了する前に${reasonSequence}。監査行の後に、元の回答本文をそのまま続けてください。`
            },
            continuation: marker,
            final: null
        };
    }
    const safeAnswer = sanitizeJudgmentAnswer(answer);
    const entry = {
        schema_version: 'brainbase-judgment-episode-final-v2',
        finalized_at: new Date().toISOString(),
        completion_status: 'complete',
        protocol_status: 'audit_protocol_complete',
        content_verification_status: 'not_evaluated',
        initial_route_receipt_digest: episode.initial_route_receipt_digest,
        event_count: events.length,
        qualifying_event_count: qualifyingEvents.length,
        event_set_digest: orderedEventSetDigest(events),
        owner_audit_complete: !missingOwnerAudit,
        owner_audit_line_count: expectedAuditLines.length,
        answer_digest: answer === null ? null : sha256(answer),
        ...(safeAnswer?.sensitive
            ? { redaction_status: 'needs_redaction' }
            : safeAnswer?.summary
                ? { final_summary: safeAnswer.summary }
                : {})
    };
    const final = createImmutableJson(paths.final, entry, 'judgment_episode_final_conflict');
    enqueueFinalKnowledgeEvent(payload, final, env);
    return { output: completedAuditOutput(), final };
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

function ownerDecision(receipt) {
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

export function buildOwnerAudit(args, receipt, { historicalExact = true } = {}) {
    const evidence = ownerEvidenceSource(args, receipt);
    const excerpt = sanitizeOwnerExcerpt(evidence.text);
    const dagIds = Array.isArray(receipt?.selected_dag_ids) ? receipt.selected_dag_ids : [];
    let decision = ownerDecision(receipt);
    let displayLine;

    if (receipt?.status === 'needs_classification' || dagIds.includes('clarification.v1')) {
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

export function successOutput(
    args,
    receipt,
    ownerAudit = buildOwnerAudit(args, receipt),
    auditContract = buildAuditContract(receipt)
) {
    const ownerReferenceLine = ownerAudit.display_line;
    const requiredCapabilityInstructions = requiredCapabilityActionContracts(receipt)
        .map((contract) => capabilityActionInstruction(contract));
    const context = [
        'Brainbase Judgment Resolver Host opened one judgment episode before model generation. The route receipt fixes the current intent and active DAG for this episode; it is not the final episode receipt.',
        'The Host-fixed initial route and classification are immutable for this episode; do not recalculate or change them.',
        ...requiredCapabilityInstructions,
        'Use Brainbase knowledge and retrieval tools repeatedly when later evidence makes another lookup useful; there is no one-call-per-turn limit.',
        'Use only active_node_definitions in active_edges order. A clarification receipt means ask the clarification selected by the receipt.',
        'Normal platform permissions and executor authorization remain in force; the Host does not add a second action-authorization layer.',
        `The final user-facing response for this turn must start with exactly this Host-generated line, before any other text:\n${ownerReferenceLine}`,
        ...(typeof auditContract?.zero_call_display_line === 'string' ? [
            `If this episode records zero actual Brainbase calls, add this exact line immediately after the judgment line:\n${auditContract.zero_call_display_line}\nIf any Brainbase call is recorded, omit that zero-call line and use the Host-generated PostToolUse audit lines instead.`
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
        return `⚠️ Brainbase監査を確定できませんでした。このtaskはBrainbase Hookを有効にする前に始まった可能性があります。新しいCodex taskを作り、同じ依頼を送ってください。（詳細: ${reason}）`;
    }
    return `⚠️ Brainbase監査を確定できませんでした。新しいCodex taskで同じ依頼を再送してください。再発する場合は、Settings → HooksでBrainbaseのユーザーHookを信頼し直してください。（詳細: ${reason}）`;
}

export async function processHookPayload(payload, dependencies = {}) {
    const eventName = payload?.hook_event_name || payload?.hookEventName;
    if (eventName === 'UserPromptSubmit') {
        const episode = await startEpisode(payload, dependencies);
        await dependencies.onEpisodeStarted?.(episode);
        return successOutput(
            {}, episode.initial_route_receipt, episode.owner_audit, episodeAuditContract(episode)
        );
    }
    if (eventName === 'PostToolUse') {
        const event = recordBrainbaseToolUse(payload, dependencies);
        return event ? { systemMessage: event.display_line } : {};
    }
    if (eventName === 'Stop') {
        const output = finalizeEpisode(payload, dependencies).output;
        if (payload.stop_hook_active === true && output?.decision === 'block') {
            throw new Error('judgment_stop_repair_exhausted');
        }
        return output;
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
            process.stdout.write(`${JSON.stringify({ systemMessage: `⚠️ Brainbase監査記録に失敗: ${reason}` })}\n`);
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
