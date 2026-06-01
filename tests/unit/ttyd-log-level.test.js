import { describe, expect, it, vi } from 'vitest';
import { classifyTtydStderrLevel, logTtydStderr } from '../../server/services/session-runtime/ttyd-log-level.js';

describe('classifyTtydStderrLevel', () => {
  it('N(notice)接頭辞のバナー行_infoに分類される', () => {
    const line = '[06/01 22:25:38:123] N: ttyd 1.7.7-unknown (libwebsockets 4.5.2-unknown)';
    expect(classifyTtydStderrLevel(line)).toBe('info');
  });

  it('W(warning)接頭辞の行_warnに分類される', () => {
    const line = "[06/01 22:25:38:123] W: callback_lws_sshd_demo: Can't open /etc/lws-test-sshd-server-key";
    expect(classifyTtydStderrLevel(line)).toBe('warn');
  });

  it('E(error)接頭辞の行_errorに分類される', () => {
    const line = '[06/01 22:25:38:123] E: lws_create_context failed';
    expect(classifyTtydStderrLevel(line)).toBe('error');
  });

  it('D(debug)接頭辞の行_infoに分類される', () => {
    const line = '[06/01 22:25:38:123] D: some debug detail';
    expect(classifyTtydStderrLevel(line)).toBe('info');
  });

  it('複数行チャンクでNとWが混在_最高シビリティのwarnに分類される', () => {
    const chunk = [
      '[06/01 22:25:38:123] N: tty configuration:',
      '[06/01 22:25:38:123] N:   max clients: 4',
      "[06/01 22:25:38:123] W: ssh pvo \"",
    ].join('\n');
    expect(classifyTtydStderrLevel(chunk)).toBe('warn');
  });

  it('複数行チャンクでNとEが混在_本物のerrorが降格されずerrorに分類される', () => {
    const chunk = [
      '[06/01 22:25:38:123] N: tty configuration:',
      '[06/01 22:25:38:123] E: fatal: cannot bind port',
    ].join('\n');
    expect(classifyTtydStderrLevel(chunk)).toBe('error');
  });

  it('実際のttyd起動バナー全体_warnに分類される(noticeとwarningのみ)', () => {
    const banner =
      '[06/01 22:25:38:] N: ttyd 1.7.7-unknown (libwebsockets 4.5.2-unknown)\n' +
      '[06/01 22:25:38:] N: tty configuration:\n' +
      '[06/01 22:25:38:] N:   start command: bash login_script.sh session- claude\n' +
      '[06/01 22:25:38:] N: lws_create_context: LWS: 4.5.2-unknown\n' +
      '[06/01 22:25:38:] N: elops_init_pt_uv:  Using foreign event loop...\n' +
      "[06/01 22:25:38:] W: callback_lws_sshd_demo: Can't open /etc/lws-test-sshd-server-key\n" +
      '[06/01 22:25:38:] W: ssh pvo "';
    expect(classifyTtydStderrLevel(banner)).toBe('warn');
  });

  it('純粋なnoticeのみのバナー_infoに分類される', () => {
    const banner =
      '[06/01 23:00:01:] N: [vh|2|default||]: lws_socket_bind: source ads 0.0.0.0\n' +
      '[06/01 23:00:01:] N:  Listening on port:';
    expect(classifyTtydStderrLevel(banner)).toBe('info');
  });

  it('ttydトークンを持たない想定外stderr_warnに分類される', () => {
    expect(classifyTtydStderrLevel('Segmentation fault')).toBe('warn');
  });

  it('空文字列や空白のみ_infoに分類される', () => {
    expect(classifyTtydStderrLevel('')).toBe('info');
    expect(classifyTtydStderrLevel('   \n  ')).toBe('info');
  });

  it('Buffer入力_文字列に強制されて分類される', () => {
    const buf = Buffer.from('[06/01 22:25:38:] E: boom', 'utf8');
    expect(classifyTtydStderrLevel(buf)).toBe('error');
  });

  it('null/undefined_infoに分類される(クラッシュしない)', () => {
    expect(classifyTtydStderrLevel(null)).toBe('info');
    expect(classifyTtydStderrLevel(undefined)).toBe('info');
  });

  it('タイムスタンプ無しのbare先頭トークン行_トークンで分類される', () => {
    // stderr 'data' が行途中で分割され、継続断片がタイムスタンプ括弧を持たないケース
    expect(classifyTtydStderrLevel('E: bare continuation line')).toBe('error');
    expect(classifyTtydStderrLevel('N: bare notice')).toBe('info');
    expect(classifyTtydStderrLevel('  W: indented bare warning')).toBe('warn');
  });

  it('非トークン行とトークン行が混在_トークンが認識されdefault warnに落ちない', () => {
    const chunk = 'some untagged preamble line\n[06/01 22:25:38:] N: tty configuration:';
    // トークン行が1つでもあれば sawToken=true となり、unknown→warn の default には落ちない
    expect(classifyTtydStderrLevel(chunk)).toBe('info');
  });
});

describe('logTtydStderr', () => {
  function makeSpyLogger() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }

  it('notice行_logger.infoで記録されlogger.errorは呼ばれない', () => {
    const logger = makeSpyLogger();
    const level = logTtydStderr(logger, 'session-abc', '[06/01 22:25:38:] N: ttyd 1.7.7-unknown');
    expect(level).toBe('info');
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warning行_logger.warnで記録される', () => {
    const logger = makeSpyLogger();
    const level = logTtydStderr(logger, 'session-abc', "[06/01 22:25:38:] W: Can't open key");
    expect(level).toBe('warn');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('error行_logger.errorで記録される', () => {
    const logger = makeSpyLogger();
    const level = logTtydStderr(logger, 'session-abc', '[06/01 22:25:38:] E: lws_create_context failed');
    expect(level).toBe('error');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('ログ本文はprefix付きで完全保持される(レベルが変わるだけでデータは失われない)', () => {
    const logger = makeSpyLogger();
    const data = '[06/01 22:25:38:] N: tty configuration:\n[06/01 22:25:38:] N:   max clients: 4';
    logTtydStderr(logger, 'session-xyz', data);
    expect(logger.info).toHaveBeenCalledWith(`[ttyd:session-xyz] ${data}`);
  });

  it('複数行でNとEが混在_最高シビリティのlogger.errorで一度だけ記録される', () => {
    const logger = makeSpyLogger();
    const data = '[06/01 22:25:38:] N: tty configuration:\n[06/01 22:25:38:] E: fatal';
    const level = logTtydStderr(logger, 'session-xyz', data);
    expect(level).toBe('error');
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
