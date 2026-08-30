import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { processJudgmentHook } from '../src/judgment-host.js';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-autonomy-host-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function auditLines(started: Awaited<ReturnType<typeof processJudgmentHook>>): string[] {
  if (!('hookSpecificOutput' in started)) throw new Error('missing UserPromptSubmit output');
  const owner = started.hookSpecificOutput.additionalContext
    .split('\n')
    .find((line) => line.startsWith('🧠')) ?? '';
  return [owner, '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓'];
}

describe('Judgment Host autonomy stop gate', () => {
  it('blocks a routine approval question before audit finalization and then completes', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const identity = { session_id: 'autonomy-routine', turn_id: 'turn-1', cwd: root };
    const started = await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: 'hooksを修正して', ...identity
    }, { env, autonomyMode: 'on' });

    const blocked = await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: 'テストを実行しますか？', ...identity
    }, { env, autonomyMode: 'on' });
    expect(blocked).toMatchObject({ decision: 'block', block_kind: 'autonomy_continue' });
    expect('reason' in blocked ? blocked.reason : '').toContain('同じターンを続行');

    const completed = await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: true,
      last_assistant_message: `${auditLines(started).join('\n')}\n実装とテストが完了しました。`, ...identity
    }, { env, autonomyMode: 'on' });
    expect(completed).toMatchObject({ completion_status: 'complete', owner_audit_complete: true });
  });

  it('allows a human question at the external action boundary', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const identity = { session_id: 'autonomy-external', turn_id: 'turn-1', cwd: root };
    const started = await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: '変更を準備して', ...identity
    }, { env, autonomyMode: 'on' });

    const result = await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: `${auditLines(started).join('\n')}\nこの変更を本番へデプロイしますか？`, ...identity
    }, { env, autonomyMode: 'on' });
    expect(result).toMatchObject({ completion_status: 'complete' });
    const sessionDirectories = await readdir(env.BRAINBASE_JUDGMENT_JOURNAL_DIR);
    const files = await readdir(join(env.BRAINBASE_JUDGMENT_JOURNAL_DIR, sessionDirectories[0]));
    const autonomyDirectory = files.find((name) => name.endsWith('.autonomy')) ?? '';
    const receipts = await readdir(join(env.BRAINBASE_JUDGMENT_JOURNAL_DIR, sessionDirectories[0], autonomyDirectory));
    const receipt = JSON.parse(await readFile(join(
      env.BRAINBASE_JUDGMENT_JOURNAL_DIR,
      sessionDirectories[0],
      autonomyDirectory,
      receipts[0]
    ), 'utf8'));
    expect(receipt).toMatchObject({
      schema_version: 'brainbase-judgment-autonomy-receipt-v1',
      verdict: 'human_required',
      mode: 'on'
    });
  });

  it('uses an independent resolver only for a semantic gray zone', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const identity = { session_id: 'autonomy-resolver', turn_id: 'turn-1', cwd: root };
    await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: '代理判断を実装して', ...identity
    }, { env, autonomyMode: 'on' });
    const resolver = vi.fn(async (request) => ({
      schema_version: 'brainbase-autonomy-resolver-decision-v1' as const,
      case_id: request.case_id,
      verdict: 'continue' as const,
      reason_code: 'centerpin_first',
      reason: '代理判断の縦切りを先行する',
      basis: [{ entity_id: 'dec_centerpin', application: '認知負荷削減を優先する' }],
      instruction_patch: {
        cancel: ['証跡台帳の先行実装'],
        do_next: ['代理判断の縦切りをローカルで実装する'],
        acceptance_criteria: ['人間へ確認せず続行する']
      }
    }));

    const result = await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: '証跡台帳と代理判断の縦切りのどちらを先にしますか？', ...identity
    }, { env, autonomyMode: 'on', autonomyResolver: resolver });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ decision: 'block', block_kind: 'autonomy_continue' });
    expect('reason' in result ? result.reason : '').toContain('代理判断の縦切りをローカルで実装する');

    await expect(processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: true,
      last_assistant_message: '証跡台帳と代理判断の縦切りのどちらを先にしますか？', ...identity
    }, { env, autonomyMode: 'on', autonomyResolver: resolver })).rejects.toThrow('judgment_autonomy_continuation_exhausted');
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('fails loudly instead of looping when the resumed Codex repeats a routine question', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const identity = { session_id: 'autonomy-loop', turn_id: 'turn-1', cwd: root };
    await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: 'hooksを修正して', ...identity
    }, { env, autonomyMode: 'on' });
    await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: 'テストを実行しますか？', ...identity
    }, { env, autonomyMode: 'on' });

    await expect(processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: true,
      last_assistant_message: 'テストを実行しますか？', ...identity
    }, { env, autonomyMode: 'on' })).rejects.toThrow('judgment_autonomy_continuation_exhausted');
  });

  it('keeps the autonomy gate off by default', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const identity = { session_id: 'autonomy-off', turn_id: 'turn-1', cwd: root };
    const started = await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: 'hooksを修正して', ...identity
    }, { env });
    const result = await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: `${auditLines(started).join('\n')}\nテストを実行しますか？`, ...identity
    }, { env });
    expect(result).toMatchObject({ completion_status: 'complete' });
  });

  it('enables canary mode only for the configured project', async () => {
    const root = await tempDir();
    const env = {
      BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
      BRAINBASE_JUDGMENT_PROJECT_CODE: 'brainbase'
    };
    const identity = { session_id: 'autonomy-canary', turn_id: 'turn-1', cwd: root };
    await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit', prompt: 'hooksを修正して', ...identity
    }, { env });
    const blocked = await processJudgmentHook({
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: 'テストを実行しますか？', ...identity
    }, { env, autonomyMode: 'canary', autonomyCanaryProjects: ['brainbase'] });
    expect(blocked).toMatchObject({ decision: 'block', block_kind: 'autonomy_continue' });
  });
});
