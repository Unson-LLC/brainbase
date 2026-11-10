import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { processJudgmentHook } from '../src/judgment-host.js';
import type { JudgmentTaskProgressAdapter } from '../src/judgment-task-progress.js';

const scope = { task_ref: 'task-8', criterion_ref: 'host-stop', contract_revision: '1' };
function adapter(kind: 'preparation_only' | 'waiting' | 'verified_outcome' = 'preparation_only', verified = true): JudgmentTaskProgressAdapter {
  return {
    scope,
    async assess({ events }) {
      if (kind === 'waiting') return { kind };
      const evidence_tool_use_ids = [events.at(-1)?.tool_use_id ?? 'missing'];
      return kind === 'preparation_only' ? { kind, evidence_tool_use_ids } : {
        kind, evidence_tool_use_ids, outcome: 'new_negative_result',
        verification_ref: events.at(-1)?.event_digest ?? 'missing'
      };
    },
    async verifyOutcome() { return verified; }
  };
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'task-progress-'));
  const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
  async function turn(id: string, taskProgress = adapter()) {
    const identity = { session_id: id, turn_id: 'turn', cwd: root };
    const options = { env, taskProgress };
    const start = await processJudgmentHook({ hook_event_name: 'UserPromptSubmit', prompt: '回答を準備して', ...identity }, options);
    if (!('hookSpecificOutput' in start)) throw new Error('missing start');
    const owner = start.hookSpecificOutput.additionalContext.split('\n').find((line) => line.startsWith('🧠'));
    const tool = await processJudgmentHook({
      hook_event_name: 'PostToolUse', ...identity, tool_use_id: `read-${id}`,
      tool_name: 'search', tool_input: { query: `different preparation ${id}` },
      tool_response: { content: [{ type: 'text', text: `different document ${id}` }] }
    }, options);
    const audit = 'systemMessage' in tool ? tool.systemMessage : '';
    const stop = (override = taskProgress) => processJudgmentHook({
      hook_event_name: 'Stop', ...identity,
      last_assistant_message: `${owner}\n${audit}\n📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓\n準備資料を確認しました。`
    }, { env, taskProgress: override });
    return { stop, identity, options };
  }
  return { root, env, turn };
}

describe('task-bound semantic preparation gate in the portable Host', () => {
  it('blocks different preparation evidence across sessions before finalization', async () => {
    const { turn, env } = await setup();
    await (await turn('one')).stop();
    const second = await turn('two');
    expect(await second.stop()).toMatchObject({ decision: 'block', block_kind: 'semantic_replan' });
    await expect(second.stop()).rejects.toThrow('replan_requires_new_evidence');
    const sessionDirs = (await readdir(env.BRAINBASE_JUDGMENT_JOURNAL_DIR)).filter((name) => name !== 'task-progress');
    const files = (await Promise.all(sessionDirs.map((dir) => readdir(join(env.BRAINBASE_JUDGMENT_JOURNAL_DIR, dir))))).flat();
    expect(files.filter((name) => name.endsWith('.final.json'))).toHaveLength(1);
  });

  it('does not let a changed task binding bypass the episode scope', async () => {
    const { turn } = await setup();
    const current = await turn('bound');
    await expect(current.stop({ ...adapter(), scope: { ...scope, task_ref: 'other' } })).rejects.toThrow('binding_changed');
  });

  it('keeps independent tasks and contract revisions separate', async () => {
    const { turn } = await setup();
    await (await turn('one')).stop();
    for (const [id, changed] of [['two', { ...scope, task_ref: 'other' }], ['three', { ...scope, contract_revision: '2' }]] as const) {
      expect(await (await turn(id, { ...adapter(), scope: changed })).stop()).not.toHaveProperty('block_kind', 'semantic_replan');
    }
  });

  it('preserves waiting without counting time or repeated Stop deliveries as preparation', async () => {
    const { turn } = await setup();
    await (await turn('one')).stop();
    await (await turn('waiting', adapter('waiting'))).stop();
    const second = await turn('two');
    expect(await second.stop()).toMatchObject({ block_kind: 'semantic_replan' });
  });

  it('resets only for an independently verified new negative result', async () => {
    const { turn } = await setup();
    await (await turn('one')).stop();
    await (await turn('negative', adapter('verified_outcome'))).stop();
    expect(await (await turn('two')).stop()).not.toHaveProperty('block_kind', 'semantic_replan');
    expect(await (await turn('three')).stop()).toMatchObject({ block_kind: 'semantic_replan' });
  });

  it('rejects unverified outcomes and evidence absent from the current episode', async () => {
    const { turn } = await setup();
    await expect((await turn('unverified', adapter('verified_outcome', false))).stop()).rejects.toThrow('outcome_unverified');
    const forged: JudgmentTaskProgressAdapter = {
      ...adapter(), async assess() { return { kind: 'preparation_only', evidence_tool_use_ids: ['foreign-id'] }; }
    };
    await expect((await turn('forged', forged)).stop()).rejects.toThrow('evidence_not_in_episode');
  });

  it('serializes preparation observations from concurrent sessions', async () => {
    const { turn } = await setup();
    const one = await turn('one');
    const two = await turn('two');
    const results = await Promise.all([one.stop(), two.stop()]);
    expect(results.filter((result) => 'block_kind' in result && result.block_kind === 'semantic_replan')).toHaveLength(1);
  });

  it('fails closed if the task ledger is corrupted', async () => {
    const { turn, env } = await setup();
    await (await turn('one')).stop();
    const ledgerRoot = join(env.BRAINBASE_JUDGMENT_JOURNAL_DIR, 'task-progress');
    const [directory] = await readdir(ledgerRoot);
    const file = join(ledgerRoot, directory, '00000001.json');
    const entry = JSON.parse(await readFile(file, 'utf8'));
    entry.observation = { kind: 'waiting' };
    await writeFile(file, JSON.stringify(entry));
    await expect((await turn('two')).stop()).rejects.toThrow('journal_corrupt');
  });
});

it('requires a new journaled result to recover from a replan and does not re-assess an exact retry', async () => {
  const { turn } = await setup();
  await (await turn('one')).stop();
  const second = await turn('two');
  expect(await second.stop()).toMatchObject({ block_kind: 'semantic_replan' });
  await expect(second.stop(adapter('verified_outcome'))).rejects.toThrow('replan_requires_new_evidence');
  await processJudgmentHook({
    hook_event_name: 'PostToolUse', ...second.identity, tool_use_id: 'new-result',
    tool_name: 'search', tool_input: { query: 'independent negative result' },
    tool_response: { content: [{ type: 'text', text: 'new independently checked result' }] }
  }, second.options);
  const result = await second.stop(adapter('verified_outcome'));
  expect(result).not.toHaveProperty('block_kind', 'semantic_replan');
});

it('fails closed if an episode-bound adapter disappears', async () => {
  const { turn, env } = await setup();
  const current = await turn('bound');
  await expect(processJudgmentHook({
    hook_event_name: 'Stop', ...current.identity, last_assistant_message: 'done'
  }, { env })).rejects.toThrow('binding_changed');
});
