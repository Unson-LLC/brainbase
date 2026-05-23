import { describe, expect, it, vi } from 'vitest';
import {
  buildBrainbaseUrl,
  buildSessionStateUrl,
  collectTmuxMissingSessionIds,
  parseArgs,
  runPauseOrphanCleanup,
} from '../../../server/scripts/pause-orphan-tmux-missing-sessions.js';

const healthPayload = {
  issues: [
    { type: 'tmux_missing', sessionId: 'session-a' },
    { type: 'tmux_missing', sessionId: 'session/b' },
    { type: 'other', sessionId: 'session-c' },
  ],
};

describe('pause-orphan-tmux-missing-sessions', () => {
  it('builds explicit Brainbase health and session state URLs', () => {
    expect(buildBrainbaseUrl('api/health/terminal', 'http://localhost:31013/'))
      .toBe('http://localhost:31013/api/health/terminal');
    expect(buildSessionStateUrl('session/b', 'http://localhost:31013/'))
      .toBe('http://localhost:31013/api/state/sessions/session%2Fb');
  });

  it('parses repeated --session filters', () => {
    const parsed = parseArgs(['--apply', '--session', 'session-a', '--session', 'session/b']);
    expect(parsed.dryRun).toBe(false);
    expect([...parsed.sessions]).toEqual(['session-a', 'session/b']);
  });

  it('collects only tmux_missing sessions and honors filters', () => {
    expect(collectTmuxMissingSessionIds(healthPayload, null)).toEqual(['session-a', 'session/b']);
    expect(collectTmuxMissingSessionIds(healthPayload, new Set(['session/b']))).toEqual(['session/b']);
  });

  it('does not PATCH in dry-run mode', async () => {
    const fetchImpl = vi.fn(async (url) => {
      expect(url).toBe('http://brainbase.local/api/health/terminal');
      return { ok: true, json: async () => healthPayload };
    });

    const result = await runPauseOrphanCleanup({
      dryRun: true,
      sessions: null,
      fetchImpl,
      baseUrl: 'http://brainbase.local/',
      log: () => {},
      error: () => {},
    });

    expect(result).toEqual({ ids: ['session-a', 'session/b'], ok: 0, fail: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('PATCHes only filtered tmux_missing sessions with paused payload', async () => {
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (!options.method) {
        return { ok: true, json: async () => healthPayload };
      }
      expect(url).toBe('http://brainbase.local/api/state/sessions/session%2Fb');
      expect(options.method).toBe('PATCH');
      expect(JSON.parse(options.body)).toMatchObject({
        intendedState: 'paused',
        pausedReason: 'tmux_missing_runtime',
        pausedAt: '2026-05-22T00:00:00.000Z',
        tmuxMissingAt: '2026-05-22T00:00:00.000Z',
        ttydProcess: null,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ intendedState: 'paused', pausedReason: 'tmux_missing_runtime' }),
      };
    });

    const result = await runPauseOrphanCleanup({
      dryRun: false,
      sessions: new Set(['session/b']),
      fetchImpl,
      baseUrl: 'http://brainbase.local/',
      now: '2026-05-22T00:00:00.000Z',
      log: () => {},
      error: () => {},
    });

    expect(result).toEqual({ ids: ['session/b'], ok: 1, fail: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
