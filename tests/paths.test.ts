import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultDataDir, resolveDataDir } from '../src/paths.js';

const originalEnvValue = process.env.BRAINBASE_PERSONAL_OS_DIR;

afterEach(() => {
  if (originalEnvValue === undefined) {
    delete process.env.BRAINBASE_PERSONAL_OS_DIR;
  } else {
    process.env.BRAINBASE_PERSONAL_OS_DIR = originalEnvValue;
  }
});

describe('Personal OS path resolution', () => {
  it('C-4 defaults to ~/.brainbase/personal-os', () => {
    delete process.env.BRAINBASE_PERSONAL_OS_DIR;

    expect(defaultDataDir()).toBe(resolve(join(homedir(), '.brainbase', 'personal-os')));
  });

  it('C-4 uses BRAINBASE_PERSONAL_OS_DIR when no explicit --dir is provided', () => {
    process.env.BRAINBASE_PERSONAL_OS_DIR = '/tmp/brainbase-env-os';

    expect(resolveDataDir()).toBe(resolve('/tmp/brainbase-env-os'));
  });

  it('C-4 explicit --dir wins over BRAINBASE_PERSONAL_OS_DIR', () => {
    process.env.BRAINBASE_PERSONAL_OS_DIR = '/tmp/brainbase-env-os';

    expect(resolveDataDir('/tmp/brainbase-explicit-os')).toBe(resolve('/tmp/brainbase-explicit-os'));
  });
});
