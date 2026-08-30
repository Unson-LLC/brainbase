import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildJudgmentRequest,
  buildOwnerReferenceLine,
  canonicalJson,
  processJudgmentHook,
  resolveLocalJudgment,
  runJudgmentHost,
  type JudgmentReceipt
} from '../src/judgment-host.js';
import { runCli } from '../src/cli.js';

const dirs: string[] = [];

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function episodePaths(journal: string, sessionId: string, turnId: string) {
  const directory = join(journal, digest(sessionId));
  const turnRef = digest(turnId);
  return {
    directory,
    episode: join(directory, `${turnRef}.episode.json`),
    events: join(directory, `${turnRef}.events`),
    final: join(directory, `${turnRef}.final.json`)
  };
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-judgment-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } }
    },
    stdout: () => stdout,
    stderr: () => stderr
  };
}

describe('portable Judgment Resolver Host contract', () => {
  it('builds canonical context from the complete transcript and includes the current turn once', async () => {
    const root = await tempDir();
    const transcript = join(root, 'session.jsonl');
    await writeFile(transcript, [
      JSON.stringify({ type: 'session_meta', payload: { id: 'session-1' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', turn_id: 'turn-1', content: [{ type: 'input_text', text: 'APIのバグを修正したい' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', turn_id: 'turn-1', content: [{ type: 'output_text', text: '原因を確認します' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'それでいい。修正して' }] } })
    ].join('\n'));

    const request = buildJudgmentRequest({
      hook_event_name: 'UserPromptSubmit',
      prompt: 'それでいい。修正して',
      session_id: 'session-1',
      turn_id: 'turn-2',
      transcript_path: transcript,
      cwd: root,
      model: 'test-model',
      permission_mode: 'never'
    }, {
      env: {
        BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS: root,
        BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal')
      }
    });

    expect(request.conversation_context.completeness).toBe('complete');
    expect(request.conversation_context.messages.map((message) => message.text)).toEqual([
      'APIのバグを修正したい',
      '原因を確認します',
      'それでいい。修正して'
    ]);
    expect(request.conversation_context.messages.filter((message) => message.turn_id === 'turn-2')).toHaveLength(1);
    expect(request.conversation_context.runtime).toMatchObject({
      host: 'codex',
      model: 'test-model',
      permission_mode: 'never'
    });
    expect(request.conversation_context.source_digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('inherits a follow-up from prior conversation while the Resolver owns classification', async () => {
    const root = await tempDir();
    const request = buildJudgmentRequest({
      prompt: 'それでいい。修正して',
      session_id: 'session-2',
      turn_id: 'turn-2',
      cwd: root
    }, {
      env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') },
      trustedConversationMessages: [
        { role: 'user', turn_id: 'turn-1', text: 'OSS版のResolver Hostを実装する' },
        { role: 'assistant', turn_id: 'turn-1', text: '公開用に分離します' }
      ]
    });

    const receipt = await resolveLocalJudgment(request, {
      now: () => new Date('2026-08-09T00:00:00.000Z'),
      id: () => 'receipt-follow-up'
    });

    expect(receipt.status).toBe('resolved');
    expect(receipt.classification).toMatchObject({ intent: 'implement', domains: ['engineering'] });
    expect(receipt.classification_evidence).toMatchObject({ source: 'prior_message', source_turn_ids: ['turn-1'] });
    expect(receipt.selected_dag_ids).toEqual(expect.arrayContaining(['engineering.v1', 'authority.v1']));
    expect(receipt.active_node_definitions.map((node) => node.id)).toContain('authority-check');
  });

  it('continues to a clarification response when a follow-up has no referent', async () => {
    const root = await tempDir();
    const request = buildJudgmentRequest({
      prompt: 'それでいい',
      session_id: 'session-3',
      turn_id: 'turn-1',
      cwd: root
    }, { env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') } });

    const receipt = await resolveLocalJudgment(request);
    const output = await runJudgmentHost({
      prompt: 'それでいい',
      session_id: 'session-3',
      turn_id: 'turn-1',
      cwd: root
    }, {
      env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal-2') },
      resolver: async () => receipt
    });

    expect(receipt.status).toBe('needs_clarification');
    expect(receipt.selected_dag_ids).toEqual(['clarification.v1']);
    expect(output.continue).toBe(true);
    expect(output.hookSpecificOutput.additionalContext).toContain('A clarification receipt means ask');
    expect(output.hookSpecificOutput.additionalContext).toContain(
      '⚠️ 判断参照: 「それでいい」の対象を特定できず → 確認質問'
    );
  });

  it('adopts exactly one receipt for a turn and reuses it without resolving again', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const payload = {
      prompt: 'この仕組みを説明して',
      session_id: 'session-4',
      turn_id: 'turn-1',
      cwd: root
    };
    const resolver = vi.fn(async (request) => resolveLocalJudgment(request, {
      now: () => new Date('2026-08-09T00:00:00.000Z'),
      id: () => 'receipt-once'
    }));

    const first = await runJudgmentHost(payload, { env, resolver });
    const second = await runJudgmentHost(payload, { env, resolver });

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(first.receipt.resolution_id).toBe('receipt-once');
    expect(second.receipt).toEqual(first.receipt);
    expect(second.hookSpecificOutput.additionalContext).toContain(
      '🧠 判断参照: 「この仕組みを説明して」を参照 → 質問として回答 ✓'
    );

    const [sessionDirectory] = await readdir(env.BRAINBASE_JUDGMENT_JOURNAL_DIR);
    const [journalName] = (await readdir(join(env.BRAINBASE_JUDGMENT_JOURNAL_DIR, sessionDirectory)))
      .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name));
    const adoption = JSON.parse(await readFile(
      join(env.BRAINBASE_JUDGMENT_JOURNAL_DIR, sessionDirectory, journalName),
      'utf8'
    ));
    expect(adoption).toMatchObject({
      schema_version: 'brainbase-judgment-adoption-v2',
      receipt: { resolution_id: 'receipt-once' },
      owner_audit: {
        schema_version: 'brainbase-owner-audit-v1',
        historical_exact: true,
        source_kind: 'current_request',
        source_turn_ids: ['turn-1'],
        source_excerpt: 'この仕組みを説明して',
        decision: '質問として回答',
        display_line: '🧠 判断参照: 「この仕組みを説明して」を参照 → 質問として回答 ✓'
      }
    });
  });

  it('reuses the adopted canonical request after later turns have added receipts', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const firstPayload = {
      prompt: 'Explain the local Resolver',
      session_id: 'session-replay',
      turn_id: 'turn-1',
      cwd: root
    };
    const first = await runJudgmentHost(firstPayload, { env, trustedConversationMessages: [] });
    await runJudgmentHost({
      prompt: 'Now implement it',
      session_id: 'session-replay',
      turn_id: 'turn-2',
      cwd: root
    }, {
      env,
      trustedConversationMessages: [{ role: 'user', turn_id: 'turn-1', text: firstPayload.prompt }]
    });
    const resolver = vi.fn(async () => { throw new Error('must not resolve an adopted turn again'); });

    const replayed = await runJudgmentHost(firstPayload, { env, resolver });

    expect(resolver).not.toHaveBeenCalled();
    expect(replayed.receipt).toEqual(first.receipt);
  });

  it('keeps v1 journal entries replayable while deriving a non-historical owner audit', async () => {
    const root = await tempDir();
    const journal = join(root, 'journal');
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };
    const payload = {
      prompt: 'この仕組みを説明して',
      session_id: 'session-legacy-journal',
      turn_id: 'turn-1',
      cwd: root
    };
    const first = await runJudgmentHost(payload, { env });
    const [sessionDirectory] = await readdir(journal);
    const [journalName] = (await readdir(join(journal, sessionDirectory)))
      .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name));
    const path = join(journal, sessionDirectory, journalName);
    const adoption = JSON.parse(await readFile(path, 'utf8'));
    delete adoption.receipt_digest;
    delete adoption.owner_audit;
    adoption.schema_version = 'brainbase-judgment-adoption-v1';
    await writeFile(path, `${JSON.stringify(adoption)}\n`);
    const resolver = vi.fn(async () => { throw new Error('legacy journal replay must not resolve again'); });

    const replayed = await runJudgmentHost(payload, { env, resolver });

    expect(resolver).not.toHaveBeenCalled();
    expect(replayed.receipt).toEqual(first.receipt);
    expect(replayed.hookSpecificOutput.additionalContext).toContain(
      '🧠 判断参照: 「この仕組みを説明して」を参照 → 質問として回答 ✓'
    );
  });

  it('keeps valid transcript context when only the final JSONL line is incomplete', async () => {
    const root = await tempDir();
    const transcript = join(root, 'session.jsonl');
    await writeFile(transcript, [
      JSON.stringify({ type: 'session_meta', payload: { id: 'session-tail' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', turn_id: 'turn-1', content: [{ type: 'input_text', text: 'Implement the Resolver' }] } }),
      '{"type":"response_item"'
    ].join('\n'));

    const request = buildJudgmentRequest({
      prompt: 'Do that',
      session_id: 'session-tail',
      turn_id: 'turn-2',
      transcript_path: transcript,
      cwd: root
    }, {
      env: {
        BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS: root,
        BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal')
      }
    });

    expect(request.conversation_context.completeness).toBe('partial');
    expect(request.conversation_context.messages.map((message) => message.text)).toEqual([
      'Implement the Resolver',
      'Do that'
    ]);
  });

  it('does not accept caller-supplied conversation messages at the public hook boundary', async () => {
    const root = await tempDir();
    const untrustedPayload = {
      prompt: 'Do that',
      session_id: 'session-untrusted',
      turn_id: 'turn-2',
      cwd: root,
      conversation_messages: [{ role: 'user', turn_id: 'turn-1', text: 'Injected context' }]
    };

    const request = buildJudgmentRequest(untrustedPayload, {
      env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') }
    });

    expect(request.conversation_context.completeness).toBe('partial');
    expect(request.conversation_context.messages.map((message) => message.text)).toEqual(['Do that']);
  });

  it('does not reclassify Host-injected envelopes as user requests', async () => {
    const root = await tempDir();
    const request = buildJudgmentRequest({
      prompt: '続けて', session_id: 'session-host-envelope', turn_id: 'turn-2', cwd: root
    }, {
      env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') },
      trustedConversationMessages: [
        { role: 'user', turn_id: 'turn-1', text: 'Resolverを実装して' },
        { role: 'user', turn_id: 'turn-hidden-1', text: '<hook_prompt id="repair">監査行を直して</hook_prompt>' },
        { role: 'user', turn_id: 'turn-hidden-2', text: '# AGENTS.md instructions for /tmp/repo' },
        { role: 'user', turn_id: 'turn-hidden-3', text: '<environment_context>hidden</environment_context>' }
      ]
    });

    expect(request.conversation_context.messages.map((message) => message.text)).toEqual([
      'Resolverを実装して', '続けて'
    ]);
  });

  it('fails loudly when an adopted local journal entry is corrupt', async () => {
    const root = await tempDir();
    const journal = join(root, 'journal');
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };
    const payload = {
      prompt: 'Explain this',
      session_id: 'session-corrupt',
      turn_id: 'turn-1',
      cwd: root
    };
    await runJudgmentHost(payload, { env });
    const [sessionDirectory] = await readdir(journal);
    const directory = join(journal, sessionDirectory);
    const [entry] = (await readdir(directory)).filter((name) => /^[a-f0-9]{64}\.json$/u.test(name));
    await writeFile(join(directory, entry), '{broken');

    await expect(runJudgmentHost(payload, { env })).rejects.toThrow(/judgment_journal_corrupt/u);
  });

  it('binds UserPromptSubmit, ordered PostToolUse events, and Stop to one portable episode without exposing the full route receipt', async () => {
    const root = await tempDir();
    const journal = join(root, 'journal');
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };
    const identity = { session_id: 'session-episode', turn_id: 'turn-1', cwd: root };
    const resolver = vi.fn(async (request) => resolveLocalJudgment(request, {
      now: () => new Date('2026-08-09T00:00:00.000Z'),
      id: () => 'receipt-episode'
    }));

    const started = await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Resolverを実装して',
      ...identity
    }, { env, resolver });
    const firstEvent = await processJudgmentHook({
      hook_event_name: 'PostToolUse',
      tool_use_id: 'tool-a',
      tool_name: 'get_context',
      tool_input: {},
      tool_response: { content: [{ type: 'text', text: 'resolved' }] },
      ...identity
    }, { env, resolver });
    const secondEvent = await processJudgmentHook({
      hook_event_name: 'PostToolUse',
      tool_use_id: 'tool-b',
      tool_name: 'search',
      tool_input: { query: 'brainbase project' },
      tool_response: { content: [{ type: 'text', text: 'project' }] },
      ...identity
    }, { env, resolver });
    const ownerLine = (started.hookSpecificOutput?.additionalContext ?? '')
      .split('\n').find((line) => line.startsWith('🧠')) ?? '';
    const completeAnswer = [
      ownerLine,
      firstEvent.systemMessage,
      secondEvent.systemMessage,
      '実装しました。'
    ].join('\n');
    const finalized = await processJudgmentHook({
      hook_event_name: 'Stop',
      last_assistant_message: completeAnswer,
      ...identity
    }, { env, resolver });
    const replayed = await processJudgmentHook({
      hook_event_name: 'Stop',
      last_assistant_message: completeAnswer,
      ...identity
    }, { env, resolver });

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(started).toMatchObject({ continue: true, receipt: { resolution_id: 'receipt-episode' } });
    const context = started.hookSpecificOutput?.additionalContext ?? '';
    expect(context).toContain('active_node_definitions');
    expect(context).toContain('audit_contract');
    expect(context).not.toContain('Accepted judgment receipt:');
    expect(context).not.toContain('receipt-episode');
    expect(finalized).toEqual(replayed);

    const paths = episodePaths(journal, identity.session_id, identity.turn_id);
    const episode = JSON.parse(await readFile(paths.episode, 'utf8'));
    const final = JSON.parse(await readFile(paths.final, 'utf8'));
    const eventNames = (await readdir(paths.events)).sort();
    const events = await Promise.all(eventNames.map(async (name) => JSON.parse(await readFile(join(paths.events, name), 'utf8'))));
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events.map((event) => event.tool_use_id)).toEqual(['tool-a', 'tool-b']);
    expect(final).toMatchObject({
      schema_version: 'brainbase-judgment-final-v1',
      initial_receipt_digest: episode.initial_receipt_digest,
      event_count: 2
    });
    expect(final.event_set_digest).toBe(digest(canonicalJson(events)));
  });

  it('replays an identical tool_use_id idempotently', async () => {
    const root = await tempDir();
    const journal = join(root, 'journal');
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };
    const identity = { session_id: 'session-replay-event', turn_id: 'turn-1', cwd: root };
    const started = await processJudgmentHook({ hook_event_name: 'UserPromptSubmit', prompt: '実装して', ...identity }, { env });
    const eventPayload = {
      hook_event_name: 'PostToolUse',
      tool_use_id: 'tool-stable',
      tool_name: 'search_personal_kg',
      tool_input: { query: 'brainbase project' },
      tool_response: { content: [{ type: 'text', text: 'project' }] },
      ...identity
    };

    const first = await processJudgmentHook(eventPayload, { env });
    const second = await processJudgmentHook(eventPayload, { env });
    const ownerLine = (started.hookSpecificOutput?.additionalContext ?? '')
      .split('\n').find((line) => line.startsWith('🧠')) ?? '';
    await processJudgmentHook({
      hook_event_name: 'Stop',
      last_assistant_message: `${ownerLine}\n${first.systemMessage}\ndone`,
      ...identity
    }, { env });

    expect(second).toEqual(first);
    const paths = episodePaths(journal, identity.session_id, identity.turn_id);
    expect(await readdir(paths.events)).toHaveLength(1);
    const final = JSON.parse(await readFile(paths.final, 'utf8'));
    expect(final.event_count).toBe(1);
  });

  it('rejects a reused tool_use_id with a different event envelope without mutating the journal', async () => {
    const root = await tempDir();
    const journal = join(root, 'journal');
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };
    const identity = { session_id: 'session-conflict', turn_id: 'turn-1', cwd: root };
    await processJudgmentHook({ hook_event_name: 'UserPromptSubmit', prompt: '実装して', ...identity }, { env });
    await processJudgmentHook({
      hook_event_name: 'PostToolUse', tool_use_id: 'tool-reused', tool_name: 'search',
      tool_input: { query: 'A' }, tool_response: { content: [] }, ...identity
    }, { env });
    const paths = episodePaths(journal, identity.session_id, identity.turn_id);
    const before = await readdir(paths.events);

    await expect(processJudgmentHook({
      hook_event_name: 'PostToolUse', tool_use_id: 'tool-reused', tool_name: 'search_personal_kg',
      tool_input: { query: 'B' }, tool_response: { content: [] }, ...identity
    }, { env })).rejects.toThrow('judgment_tool_event_conflict');

    expect(await readdir(paths.events)).toEqual(before);
  });

  it('fails loudly when an active episode journal is truncated', async () => {
    const root = await tempDir();
    const journal = join(root, 'journal');
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };
    const identity = { session_id: 'session-corrupt-episode', turn_id: 'turn-1', cwd: root };
    await processJudgmentHook({ hook_event_name: 'UserPromptSubmit', prompt: '実装して', ...identity }, { env });
    const paths = episodePaths(journal, identity.session_id, identity.turn_id);
    await writeFile(paths.episode, '{broken');

    await expect(processJudgmentHook({
      hook_event_name: 'Stop', last_assistant_message: 'done', ...identity
    }, { env })).rejects.toThrow(/judgment_journal_corrupt/u);
    await expect(readFile(paths.final, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects Stop without the matching active session and turn', async () => {
    const root = await tempDir();
    const journal = join(root, 'journal');
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };

    await expect(processJudgmentHook({
      hook_event_name: 'Stop', session_id: 'orphan-session', turn_id: 'turn-1', cwd: root,
      last_assistant_message: 'done'
    }, { env })).rejects.toThrow('judgment_orphan_stop');

    await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: '実装して',
      session_id: 'bound-session', turn_id: 'bound-turn', cwd: root
    }, { env });
    await expect(processJudgmentHook({
      hook_event_name: 'Stop', session_id: 'bound-session', turn_id: 'other-turn', cwd: root,
      last_assistant_message: 'done'
    }, { env })).rejects.toThrow('judgment_orphan_stop');
  });

  it('blocks the first repairable Stop with the exact audit prefix and preserves the original answer body', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const identity = { session_id: 'session-audit-repair', turn_id: 'turn-1', cwd: root };
    const started = await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: '変更内容を説明して', ...identity
    }, { env });
    const ownerLine = (started.hookSpecificOutput?.additionalContext ?? '')
      .split('\n').find((line) => line.startsWith('🧠')) ?? '';
    const zeroCallLine = '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓';
    const body = '修正内容は3点です。\n\n- lifecycle\n- audit\n- tests';

    const first = await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: body, ...identity
    }, { env });

    expect(first).toMatchObject({ decision: 'block' });
    expect(first.reason).toContain(ownerLine);
    expect(first.reason).toContain(zeroCallLine);
    expect(first.reason).toContain('削除・要約・置換せずそのまま残す');

    const repaired = await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: true,
      last_assistant_message: `${ownerLine}\n${zeroCallLine}\n${body}`, ...identity
    }, { env });
    expect(repaired).toMatchObject({ completion_status: 'complete', owner_audit_complete: true });
  });

  it('rejects missing, duplicate, and out-of-order audit lines', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const identity = { session_id: 'session-audit-order', turn_id: 'turn-1', cwd: root };
    const started = await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: '結果を説明して', ...identity
    }, { env });
    const event = await processJudgmentHook({
      hook_event_name: 'PostToolUse', tool_use_id: 'tool-order', tool_name: 'get_context',
      tool_input: {}, tool_response: { content: [] }, ...identity
    }, { env });
    const ownerLine = (started.hookSpecificOutput?.additionalContext ?? '')
      .split('\n').find((line) => line.startsWith('🧠')) ?? '';
    const eventLine = event.systemMessage;

    for (const answer of [
      '本文だけ',
      `${ownerLine}\n${ownerLine}\n${eventLine}\n本文`,
      `${eventLine}\n${ownerLine}\n本文`
    ]) {
      const result = await processJudgmentHook({
        hook_event_name: 'Stop', stop_hook_active: false,
        last_assistant_message: answer, ...identity
      }, { env });
      expect(result).toMatchObject({ decision: 'block' });
      expect(result.reason).toContain(`${ownerLine}\n${eventLine}`);
    }
  });

  it('exhausts the one bounded repair when the answer body changes', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const identity = { session_id: 'session-body-binding', turn_id: 'turn-1', cwd: root };
    const started = await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: '詳しく説明して', ...identity
    }, { env });
    const ownerLine = (started.hookSpecificOutput?.additionalContext ?? '')
      .split('\n').find((line) => line.startsWith('🧠')) ?? '';
    await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: '詳しい本文を保持する', ...identity
    }, { env });

    await expect(processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: true,
      last_assistant_message: `${ownerLine}\n短縮`, ...identity
    }, { env })).rejects.toThrow('judgment_stop_repair_exhausted');
  });

  it('returns nonzero from the active Stop hook after repair is exhausted', async () => {
    const root = await tempDir();
    const journal = join(root, 'journal');
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };
    vi.stubEnv('BRAINBASE_JUDGMENT_JOURNAL_DIR', journal);
    const identity = { session_id: 'session-cli-repair', turn_id: 'turn-1', cwd: root };
    const started = await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: '説明して', ...identity
    }, { env });
    const ownerLine = (started.hookSpecificOutput?.additionalContext ?? '')
      .split('\n').find((line) => line.startsWith('🧠')) ?? '';
    await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: '元の詳しい本文', ...identity
    }, { env });
    const output = capture();
    const code = await runCli(['judgment:hook'], {
      ...output.io,
      stdin: Readable.from([JSON.stringify({
        hook_event_name: 'Stop', stop_hook_active: true,
        last_assistant_message: `${ownerLine}\n短縮`, ...identity
      })])
    });

    expect(code).toBe(1);
    expect(output.stderr()).toContain('judgment_stop_repair_exhausted');
  });

  it('does not complete a knowledge route without a recorded capability event', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const identity = { session_id: 'session-required-knowledge', turn_id: 'turn-1', cwd: root };
    const started = await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: 'Brainbaseで検索して', ...identity
    }, { env });
    const ownerLine = (started.hookSpecificOutput?.additionalContext ?? '')
      .split('\n').find((line) => line.startsWith('🧠')) ?? '';
    const first = await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: `${ownerLine}\n本文`, ...identity
    }, { env });
    expect(first).toMatchObject({ decision: 'block' });
    expect(first.reason).toContain('knowledge.resolve');
    await expect(processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: true,
      last_assistant_message: `${ownerLine}\n本文`, ...identity
    }, { env })).rejects.toThrow('judgment_stop_repair_exhausted');
  });

  it('separates judgment evidence from a successful portable search call', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const identity = { session_id: 'session-search-evidence', turn_id: 'turn-1', cwd: root };
    const started = await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: 'Alphaを検索して', ...identity
    }, { env });
    const ownerLine = (started.hookSpecificOutput?.additionalContext ?? '')
      .split('\n').find((line) => line.startsWith('🧠')) ?? '';
    expect(ownerLine).toContain('🧠 判断参照:');
    expect(ownerLine).not.toContain('Brainbase参照');

    const recorded = await processJudgmentHook({
      hook_event_name: 'PostToolUse', tool_use_id: 'tool-search', tool_name: 'mcp__brainbase__search',
      tool_input: { query: 'Alpha' },
      tool_response: { content: [{ type: 'text', text: JSON.stringify({ results: [{ name: 'Alpha' }] }) }] },
      ...identity
    }, { env });

    expect(recorded).toEqual({ systemMessage: '📚 Brainbase検索: 「Alpha」→ 正常応答を確認 ✓' });
    const result = await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: `${ownerLine}\n${recorded.systemMessage}\n検索結果です`, ...identity
    }, { env });
    expect(result).toMatchObject({ completion_status: 'complete', owner_audit_line_count: 2 });
  });

  it('records isError, malformed, and empty CallToolResult envelopes as warnings, never successful evidence', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const cases = [
      { suffix: 'error', response: { isError: true, content: [{ type: 'text', text: 'failed' }] }, expected: '失敗応答' },
      { suffix: 'malformed', response: { content: [{ type: 'text' }] }, expected: '不正な応答形式' },
      { suffix: 'empty', response: { content: [] }, expected: '空応答' }
    ];
    for (const testCase of cases) {
      const identity = { session_id: `session-${testCase.suffix}`, turn_id: 'turn-1', cwd: root };
      const started = await processJudgmentHook({
        hook_event_name: 'UserPromptSubmit', prompt: 'Alphaを検索して', ...identity
      }, { env });
      const recorded = await processJudgmentHook({
        hook_event_name: 'PostToolUse', tool_use_id: `tool-${testCase.suffix}`,
        tool_name: 'search', tool_input: { query: 'Alpha' }, tool_response: testCase.response,
        ...identity
      }, { env });
      expect(recorded.systemMessage).toBe(`⚠️ Brainbase検索: 「Alpha」→ ${testCase.expected}を記録`);
      const paths = episodePaths(env.BRAINBASE_JUDGMENT_JOURNAL_DIR, identity.session_id, identity.turn_id);
      const [eventName] = await readdir(paths.events);
      const event = JSON.parse(await readFile(join(paths.events, eventName), 'utf8'));
      expect(event).toMatchObject({ audit_kind: 'search', success: false, satisfies: [] });
      const ownerLine = (started.hookSpecificOutput?.additionalContext ?? '')
        .split('\n').find((line) => line.startsWith('🧠')) ?? '';
      const stopped = await processJudgmentHook({
        hook_event_name: 'Stop', stop_hook_active: false,
        last_assistant_message: `${ownerLine}\n${recorded.systemMessage}\n検索結果は確認できませんでした`, ...identity
      }, { env });
      expect(stopped).toMatchObject({ decision: 'block' });
      expect(stopped.reason).toContain('knowledge.resolve');
    }
  });

  it('uses the dedicated zero-call line only when knowledge resolution is not required', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const identity = { session_id: 'session-zero-call', turn_id: 'turn-1', cwd: root };
    const started = await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: 'この仕組みを説明して', ...identity
    }, { env });
    const ownerLine = (started.hookSpecificOutput?.additionalContext ?? '')
      .split('\n').find((line) => line.startsWith('🧠')) ?? '';
    const zeroCallLine = '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓';
    const result = await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: `${ownerLine}\n${zeroCallLine}\n回答`, ...identity
    }, { env });
    expect(result).toMatchObject({ completion_status: 'complete', owner_audit_line_count: 2 });
  });

  it('keeps multiple successful portable calls in journal commit order', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const identity = { session_id: 'session-multiple-evidence', turn_id: 'turn-1', cwd: root };
    const started = await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: 'Alphaを検索して', ...identity
    }, { env });
    const ownerLine = (started.hookSpecificOutput?.additionalContext ?? '')
      .split('\n').find((line) => line.startsWith('🧠')) ?? '';
    const first = await processJudgmentHook({
      hook_event_name: 'PostToolUse', tool_use_id: 'tool-context', tool_name: 'get_context',
      tool_input: {}, tool_response: { content: [{ type: 'text', text: '{"owner":{"name":"Owner"}}' }] }, ...identity
    }, { env });
    const second = await processJudgmentHook({
      hook_event_name: 'PostToolUse', tool_use_id: 'tool-personal', tool_name: 'search_personal_kg',
      tool_input: { query: 'Alpha' }, tool_response: { content: [{ type: 'text', text: '{"results":[]}' }] }, ...identity
    }, { env });
    const result = await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: [ownerLine, first.systemMessage, second.systemMessage, '回答'].join('\n'), ...identity
    }, { env });
    expect(result).toMatchObject({ completion_status: 'complete', owner_audit_line_count: 3 });
  });

  it('renders source selection and exclusions only when they exist in the tool result', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const identity = { session_id: 'session-source-selection', turn_id: 'turn-1', cwd: root };
    await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: 'contextを確認して', ...identity
    }, { env });
    const recorded = await processJudgmentHook({
      hook_event_name: 'PostToolUse', tool_use_id: 'tool-routing', tool_name: 'get_context',
      tool_input: { selected_source: 'input-must-not-be-used' },
      tool_response: { content: [{ type: 'text', text: JSON.stringify({
        source_selection: {
          selected: ['personal-os'],
          excluded: [{ source: 'workspace', reason: 'not canonical' }]
        }
      }) }] },
      ...identity
    }, { env });
    expect(recorded.systemMessage).toContain('採用: personal-os');
    expect(recorded.systemMessage).toContain('除外: workspace（not canonical）');
    expect(recorded.systemMessage).not.toContain('input-must-not-be-used');
  });

  it('binds every applicable AGENTS.md from repository root to cwd', async () => {
    const root = await tempDir();
    const nested = join(root, 'a', 'b');
    await mkdir(join(root, '.git'));
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, 'AGENTS.md'), 'root instructions');
    await writeFile(join(root, 'a', 'AGENTS.md'), 'a instructions');
    await writeFile(join(nested, 'AGENTS.md'), 'b instructions');

    const request = buildJudgmentRequest({
      prompt: 'Explain this',
      session_id: 'session-bindings',
      turn_id: 'turn-1',
      cwd: nested
    }, {
      env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') },
      trustedConversationMessages: []
    });

    expect(request.conversation_context.instruction_bindings.map((binding) => binding.source_ref)).toEqual([
      'AGENTS.md',
      'a/AGENTS.md',
      'a/b/AGENTS.md'
    ]);
  });

  it('shows the concrete prior statement and judgment without treating judgment as action authorization', async () => {
    const root = await tempDir();
    const request = buildJudgmentRequest({
      prompt: 'それでいい。修正して',
      session_id: 'session-owner-line',
      turn_id: 'turn-current',
      cwd: root
    }, {
      env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') },
      trustedConversationMessages: [{
        role: 'user',
        turn_id: 'turn-prior',
        text: 'ログイン後の白画面を直して'
      }]
    });
    const receipt = {
      status: 'resolved',
      classification_evidence: { source: 'prior_message', source_turn_ids: ['turn-prior'], matcher_ids: [] },
      reconciliation_reasons: ['classification_inherited_from_prior_turn'],
      selected_dag_ids: ['engineering.v1', 'authority.v1'],
      classification: { intent: 'implement', domains: ['engineering'] }
    } as JudgmentReceipt;

    expect(buildOwnerReferenceLine(request, receipt)).toBe(
      '🧠 判断参照: 直前の「ログイン後の白画面を直して」を参照 → 実装依頼として継続 ✓'
    );

    const output = capture();
    const code = await runCli(['judgment:install', '--target', 'codex', '--dry-run'], output.io);
    expect(code).toBe(0);
    const config = JSON.parse(output.stdout());
    expect(Object.keys(config.hooks)).toEqual(['UserPromptSubmit', 'PostToolUse', 'Stop']);
    const hook = config.hooks.UserPromptSubmit[0].hooks[0];
    expect(hook.command).toContain('judgment:hook');
    expect(JSON.stringify(config)).not.toMatch(/https?:\/\/|Infisical|Lightsail|Unson/iu);
  });

  it('generates an explicit one-project autonomy canary hook', async () => {
    const output = capture();
    const code = await runCli([
      'judgment:install', '--target', 'codex', '--autonomy-mode', 'canary',
      '--autonomy-project', 'brainbase', '--dry-run'
    ], output.io);
    expect(code).toBe(0);
    const config = JSON.parse(output.stdout());
    const commands = Object.values(config.hooks).map((bindings: any) => bindings[0].hooks[0].command);
    expect(commands).toHaveLength(3);
    expect(commands.every((command: string) => command.includes('"--autonomy-mode" "canary"'))).toBe(true);
    expect(commands.every((command: string) => command.includes('"--autonomy-project" "brainbase"'))).toBe(true);
  });

  it('lets doctor verify the three installed lifecycle hooks', async () => {
    const root = await tempDir();
    const dataDir = join(root, 'personal-os');
    const hooksPath = join(root, 'hooks.json');
    const initOutput = capture();
    expect(await runCli(['onboard:init', '--dir', dataDir], initOutput.io)).toBe(0);
    const installOutput = capture();
    expect(await runCli(['judgment:install', '--target', 'codex', '--dry-run'], installOutput.io)).toBe(0);
    await writeFile(hooksPath, installOutput.stdout());
    const doctorOutput = capture();

    const code = await runCli([
      'doctor', '--dir', dataDir, '--judgment-hooks', hooksPath
    ], doctorOutput.io);

    expect(code).toBe(0);
    expect(JSON.parse(doctorOutput.stdout())).toMatchObject({
      judgment_hooks: {
        status: 'ready',
        events: ['UserPromptSubmit', 'PostToolUse', 'Stop']
      }
    });
  });

  it('documents the Judgment Hook verification option in CLI help', async () => {
    const output = capture();

    expect(await runCli([], output.io)).toBe(0);
    expect(output.stdout()).toContain(
      'brainbase doctor [--dir path] [--judgment-hooks path]'
    );
  });

  it('redacts secrets, truncates long excerpts, and keeps the owner audit on one line', async () => {
    const root = await tempDir();
    const request = buildJudgmentRequest({
      prompt: 'token=sk-secret-value-1234567890\nを使って本番環境を確認し、その後の長い説明も参照して判断して',
      session_id: 'session-owner-redaction',
      turn_id: 'turn-current',
      cwd: root
    }, {
      env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') },
      trustedConversationMessages: []
    });
    const receipt = {
      status: 'resolved',
      classification_evidence: { source: 'current_request', source_turn_ids: ['turn-current'], matcher_ids: [] },
      reconciliation_reasons: [],
      selected_dag_ids: ['operations.v1'],
      classification: { intent: 'investigate', domains: ['operations'] }
    } as JudgmentReceipt;

    const line = buildOwnerReferenceLine(request, receipt);

    expect(line).toBe(
      '🧠 判断参照: 「token=[秘密情報] を使って本番環境を確認し、…」を参照 → 調査として確認 ✓'
    );
    expect(line).not.toContain('sk-secret-value');
    expect(line.split('\n')).toHaveLength(1);
  });

  it('warns instead of silently substituting another turn when receipt evidence is missing', async () => {
    const root = await tempDir();
    const request = buildJudgmentRequest({
      prompt: 'それでいい',
      session_id: 'session-owner-missing',
      turn_id: 'turn-current',
      cwd: root
    }, {
      env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') },
      trustedConversationMessages: [{ role: 'user', turn_id: 'turn-other', text: '別件を実装して' }]
    });
    const receipt = {
      status: 'resolved',
      classification_evidence: { source: 'prior_receipt', source_turn_ids: ['turn-missing'], matcher_ids: [] },
      reconciliation_reasons: ['classification_inherited_from_prior_turn'],
      selected_dag_ids: ['engineering.v1'],
      classification: { intent: 'implement', domains: ['engineering'] }
    } as JudgmentReceipt;

    expect(buildOwnerReferenceLine(request, receipt)).toBe(
      '⚠️ 判断参照: 参照元の会話を確認できず → 判断証跡を要確認'
    );
  });

  it('runs the installed CLI hook locally and emits a managed pre-model result', async () => {
    const root = await tempDir();
    vi.stubEnv('BRAINBASE_JUDGMENT_JOURNAL_DIR', join(root, 'journal'));
    const output = capture();
    const payload = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Explain this design',
      session_id: 'session-cli',
      turn_id: 'turn-cli',
      cwd: root
    });
    const code = await runCli(['judgment:hook'], {
      ...output.io,
      stdin: Readable.from([payload])
    });

    expect(code).toBe(0);
    const result = JSON.parse(output.stdout());
    expect(result).toMatchObject({
      continue: true,
      receipt: {
        status: 'resolved',
        host_binding: { status: 'managed', enforcement_level: 'host_contract' }
      }
    });
    expect(result.hookSpecificOutput.additionalContext).toContain('🧠 判断参照:');
  });
});
