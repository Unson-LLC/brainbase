import { describe, expect, it } from 'vitest';
import { buildDirectLaunchDecision, assertAllowedServerEntrypoint } from '../../server/bootstrap/direct-launch-guard.js';

describe('direct-launch-guard', () => {
  it('canonical portのserver.js直接起動時_blockする', () => {
    const decision = buildDirectLaunchDecision({
      port: 31013,
      canonicalPort: 31013,
      startedByStartJs: false,
      allowDirectServer: false,
      testMode: false,
      isWorktree: false
    });

    expect(decision.allowed).toBe(false);
    expect(() => assertAllowedServerEntrypoint({
      port: 31013,
      canonicalPort: 31013
    })).toThrow(/Direct server\.js launch/);
  });

  it('start.js経由またはdev/test例外時_allowする', () => {
    expect(buildDirectLaunchDecision({ port: 31013, canonicalPort: 31013, startedByStartJs: true }).allowed).toBe(true);
    expect(buildDirectLaunchDecision({ port: 31013, canonicalPort: 31013, allowDirectServer: true }).allowed).toBe(true);
    expect(buildDirectLaunchDecision({ port: 31013, canonicalPort: 31013, testMode: true }).allowed).toBe(true);
    expect(buildDirectLaunchDecision({ port: 31014, canonicalPort: 31013 }).allowed).toBe(true);
  });
});
