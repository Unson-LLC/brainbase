import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  handleJudgmentNodeToolCall,
  judgmentNodeTools,
} from '../../src/tools/judgment-node-tools.js';
import { __testing as serverTesting } from '../../src/server.js';

const valid = {
  node_id: 'observe',
  status: 'supported',
  finding: 'The current screen provides enough evidence for this step.',
  evidence_fit: 'The referenced inspection happened before this judgment.',
  unknowns: [],
  evidence_tool_use_ids: ['tool-123'],
  previous_result_tool_use_id: 'node-problem',
  next_action: 'Continue to the next node.',
};

describe('brainbase_judgment_node_record', () => {
  it('publishes the tool and returns the schema-bound compact result', async () => {
    assert.equal(judgmentNodeTools[0].name, 'brainbase_judgment_node_record');
    assert.ok(serverTesting.tools.some((tool) => tool.name === 'brainbase_judgment_node_record'));
    assert.deepEqual(await handleJudgmentNodeToolCall('brainbase_judgment_node_record', valid), {
      status: 'ok',
      data: { schema_version: 'brainbase-judgment-node-result-v1', ...valid },
    });
  });

  it('rejects missing/extra fields, empty insufficiency, duplicates, and secret-like text', async () => {
    assert.equal(await handleJudgmentNodeToolCall('other', valid), null);
    for (const args of [
      { ...valid, extra: true },
      { ...valid, evidence_tool_use_ids: ['tool-123', 'tool-123'] },
      { ...valid, status: 'insufficient', unknowns: [] },
      { ...valid, finding: 'token=do-not-store' },
    ]) {
      const result = await handleJudgmentNodeToolCall('brainbase_judgment_node_record', args);
      assert.equal(result?.status, 'error');
      assert.equal(result?.error.code, 'judgment_node_result_invalid');
    }
  });

  it('requires unknowns for insufficient and accepts a first node null predecessor', async () => {
    const result = await handleJudgmentNodeToolCall('brainbase_judgment_node_record', {
      ...valid,
      node_id: 'problem-frame',
      previous_result_tool_use_id: null,
      status: 'insufficient',
      unknowns: ['The question still needs a direct observation.'],
      next_action: 'Perform the direct observation and retry this node.',
    });
    assert.equal(result?.status, 'ok');
    assert.equal(result?.data.previous_result_tool_use_id, null);
  });
});
