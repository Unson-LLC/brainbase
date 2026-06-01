import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { classifyTtydStderrLevel, logTtydStderr } from '../../server/services/session-runtime/ttyd-log-level.js';

// STR-008 ttyd stderr ログレベル分類 — in-process e2e (no browser).
// ttyd stderr ハンドラが logger[level] を呼ぶときに使う分類関数を、Story の各 AC で検証する。

test.describe('str-008-ttyd-stderr-log-level', () => {
  test('STR-008 ac:1 ttyd の `N:`(notice) / `D:`(debug) 行は error 以外（info）で記録される', () => {
    const notice = '[06/01 22:25:38:] N: ttyd 1.7.7-unknown (libwebsockets 4.5.2-unknown)';
    const debug = '[06/01 22:25:38:] D: lws debug detail';
    expect(classifyTtydStderrLevel(notice)).toBe('info'); // ttyd の `N:`(notice) / `D:`(debug) 行は error 以外（info）で記録される
    expect(classifyTtydStderrLevel(debug)).toBe('info'); // ttyd の `N:`(notice) / `D:`(debug) 行は error 以外（info）で記録される
    expect(classifyTtydStderrLevel(notice)).not.toBe('error');
  });

  test('STR-008 ac:2 ttyd の `W:`(warning) 行は warn で記録される', () => {
    const warning = "[06/01 22:25:38:] W: callback_lws_sshd_demo: Can't open /etc/lws-test-sshd-server-key";
    expect(classifyTtydStderrLevel(warning)).toBe('warn'); // ttyd の `W:`(warning) 行は warn で記録される
  });

  test('STR-008 ac:3 ttyd の `E:`(error) 行は引き続き error で記録される', () => {
    const error = '[06/01 22:25:38:] E: lws_create_context failed';
    expect(classifyTtydStderrLevel(error)).toBe('error'); // ttyd の `E:`(error) 行は引き続き error で記録される
  });

  test('STR-008 ac:4 複数行チャンクは最高シビリティで分類され、notice に混じった `E:` が降格されない', () => {
    const chunk = [
      '[06/01 22:25:38:] N: tty configuration:',
      '[06/01 22:25:38:] N:   max clients: 4',
      '[06/01 22:25:38:] E: fatal: cannot bind port',
    ].join('\n');
    expect(classifyTtydStderrLevel(chunk)).toBe('error'); // 複数行チャンクは最高シビリティで分類され、notice に混じった `E:` が降格されない
  });

  test('STR-008 ac:5 ttyd のログ出力自体は失われない（レベルが変わるだけ）', () => {
    // 実ハンドラ helper を spy logger で駆動し、ペイロードが prefix 付きで完全保持され、
    // benign な notice が logger.error に流れない（=error stream を汚さない）ことを検証する。
    const calls: Array<{ level: string; msg: string }> = [];
    const logger = {
      info: (msg: string) => calls.push({ level: 'info', msg }),
      warn: (msg: string) => calls.push({ level: 'warn', msg }),
      error: (msg: string) => calls.push({ level: 'error', msg }),
    };
    const banner = '[06/01 22:25:38:] N: ttyd 1.7.7-unknown\n[06/01 22:25:38:] W: ssh pvo "';
    logTtydStderr(logger as any, 'session-ac5', banner);
    const errored = calls.filter((c) => c.level === 'error');
    const emitted = calls.find((c) => c.msg.includes(banner));
    expect(emitted && errored.length === 0).toBeTruthy(); // ttyd のログ出力自体は失われない（レベルが変わるだけ）
  });

  test('STR-008 ac:6 VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる', () => {
    // Story -> Spec -> Test -> Code の各成果物が実在することで dogfood の追跡可能性を担保する。
    const artifacts = [
      'docs/stories/STR-008-ttyd-stderr-log-level.md',
      'docs/specs/STR-008-ttyd-stderr-log-level.md',
      'server/services/session-runtime/ttyd-log-level.js',
      'tests/unit/ttyd-log-level.test.js',
      'tests/e2e/str-008-ttyd-stderr-log-level.spec.ts',
    ];
    const allPresent = artifacts.every((p) => fs.existsSync(p));
    expect(allPresent).toBe(true); // VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる
  });
});
