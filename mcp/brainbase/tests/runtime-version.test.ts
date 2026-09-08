import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readRuntimeVersion } from '../src/runtime-version.js';

describe('MCP runtime version readback', () => {
  it('reports the launcher-captured process SHA and clean state', () => {
    const readback = readRuntimeVersion({
      BRAINBASE_RUNTIME_GIT_SHA: 'a'.repeat(40),
      BRAINBASE_RUNTIME_GIT_DIRTY: 'false',
      BRAINBASE_RUNTIME_STARTED_AT: '2026-09-02T00:00:00.000Z',
    }, 1234);

    assert.deepEqual(readback, {
      status: 200,
      body: {
        ready: true,
        runtime: {
          git: { sha: 'a'.repeat(40), dirty: false },
          pid: 1234,
          started_at: '2026-09-02T00:00:00.000Z',
        },
      },
    });
  });

  it('fails closed when the runtime identity was not captured by the launcher', () => {
    assert.deepEqual(readRuntimeVersion({}, 1234), {
      status: 503,
      body: { ready: false, reason: 'runtime_version_unavailable' },
    });
  });
});
