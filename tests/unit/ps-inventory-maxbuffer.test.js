import { describe, expect, it, vi } from 'vitest';
import { PS_INVENTORY_MAX_BUFFER } from '../../server/services/session-runtime/ps-inventory-config.js';
import { runtimeQueryMethods } from '../../server/services/session-runtime/runtime-query-methods.js';
import { TerminalRuntimeReconciler } from '../../server/services/terminal-runtime-reconciler.js';

// Regression guard: the full-command `ps -axo ...command=` output can exceed
// Node's 1 MB default exec buffer on a busy host, which throws
// "stdout maxBuffer length exceeded" and silently blinds runtime inventory and
// the terminal reconciler (it then sees zero processes). Both ps call sites must
// pass a generous maxBuffer so observation never fails purely for output size.

const MIN_SAFE_BUFFER = 16 * 1024 * 1024; // anything below this is too close to the 1MB default

describe('ps inventory maxBuffer', () => {
  it('PS_INVENTORY_MAX_BUFFER_は1MBデフォルトより十分大きい', () => {
    expect(PS_INVENTORY_MAX_BUFFER).toBeGreaterThanOrEqual(MIN_SAFE_BUFFER);
  });

  it('getRuntimeInventory呼び出し時_ps execPromiseに大きなmaxBufferが渡される', async () => {
    const calls = [];
    const host = {
      stateStore: { get: () => ({ sessions: [] }) },
      activeSessions: new Map(),
      execPromise: vi.fn((command, options) => {
        calls.push({ command, options });
        return Promise.resolve({ stdout: '' });
      }),
    };

    await runtimeQueryMethods.getRuntimeInventory.call(host);

    const psCall = calls.find((c) => String(c.command).startsWith('ps -axo'));
    expect(psCall).toBeTruthy();
    expect(psCall.options?.maxBuffer).toBeGreaterThanOrEqual(MIN_SAFE_BUFFER);
  });

  it('reconciler_listProcesses呼び出し時_ps execSyncに大きなmaxBufferが渡される', () => {
    const calls = [];
    const reconciler = new TerminalRuntimeReconciler({
      stateStore: { get: () => ({ sessions: [] }) },
      runtimeRegistry: { getSession: () => null, getAll: () => ({ sessions: {} }), updateSession: () => {} },
      execSyncFn: vi.fn((command, options) => {
        calls.push({ command, options });
        return '';
      }),
    });

    reconciler._listProcesses();

    const psCall = calls.find((c) => String(c.command).startsWith('ps -axo'));
    expect(psCall).toBeTruthy();
    expect(psCall.options?.maxBuffer).toBeGreaterThanOrEqual(MIN_SAFE_BUFFER);
  });

  it('reconciler_listProcesses_ps出力を行ごとにパースして返す(maxBuffer追加後も既存挙動維持)', () => {
    const reconciler = new TerminalRuntimeReconciler({
      stateStore: { get: () => ({ sessions: [] }) },
      runtimeRegistry: { getSession: () => null, getAll: () => ({ sessions: {} }), updateSession: () => {} },
      execSyncFn: () => '1000 1 1000 /usr/bin/ttyd --port 7681\n',
    });

    const procs = reconciler._listProcesses();
    expect(Array.isArray(procs)).toBe(true);
    expect(procs.length).toBe(1);
    expect(procs[0].pid).toBe(1000);
  });
});
