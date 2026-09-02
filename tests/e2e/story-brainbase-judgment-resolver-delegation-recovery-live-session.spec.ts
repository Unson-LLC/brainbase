import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import test from 'node:test';

const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex');
const JOURNAL_ROOT = join(CODEX_HOME, 'var', 'judgment-resolver');
const EPISODE_PATH = process.env.BRAINBASE_JUDGMENT_DELEGATION_E2E_EPISODE_PATH || '';
const TRANSCRIPT_PATH = process.env.BRAINBASE_JUDGMENT_DELEGATION_E2E_TRANSCRIPT_PATH || '';
const EXPECTED_HEAD = process.env.BRAINBASE_JUDGMENT_DELEGATION_E2E_EXPECTED_HEAD || '';
const EXPECTED_SOURCE_THREAD_ID = process.env.BRAINBASE_JUDGMENT_DELEGATION_E2E_SOURCE_THREAD_ID || '';

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
    assert.equal(final.stop_state?.status, 'completed');
    assert.equal(final.stop_state?.source, 'journal');
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
    assert.deepEqual(rendered.replaceAll('\r\n', '\n').split('\n').slice(0, expectedAudit.length), expectedAudit);
    assert.match(rendered, /🔁 自律継続:/u, 'Value proof must be bound to an actual Host continuation');
    assert.notEqual(episode.route_application, 'pre_generation', 'Stop recovery must never claim pre-generation guidance');
});
