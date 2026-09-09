import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildJudgmentRequest, canonicalJson, processHookPayload, verifiedSubagentParent } from '../../scripts/codex-hooks/judgment-resolver-host.mjs';
const roots = [];
const hash = value => createHash('sha256').update(value).digest('hex');
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture({ status = 'resolved', autonomy = 'continue' } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'judgment-subagent-')); roots.push(root);
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'), BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS: root,
        BRAINBASE_JUDGMENT_START_FAILURE_MODE: 'diagnostic_continue', BRAINBASE_JUDGMENT_CANARY_CWD: process.cwd() };
    const parent = { hook_event_name: 'UserPromptSubmit', session_id: 'parent', turn_id: 'parent-turn', prompt: 'Inspect delegated evidence', cwd: process.cwd() };
    const args = buildJudgmentRequest(parent, { env });
    const receipt = { resolution_id: 'test', turn_id: args.turn_id, request_digest: hash(canonicalJson(args)), context_digest: hash(canonicalJson(args.conversation_context)),
        status, autonomy_decision: autonomy, autonomy_reason_code: autonomy === 'continue' ? 'routine_in_scope' : 'risk_or_external', allowed_runtime_escalation_reasons: autonomy === 'continue' ? ['irreversible_action', 'missing_authority', 'owner_value_choice', 'required_input_unavailable', 'evidenced_terminal_blocker'] : [], host_binding: { status: 'managed' }, classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] }, active_node_definitions: [], autonomy_policy_ids: [] };
    await processHookPayload(parent, { env, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ management_status: 'managed', receipt }) }) });
    const entries = [
        { type: 'session_meta', payload: { id: 'child', session_id: 'parent', cwd: process.cwd(), source: { subagent: { thread_spawn: { parent_thread_id: 'parent', depth: 1, agent_path: '/root/test' } } } } },
        { type: 'turn_context', payload: { turn_id: 'child-turn', root_turn_id: 'parent-turn' } },
        { type: 'response_item', payload: { type: 'agent_message', author: '/root', recipient: '/root/test', internal_chat_message_metadata_passthrough: { turn_id: 'child-turn' } } }
    ];
    const transcript = join(root, 'child.jsonl');
    const save = () => writeFileSync(transcript, entries.map(x => JSON.stringify(x)).join('\n') + '\n'); save();
    const child = { hook_event_name: 'PreToolUse', session_id: 'child', turn_id: 'child-turn', cwd: process.cwd(), transcript_path: transcript, tool_name: 'Bash', tool_use_id: 'call1', tool_input: { command: 'pwd' }, tool_response: { output: process.cwd() } };
    return { root, env, child, entries, save, directory: join(root, 'journal', hash('parent')), prefix: hash('parent-turn') };
}
it.each(['child', 'parent'])('verified direct child %s inherits open parent without granting permissions', async session => {
    const f = await fixture(); f.child.session_id = session;
    expect(verifiedSubagentParent(f.child, f.env)?.parent.turn_id).toBe('parent-turn');
    const out = await processHookPayload(f.child, { env: f.env });
    expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
    expect(out.hookSpecificOutput.additionalContext).toContain('委任');
});
it.each(['source', 'root-turn', 'recipient', 'depth', 'session', 'duplicate', 'outside', 'closed', 'missing'])('rejects invalid delegation: %s', async kind => {
    const f = await fixture();
    if (kind === 'source') f.entries[0].payload.source.subagent.thread_spawn.parent_thread_id = 'other';
    if (kind === 'root-turn') f.entries[1].payload.root_turn_id = 'other';
    if (kind === 'recipient') f.entries[2].payload.recipient = '/root/other';
    if (kind === 'depth') f.entries[0].payload.source.subagent.thread_spawn.depth = 2;
    if (kind === 'session') f.child.session_id = 'other';
    if (kind === 'duplicate') f.entries.push(f.entries[0]);
    if (kind === 'outside') f.env.BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS = join(f.root, 'absent');
    if (kind === 'closed') writeFileSync(join(f.directory, `${f.prefix}.final.json`), '{}');
    if (kind === 'missing') rmSync(join(f.root, 'journal'), { recursive: true });
    f.save();
    expect((await processHookPayload(f.child, { env: f.env })).hookSpecificOutput.permissionDecision).toBe('deny');
});
it('rejects a parent that cannot continue', async () => {
    const f = await fixture({ autonomy: 'escalate' });
    expect(verifiedSubagentParent(f.child, f.env)).toBeNull();
});
it.each(['resolve_turn', 'judgment_audit_read', 'judgment_state_record', 'judgment_value_proof_record'])('denies child control tool %s', async name => {
    const f = await fixture(); f.child.tool_name = `mcp__brainbase__brainbase_${name}`;
    expect((await processHookPayload(f.child, { env: f.env })).hookSpecificOutput.permissionDecision).toBe('deny');
});
it('records child execution and Stop under parent without finalizing parent or satisfying capabilities', async () => {
    const f = await fixture();
    for (const name of ['PostToolUse', 'Stop']) await processHookPayload({ ...f.child, hook_event_name: name, last_assistant_message: 'done' }, { env: f.env });
    const eventsDir = join(f.directory, `${f.prefix}.events`);
    const events = readdirSync(eventsDir).map(name => JSON.parse(readFileSync(join(eventsDir, name), 'utf8')));
    expect(events).toHaveLength(2);
    expect(events.map(x => x.tool_name).sort()).toEqual(['delegated.Bash', 'delegated.Stop']);
    expect(events.every(x => x.event_kind === 'execution')).toBe(true);
    expect(events.every(x => !x.satisfies?.length)).toBe(true);
    expect(existsSync(join(f.directory, `${f.prefix}.final.json`))).toBe(false);
});
it('rejects missing tool identity', async () => {
    const f = await fixture(); delete f.child.tool_use_id;
    await expect(processHookPayload({ ...f.child, hook_event_name: 'PostToolUse' }, { env: f.env })).rejects.toThrow('judgment_delegated_tool_identity_missing');
});

it('keeps child failure a failed execution event without exposing the error text', async () => {
    const f = await fixture();
    await processHookPayload({ ...f.child, hook_event_name: 'PostToolUseFailure', error: 'sensitive failure text' }, { env: f.env });
    const dir = join(f.directory, `${f.prefix}.events`);
    const text = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8');
    expect(JSON.parse(text)).toMatchObject({ success: false, event_kind: 'execution', satisfies: [] });
    expect(text).not.toContain('sensitive failure text');
});

it('accepts a full-history fork with one inherited parent session metadata entry', async () => {
    const f = await fixture();
    f.entries.splice(1, 0, { type: 'session_meta', payload: { id: 'parent', session_id: 'parent' } });
    f.save();
    expect(verifiedSubagentParent(f.child, f.env)?.parent.turn_id).toBe('parent-turn');
});
it('denies parent control tools invoked through functions.exec', async () => {
    const f = await fixture();
    f.child.tool_name = 'functions.exec';
    f.child.tool_input = { code: 'await tools.mcp__brainbase__brainbase_judgment_state_record({status: "completed"})' };
    expect((await processHookPayload(f.child, { env: f.env })).hookSpecificOutput.permissionDecision).toBe('deny');
});
