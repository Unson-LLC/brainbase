import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeQueryMethods } from '../../server/services/session-runtime/runtime-query-methods.js';
import { runtimeMaintenanceMethods } from '../../server/services/session-runtime/runtime-maintenance-methods.js';

// STR-011: _isXtermOnlyMode must be determined by the configured terminal transport
// alone. The previous `&& BRAINBASE_TEST_MODE !== 'false'` clause left production
// (transport=xterm, TEST_MODE=false) NOT recognized as xterm-only, so ttyd-vestigial
// code (incl. repairActiveTtydSessions spawning ttyd that timed out every watchdog
// cycle) stayed active.

describe('_isXtermOnlyMode transport gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('transport=xterm かつ TEST_MODE=false でも xterm-only と判定する（本番条件）', () => {
    vi.stubEnv('BRAINBASE_TERMINAL_TRANSPORT', 'xterm');
    vi.stubEnv('BRAINBASE_TEST_MODE', 'false');
    expect(runtimeQueryMethods._isXtermOnlyMode.call({})).toBe(true);
  });

  it('transport=xterm かつ TEST_MODE 未設定でも xterm-only と判定する', () => {
    vi.stubEnv('BRAINBASE_TERMINAL_TRANSPORT', 'xterm');
    vi.stubEnv('BRAINBASE_TEST_MODE', undefined);
    expect(runtimeQueryMethods._isXtermOnlyMode.call({})).toBe(true);
  });

  it('transport=ttyd では xterm-only ではない', () => {
    vi.stubEnv('BRAINBASE_TERMINAL_TRANSPORT', 'ttyd');
    vi.stubEnv('BRAINBASE_TEST_MODE', 'false');
    expect(runtimeQueryMethods._isXtermOnlyMode.call({})).toBe(false);
  });

  it('transport 未設定では xterm-only ではない', () => {
    vi.stubEnv('BRAINBASE_TERMINAL_TRANSPORT', undefined);
    expect(runtimeQueryMethods._isXtermOnlyMode.call({})).toBe(false);
  });

  it('repairActiveTtydSessions は xterm-only(本番条件)で早期returnしttyd修復をしない（churn停止）', async () => {
    vi.stubEnv('BRAINBASE_TERMINAL_TRANSPORT', 'xterm');
    vi.stubEnv('BRAINBASE_TEST_MODE', 'false');
    let getRuntimeStatusCalled = false;
    const host = {
      _isXtermOnlyMode: runtimeQueryMethods._isXtermOnlyMode,
      stateStore: { get: () => ({ sessions: [{ id: 'session-1', intendedState: 'active', ttydProcess: { pid: 1, port: 7681 } }] }) },
      getRuntimeStatus: () => { getRuntimeStatusCalled = true; return { ttydRunning: false }; },
      ensureTtydForActiveSession: () => { throw new Error('must not attempt ttyd repair under xterm-only'); },
    };
    const result = await runtimeMaintenanceMethods.repairActiveTtydSessions.call(host);
    expect(result).toEqual({ checked: 0, restarted: 0, failed: 0, skipped: 0 });
    expect(getRuntimeStatusCalled).toBe(false);
  });

  it('repairActiveTtydSessions は ttyd transport では従来どおり active セッションを検査する', async () => {
    vi.stubEnv('BRAINBASE_TERMINAL_TRANSPORT', 'ttyd');
    let checked = 0;
    const host = {
      _isXtermOnlyMode: runtimeQueryMethods._isXtermOnlyMode,
      stateStore: { get: () => ({ sessions: [{ id: 'session-1', intendedState: 'active', ttydProcess: { pid: 1, port: 7681 } }] }) },
      getRuntimeStatus: () => { checked += 1; return { ttydRunning: true }; },
      ensureTtydForActiveSession: () => ({ restarted: false }),
    };
    const result = await runtimeMaintenanceMethods.repairActiveTtydSessions.call(host);
    expect(result.checked).toBe(1);
    expect(checked).toBe(1);
  });
});
