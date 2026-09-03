import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import test from 'node:test';
import { verifyOwnerVisibleSource } from '../../scripts/lib/codex-owner-visible-readback.mjs';

const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex');
const JOURNAL_ROOT = join(CODEX_HOME, 'var', 'judgment-resolver');
const EPISODE_PATH = process.env.BRAINBASE_JUDGMENT_DELEGATION_E2E_EPISODE_PATH || '';
const TRANSCRIPT_PATH = process.env.BRAINBASE_JUDGMENT_DELEGATION_E2E_TRANSCRIPT_PATH || '';
const EXPECTED_HEAD = process.env.BRAINBASE_JUDGMENT_DELEGATION_E2E_EXPECTED_HEAD || '';
const EXPECTED_SOURCE_THREAD_ID = process.env.BRAINBASE_JUDGMENT_DELEGATION_E2E_SOURCE_THREAD_ID || '';
const OWNER_VISIBLE_PATH = process.env.BRAINBASE_JUDGMENT_DELEGATION_E2E_OWNER_VISIBLE_PATH || '';
const OWNER_VISIBLE_ROOT = join(JOURNAL_ROOT, 'owner-visible-readback');
const OWNER_VISIBLE_SCHEMA = 'brainbase-owner-visible-readback-v1';

function readJson(path: string) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function digest(value: unknown) {
    return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function boundPath(root: string, path: string, suffix: string) {
    if (!path || !isAbsolute(path) || !existsSync(path) || !path.endsWith(suffix)) return false;
    const child = relative(realpathSync(root), realpathSync(path));
    return child !== '' && !child.startsWith('..') && !isAbsolute(child);
}

function ownerVisiblePathIsBound(path: string) {
    if (!path || !isAbsolute(path) || !existsSync(path)) return false;
    try {
        const canonicalRoot = realpathSync(OWNER_VISIBLE_ROOT);
        const canonicalPath = realpathSync(path);
        if (!statSync(canonicalPath).isFile()) return false;
        const child = relative(canonicalRoot, canonicalPath);
        return child !== ''
            && !child.startsWith('..')
            && !isAbsolute(child)
            && canonicalPath.endsWith('.json');
    } catch {
        return false;
    }
}

function exactSha256(value: string) {
    return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function sessionMetaIdentity(entries: Array<Record<string, any>>) {
    const meta = entries.find((entry) => entry?.type === 'session_meta');
    const taskId = meta?.payload?.id;
    const createdAt = meta?.payload?.timestamp || meta?.timestamp;
    assert.equal(typeof taskId, 'string', 'session_meta.payload.id must bind the delegated owner-visible task');
    assert.ok(taskId.trim(), 'session_meta.payload.id must not be empty');
    assert.equal(typeof createdAt, 'string', 'session_meta must contain a task creation timestamp');
    assert.ok(Number.isFinite(Date.parse(createdAt)), 'session_meta task creation timestamp must be valid');
    return { taskId, createdAt };
}

function assertOwnerVisibleReadback({
    path,
    taskId,
    turnId,
    journalEventFingerprint,
    capturedAfter,
    expectedLines
}: {
    path: string;
    taskId: string;
    turnId: string;
    journalEventFingerprint: string;
    capturedAfter: string;
    expectedLines: string[];
}) {
    assert.ok(
        ownerVisiblePathIsBound(path),
        `Owner-visible readback must be one JSON artifact under ${OWNER_VISIBLE_ROOT}`
    );
    const artifact = readJson(realpathSync(path));
    assert.equal(artifact.schema_version, OWNER_VISIBLE_SCHEMA);
    assert.equal(artifact.source, 'codex_event_stream', 'Owner-visible readback must come from the Codex event stream');
    verifyOwnerVisibleSource(artifact);
    assert.equal(artifact.task_id, taskId, 'Owner-visible readback must bind session_meta.payload.id');
    assert.equal(artifact.turn_id, turnId, 'Owner-visible readback must bind the current judgment turn');
    assert.equal(typeof artifact.event_id, 'string', 'Owner-visible readback must retain the source event identity');
    assert.ok(artifact.event_id.trim(), 'Owner-visible source event identity must not be empty');
    assert.ok(artifact.event_id.length <= 256, 'Owner-visible source event identity must be bounded');
    assert.doesNotMatch(artifact.event_id, /[\r\n]/u, 'Owner-visible source event identity must be one line');
    assert.equal(
        typeof artifact.final_event_fingerprint,
        'string',
        'Owner-visible readback must retain the final journal event fingerprint'
    );
    assert.match(
        artifact.final_event_fingerprint,
        /^[0-9a-f]{64}$/u,
        'Owner-visible final_event_fingerprint must be a journal event fingerprint'
    );
    assert.equal(
        artifact.final_event_fingerprint,
        journalEventFingerprint,
        'Owner-visible readback must bind the final journal event fingerprint'
    );
    assert.notEqual(
        artifact.event_id,
        artifact.final_event_fingerprint,
        'Owner-visible event_id is the source identity, not a copied journal fingerprint'
    );
    assert.equal(typeof artifact.captured_at, 'string', 'Owner-visible readback must record captured_at');
    const capturedAt = Date.parse(artifact.captured_at);
    const taskCreatedAt = Date.parse(capturedAfter);
    assert.ok(Number.isFinite(capturedAt), 'Owner-visible captured_at must be a valid timestamp');
    assert.ok(Number.isFinite(taskCreatedAt), 'Task creation timestamp must be valid before owner readback');
    assert.ok(capturedAt >= taskCreatedAt, 'Owner-visible readback must be captured after the bound task started');
    assert.ok(capturedAt <= Date.now() + 5 * 60 * 1000, 'Owner-visible readback must not be from the future');
    assert.equal(typeof artifact.system_message, 'string', 'Owner-visible readback must retain exact system_message');
    assert.equal(artifact.occurrences, 1, 'Owner-visible system_message must occur exactly once');
    assert.match(artifact.system_message_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(
        artifact.system_message_digest,
        exactSha256(artifact.system_message),
        'Owner-visible digest must be sha256 of the exact system_message text'
    );
    assert.ok(Array.isArray(expectedLines) && expectedLines.length > 0, 'Expected owner audit lines must be explicit');
    const systemLines = artifact.system_message.split('\n');
    let previousIndex = -1;
    for (const [ordinal, line] of expectedLines.entries()) {
        const index = systemLines.indexOf(line, previousIndex + 1);
        assert.ok(index >= 0, `Expected owner audit line ${ordinal + 1} is missing or out of order: ${line}`);
        previousIndex = index;
    }
    for (const line of new Set(expectedLines)) {
        assert.equal(
            systemLines.filter((candidate: string) => candidate === line).length,
            expectedLines.filter((candidate) => candidate === line).length,
            `Expected owner audit line must have the Host event multiplicity exactly once: ${line}`
        );
    }
    assert.equal(
        artifact.system_message.match(/Brainbase判断レシート/gu)?.length ?? 0,
        1,
        'Delegated owner-visible readback must contain Brainbase判断レシート exactly once'
    );
    const receiptIndex = systemLines.findIndex((line: string) => line.includes('Brainbase判断レシート'));
    assert.ok(receiptIndex > previousIndex, 'Judgment receipt must follow the owner audit block');
}

function transcriptEntries() {
    return readFileSync(TRANSCRIPT_PATH, 'utf8').split('\n').flatMap((line) => (
        line.trim() ? [JSON.parse(line)] : []
    ));
}

function turnMetadata(payload: Record<string, unknown>) {
    return (payload.internal_chat_message_metadata_passthrough || payload.metadata || {}) as Record<string, unknown>;
}

function finalAnswer(entries: Array<Record<string, any>>, turnId: string) {
    const answers = entries.flatMap((entry) => {
        const payload = entry?.type === 'response_item' ? entry.payload : null;
        const metadata = payload ? turnMetadata(payload) : {};
        if (payload?.type !== 'message' || payload.role !== 'assistant'
            || metadata.turn_id !== turnId || metadata.phase !== 'final_answer') return [];
        const text = Array.isArray(payload.content)
            ? payload.content.filter((part: any) => part?.type === 'output_text').map((part: any) => part.text).join('\n')
            : '';
        return text ? [text] : [];
    });
    assert.ok(answers.length > 0, `No final assistant response for delegated turn ${turnId}`);
    return answers.at(-1) as string;
}

test('delegated fresh task proves post-generation recovery without impersonating UserPromptSubmit', () => {
    assert.match(EXPECTED_HEAD, /^[0-9a-f]{40}$/u, 'Expected deployed HEAD must be explicit');
    assert.ok(EXPECTED_SOURCE_THREAD_ID, 'Expected source task id must be explicit');
    assert.ok(boundPath(JOURNAL_ROOT, EPISODE_PATH, '.episode.json'), 'Episode must be owner-journal evidence');
    assert.ok(boundPath(join(CODEX_HOME, 'sessions'), TRANSCRIPT_PATH, '.jsonl'), 'Transcript must be Codex session evidence');
    const currentHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(currentHead.status, 0, currentHead.stderr || 'Unable to resolve current HEAD');
    assert.equal(currentHead.stdout.trim(), EXPECTED_HEAD, 'Delegated live evidence must target the checkout under test');

    const episode = readJson(EPISODE_PATH);
    const turnId = episode.initial_route_receipt?.turn_id;
    assert.ok(turnId, 'Recovered episode must retain its delegated turn id');
    assert.equal(episode.episode_origin, 'stop_delegation_recovery');
    assert.equal(episode.route_application, 'post_generation_recovery');
    assert.equal(episode.initial_route_receipt?.status, 'resolved');

    const entries = transcriptEntries();
    const taskIdentity = sessionMetaIdentity(entries);
    const delegationOutputs = entries.flatMap((entry) => {
        const payload = entry?.type === 'response_item' ? entry.payload : null;
        const metadata = payload ? turnMetadata(payload) : {};
        if (payload?.type !== 'function_call_output'
            || !['create_thread', 'send_message_to_thread'].includes(payload.name)
            || payload.namespace !== 'codex_app' || metadata.turn_id !== turnId) return [];
        const match = String(payload.output || '').match(
            /^<codex_delegation>\s*<source_thread_id>([^<]+)<\/source_thread_id>\s*<input>([\s\S]+)<\/input>\s*<\/codex_delegation>$/u
        );
        return match ? [{ sourceThreadId: match[1], input: match[2] }] : [];
    });
    assert.equal(delegationOutputs.length, 1, 'Exactly one complete current-turn delegation envelope is required');
    assert.equal(delegationOutputs[0].sourceThreadId, EXPECTED_SOURCE_THREAD_ID);
    assert.ok(delegationOutputs[0].input.trim(), 'Delegated input must not be empty');

    const eventDirectory = EPISODE_PATH.replace(/\.episode\.json$/u, '.events');
    const events = readdirSync(eventDirectory)
        .filter((name) => name.endsWith('.json'))
        .map((name) => readJson(join(eventDirectory, name)))
        .sort((left, right) => left.event_sequence - right.event_sequence);
    const successfulEvidence = events.filter((event) => event.success && !['state', 'value_proof'].includes(event.event_kind));
    const executions = successfulEvidence.filter((event) => ['execution', 'write'].includes(event.event_kind));
    const readbacks = successfulEvidence.filter((event) => ['search', 'retrieve'].includes(event.event_kind));
    const valueProofEvents = events.filter((event) => event.success && event.event_kind === 'value_proof');
    const stateEvents = events.filter((event) => event.success && event.event_kind === 'state');
    assert.ok(executions.length > 0, 'Delegated recovery must retain a successful bounded update event');
    assert.ok(readbacks.length > 0, 'Delegated recovery must retain a successful canonical readback');
    assert.equal(valueProofEvents.length, 1, 'Delegated continuation canary must record exactly one value proof');
    assert.equal(stateEvents.length, 1, 'Delegated completion must record exactly one final state event');
    assert.equal(events.at(-1)?.event_kind, 'state', 'Judgment state must be the final tool event');

    const valueProof = readJson(EPISODE_PATH.replace(/\.episode\.json$/u, '.value-proof.json'));
    const final = readJson(EPISODE_PATH.replace(/\.episode\.json$/u, '.final.json'));
    assert.equal(valueProof.state, 'outcome_verified');
    assert.equal(final.completion_status, 'complete');
    assert.equal(final.episode_origin, 'stop_delegation_recovery');
    assert.equal(final.route_application, 'post_generation_recovery');
    assert.equal(final.value_proof_state, 'outcome_verified');
    assert.equal(final.value_proof_digest, digest(valueProof));
    assert.equal(final.owner_audit_source, 'stop_hook_system_message');
    assert.equal(final.stop_state?.status, 'completed');
    assert.equal(final.stop_state?.source, 'journal');
    assert.equal(final.autonomy_continuation?.status, 'completed');
    assert.equal(final.autonomy_continuation?.trigger_code, 'unnecessary_user_question');
    const finalizedAt = Date.parse(final.finalized_at);
    assert.ok(Number.isFinite(finalizedAt), 'Final receipt must retain a valid timestamp');
    assert.ok(Date.now() - finalizedAt <= 60 * 60 * 1000, 'Delegated live evidence must be finalized within one hour');

    const executionIds = new Set(executions.map((event) => event.tool_use_id));
    const readbackIds = new Set(readbacks.map((event) => event.tool_use_id));
    const proofInput = valueProofEvents[0]?.safe_metadata?.value_proof;
    const proofRefs = proofInput?.outcome?.evidence_refs || [];
    const executionRef = proofRefs.find((ref: any) => ref.kind === 'tool_event' && executionIds.has(ref.tool_use_id));
    const readbackRef = proofRefs.find((ref: any) => ref.kind === 'canonical_readback' && readbackIds.has(ref.tool_use_id));
    assert.ok(executionRef, 'Value proof must bind tool_event to execution/write evidence');
    assert.ok(readbackRef, 'Value proof must bind canonical_readback to search/retrieve evidence');
    assert.notEqual(executionRef.tool_use_id, readbackRef.tool_use_id, 'Update and readback must be different events');
    const executionEvent = executions.find((event) => event.tool_use_id === executionRef.tool_use_id);
    const readbackEvent = readbacks.find((event) => event.tool_use_id === readbackRef.tool_use_id);
    assert.ok(executionEvent, 'Referenced update event must exist');
    assert.ok(readbackEvent, 'Referenced canonical readback event must exist');
    assert.equal(executionRef.subject_ref, readbackRef.subject_ref, 'Update and readback must bind the same artifact');
    assert.ok(executionEvent.event_sequence < readbackEvent.event_sequence, 'Canonical readback must follow the update');

    const rendered = finalAnswer(entries, turnId);
    const expectedAudit = [episode.owner_audit.display_line, ...events.flatMap((event) => event.display_line ? [event.display_line] : [])];
    assertOwnerVisibleReadback({
        path: OWNER_VISIBLE_PATH,
        taskId: taskIdentity.taskId,
        turnId,
        journalEventFingerprint: events.at(-1)?.event_fingerprint || '',
        capturedAfter: taskIdentity.createdAt,
        expectedLines: expectedAudit
    });
    const renderedLines = rendered.replaceAll('\r\n', '\n').split('\n');
    for (const line of new Set(expectedAudit)) {
        assert.equal(
            renderedLines.filter((candidate) => candidate === line).length,
            0,
            `Stop systemMessage owns the delegated audit surface; the assistant body must not duplicate it: ${line}`
        );
    }
    assert.equal(
        rendered.match(/Brainbase判断レシート/gu)?.length ?? 0,
        0,
        'The Host-rendered judgment receipt must not be duplicated in the assistant body'
    );
    assert.equal(
        final.autonomy_continuation?.interruption_candidate?.resolution,
        'continued_without_human',
        'Value proof must be bound to an actual Host continuation recorded in the final receipt'
    );
    assert.notEqual(episode.route_application, 'pre_generation', 'Stop recovery must never claim pre-generation guidance');
});
