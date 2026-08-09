import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildJudgmentRequest,
  buildOwnerReferenceLine,
  resolveLocalJudgment,
  runJudgmentHost,
  type JudgmentReceipt
} from '../src/judgment-host.js';
import { runCli } from '../src/cli.js';

const dirs: string[] = [];

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
    const [entry] = await readdir(directory);
    await writeFile(join(directory, entry), '{broken');

    await expect(runJudgmentHost(payload, { env })).rejects.toThrow(/judgment_journal_corrupt/u);
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

  it('shows a short owner-visible summary without treating judgment as action authorization', async () => {
    const receipt = {
      status: 'resolved',
      reconciliation_reasons: ['classification_inherited_from_prior_turn'],
      selected_dag_ids: ['engineering.v1', 'authority.v1'],
      classification: { intent: 'implement', domains: ['engineering'] }
    } as JudgmentReceipt;

    expect(buildOwnerReferenceLine(receipt)).toBe(
      '🧠 Brainbase参照: 直前の会話を引き継ぎ、実装方針と権限条件を判断しました。'
    );

    const output = capture();
    const code = await runCli(['judgment:install', '--target', 'codex', '--dry-run'], output.io);
    expect(code).toBe(0);
    const config = JSON.parse(output.stdout());
    const hook = config.hooks.UserPromptSubmit[0].hooks[0];
    expect(hook.command).toContain('judgment:hook');
    expect(JSON.stringify(config)).not.toMatch(/https?:\/\/|Infisical|Lightsail|Unson/iu);
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
    expect(result.hookSpecificOutput.additionalContext).toContain('🧠 Brainbase参照:');
  });
});
