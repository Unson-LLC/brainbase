#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
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

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), '../..');
const DEFAULT_HOST_URL = 'http://127.0.0.1:39002/host/judgment/resolve';
const TRANSIENT_REASONS = new Set([
    'brainbase_api_unavailable',
    'judgment_host_bridge_failed',
    'judgment_host_transport_failed'
]);

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
        || trimmed.startsWith('# AGENTS.md instructions for ')
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
    return { directory, target: join(directory, `${sha256(turnId)}.json`) };
}

function acceptedProjection(receipt) {
    if (!record(receipt) || !record(receipt.classification) || receipt.status !== 'resolved') return null;
    const fields = ['turn_id', 'resolution_id', 'request_digest', 'context_digest', 'plan_digest', 'classification', 'selected_dag_ids'];
    if (fields.some((field) => receipt[field] === undefined)) return null;
    return Object.fromEntries(fields.map((field) => [field, receipt[field]]));
}

function priorReceipts(sessionRef, currentTurnId, env) {
    const { directory, target } = journalPaths(sessionRef, currentTurnId, env);
    let names;
    try { names = readdirSync(directory).filter((name) => name.endsWith('.json')); } catch { return []; }
    return names.filter((name) => name !== basename(target)).flatMap((name) => {
        try {
            const entry = JSON.parse(readFileSync(join(directory, name), 'utf8'));
            const projection = acceptedProjection(entry.receipt);
            return projection ? [{ accepted_at: entry.accepted_at, projection }] : [];
        } catch { return []; }
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
        const response = await fetchImpl(env.BRAINBASE_JUDGMENT_HOST_URL || DEFAULT_HOST_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(args),
            signal: controller.signal
        });
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

const OWNER_EXCERPT_LIMIT = 26;
const PRIOR_EVIDENCE_SOURCES = new Set(['prior_receipt', 'prior_message']);

function sanitizeOwnerExcerpt(value) {
    const redacted = String(value ?? '')
        .replace(/\b(token|api[_-]?key|secret|password)\s*=\s*[^\s]+/giu, '$1=[秘密情報]')
        .replace(/\b(?:sk-[a-z0-9_-]{8,}|ghp_[a-z0-9_]{8,}|github_pat_[a-z0-9_]{8,}|xox[a-z]-[a-z0-9-]{8,}|AIza[a-z0-9_-]{8,})\b/giu, '[秘密情報]')
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/[「」]/gu, ' ')
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

function requiredKnowledgeResolution(receipt) {
    return Array.isArray(receipt?.required_capabilities) && receipt.required_capabilities.some((entry) => (
        entry === 'knowledge.resolve' || entry?.capability === 'knowledge.resolve'
    ));
}

function ownerDecision(receipt) {
    if (requiredKnowledgeResolution(receipt)) return 'Brainbase内検索が必要と判断';
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
        displayLine = `⚠️ Brainbase参照: 「${excerpt || '現在の依頼'}」の対象を特定できず → ${decision}`;
    } else if (receipt?.status === 'needs_policy_resolution') {
        decision = '方針衝突を要確認';
        displayLine = `⚠️ Brainbase参照: 「${excerpt || '現在の依頼'}」を参照 → ${decision}`;
    } else if (receipt?.status && receipt.status !== 'resolved') {
        decision = '状態を要確認';
        displayLine = `⚠️ Brainbase参照: 「${excerpt || '現在の依頼'}」を参照 → ${decision}`;
    } else if (evidence.sourceKind === 'prior_turn_unavailable') {
        decision = '判断証跡を要確認';
        displayLine = `⚠️ Brainbase参照: 参照元の会話を確認できず → ${decision}`;
    } else {
        const prefix = evidence.sourceKind.startsWith('prior_turn') ? '直前の' : '';
        displayLine = `🧠 Brainbase参照: ${prefix}「${excerpt || '現在の依頼'}」を参照 → ${decision} ✓`;
    }

    return {
        schema_version: 'brainbase-owner-audit-v1',
        renderer_version: '1',
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

export function successOutput(args, receipt, ownerAudit = buildOwnerAudit(args, receipt)) {
    const ownerReferenceLine = ownerAudit.display_line;
    const context = [
        'Brainbase Judgment Resolver Host contract was completed before model generation.',
        'This is the only accepted receipt for the current turn. Do not call Judgment Resolver again and do not reclassify the turn.',
        'Use only active_node_definitions in active_edges order. A clarification receipt means ask the clarification selected by the receipt.',
        'Normal platform permissions and executor authorization remain in force; the Host does not add a second action-authorization layer.',
        `The first line of every user-facing response must be exactly this Host-generated line, before any other text:\n${ownerReferenceLine}`,
        'Do not alter, translate, summarize, omit, or repeat that owner-visible line. It reports judgment evidence, not action authorization or completed knowledge retrieval.',
        `Accepted judgment receipt: ${JSON.stringify(receipt)}`
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

async function main() {
    const input = readFileSync(0, 'utf8');
    let payload;
    try { payload = JSON.parse(input || '{}'); } catch { process.stdout.write(`${JSON.stringify(blockedOutput('hook_payload_invalid'))}\n`); return; }
    const eventName = payload.hook_event_name || payload.hookEventName;
    if (eventName !== 'UserPromptSubmit') return;
    try {
        const args = buildJudgmentRequest(payload);
        const adoption = await resolveAndAdoptEntry(args);
        process.stdout.write(`${JSON.stringify(successOutput(args, adoption.receipt, adoption.owner_audit))}\n`);
    } catch (error) {
        process.stdout.write(`${JSON.stringify(blockedOutput(error instanceof Error ? error.message : String(error)))}\n`);
    }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(SCRIPT_PATH)) await main();
