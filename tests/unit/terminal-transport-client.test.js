import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalTransportClient, TERMINAL_SCROLLBACK_LINES, shouldUseXtermTransport } from '../../public/modules/core/terminal-transport-client.js';
import { httpClient } from '../../public/modules/core/http-client.js';

describe('terminal-transport-client', () => {
  const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    vi.spyOn(httpClient, 'get').mockResolvedValue({ ok: true, access: { role: 'member' } });
    vi.spyOn(httpClient, 'post').mockResolvedValue({ inputReady: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('localhost desktop環境ではxterm transportを使う', () => {
    vi.stubGlobal('window', {
      innerWidth: 1280,
      location: { hostname: 'localhost' }
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });

    expect(shouldUseXtermTransport()).toBe(true);
  });

  it('xterm scrollbackはtmux history-limit相当を保持する', async () => {
    expect(TERMINAL_SCROLLBACK_LINES).toBe(5000);
  });

  it('mobile環境ではxterm transportを使わない', () => {
    vi.stubGlobal('window', {
      innerWidth: 390,
      location: { hostname: 'localhost' }
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });

    expect(shouldUseXtermTransport()).toBe(false);
  });

  it('Cloudflare hostnameでもxterm transportを使う', () => {
    vi.stubGlobal('window', {
      innerWidth: 1440,
      location: { hostname: 'brain-base.work' }
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });

    expect(shouldUseXtermTransport()).toBe(true);
  });

  it('jsdom環境ではxterm transportを使わない', () => {
    vi.stubGlobal('window', {
      innerWidth: 1280,
      location: { hostname: 'localhost' }
    });
    vi.stubGlobal('navigator', { userAgent: 'jsdom/24.0.0' });

    expect(shouldUseXtermTransport()).toBe(false);
  });

  it('同一sessionかつWebSocket openかつowner/inputReadyなら入力可能と判定する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.sessionId = 'session-1';
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = true;
    client.ws = { readyState: 1 };

    expect(client.canSendInput('session-1')).toBe(true);
    expect(client.canSendInput('session-2')).toBe(false);
  });

  it('verifyInputReadyは既にownerかつinputReadyならprobe APIを再実行しない', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.sessionId = 'session-1';
    client.status.mode = 'live';
    client.status.connected = true;
    client.status.runtimeState = 'interactive_ready';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = true;
    client.ws = { readyState: 1 };

    const result = await client.verifyInputReady();

    expect(result).toBe(true);
    expect(httpClient.post).not.toHaveBeenCalledWith(
      '/api/sessions/session-1/terminal/probe-input',
      expect.anything(),
      expect.anything()
    );
  });

  it('inputReadyでない場合はWebSocket openでも入力不可と判定する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.sessionId = 'session-1';
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = false;
    client.ws = { readyState: 1 };

    expect(client.canSendInput('session-1')).toBe(false);
  });

  it('INV-4/S-3 alternate bufferではwheelをtmux scroll messageへ変換する', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', { OPEN: 1 });
    const host = document.createElement('div');
    const send = vi.fn();
    const alternate = {};
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.hostEl = host;
    client.ws = { readyState: 1, send };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.terminal = {
      buffer: {
        active: alternate,
        alternate
      }
    };
    client._attachScrollHandlers();

    const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    host.dispatchEvent(event);
    await vi.advanceTimersByTimeAsync(16);

    expect(event.defaultPrevented).toBe(true);
    expect(send).toHaveBeenCalledWith(JSON.stringify({
      type: 'scroll',
      direction: 'down',
      steps: 3
    }));
    expect(client.status.copyMode).toBe(true);
  });

  it('INV-5/AP-2 通常bufferではwheelを奪わずnative scrollbackへ任せる', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', { OPEN: 1 });
    const host = document.createElement('div');
    const send = vi.fn();
    const alternate = {};
    const normal = {};
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.hostEl = host;
    client.ws = { readyState: 1, send };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.terminal = {
      buffer: {
        active: normal,
        alternate
      }
    };
    client._attachScrollHandlers();

    const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    host.dispatchEvent(event);
    await vi.advanceTimersByTimeAsync(16);

    expect(event.defaultPrevented).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('blocked sessionを判定できる', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.sessionId = 'session-1';
    client.status.mode = 'blocked';
    client.status.blockedAccess = { state: 'blocked' };

    expect(client.isBlockedForSession('session-1')).toBe(true);
    expect(client.isBlockedForSession('session-2')).toBe(false);
  });

  it('xterm host幅が変わるとviewport同期を予約する', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(callback, 0));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.syncViewportSize = vi.fn();
    client._lastObservedHostWidth = 320;
    client._lastObservedHostHeight = 720;

    client._handleHostResize({ width: 640, height: 720 });
    await vi.runAllTimersAsync();

    expect(client.syncViewportSize).toHaveBeenCalledTimes(1);

    client._handleHostResize({ width: 640, height: 720 });
    await vi.runAllTimersAsync();

    expect(client.syncViewportSize).toHaveBeenCalledTimes(1);

    client._handleHostResize({ width: 80, height: 720 });
    await vi.runAllTimersAsync();

    expect(client.syncViewportSize).toHaveBeenCalledTimes(1);
  });

  it('非表示から戻った後はviewport同期とxterm再描画を行う', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(callback, 0));

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const refresh = vi.fn();
    client.hostEl = {
      getBoundingClientRect: () => ({ width: 640, height: 480 })
    };
    client.terminal = { cols: 100, rows: 30, refresh };
    client.fitAddon = { fit: vi.fn() };
    client.ws = { readyState: 1, send: vi.fn() };

    await client.restoreAfterReveal();
    await vi.runAllTimersAsync();

    expect(client.fitAddon.fit).toHaveBeenCalled();
    expect(client.ws.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'resize',
      cols: 100,
      rows: 30
    }));
    expect(refresh).toHaveBeenCalledWith(0, 29);
  });

  it('blocked snapshotではスクロール可能なfull snapshotを要求する', async () => {
    httpClient.get.mockResolvedValueOnce({
      text: 'readonly snapshot',
      colorText: 'readonly snapshot',
      capturedAt: '2026-05-09T01:00:00.000Z'
    });
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.sessionId = 'session-blocked';
    client.status.mode = 'blocked';
    client.status.terminalAccess = { state: 'blocked' };
    client._queueOrApplySnapshot = vi.fn();

    await client.refreshSnapshot();

    expect(httpClient.get).toHaveBeenCalledWith(expect.stringContaining('/api/sessions/session-blocked/terminal/snapshot?'));
    const url = new URL(httpClient.get.mock.calls[0][0], 'http://localhost');
    expect(url.searchParams.get('lines')).toBe('400');
    expect(url.searchParams.get('visibleOnly')).toBe('0');
    expect(client._queueOrApplySnapshot).toHaveBeenCalledWith('readonly snapshot', null);
  });

  it('owner snapshotでは表示安定用にvisible snapshotを要求する', async () => {
    httpClient.get.mockResolvedValueOnce({
      text: 'visible snapshot',
      colorText: 'visible snapshot',
      capturedAt: '2026-05-09T01:00:00.000Z'
    });
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.sessionId = 'session-owner';
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client._queueOrApplySnapshot = vi.fn();

    await client.refreshSnapshot();

    const url = new URL(httpClient.get.mock.calls[0][0], 'http://localhost');
    expect(url.searchParams.get('visibleOnly')).toBe('1');
  });

  it('hasDomFocusはxterm host内の実DOM focusだけをtrueにする', () => {
    document.body.innerHTML = `
      <div id="terminal-xterm-host">
        <textarea class="xterm-helper-textarea"></textarea>
      </div>
      <button id="outside">outside</button>
    `;
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.hostEl = document.getElementById('terminal-xterm-host');

    expect(client.hasDomFocus()).toBe(false);

    document.querySelector('.xterm-helper-textarea').focus();
    expect(client.hasDomFocus()).toBe(true);

    document.getElementById('outside').focus();
    expect(client.hasDomFocus()).toBe(false);
  });

  it('connect時に初期viewportサイズをws queryへ含めてready後もresizeを送る', async () => {
    const sentMessages = [];
    let openedUrl = null;

    class MockWebSocket {
      static OPEN = 1;
      static CONNECTING = 0;

      constructor(url) {
        openedUrl = url;
        this.url = url;
        this.readyState = MockWebSocket.OPEN;
        this.listeners = new Map();
        queueMicrotask(() => {
          this._emit('message', {
            data: JSON.stringify({ type: 'ready', sessionId: 'session-1', cols: 98, rows: 32, inputReady: true, terminalAccess: { state: 'owner' } })
          });
          this._emit('message', {
            data: JSON.stringify({ type: 'status', mode: 'live', transport: 'streaming', copyMode: false })
          });
        });
      }

      addEventListener(type, listener) {
        const current = this.listeners.get(type) || [];
        current.push(listener);
        this.listeners.set(type, current);
      }

      send(message) {
        sentMessages.push(JSON.parse(message));
      }

      close() {}

      _emit(type, event) {
        for (const listener of this.listeners.get(type) || []) {
          listener(event);
        }
      }
    }

    vi.stubGlobal('window', {
      location: { protocol: 'http:', host: 'localhost:31013', hostname: 'localhost' }
    });
    vi.stubGlobal('WebSocket', MockWebSocket);

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.fitAddon = { fit: vi.fn() };
    client.terminal = { cols: 98, rows: 32 };

    await client.connect('session-1');

    const url = new URL(openedUrl);
    expect(url.searchParams.get('cols')).toBe('98');
    expect(url.searchParams.get('rows')).toBe('32');
    expect(client.fitAddon.fit).toHaveBeenCalled();
    expect(sentMessages).toContainEqual({
      type: 'resize',
      cols: 98,
      rows: 32
    });
  });

  it('認証確認が失敗してもWebSocket接続は継続する', async () => {
    vi.spyOn(httpClient, 'get').mockRejectedValue(new Error('HTTP Error: 401 Unauthorized'));

    class MockWebSocket {
      static OPEN = 1;
      static CONNECTING = 0;

      constructor() {
        this.readyState = MockWebSocket.OPEN;
        this.listeners = new Map();
      }

      addEventListener(type, listener) {
        const current = this.listeners.get(type) || [];
        current.push(listener);
        this.listeners.set(type, current);
      }

      send() {}

      close() {}

      emitReady() {
        this._emit('message', {
          data: JSON.stringify({ type: 'ready', sessionId: 'session-1', inputReady: true, terminalAccess: { state: 'owner' } })
        });
      }

      _emit(type, event) {
        for (const listener of this.listeners.get(type) || []) {
          listener(event);
        }
      }
    }

    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'brain-base.work', hostname: 'brain-base.work' }
    });

    let socket = null;
    vi.stubGlobal('WebSocket', class extends MockWebSocket {
      constructor(...args) {
        super(...args);
        socket = this;
      }
    });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Cloudflare / Mac'
    });

    const connectPromise = client.connect('session-1');
    await flushMicrotasks();
    socket.emitReady();

    await expect(connectPromise).resolves.toEqual({ mode: 'live' });
    expect(httpClient.get).toHaveBeenCalledWith('/api/auth/verify', { suppressAuthError: true });
    expect(client.status.mode).toBe('live');
  });

  it('Shift+Enter押下時_M-Enterとして送信する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.sendKey = vi.fn();

    const preventDefault = vi.fn();
    const handled = client._handleCustomKeyEvent({
      type: 'keydown',
      key: 'Enter',
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault
    });

    expect(handled).toBe(false);
    expect(preventDefault).toHaveBeenCalled();
    expect(client.sendKey).toHaveBeenCalledWith('M-Enter');
  });

  it('inputReady=falseでもShift+EnterのM-Enter keyはprobeせず送信する', async () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const send = vi.fn();
    client.sessionId = 'session-1';
    client.ws = { readyState: 1, send };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = false;

    await client.sendKey('M-Enter');

    expect(httpClient.post).not.toHaveBeenCalledWith(
      '/api/sessions/session-1/terminal/probe-input',
      expect.anything(),
      expect.anything()
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      type: 'input',
      inputType: 'key',
      value: 'M-Enter'
    });
  });

  it('通常Enter押下時_カスタム処理せずxterm標準に任せる', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.sendKey = vi.fn();

    const handled = client._handleCustomKeyEvent({
      type: 'keydown',
      key: 'Enter',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false
    });

    expect(handled).toBe(true);
    expect(client.sendKey).not.toHaveBeenCalled();
  });

  it('短い連続入力は1つのWebSocket text messageにまとめる', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', { OPEN: 1 });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const send = vi.fn();
    client.ws = { readyState: 1, send };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = true;
    client.terminal = { write: vi.fn() };

    await client.sendText('a');
    await client.sendText('b');
    await client.sendText('c');

    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(8);

    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      type: 'input',
      inputType: 'text',
      value: 'abc'
    });
  });

  it('長めのpaste chunkも1KBで分割せず短時間で1つのWebSocket text messageにまとめる', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', { OPEN: 1 });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const send = vi.fn();
    client.ws = { readyState: 1, send };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = true;
    client.terminal = { write: vi.fn() };
    const firstChunk = 'a'.repeat(900);
    const secondChunk = 'b'.repeat(900);

    await client.sendText(firstChunk);
    await client.sendText(secondChunk);

    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(8);

    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      type: 'input',
      inputType: 'text',
      value: `${firstChunk}${secondChunk}`
    });
  });

  it('buffered textはsendKey前にflushされる', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', { OPEN: 1 });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const send = vi.fn();
    client.ws = { readyState: 1, send };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = true;
    client.terminal = { write: vi.fn() };

    await client.sendText('a');
    await client.sendText('b');
    await client.sendKey('C-c');

    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      type: 'input',
      inputType: 'text',
      value: 'ab'
    });
    expect(JSON.parse(send.mock.calls[1][0])).toEqual({
      type: 'input',
      inputType: 'key',
      value: 'C-c'
    });
  });

  it('改行を含むtextは即時送信してbatchしない', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', { OPEN: 1 });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const send = vi.fn();
    client.ws = { readyState: 1, send };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = true;
    client.terminal = { write: vi.fn() };

    await client.sendText('hello\n');

    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      type: 'input',
      inputType: 'text',
      value: 'hello\n'
    });
    expect(client.terminal.write).toHaveBeenCalledWith('\r\n', expect.any(Function));
  });

  it('inputReady=falseでもEnter文字はprobeせず送信する', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', { OPEN: 1 });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const send = vi.fn();
    client.sessionId = 'session-1';
    client.ws = { readyState: 1, send };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = false;
    client.terminal = { write: vi.fn() };

    await client.sendText('\r');

    expect(httpClient.post).not.toHaveBeenCalledWith(
      '/api/sessions/session-1/terminal/probe-input',
      expect.anything(),
      expect.anything()
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      type: 'input',
      inputType: 'text',
      value: '\r'
    });
    expect(client.terminal.write).toHaveBeenCalledWith('\r\n', expect.any(Function));
  });

  it('inputReady=falseの送信Enter時_直前のbuffer本文もqueueせず送信し描画待ちechoを解除する', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', { OPEN: 1 });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const send = vi.fn();
    const terminal = {
      write: vi.fn((text, callback) => callback?.()),
      buffer: { active: { baseY: 0, viewportY: 0 } },
      scrollToBottom: vi.fn()
    };
    client.sessionId = 'session-1';
    client.ws = { readyState: 1, send };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = false;
    client.terminal = terminal;

    client._pendingTextBuffer = '生成して';
    client._pendingEchoText = '生成して';

    await client.sendText('\r');

    expect(httpClient.post).not.toHaveBeenCalledWith(
      '/api/sessions/session-1/terminal/probe-input',
      expect.anything(),
      expect.anything()
    );
    expect(client._messageQueue.size()).toBe(0);
    expect(client._pendingTextBuffer).toBe('');
    expect(client._pendingEchoText).toBe('');
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      type: 'input',
      inputType: 'text',
      value: '生成して'
    });
    expect(JSON.parse(send.mock.calls[1][0])).toEqual({
      type: 'input',
      inputType: 'text',
      value: '\r'
    });
    expect(terminal.write).toHaveBeenCalledWith('\r\n', expect.any(Function));
  });

  it('ws切断中の即時textはinputReady=falseでもdropせずqueueする', async () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.ws = { readyState: 3, send: vi.fn() };
    client.status.mode = 'reconnecting';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = false;

    await client._dispatchTextMessage('生成して\n', { enqueueIfUnavailable: true });

    expect(client._messageQueue.size()).toBe(1);
    expect(client.ws.send).not.toHaveBeenCalled();
  });

  it('canSendInput=falseの即時textはenqueue指定ならdropせずqueueする', async () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.sessionId = 'session-1';
    client.ws = { readyState: 1, send: vi.fn() };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = false;

    await client._dispatchTextMessage('生成して\n', { enqueueIfUnavailable: true });

    expect(client._messageQueue.size()).toBe(1);
    expect(client.ws.send).not.toHaveBeenCalled();
  });

  it('フォーカスイベント混入時_テキスト部分のみバッチしフォーカスは即時送信する', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', { OPEN: 1 });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const send = vi.fn();
    client.ws = { readyState: 1, send };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = true;
    client.terminal = { write: vi.fn() };

    await client.sendText('ab\x1b[Icd');

    // フォーカスイベントで分割: 'ab' (flush) + '\x1b[I' (即時) + 'cd' (バッファ)
    // 'ab' は flush される、'\x1b[I' は即時送信
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      type: 'input',
      inputType: 'text',
      value: 'ab'
    });
    expect(JSON.parse(send.mock.calls[1][0])).toEqual({
      type: 'input',
      inputType: 'text',
      value: '\x1b[I'
    });

    // 'cd' はバッファに残っている
    await vi.advanceTimersByTimeAsync(8);
    expect(send).toHaveBeenCalledTimes(3);
    expect(JSON.parse(send.mock.calls[2][0])).toEqual({
      type: 'input',
      inputType: 'text',
      value: 'cd'
    });
  });

  it('フォーカスイベントのみの入力はローカルエコーを適用しない', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', { OPEN: 1 });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const send = vi.fn();
    client.ws = { readyState: 1, send };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = true;
    client.terminal = { write: vi.fn() };

    await client.sendText('\x1b[I');

    expect(client.terminal.write).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('テキスト間のフォーカスイベントでローカルエコーがテキスト部分のみ適用される', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', { OPEN: 1 });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const send = vi.fn();
    client.ws = { readyState: 1, send };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = true;
    client.terminal = { write: vi.fn() };

    await client.sendText('hello\x1b[Oworld');

    // ローカルエコーは 'hello' と 'world' のみ
    const echoTexts = client.terminal.write.mock.calls.map(c => c[0]);
    expect(echoTexts).toEqual(['hello', 'world']);
  });

  it('Backspaceはローカルエコーせず即時送信してPTYの描画に任せる', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', { OPEN: 1 });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const send = vi.fn();
    client.sessionId = 'session-1';
    client.ws = { readyState: 1, send };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = true;
    client.terminal = { write: vi.fn() };

    await client.sendText('\x7f');

    expect(client.terminal.write).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      type: 'input',
      inputType: 'text',
      value: '\x7f'
    });
  });

  it('日本語IME確定文字はローカルエコーせずPTYの描画に任せる', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', { OPEN: 1 });

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const send = vi.fn();
    client.ws = { readyState: 1, send };
    client.status.mode = 'live';
    client.status.terminalAccess = { state: 'owner' };
    client.status.inputReady = true;
    client.terminal = { write: vi.fn() };

    await client.sendText('生成して');

    expect(client.terminal.write).not.toHaveBeenCalled();
    expect(client._pendingEchoText).toBe('');
  });

  it('IME変換中はhostにbb-ime-composingを付け外しできる', () => {
    vi.useFakeTimers();
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.hostEl = document.createElement('div');

    client._setImeComposing(true);

    expect(client.hostEl.classList.contains('bb-ime-composing')).toBe(true);

    client._setImeComposing(false);

    expect(client.hostEl.classList.contains('bb-ime-composing')).toBe(false);
  });

  it('IME確定文字はcompositionendが欠けても確定入力として判定できる', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });

    expect(client._isImeCommitText('生成して')).toBe(true);
    expect(client._isImeCommitText('hello')).toBe(false);
    expect(client._isImeCommitText('\r')).toBe(false);
    expect(client._isImeCommitText('\x1b[I')).toBe(false);
  });

  it('cursorDebug queryでカーソルレイヤーdebug classを有効化できる', () => {
    document.body.innerHTML = '';
    const hostEl = document.createElement('div');
    vi.stubGlobal('window', {
      location: { search: '?cursorDebug=1' },
    });
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.hostEl = hostEl;

    client._syncCursorDebugClass();

    expect(hostEl.classList.contains('bb-cursor-debug')).toBe(true);
    expect(document.querySelector('.bb-cursor-debug-panel')?.textContent).toContain('state=none');
  });

  it('cursorDebug queryがない通常URLではdebug classを出さない', () => {
    document.body.innerHTML = '';
    const hostEl = document.createElement('div');
    vi.stubGlobal('window', {
      location: { search: '' },
    });
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.hostEl = hostEl;

    client._syncCursorDebugClass();

    expect(hostEl.classList.contains('bb-cursor-debug')).toBe(false);
    expect(document.querySelector('.bb-cursor-debug-panel')).toBeNull();
  });

  it('cursorDebug panelはIMEカーソル状態に追従する', () => {
    document.body.innerHTML = '';
    const hostEl = document.createElement('div');
    vi.stubGlobal('window', {
      location: { search: '?cursorDebug=1' },
    });
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.hostEl = hostEl;

    client._syncCursorDebugClass();
    client._setImeComposing(true);

    expect(document.querySelector('.bb-cursor-debug-panel')?.textContent).toContain('state=composing');

    client._setImeComposing(false, { settleCursor: true });

    expect(document.querySelector('.bb-cursor-debug-panel')?.textContent).toContain('state=settling');

    client._clearImeCursorState();

    expect(document.querySelector('.bb-cursor-debug-panel')?.textContent).toContain('state=none');
  });

  it('xterm DOM cursor補正用にterminal行高をCSS変数へ反映する', () => {
    const hostEl = document.createElement('div');
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.hostEl = hostEl;

    client._syncTerminalMetricVars({ fontSize: 14, lineHeight: 1.35 });

    expect(hostEl.style.getPropertyValue('--bb-terminal-row-height')).toBe('18.9px');
  });

  it('IME確定直後は入力行が終わるまでカーソル補正を維持し送信時に解除する', async () => {
    vi.useFakeTimers();
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.hostEl = document.createElement('div');

    client._setImeComposing(false, { settleCursor: true });

    expect(client.hostEl.classList.contains('bb-ime-cursor-settling')).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);

    expect(client.hostEl.classList.contains('bb-ime-cursor-settling')).toBe(true);

    client._clearImeCursorState();

    expect(client.hostEl.classList.contains('bb-ime-cursor-settling')).toBe(false);
  });

  it('IME確定後の通常出力ではカーソル補正を消さずsubmit feedbackで解除する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.hostEl = document.createElement('div');
    client.terminal = { write: vi.fn((text, callback) => callback?.()) };
    client.status.mode = 'live';

    client._setImeComposing(false, { settleCursor: true });
    client._applyOutput('\r\nprompt repaint');

    expect(client.hostEl.classList.contains('bb-ime-cursor-settling')).toBe(true);

    client._applySubmitFeedback('\r');

    expect(client.hostEl.classList.contains('bb-ime-cursor-settling')).toBe(false);
  });

  it('snapshot適用時_ユーザーが上にスクロール中ならviewport位置を維持する', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const scrollToLine = vi.fn();
    const terminal = {
      buffer: {
        active: {
          baseY: 120,
          viewportY: 80
        }
      },
      write: vi.fn((text, callback) => {
        terminal.buffer.active.baseY = 160;
        callback?.();
      }),
      scrollToLine
    };

    client.terminal = terminal;
    client.fitAddon = { fit: vi.fn() };

    client._applySnapshot('updated output');
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[3J\x1b[Hupdated output',
      expect.any(Function)
    );
    expect(scrollToLine).toHaveBeenCalledWith(120);
    expect(client.fitAddon.fit).not.toHaveBeenCalled();
  });

  it('snapshot適用時_最下部を見ているなら最下部を維持する', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const scrollToBottom = vi.fn();
    const terminal = {
      buffer: {
        active: {
          baseY: 64,
          viewportY: 64
        }
      },
      write: vi.fn((text, callback) => {
        callback?.();
      }),
      scrollToBottom,
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;
    client.fitAddon = { fit: vi.fn() };

    client._applySnapshot('latest output');
    await Promise.resolve();

    expect(scrollToBottom).toHaveBeenCalled();
    expect(terminal.scrollToLine).not.toHaveBeenCalled();
  });

  it('snapshot適用時_cursor座標があればtmuxのカーソル位置へ戻す', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      buffer: {
        active: {
          baseY: 64,
          viewportY: 64
        }
      },
      write: vi.fn((text, callback) => {
        callback?.();
      }),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;

    client._queueOrApplySnapshot('latest output', { x: 2, y: 34 });
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[3J\x1b[Hlatest output\x1b[35;3H',
      expect.any(Function)
    );
  });

  it('tmux snapshot末尾の区切り改行でカーソル行を1段ずらさない', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      buffer: {
        active: {
          baseY: 64,
          viewportY: 64
        }
      },
      write: vi.fn((text, callback) => {
        callback?.();
      }),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;

    client._queueOrApplySnapshot('row 1\n› prompt\n', { x: 2, y: 1 });
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[3J\x1b[Hrow 1\n› prompt\x1b[2;3H',
      expect.any(Function)
    );
  });

  it('履歴付きsnapshot適用時_full snapshotをvisible paneで部分上書きせず保持する', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      buffer: {
        active: {
          baseY: 64,
          viewportY: 64
        }
      },
      write: vi.fn((text, callback) => {
        callback?.();
      }),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;

    client._queueOrApplySnapshot('\x1b[31mold status\x1b[0m\n\x1b[36mcurrent prompt\x1b[0m', { x: 2, y: 5 }, {
      plainText: 'old status\ncurrent prompt',
      visibleText: '\x1b[36mcurrent prompt\x1b[0m',
      visiblePlainText: 'current prompt'
    });
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[3J\x1b[H\x1b[31mold status\x1b[0m\n\x1b[36mcurrent prompt\x1b[0m\x1b[6;3H',
      expect.any(Function)
    );
  });

  it('snapshot末尾のspinnerが変わってもfull snapshotの行を消さない', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      buffer: {
        active: {
          baseY: 64,
          viewportY: 64
        }
      },
      write: vi.fn((text, callback) => {
        callback?.();
      }),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;

    client._queueOrApplySnapshot('old output\n· running task\nprompt', { x: 0, y: 1 }, {
      plainText: 'old output\n· running task\nprompt',
      visibleText: '✢ running task\nprompt',
      visiblePlainText: '✢ running task\nprompt'
    });
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[3J\x1b[Hold output\n· running task\nprompt\x1b[2;1H',
      expect.any(Function)
    );
  });

  it('visible snapshotが表の途中から始まってもfull snapshot内の表行を消さない', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      buffer: {
        active: {
          baseY: 64,
          viewportY: 64
        }
      },
      write: vi.fn((text, callback) => {
        callback?.();
      }),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;

    const fullSnapshot = [
      '  ┌─────┬──────────────────────────┬────────────────────┐',
      '  │ 1   │ 14本のPeriod埋め         │ done               │',
      '  ├─────┼──────────────────────────┼────────────────────┤',
      '  │ 2   │ 5月の3 Story Spec雛形    │ done               │',
      '  ├─────┼──────────────────────────┼────────────────────┤',
      '  │ 3   │ (Slack canvas)           │ done               │',
      '  ├─────┼──────────────────────────┼────────────────────┤',
      '  │ 4   │ 完了判定基準ドラフト     │ done               │',
      '  ├─────┼──────────────────────────┼────────────────────┤',
      '  │ 5   │ フィードバック収集 Story │ done               │',
      '  └─────┴──────────────────────────┴────────────────────┘'
    ].join('\n');
    const visibleSnapshot = [
      '  ├─────┼──────────────────────────┼────────────────────┤',
      '  │ 5   │ フィードバック収集 Story │ done               │',
      '  └─────┴──────────────────────────┴────────────────────┘'
    ].join('\n');

    client._queueOrApplySnapshot(fullSnapshot, null, {
      plainText: fullSnapshot,
      visibleText: visibleSnapshot,
      visiblePlainText: visibleSnapshot
    });
    await Promise.resolve();

    const written = terminal.write.mock.calls[0][0];
    expect(written).toContain('│ 1   │ 14本のPeriod埋め');
    expect(written).toContain('│ 4   │ 完了判定基準ドラフト');
    expect(written).toContain('│ 5   │ フィードバック収集 Story');
    expect(written).not.toContain('\x1b[2J\x1b[H  ├─────');
  });

  it('snapshot行がterminal最終列で終わる場合_改行をautowrapと二重適用しない', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      cols: 10,
      buffer: {
        active: {
          baseY: 64,
          viewportY: 64
        }
      },
      write: vi.fn((text, callback) => {
        callback?.();
      }),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;

    client._queueOrApplySnapshot('1234567890\nnext');
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[3J\x1b[H1234567890next',
      expect.any(Function)
    );
  });

  it('ANSI付きsnapshot行も表示セル幅で改行二重適用を避ける', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      cols: 10,
      buffer: {
        active: {
          baseY: 64,
          viewportY: 64
        }
      },
      write: vi.fn((text, callback) => {
        callback?.();
      }),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;

    client._queueOrApplySnapshot('\x1b[36m1234567890\x1b[0m\nnext');
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[3J\x1b[H\x1b[36m1234567890\x1b[0mnext',
      expect.any(Function)
    );
  });

  it('screenOnly snapshot適用時_現在画面だけ消してscrollbackは消さない', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      buffer: {
        active: {
          baseY: 64,
          viewportY: 64
        }
      },
      write: vi.fn((text, callback) => {
        callback?.();
      }),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;

    client._queueOrApplySnapshot('live frame', null, { screenOnly: true });
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[H\x1b[?7l\x1b[1;1Hlive frame\x1b[?7h',
      expect.any(Function)
    );
  });

  it('screenOnly snapshotは行を絶対座標で描いてtmuxカーソル行と同期する', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      cols: 10,
      buffer: {
        active: {
          baseY: 64,
          viewportY: 64
        }
      },
      write: vi.fn((text, callback) => {
        callback?.();
      }),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;

    client._queueOrApplySnapshot('1234567890\n\n› prompt\nstatus\n', { x: 8, y: 2 }, { screenOnly: true });
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[H\x1b[?7l\x1b[1;1H1234567890\x1b[3;1H› prompt\x1b[4;1Hstatus\x1b[?7h\x1b[3;9H',
      expect.any(Function)
    );
  });

  it('初回snapshot適用時_xterm内部バッファをresetしてから再描画する', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      buffer: {
        active: {
          baseY: 64,
          viewportY: 64
        }
      },
      reset: vi.fn(),
      write: vi.fn((text, callback) => {
        callback?.();
      }),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;
    client._resetTerminalOnNextSnapshot = true;
    client._lastSnapshotText = 'same output';

    client._queueOrApplySnapshot('same output');
    await Promise.resolve();

    expect(terminal.reset).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[3J\x1b[Hsame output',
      expect.any(Function)
    );
    expect(client._resetTerminalOnNextSnapshot).toBe(false);
  });

  it('scroll中に新しいsnapshotが来たら適用を保留する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      buffer: {
        active: {
          baseY: 120,
          viewportY: 80
        }
      },
      write: vi.fn()
    };

    client.terminal = terminal;
    client._queueOrApplySnapshot('new output');

    expect(terminal.write).not.toHaveBeenCalled();
    expect(client._pendingSnapshotText).toBe('new output');
  });

  it('scroll中に保留したsnapshotは最下部に戻った時だけ反映する', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const scrollToBottom = vi.fn();
    const terminal = {
      buffer: {
        active: {
          baseY: 120,
          viewportY: 80
        }
      },
      write: vi.fn((text, callback) => {
        terminal.buffer.active.viewportY = terminal.buffer.active.baseY;
        callback?.();
      }),
      scrollToBottom
    };

    client.terminal = terminal;
    client.fitAddon = { fit: vi.fn() };
    client._pendingSnapshotText = 'queued output';

    terminal.buffer.active.viewportY = terminal.buffer.active.baseY;
    client._handleTerminalScroll();
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[3J\x1b[Hqueued output',
      expect.any(Function)
    );
    expect(scrollToBottom).toHaveBeenCalled();
    expect(client._pendingSnapshotText).toBeNull();
  });

  it('別sessionへ切り替えた直後の最初のsnapshotはscroll位置に関係なく即反映する', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      cols: 98,
      rows: 32,
      buffer: {
        active: {
          baseY: 120,
          viewportY: 80
        }
      },
      write: vi.fn((text, callback) => {
        terminal.buffer.active.baseY = 0;
        terminal.buffer.active.viewportY = 0;
        callback?.();
      }),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn()
    };

    const sockets = [];

    class MockWebSocket {
      static OPEN = 1;
      static CONNECTING = 0;

      constructor(url) {
        this.url = url;
        this.readyState = MockWebSocket.OPEN;
        this.listeners = new Map();
        sockets.push(this);
      }

      addEventListener(type, listener) {
        const current = this.listeners.get(type) || [];
        current.push(listener);
        this.listeners.set(type, current);
      }

      send() {}

      close() {
        this.readyState = 3;
      }

      _emit(type, event) {
        for (const listener of this.listeners.get(type) || []) {
          listener(event);
        }
      }
    }

    vi.stubGlobal('window', {
      location: { protocol: 'http:', host: 'localhost:31013', hostname: 'localhost' }
    });
    vi.stubGlobal('WebSocket', MockWebSocket);

    client.fitAddon = { fit: vi.fn() };
    client.terminal = terminal;
    client.sessionId = 'session-1';

    const connectPromise = client.connect('session-2');
    await flushMicrotasks();
    const socket = sockets[0];
    socket._emit('message', {
      data: JSON.stringify({ type: 'ready', sessionId: 'session-2', cols: 98, rows: 32, inputReady: true, terminalAccess: { state: 'owner' } })
    });
    socket._emit('message', {
      data: JSON.stringify({ type: 'snapshot', text: 'session-2 output', capturedAt: new Date().toISOString() })
    });
    socket._emit('message', {
      data: JSON.stringify({ type: 'status', mode: 'live', transport: 'streaming', copyMode: false })
    });
    await connectPromise;

    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[3J\x1b[Hsession-2 output',
      expect.any(Function)
    );
    expect(client._pendingSnapshotText).toBeNull();
    expect(client._forceApplyNextSnapshot).toBe(false);
  });

  it('outputメッセージはxtermへそのまま追記する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      write: vi.fn()
    };

    client.terminal = terminal;
    client._applyOutput('\u001b[32mhello\u001b[0m');

    expect(terminal.write).toHaveBeenCalledWith('\u001b[32mhello\u001b[0m', expect.any(Function));
  });

  it('live入力時は印字可能な文字をローカルエコーする', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.status.mode = 'live';
    client.terminal = {
      write: vi.fn()
    };

    client._applyLocalEcho('abc');

    expect(client.terminal.write).toHaveBeenCalledWith('abc', expect.any(Function));
    expect(client._pendingEchoText).toBe('abc');
  });

  it('サーバー出力がローカルエコーと一致する場合は二重描画しない', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      write: vi.fn()
    };

    client.terminal = terminal;
    client._pendingEchoText = 'abc';
    client._applyOutput('abc');

    expect(terminal.write).not.toHaveBeenCalled();
    expect(client._pendingEchoText).toBe('');
  });

  it('サーバー出力がローカルエコーに続く追加出力を含む場合は差分だけ描画する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      write: vi.fn()
    };

    client.terminal = terminal;
    client._pendingEchoText = 'abc\r\n';
    client._applyOutput('abc\r\n$ ');

    expect(terminal.write).toHaveBeenCalledWith('$ ', expect.any(Function));
    expect(client._pendingEchoText).toBe('');
  });

  it('同一session再接続では未確認local echoを保持する', async () => {
    const sentMessages = [];
    let socket = null;

    class MockWebSocket {
      static OPEN = 1;
      static CONNECTING = 0;

      constructor() {
        this.readyState = MockWebSocket.OPEN;
        this.listeners = new Map();
        socket = this;
      }

      addEventListener(type, listener) {
        const current = this.listeners.get(type) || [];
        current.push(listener);
        this.listeners.set(type, current);
      }

      send(message) {
        sentMessages.push(JSON.parse(message));
      }

      close() {}

      _emit(type, event) {
        for (const listener of this.listeners.get(type) || []) {
          listener(event);
        }
      }
    }

    vi.stubGlobal('window', {
      location: { protocol: 'http:', host: 'localhost:31013', hostname: 'localhost' }
    });
    vi.stubGlobal('WebSocket', MockWebSocket);

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.sessionId = 'session-1';
    client._pendingEchoText = 'draft';
    client.terminal = { cols: 98, rows: 32, write: vi.fn() };
    client.fitAddon = { fit: vi.fn() };

    const connectPromise = client.connect('session-1');
    await flushMicrotasks();
    socket._emit('message', {
      data: JSON.stringify({ type: 'ready', sessionId: 'session-1', inputReady: true, terminalAccess: { state: 'owner' } })
    });
    await connectPromise;

    expect(client._pendingEchoText).toBe('draft');
  });

  it('未確認local echoを含まないsnapshotは表示へ適用せず保留する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      buffer: { active: { baseY: 1, viewportY: 1 } },
      write: vi.fn()
    };

    client.terminal = terminal;
    client._pendingEchoText = 'draft';

    client._queueOrApplySnapshot('old prompt');

    expect(terminal.write).not.toHaveBeenCalled();
    expect(client._deferredSnapshotWhileEchoPending).toMatchObject({ text: 'old prompt' });
    expect(client._pendingEchoText).toBe('draft');
    client._clearPendingEchoState();
  });

  it('local echo確認後_保留した古いsnapshotは適用せず破棄する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      buffer: { active: { baseY: 1, viewportY: 1 } },
      write: vi.fn()
    };

    client.terminal = terminal;
    client._pendingEchoText = 'draft';

    client._queueOrApplySnapshot('old prompt');
    client._applyOutput('draft');

    expect(terminal.write).not.toHaveBeenCalled();
    expect(client._pendingEchoText).toBe('');
    expect(client._deferredSnapshotWhileEchoPending).toBeNull();
  });

  it('local echo未確認の保留snapshotは期限切れで描画を再開する', () => {
    vi.useFakeTimers();
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      buffer: { active: { baseY: 1, viewportY: 1 } },
      write: vi.fn()
    };

    client.terminal = terminal;
    client._pendingEchoText = '/tmp/brainbase-uploaded-image.png';
    client._pendingEchoSince = Date.now();

    client._queueOrApplySnapshot('prompt after image');

    expect(terminal.write).not.toHaveBeenCalled();
    expect(client._deferredSnapshotWhileEchoPending).toMatchObject({ text: 'prompt after image' });

    vi.advanceTimersByTime(1300);

    expect(client._pendingEchoText).toBe('');
    expect(client._deferredSnapshotWhileEchoPending).toBeNull();
    expect(terminal.write).toHaveBeenCalledWith('\u001b[2J\u001b[3J\u001b[Hprompt after image', expect.any(Function));
  });

  it('output適用時_上にスクロール中ならviewport位置を維持する', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const scrollToLine = vi.fn();
    const terminal = {
      buffer: {
        active: {
          baseY: 120,
          viewportY: 80
        }
      },
      write: vi.fn((text, callback) => {
        terminal.buffer.active.baseY = 160;
        callback?.();
      }),
      scrollToLine
    };

    client.terminal = terminal;
    client._applyOutput('hello');
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith('hello', expect.any(Function));
    expect(scrollToLine).toHaveBeenCalledWith(120);
  });

  it('output適用時_最下部にいるなら最下部を維持する', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const scrollToBottom = vi.fn();
    const terminal = {
      buffer: {
        active: {
          baseY: 64,
          viewportY: 64
        }
      },
      write: vi.fn((text, callback) => {
        callback?.();
      }),
      scrollToBottom,
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;
    client._applyOutput('hello');
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith('hello', expect.any(Function));
    expect(scrollToBottom).toHaveBeenCalled();
    expect(terminal.scrollToLine).not.toHaveBeenCalled();
  });

  it('古いWebSocketのcloseイベントでは現在のlive状態を上書きしない', async () => {
    const sockets = [];

    class MockWebSocket {
      static OPEN = 1;
      static CONNECTING = 0;

      constructor(url) {
        this.url = url;
        this.readyState = MockWebSocket.OPEN;
        this.listeners = new Map();
        sockets.push(this);
      }

      addEventListener(type, listener) {
        const current = this.listeners.get(type) || [];
        current.push(listener);
        this.listeners.set(type, current);
      }

      send() {}

      close() {
        this.readyState = 3;
        this._emit('close', { code: 1006 });
      }

      _emit(type, event) {
        for (const listener of this.listeners.get(type) || []) {
          listener(event);
        }
      }
    }

    vi.stubGlobal('window', {
      location: { protocol: 'http:', host: 'localhost:31013', hostname: 'localhost' }
    });
    vi.stubGlobal('WebSocket', MockWebSocket);

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.fitAddon = { fit: vi.fn() };
    client.terminal = { cols: 98, rows: 32 };

    const firstConnect = client.connect('session-1');
    await flushMicrotasks();
    const firstSocket = sockets[0];
    firstSocket._emit('message', {
      data: JSON.stringify({ type: 'ready', sessionId: 'session-1', cols: 98, rows: 32, inputReady: true, terminalAccess: { state: 'owner' } })
    });
    firstSocket._emit('message', {
      data: JSON.stringify({ type: 'status', mode: 'live', transport: 'streaming', copyMode: false })
    });
    await firstConnect;

    const secondConnect = client.connect('session-1');
    await flushMicrotasks();
    const secondSocket = sockets[1];

    secondSocket._emit('message', {
      data: JSON.stringify({ type: 'ready', sessionId: 'session-1', cols: 98, rows: 32, inputReady: true, terminalAccess: { state: 'owner' } })
    });
    secondSocket._emit('message', {
      data: JSON.stringify({ type: 'status', mode: 'live', transport: 'streaming', copyMode: false })
    });
    await secondConnect;

    expect(client.status.mode).toBe('live');

    firstSocket._emit('close', { code: 1006 });

    expect(client.status.mode).toBe('live');

    secondSocket._emit('close', { code: 1000 });
  });

  describe('Mobile scroll preservation (Bug#2)', () => {
    it('_writeToTerminal: pinned=false のとき次フレームでも_restoreViewportStateが再呼び出しされる', () => {
      const client = new TerminalTransportClient({
        viewerId: 'viewer-mobile-1',
        viewerLabel: 'Mobile'
      });
      const writeCallbacks = [];
      client.terminal = {
        write: vi.fn((text, cb) => { writeCallbacks.push(cb); }),
        scrollToBottom: vi.fn(),
        scrollToLine: vi.fn(),
        buffer: { active: { baseY: 100, viewportY: 80 } }
      };
      const restoreSpy = vi.spyOn(client, '_restoreViewportState');
      const rafCallbacks = [];
      vi.stubGlobal('requestAnimationFrame', (cb) => { rafCallbacks.push(cb); return rafCallbacks.length; });

      client._writeToTerminal('hello');
      writeCallbacks[0]?.();
      expect(restoreSpy).toHaveBeenCalledTimes(1);
      expect(restoreSpy.mock.calls[0][0].wasPinnedToBottom).toBe(false);

      expect(rafCallbacks).toHaveLength(1);
      rafCallbacks[0]?.();
      expect(restoreSpy).toHaveBeenCalledTimes(2);
    });

    it('_writeToTerminal: pinned=true のときは rAF再復元しない', () => {
      const client = new TerminalTransportClient({
        viewerId: 'viewer-mobile-2',
        viewerLabel: 'Mobile'
      });
      const writeCallbacks = [];
      client.terminal = {
        write: vi.fn((text, cb) => { writeCallbacks.push(cb); }),
        scrollToBottom: vi.fn(),
        scrollToLine: vi.fn(),
        buffer: { active: { baseY: 100, viewportY: 100 } }
      };
      const restoreSpy = vi.spyOn(client, '_restoreViewportState');
      const rafCallbacks = [];
      vi.stubGlobal('requestAnimationFrame', (cb) => { rafCallbacks.push(cb); return rafCallbacks.length; });

      client._writeToTerminal('hello');
      writeCallbacks[0]?.();
      expect(restoreSpy).toHaveBeenCalledTimes(1);
      expect(rafCallbacks).toHaveLength(0);
    });
  });
});
