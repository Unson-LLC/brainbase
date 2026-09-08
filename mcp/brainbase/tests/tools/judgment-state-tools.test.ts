import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { handleJudgmentStateToolCall, judgmentStateTools } from '../../src/tools/judgment-state-tools.js';
import { __testing as serverTesting } from '../../src/server.js';

describe('brainbase_judgment_state_record', () => {
  it('状態toolを公開し、Hostが検証可能な正規化済み状態を返す', async () => {
    assert.ok(serverTesting.tools.some((tool) => tool.name === 'brainbase_judgment_state_record'));
    assert.equal(judgmentStateTools[0].annotations, undefined);
    assert.deepEqual(await handleJudgmentStateToolCall('brainbase_judgment_state_record', {
      status: 'completed', pending_safe_work: false, runtime_reason_code: null,
    }), {
      status: 'ok',
      data: { schema_version: 'brainbase-stop-state-v1', status: 'completed', pending_safe_work: false, runtime_reason_code: null },
    });
  });

  it('不正な状態や余分な入力を拒否し、他toolは処理しない', async () => {
    assert.equal(await handleJudgmentStateToolCall('other', {}), null);
    assert.equal((await handleJudgmentStateToolCall('brainbase_judgment_state_record', {
      status: 'completed', pending_safe_work: false, runtime_reason_code: null, extra: true,
    }))?.status, 'error');
    assert.equal((await handleJudgmentStateToolCall('brainbase_judgment_state_record', {
      status: 'completed', pending_safe_work: true, runtime_reason_code: null,
    }))?.status, 'ok');
  });
});
