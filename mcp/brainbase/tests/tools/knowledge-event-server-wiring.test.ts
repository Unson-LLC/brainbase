import { describe, expect, it } from 'vitest';
import { __testing } from '../../src/server.js';

describe('VibePro Knowledge Event server wiring', () => {
  it('publishes the receiver as a non-destructive write tool', () => {
    const tool = __testing.tools.find((candidate) => candidate.name === 'brainbase_knowledge_event_record');
    expect(tool).toMatchObject({
      name: 'brainbase_knowledge_event_record',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    });
  });
});
