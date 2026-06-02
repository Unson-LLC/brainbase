import { describe, expect, it, vi, afterEach } from 'vitest';
import fs from 'fs';

import { workspaceServiceMethods } from '../../server/services/session-core/workspace-service-methods.js';

// Build a minimal `this` for the mixin: only stateStore + execPromise are used by
// resolveSessionWorkspacePath / _getTmuxCurrentPath.
function makeService({ sessions, execPromise }) {
  return {
    ...workspaceServiceMethods,
    stateStore: { get: () => ({ sessions }) },
    execPromise,
    _persistResolvedWorkspacePath: vi.fn(async () => {})
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveSessionWorkspacePath reuseExistingPath', () => {
  it('returns persisted session.path WITHOUT querying tmux when the path exists', async () => {
    const execPromise = vi.fn(async () => ({ stdout: '' }));
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === '/work/repo');
    const svc = makeService({
      sessions: [{ id: 's1', path: '/work/repo' }],
      execPromise
    });

    const resolved = await svc.resolveSessionWorkspacePath('s1', {
      persist: false,
      preferTmux: true,
      reuseExistingPath: true
    });

    expect(resolved).toBe('/work/repo');
    // the whole point: no `tmux list-panes` subprocess on the hot path
    expect(execPromise).not.toHaveBeenCalled();
  });

  it('falls back to full (tmux-preferring) resolution when session.path is missing/stale', async () => {
    const execPromise = vi.fn(async () => ({ stdout: '/work/from-tmux\n' }));
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === '/work/from-tmux');
    const svc = makeService({
      sessions: [{ id: 's1', path: '/work/gone' }], // persisted path no longer exists
      execPromise
    });

    const resolved = await svc.resolveSessionWorkspacePath('s1', {
      persist: false,
      preferTmux: true,
      reuseExistingPath: true
    });

    expect(resolved).toBe('/work/from-tmux');
    expect(execPromise).toHaveBeenCalledTimes(1); // tmux was queried in the fallback
  });

  it('does not short-circuit when reuseExistingPath is not set (default callers unchanged)', async () => {
    const execPromise = vi.fn(async () => ({ stdout: '/work/from-tmux\n' }));
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === '/work/repo' || p === '/work/from-tmux');
    const svc = makeService({
      sessions: [{ id: 's1', path: '/work/repo' }],
      execPromise
    });

    const resolved = await svc.resolveSessionWorkspacePath('s1', {
      persist: false,
      preferTmux: true
    });

    // tmux is still preferred for existing callers; reuse must be opt-in only
    expect(execPromise).toHaveBeenCalledTimes(1);
    expect(resolved).toBe('/work/from-tmux');
  });
});
