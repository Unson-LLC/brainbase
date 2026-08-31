import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { __testing } from '../../src/server.js';

describe('VibePro Knowledge Event server wiring', () => {
  it('publishes the receiver as a non-destructive idempotent write tool', () => {
    const tool = __testing.tools.find((candidate) => candidate.name === 'brainbase_knowledge_event_record');
    assert.ok(tool);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
