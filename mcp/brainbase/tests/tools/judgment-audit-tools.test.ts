import assert from 'node:assert/strict';
import type { ExecFileOptions } from 'node:child_process';
import { describe, it } from 'node:test';

import { __testing as serverTesting } from '../../src/server.js';
import {
  handleJudgmentAuditToolCall,
  judgmentAuditTools,
} from '../../src/tools/judgment-audit-tools.js';

const TURN_REF = `${'a'.repeat(64)}/${'b'.repeat(64)}`;
const PREFIX_LINES = [
  '🧠 判断参照: 「確認して」を参照 → 判断方針を確認 ✓',
  '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓',
];
const PREFIX = PREFIX_LINES.join('\n');

function hostAuditPayload(turnRef = TURN_REF): Record<string, unknown> {
  return {
    schema_version: 'brainbase-owner-audit-v1',
    turn_ref: turnRef,
    lines: PREFIX_LINES,
    prefix: PREFIX,
  };
}

describe('brainbase_judgment_audit_read', () => {
  it('公開read-only toolがHost CLIを固定引数で呼び、監査prefixをそのまま返す', async () => {
    const calls: Array<{ file: string; args: readonly string[]; options: ExecFileOptions }> = [];
    const result = await handleJudgmentAuditToolCall(
      'brainbase_judgment_audit_read',
      { turn_ref: TURN_REF },
      {
        execFile: async (file, args, options) => {
          calls.push({ file, args, options });
          return { stdout: JSON.stringify(hostAuditPayload()), stderr: '' };
        },
      },
    );

    assert.deepEqual(result, { status: 'ok', data: hostAuditPayload() });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, process.execPath);
    assert.match(calls[0].args[0], /(?:^|\/)scripts\/codex-hooks\/judgment-resolver-host\.mjs$/u);
    assert.deepEqual(calls[0].args.slice(1), ['--read-audit', TURN_REF]);
    assert.equal(calls[0].options.shell, false);
    assert.ok((calls[0].options.timeout ?? 0) > 0);
    assert.ok((calls[0].options.maxBuffer ?? 0) > 0);
    assert.equal(calls[0].options.env, undefined);
  });

  it('MCP公開一覧でread-onlyに分類し、入力schemaを厳密にする', () => {
    const tool = serverTesting.tools.find((candidate) => candidate.name === 'brainbase_judgment_audit_read');
    assert.ok(tool);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(judgmentAuditTools[0].inputSchema.additionalProperties, false);
    assert.deepEqual(judgmentAuditTools[0].inputSchema.required, ['turn_ref']);
    assert.equal(
      (judgmentAuditTools[0].inputSchema.properties as Record<string, { pattern?: string }>).turn_ref.pattern,
      '^[a-f0-9]{64}/[a-f0-9]{64}$',
    );
  });

  it('不正なturn_refや余分な入力をHostへ渡さない', async () => {
    const calls: string[] = [];
    const execFile = async () => {
      calls.push('called');
      return { stdout: JSON.stringify(hostAuditPayload()), stderr: '' };
    };
    const invalidArgs: Record<string, unknown>[] = [
      {},
      { turn_ref: `${'A'.repeat(64)}/${'b'.repeat(64)}` },
      { turn_ref: `${'a'.repeat(63)}/${'b'.repeat(64)}` },
      { turn_ref: `${'a'.repeat(64)}-${'b'.repeat(64)}` },
      { turn_ref: TURN_REF, extra: true },
    ];

    for (const args of invalidArgs) {
      const result = await handleJudgmentAuditToolCall('brainbase_judgment_audit_read', args, { execFile });
      assert.equal(result?.status, 'error');
      assert.equal((result as { error?: { code?: string } }).error?.code, 'judgment_audit_input_invalid');
    }
    assert.deepEqual(calls, []);
  });

  it('Hostの未解決・不正応答を成功へ変換しない', async () => {
    const unavailable = await handleJudgmentAuditToolCall(
      'brainbase_judgment_audit_read',
      { turn_ref: TURN_REF },
      { execFile: async () => { throw new Error('host unavailable'); } },
    );
    assert.equal(unavailable?.status, 'error');
    assert.equal((unavailable as { error?: { code?: string } }).error?.code, 'judgment_audit_unavailable');

    const invalidResponse = await handleJudgmentAuditToolCall(
      'brainbase_judgment_audit_read',
      { turn_ref: TURN_REF },
      { execFile: async () => ({ stdout: JSON.stringify({ ...hostAuditPayload(), prefix: '改変された監査行' }), stderr: '' }) },
    );
    assert.equal(invalidResponse?.status, 'error');
    assert.equal((invalidResponse as { error?: { code?: string } }).error?.code, 'judgment_audit_response_invalid');
  });

  it('他toolは処理しない', async () => {
    assert.equal(await handleJudgmentAuditToolCall('other', {}, { execFile: async () => ({ stdout: '', stderr: '' }) }), null);
  });
});
