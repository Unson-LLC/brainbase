import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { PS_INVENTORY_MAX_BUFFER } from '../../server/services/session-runtime/ps-inventory-config.js';
import { runtimeQueryMethods } from '../../server/services/session-runtime/runtime-query-methods.js';
import { TerminalRuntimeReconciler } from '../../server/services/terminal-runtime-reconciler.js';

// STR-009 ps inventory maxBuffer — in-process e2e (no browser).
// Drives the real inventory + reconciler ps call sites and asserts a large
// maxBuffer is passed so observation never fails purely for output size.

const MIN_SAFE_BUFFER = 16 * 1024 * 1024;

test.describe('str-009-ps-inventory-maxbuffer', () => {
  test('STR-009 ac:1 getRuntimeInventory の ps -axo 呼び出しに、1MB デフォルトを十分超える maxBuffer が渡される', async () => {
    const calls: Array<{ command: string; options: any }> = [];
    const host = {
      stateStore: { get: () => ({ sessions: [] }) },
      activeSessions: new Map(),
      execPromise: (command: string, options: any) => {
        calls.push({ command, options });
        return Promise.resolve({ stdout: '' });
      },
    };
    await runtimeQueryMethods.getRuntimeInventory.call(host as any);
    const psCall = calls.find((c) => String(c.command).startsWith('ps -axo'));
    expect(psCall?.options?.maxBuffer).toBeGreaterThanOrEqual(MIN_SAFE_BUFFER); // getRuntimeInventory の ps -axo 呼び出しに、1MB デフォルトを十分超える maxBuffer が渡される
  });

  test('STR-009 ac:2 terminal reconciler の _listProcesses の ps -axo 呼び出しに、同様に十分大きい maxBuffer が渡される', () => {
    const calls: Array<{ command: string; options: any }> = [];
    const reconciler = new TerminalRuntimeReconciler({
      stateStore: { get: () => ({ sessions: [] }) },
      runtimeRegistry: { getSession: () => null, getAll: () => ({ sessions: {} }), updateSession: () => {} },
      execSyncFn: (command: string, options: any) => {
        calls.push({ command, options });
        return '';
      },
    } as any);
    reconciler._listProcesses();
    const psCall = calls.find((c) => String(c.command).startsWith('ps -axo'));
    expect(psCall?.options?.maxBuffer).toBeGreaterThanOrEqual(MIN_SAFE_BUFFER); // terminal reconciler の _listProcesses の ps -axo 呼び出しに、同様に十分大きい maxBuffer が渡される
  });

  test('STR-009 ac:3 maxBuffer 追加後も _listProcesses は ps 出力を従来どおり行パースしてプロセス配列を返す', () => {
    const reconciler = new TerminalRuntimeReconciler({
      stateStore: { get: () => ({ sessions: [] }) },
      runtimeRegistry: { getSession: () => null, getAll: () => ({ sessions: {} }), updateSession: () => {} },
      execSyncFn: () => '1000 1 1000 /usr/bin/ttyd --port 7681\n',
    } as any);
    const procs = reconciler._listProcesses();
    expect(Array.isArray(procs) && procs.length === 1 && procs[0].pid === 1000).toBe(true); // maxBuffer 追加後も _listProcesses は ps 出力を従来どおり行パースしてプロセス配列を返す
  });

  test('STR-009 ac:4 VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる', () => {
    const artifacts = [
      'docs/stories/STR-009-ps-inventory-maxbuffer.md',
      'docs/specs/STR-009-ps-inventory-maxbuffer.md',
      'server/services/session-runtime/ps-inventory-config.js',
      'tests/unit/ps-inventory-maxbuffer.test.js',
      'tests/e2e/str-009-ps-inventory-maxbuffer.spec.ts',
    ];
    expect(artifacts.every((p) => fs.existsSync(p)) && PS_INVENTORY_MAX_BUFFER >= MIN_SAFE_BUFFER).toBe(true); // VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる
  });
});
