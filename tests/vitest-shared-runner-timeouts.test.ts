import { describe, expect, it } from 'vitest';
import config, { sharedRunnerTimeouts } from '../vitest.config.mjs';

describe('Vitest time limits on the shared CI machine', () => {
  it('gives each test and hook enough time when CI runs on the shared machine', () => {
    const limits = sharedRunnerTimeouts({ CI: 'true' });
    // CI runs on one machine that several repositories share. Under that load, ordinary
    // tests took up to 14s and hooks over 10s, so the Vitest defaults (5s, 10s) failed.
    expect(limits.testTimeout).toBeGreaterThanOrEqual(30_000);
    expect(limits.hookTimeout).toBeGreaterThanOrEqual(60_000);
  });

  it('keeps the Vitest defaults on a developer machine so a real hang still shows quickly', () => {
    expect(sharedRunnerTimeouts({})).toEqual({ testTimeout: 5_000, hookTimeout: 10_000 });
    expect(sharedRunnerTimeouts({ CI: 'false' })).toEqual({ testTimeout: 5_000, hookTimeout: 10_000 });
  });

  it('applies the limits for the current environment in the config Vitest loads', () => {
    expect(config.test).toMatchObject(sharedRunnerTimeouts(process.env));
  });
});
