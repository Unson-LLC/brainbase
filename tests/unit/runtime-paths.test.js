import { describe, expect, it } from 'vitest';
import { resolveRuntimePaths } from '../../lib/runtime-paths.js';

describe('runtime-paths', () => {
  it('prefers BRAINBASE_STATE_PATH over BRAINBASE_VAR_DIR', () => {
    const runtimePaths = resolveRuntimePaths({
      repoDir: '/Users/ksato/workspace/code/brainbase',
      env: {
        BRAINBASE_STATE_PATH: '/tmp/brainbase-custom/state.json',
        BRAINBASE_VAR_DIR: '/tmp/brainbase-var',
        BRAINBASE_ROOT: '/Users/ksato/workspace/shared'
      }
    });

    expect(runtimePaths.varDir).toBe('/tmp/brainbase-custom');
    expect(runtimePaths.stateFile).toBe('/tmp/brainbase-custom/state.json');
  });

  it('uses only the canonical workspace var directory', () => {
    const runtimePaths = resolveRuntimePaths({
      repoDir: '/Users/ksato/workspace/code/brainbase',
      env: {
        BRAINBASE_ROOT: '/Users/ksato/workspace/shared'
      }
    });

    expect(runtimePaths.workspaceRoot).toBe('/Users/ksato/workspace');
    expect(runtimePaths.varDir).toBe('/Users/ksato/workspace/var');
    expect(runtimePaths.stateFile).toBe('/Users/ksato/workspace/var/state.json');
    expect(runtimePaths).not.toHaveProperty('shadowVarDir');
  });
});
