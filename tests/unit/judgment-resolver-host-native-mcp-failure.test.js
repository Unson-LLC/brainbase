import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildJudgmentRequest, canonicalJson, processHookPayload, reconcileNativeMcpFailures, recordBrainbaseToolUse, readEpisodeAudit } from '../../scripts/codex-hooks/judgment-resolver-host.mjs';
const roots = [];
const hash = value => createHash('sha256').update(value).digest('hex');
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'judgment-native-mcp-')); roots.push(root);
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'), BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS: root,
        BRAINBASE_JUDGMENT_START_FAILURE_MODE: 'diagnostic_continue', BRAINBASE_JUDGMENT_CANARY_CWD: process.cwd() };
    const payload = { hook_event_name: 'UserPromptSubmit', session_id: 'session', turn_id: 'turn', prompt: 'Inspect evidence', cwd: process.cwd() };
    const status = 'resolved', autonomy = 'continue';
    const args = buildJudgmentRequest(payload, { env });
    const receipt = { resolution_id: 'test', turn_id: args.turn_id, request_digest: hash(canonicalJson(args)), context_digest: hash(canonicalJson(args.conversation_context)),
        status, autonomy_decision: autonomy, autonomy_reason_code: autonomy === 'continue' ? 'routine_in_scope' : status === 'needs_classification' ? 'classification_missing' : 'risk_or_external', allowed_runtime_escalation_reasons: autonomy === 'continue' ? ['irreversible_action', 'missing_authority', 'owner_value_choice', 'required_input_unavailable', 'evidenced_terminal_blocker'] : [], host_binding: { status: 'managed' }, classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] }, active_node_definitions: [], autonomy_policy_ids: [] };
    await processHookPayload(payload, { env, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ management_status: 'managed', receipt }) }) });

    const entries = [
        { type: 'session_meta', payload: { id: 'session', session_id: 'session' } },
        { type: 'turn_context', payload: { turn_id: 'turn', root_turn_id: 'turn' } },
        { type: 'event_msg', payload: { type: 'item_completed', thread_id: 'session', turn_id: 'turn', item: {
            type: 'McpToolCall', id: 'exec-native-1', server: 'brainbase', tool: 'search', arguments: { query: '' }, status: 'failed',
            result: { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: { code: 'graph_retrieval_input_invalid', message: 'private upstream error' } }) }], isError: true }
        } } }
    ];
    payload.transcript_path = join(root, 'session.jsonl'); payload.hook_event_name = 'PreToolUse';
    const save = () => writeFileSync(payload.transcript_path, entries.map(x => JSON.stringify(x)).join('\n') + '\n'); save();
    const directory = join(root, 'journal', hash('session'), `${hash('turn')}.events`);
    const events = () => existsSync(directory) ? readdirSync(directory).map(n => JSON.parse(readFileSync(join(directory, n), 'utf8'))).sort((a,b)=>a.event_sequence-b.event_sequence) : [];
    return { root, env, payload, entries, save, events };
}
it('reconciles failed native search before assessment and audit read, idempotently', async () => {
    const f = await fixture();
    await processHookPayload(f.payload, { env: f.env });
    expect(f.events()).toHaveLength(1);
    expect(f.events()[0]).toMatchObject({ tool_use_id: 'exec-native-1', event_kind: 'search', success: false, satisfies: [] });
    expect(f.events()[0].safe_metadata.retrieval_outcome).toBeNull();
    expect(JSON.stringify(f.events())).not.toContain('private upstream error');
    const assessment = { status: 'insufficient', reference_ids: [], reason: 'Search failed' };
    recordBrainbaseToolUse({ ...f.payload, hook_event_name: 'PostToolUse', tool_name: 'mcp__brainbase__brainbase_knowledge_evidence_record', tool_use_id: 'assessment', tool_input: assessment,
        tool_response: { status: 'ok', data: { schema_version: 'brainbase-knowledge-evidence-assessment-v1', ...assessment } } }, { env: f.env });
    await processHookPayload(f.payload, { env: f.env });
    expect(f.events().map(e=>e.event_kind)).toEqual(['search', 'evidence']);
    const before = f.events();
    const audit = readEpisodeAudit(`${hash('session')}/${hash('turn')}`, { env: f.env });
    expect(audit.prefix.indexOf('Brainbase検索')).toBeLessThan(audit.prefix.indexOf('Brainbase根拠不足'));
    expect(f.events()).toEqual(before);
    reconcileNativeMcpFailures({ ...f.payload, hook_event_name: 'Stop' }, { env: f.env });
    expect(f.events()).toEqual(before);
});
it.each(['wrong-turn', 'foreign-session', 'foreign-meta', 'outside', 'forged', 'success', 'no-error', 'child', 'partial'])('rejects %s evidence', async kind => {
    const f = await fixture(); const native = f.entries[2];
    if (kind === 'wrong-turn') native.payload.turn_id = 'other';
    if (kind === 'foreign-session') native.payload.thread_id = 'other';
    if (kind === 'foreign-meta') f.entries.push({ type: 'session_meta', payload: { id: 'other', session_id: 'other' } });
    if (kind === 'outside') f.env.BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS = join(f.root, 'absent');
    if (kind === 'forged') native.type = 'response_item';
    if (kind === 'success') native.payload.item.status = 'completed';
    if (kind === 'no-error') delete native.payload.item.result.isError;
    if (kind === 'child') f.entries[0].payload.source = { subagent: {} };
    f.save(); if (kind === 'partial') writeFileSync(f.payload.transcript_path, '{');
    expect(reconcileNativeMcpFailures(f.payload, { env: f.env })).toEqual([]);
    expect(f.events()).toEqual([]);
});
it('deduplicates an existing PostToolUse failure with its original native result', async () => {
    const f = await fixture(); const item = f.entries[2].payload.item;
    recordBrainbaseToolUse({ ...f.payload, hook_event_name: 'PostToolUse', tool_name: 'mcp__brainbase__search', tool_use_id: item.id, tool_input: item.arguments, tool_response: item.result }, { env: f.env });
    const before = f.events();
    reconcileNativeMcpFailures(f.payload, { env: f.env });
    expect(f.events()).toEqual(before);
});
it('rejects conflicting native item identities without partially writing', async () => {
    const f = await fixture(); const duplicate = structuredClone(f.entries[2]); duplicate.payload.item.arguments.query = 'other';
    f.entries.push(duplicate); f.save();
    expect(() => reconcileNativeMcpFailures(f.payload, { env: f.env })).toThrow('judgment_native_mcp_item_conflict');
    expect(f.events()).toEqual([]);
});
it('captures a trusted native transport error without exposing its text', async () => {
    const f = await fixture(); const item = f.entries[2].payload.item;
    delete item.result; item.error = { message: 'private transport failure' }; f.save();
    reconcileNativeMcpFailures(f.payload, { env: f.env });
    expect(f.events()[0]).toMatchObject({ success: false, satisfies: [] });
    expect(JSON.stringify(f.events())).not.toContain('private transport failure');
});
it('reconciles at Stop before checking the required final prefix', async () => {
    const f = await fixture();
    const result = await processHookPayload({ ...f.payload, hook_event_name: 'Stop', last_assistant_message: 'Done' }, { env: f.env });
    expect(f.events()).toHaveLength(1);
    expect(f.events()[0].success).toBe(false);
    expect(JSON.stringify(result)).toContain('Brainbase検索');
});
it('records failed native control calls without adopting a contract or granting capabilities', async () => {
    const f = await fixture(); f.entries[2].payload.item.tool = 'brainbase_resolve_turn'; f.save();
    reconcileNativeMcpFailures(f.payload, { env: f.env });
    expect(f.events()[0]).toMatchObject({ event_kind: 'turn_resolution', success: false, satisfies: [] });
    expect(f.events()[0].safe_metadata.turn_contract).toBeUndefined();
});
it('retains the structured upstream error code alongside the generic failure code', async () => {
    const f = await fixture();
    reconcileNativeMcpFailures(f.payload, { env: f.env });
    expect(f.events()[0].safe_metadata.tool_failure).toMatchObject({ failure_code: 'tool_execution_failed', upstream_error_code: 'graph_retrieval_input_invalid' });
    expect(JSON.stringify(f.events())).not.toContain('private upstream error');
});
it.each(['contains secret', 'UPPERCASE', 'https://secret.example', 'x'.repeat(81)])('omits invalid upstream code %s', async code => {
    const f = await fixture(); f.entries[2].payload.item.result.content[0].text = JSON.stringify({ error: { code, message: 'private text' } }); f.save();
    reconcileNativeMcpFailures(f.payload, { env: f.env });
    expect(f.events()[0].safe_metadata.tool_failure.upstream_error_code).toBeUndefined();
    expect(JSON.stringify(f.events())).not.toContain('private text');
});
it('retains a native transport error code, without its message', async () => {
    const f = await fixture(); const item = f.entries[2].payload.item; delete item.result; item.error = { code: 'transport_failed', message: 'private text' }; f.save();
    reconcileNativeMcpFailures(f.payload, { env: f.env });
    expect(f.events()[0].safe_metadata.tool_failure.upstream_error_code).toBe('transport_failed');
    expect(JSON.stringify(f.events())).not.toContain('private text');
});
it('does not choose between conflicting structured upstream codes', async () => {
    const f = await fixture(); f.entries[2].payload.item.error = { code: 'different_error' }; f.save();
    reconcileNativeMcpFailures(f.payload, { env: f.env });
    expect(f.events()[0].safe_metadata.tool_failure.upstream_error_code).toBeUndefined();
});
