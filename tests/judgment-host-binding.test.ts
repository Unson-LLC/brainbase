import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  canonicalJson,
  processJudgmentHook,
  resolveLocalJudgment,
  runJudgmentHost,
  type JudgmentHostBinding,
  type JudgmentReceipt
} from '../src/judgment-host.js';

const dirs: string[] = [];

const alternateBinding: JudgmentHostBinding = {
  adapter_id: 'oss-judgment-host',
  adapter_version: '0.44.1',
  status: 'managed',
  enforcement_level: 'host_contract'
};

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function rebindReceipt(receipt: JudgmentReceipt, hostBinding: JudgmentHostBinding): JudgmentReceipt {
  const rebound = { ...receipt, host_binding: hostBinding };
  const plan = { ...rebound } as Record<string, unknown>;
  delete plan.resolution_id;
  delete plan.resolved_at;
  delete plan.request_digest;
  delete plan.plan_digest;
  return { ...rebound, plan_digest: digest(canonicalJson(plan)) };
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-judgment-binding-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Judgment Host adapter binding', () => {
  it('uses the local adapter binding when no expected binding is configured', async () => {
    const root = await tempDir();
    const output = await runJudgmentHost({
      prompt: 'この仕組みを説明して',
      session_id: 'binding-local-default-session',
      turn_id: 'turn-1',
      cwd: root
    }, {
      env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') }
    });

    expect(output.receipt.host_binding).toEqual({
      adapter_id: 'brainbase-local',
      adapter_version: '1',
      status: 'managed',
      enforcement_level: 'host_contract'
    });
  });

  it.each([
    ['null', null],
    ['array', []],
    ['string', 'brainbase-local'],
    ['number', 1],
    ['incomplete object', { adapter_id: 'brainbase-local' }]
  ])('fails closed for an invalid expected binding (%s)', async (_label, expectedHostBinding) => {
    const root = await tempDir();
    const resolver = vi.fn();

    await expect(runJudgmentHost({
      prompt: 'この仕組みを説明して',
      session_id: 'binding-invalid-config-session',
      turn_id: 'turn-1',
      cwd: root
    }, {
      env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') },
      resolver,
      expectedHostBinding: expectedHostBinding as JudgmentHostBinding
    })).rejects.toThrow('judgment_host_binding_config_invalid');

    expect(resolver).not.toHaveBeenCalled();
  });

  it('keeps the local default fail-closed and does not rewrite a mismatched receipt', async () => {
    const root = await tempDir();
    const returnedReceipts: JudgmentReceipt[] = [];
    const resolver = vi.fn(async (request) => {
      const receipt = rebindReceipt(await resolveLocalJudgment(request), alternateBinding);
      returnedReceipts.push(receipt);
      return receipt;
    });

    await expect(runJudgmentHost({
      prompt: 'この仕組みを説明して',
      session_id: 'binding-default-session',
      turn_id: 'turn-1',
      cwd: root
    }, {
      env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') },
      resolver
    })).rejects.toThrow('judgment_receipt_binding_unmanaged');

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(returnedReceipts[0]?.host_binding).toEqual(alternateBinding);
  });

  it('accepts an explicitly injected binding across adoption, PostToolUse, Stop, and replay', async () => {
    const root = await tempDir();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const identity = {
      session_id: 'binding-oss-session',
      turn_id: 'turn-1',
      cwd: root
    };
    const resolver = vi.fn(async (request) => rebindReceipt(
      await resolveLocalJudgment(request, {
        now: () => new Date('2026-10-19T00:00:00.000Z'),
        id: () => 'oss-binding-receipt'
      }),
      alternateBinding
    ));
    const options = { env, resolver, expectedHostBinding: alternateBinding };

    const started = await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Resolverを実装して',
      ...identity
    }, options);
    const tool = await processJudgmentHook({
      hook_event_name: 'PostToolUse',
      tool_use_id: 'binding-tool-1',
      tool_name: 'search',
      tool_input: { query: 'brainbase' },
      tool_response: { content: [{ type: 'text', text: 'resolved' }] },
      ...identity
    }, options);
    const ownerLine = (started.hookSpecificOutput.additionalContext ?? '')
      .split('\n').find((line) => line.startsWith('🧠')) ?? '';
    const answer = [ownerLine, tool.systemMessage, '実装しました。'].join('\n');
    const finalized = await processJudgmentHook({
      hook_event_name: 'Stop',
      last_assistant_message: answer,
      ...identity
    }, options);
    const replayed = await processJudgmentHook({
      hook_event_name: 'Stop',
      last_assistant_message: answer,
      ...identity
    }, options);

    expect(started.receipt.host_binding).toEqual(alternateBinding);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(finalized).toEqual(replayed);

    await expect(runJudgmentHost({
      prompt: 'Resolverを実装して',
      ...identity
    }, {
      env,
      resolver: vi.fn(),
      expectedHostBinding: {
        ...alternateBinding,
        adapter_id: ''
      }
    })).rejects.toThrow('judgment_host_binding_config_invalid');

    await expect(runJudgmentHost({
      prompt: 'Resolverを実装して',
      ...identity
    }, { env, resolver: vi.fn() })).rejects.toThrow('judgment_receipt_binding_unmanaged');
  });
});
